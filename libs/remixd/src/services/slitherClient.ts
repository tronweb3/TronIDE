/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint dot-notation: "off" */

import * as WS from 'ws' // eslint-disable-line
import { PluginClient } from '@remixproject/plugin'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as utils from '../utils'
import { OutputStandard } from '../types' // eslint-disable-line
const { spawn, execFileSync } = require('child_process')

export interface SlitherCommands {
  spawn: typeof spawn
  execFileSync: typeof execFileSync
}

const defaultSlitherCommands: SlitherCommands = { spawn, execFileSync }
const isLogicalTronTarget = (value: unknown): boolean => typeof value === 'string' && value.trim().toLowerCase() === 'tron'

export class SlitherClient extends PluginClient {
  methods: Array<string>
  websocket: WS
  currentSharedFolder: string

  constructor (private readOnly = false, private readonly commands: SlitherCommands = defaultSlitherCommands) {
    super()
    this.methods = ['analyse']
  }

  setWebSocket (websocket: WS): void {
    this.websocket = websocket
  }

  sharedFolder (currentSharedFolder: string): void {
    this.currentSharedFolder = currentSharedFolder
  }

  mapNpmDepsDir (list) {
    const remixNpmDepsPath = `${this.currentSharedFolder}/.deps/npm`
    const localNpmDepsPath = `${this.currentSharedFolder}/node_modules`
    const npmDepsExists = existsSync(remixNpmDepsPath)
    const nodeModulesExists = existsSync(localNpmDepsPath)
    let isLocalDep = false
    let isRemixDep = false
    let allowPathString = ''
    let remapString = ''

    for (const e of list) {
      const importPath = e.replace(/import ['"]/g, '').trim()
      const packageName = importPath.split('/')[0]
      if (nodeModulesExists && readdirSync(localNpmDepsPath).includes(packageName)) {
        isLocalDep = true
        remapString += `${packageName}=./node_modules/${packageName} `
      } else if (npmDepsExists && readdirSync(remixNpmDepsPath).includes(packageName)) {
        isRemixDep = true
        remapString += `${packageName}=./.deps/npm/${packageName} `
      }
    }
    if (isLocalDep) allowPathString += './node_modules,'
    if (isRemixDep) allowPathString += './.deps/npm,'

    return { remapString, allowPathString }
  }

  transform (detectors: Record<string, any>[]): OutputStandard[] {
    const standardReport: OutputStandard[] = []
    for (const e of detectors) {
      if (!e || typeof e !== 'object' || !Array.isArray(e.elements)) throw new Error('Invalid Slither detector result.')
      const obj = {} as OutputStandard
      obj.description = e.description
      obj.title = e.check
      obj.confidence = e.confidence
      obj.severity = e.impact
      obj.sourceMap = e.elements.map((element) => {
        if (!element || typeof element !== 'object' || !element.source_mapping || typeof element.source_mapping !== 'object') {
          throw new Error('Invalid Slither source mapping.')
        }
        // Do not mutate the parsed Slither object: callers may retain it for
        // diagnostics and a detector must not be able to alter shared state.
        const sourceMapping = { ...element.source_mapping }
        delete sourceMapping.filename_used
        delete sourceMapping.filename_absolute
        return { ...element, source_mapping: sourceMapping }
      })
      standardReport.push(obj)
    }
    return standardReport
  }

  analyse (filePath: string, compilerConfig: Record<string, any>) {
    return new Promise((resolve, reject) => {
      let tempDirectory: string | undefined
      let child: any
      let timeout: any
      let settled = false

      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        if (tempDirectory) {
          try { rmSync(tempDirectory, { recursive: true, force: true }) } catch (e) { console.debug('[Slither Analysis]: Failed to clean temporary report directory.', e) }
        }
      }
      const fail = (error: any) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      const succeed = (value: any) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }

      try {
        if (this.readOnly) throw new Error('[Slither Analysis]: Cannot analyse in read-only mode')
        const safeFilePath = assertSafeRelativePath(filePath)
        const fileAbsolutePath = utils.absolutePath(safeFilePath, this.currentSharedFolder)
        const sharedFolderRealPath = realpathSync(this.currentSharedFolder)
        const sourceRealPath = realpathSync(fileAbsolutePath)
        if (!isPathInside(sharedFolderRealPath, sourceRealPath)) throw new Error('Slither file path must stay inside the shared folder.')
        if (!compilerConfig || typeof compilerConfig !== 'object') throw new Error('Invalid Slither compiler configuration.')
        const options = { cwd: this.currentSharedFolder, shell: false }
        let compilerEnvironment = process.env
        const { currentVersion, optimize, evmVersion } = compilerConfig
        if (currentVersion && currentVersion.includes('+commit')) {
          // Get compiler version with commit id e.g: 0.8.2+commit.661d110
          const versionString: string = currentVersion.substring(0, currentVersion.indexOf('+commit') + 16)
          if (!/^\d+\.\d+\.\d+\+commit\.[0-9a-fA-F]{8}$/.test(versionString)) throw new Error('Invalid Solidity compiler version.')
          // Get compiler version without commit id e.g: 0.8.2. solc-select's
          // wrapper honors SOLC_VERSION per child process, avoiding the global
          // `solc-select use` state that can race between simultaneous scans.
          const version: string = versionString.substring(0, versionString.indexOf('+commit'))
          compilerEnvironment = { ...process.env, SOLC_VERSION: version }
          const compilerOptions = { ...options, env: compilerEnvironment }
          console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Compiler version is ${versionString}`)
          let solcOutput: Buffer | string | undefined
          // Check whether the request-local compiler version is installed.
          try {
            solcOutput = this.commands.execFileSync('solc', ['--version'], compilerOptions)
          } catch (_) {
            solcOutput = undefined
          }
          if (!solcOutput || !solcOutput.toString().includes(versionString)) {
            console.log('\x1b[32m%s\x1b[0m', '[Slither Analysis]: Installing the requested compiler version')
            // List solc versions installed using solc-select
            try {
              const solcSelectEnvironment = { ...process.env }
              delete solcSelectEnvironment.SOLC_VERSION
              const solcSelectOptions = { ...options, env: solcSelectEnvironment }
              const solcSelectInstalledVersions: Buffer = this.commands.execFileSync('solc-select', ['versions'], solcSelectOptions)
              // Check if required version is already installed
              const installed = solcSelectInstalledVersions.toString().split(/\r?\n/).some(line => line.trim().split(/\s+/)[0] === version)
              if (!installed) {
                console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Installing ${version} using solc-select`)
                // Install required version
                this.commands.execFileSync('solc-select', ['install', version], solcSelectOptions)
              }
              solcOutput = this.commands.execFileSync('solc', ['--version'], compilerOptions)
              if (!solcOutput.toString().includes(versionString)) throw new Error('The requested solc version could not be selected locally.')
            } catch (err) {
              console.log(err)
              throw new Error('Error in running solc-select command')
            }
          } else console.log('\x1b[32m%s\x1b[0m', '[Slither Analysis]: Requested compiler version is available')
        }
        // Allow paths and set solc remapping for import URLs
        const fileContent = readFileSync(fileAbsolutePath, 'utf8')
        const importsArr = fileContent.match(/import ['"][^.|..](.+?)['"];/g)
        let allowPaths = ''; let remaps = ''
        if (importsArr?.length) {
          const { remapString, allowPathString } = this.mapNpmDepsDir(importsArr)
          allowPaths = allowPathString
          remaps = remapString.trim()
        }
        const solcArgs: string[] = []
        if (allowPaths) solcArgs.push(`--allow-paths ${allowPaths}`)
        if (optimize) solcArgs.push('--optimize')
        // `tron` is the IDE's logical TVM target. It is not a valid solc/
        // Slither `--evm-version` value, so let the TRON compiler defaults
        // apply instead of making Slither fail before analysis starts.
        if (evmVersion && !isLogicalTronTarget(evmVersion)) {
          if (typeof evmVersion !== 'string' || !/^[A-Za-z0-9._-]+$/.test(evmVersion)) throw new Error('Invalid EVM version.')
          solcArgs.push(`--evm-version ${evmVersion}`)
        }

        // Keep the report outside the shared workspace. mkdtempSync creates a
        // unique directory atomically, so concurrent analyses cannot collide
        // and a workspace symlink cannot redirect Slither's output.
        tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'tronide-slither-'))
        const outputFile = path.join(tempDirectory, 'report.json')
        console.log('\x1b[32m%s\x1b[0m', '[Slither Analysis]: Running Slither...')
        // Added `stdio: 'ignore'` as for contract with NPM imports analysis which is exported in 'stderr'
        // get too big and hangs the process. We process analysis from the report file only
        const slitherArgs: string[] = [fileAbsolutePath]
        if (solcArgs.length) slitherArgs.push('--solc-args', solcArgs.join(' '))
        if (remaps) slitherArgs.push('--solc-remaps', remaps)
        slitherArgs.push('--json', outputFile)
        child = this.commands.spawn('slither', slitherArgs, { cwd: this.currentSharedFolder, shell: false, stdio: 'ignore', env: compilerEnvironment })

        timeout = setTimeout(() => {
          try { child.kill('SIGKILL') } catch (e) { console.debug('[Slither Analysis]: Failed to stop timed-out process.', e) }
          fail(new Error('Slither analysis timed out.'))
        }, SLITHER_TIMEOUT_MS)
        if (timeout.unref) timeout.unref()
        child.once('error', fail)
        child.once('close', (code) => {
          if (settled) return
          try {
            if (code !== 0) throw new Error(`Slither exited with code ${code}.`)
            const reportStat = lstatSync(outputFile)
            if (!reportStat.isFile()) throw new Error('Slither report is not a regular file.')
            const report = JSON.parse(readFileSync(outputFile, 'utf8'))
            if (!report || typeof report !== 'object' || report.success !== true) {
              console.log(report && report.error)
              throw new Error('Error in running Slither Analysis.')
            }
            const detectors = report.results && Array.isArray(report.results.detectors) ? report.results.detectors : []
            const response: any = { status: true, count: detectors.length }
            if (detectors.length) response.data = this.transform(detectors)
            console.log('\x1b[32m%s\x1b[0m', `[Slither Analysis]: Analysis Completed!! ${response.count} warnings found.`)
            succeed(response)
          } catch (error) {
            fail(error)
          }
        })
      } catch (error) {
        fail(error)
      }
    })
  }
}

const SLITHER_TIMEOUT_MS = 120000

function isPathInside (parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function assertSafeRelativePath (value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.indexOf('\0') !== -1 || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error('Slither file path must stay inside the shared folder.')
  }
  return value
}
