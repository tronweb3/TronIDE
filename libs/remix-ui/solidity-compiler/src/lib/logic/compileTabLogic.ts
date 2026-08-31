/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
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

import { Plugin } from '@remixproject/engine'

const packageJson = require('../../../../../../package.json')
const Compiler = require('@remix-project/remix-solidity').Compiler
const normalizeRuns = require('@remix-project/remix-solidity').normalizeRuns
const parseOptimizeParam = require('@remix-project/remix-solidity').parseOptimizeParam
const normalizeEvmVersion = require('@remix-project/remix-solidity').normalizeEvmVersion
const parseRemappings = require('@remix-project/remix-solidity').parseRemappings
const EventEmitter = require('events')
const profile = {
  name: 'solidity-logic',
  displayName: 'Solidity compiler logic',
  description: 'Compile solidity contracts - Logic',
  methods: ['getCompilerState'],
  version: packageJson.version
}
export class CompileTab extends Plugin {
  public compiler
  public optimize
  public runs
  public evmVersion: string
  public compilerImport
  public event

  constructor (public queryParams, public fileManager, public editor, public config, public fileProvider, public contentImport) {
    super(profile)
    this.event = new EventEmitter()
    this.compiler = new Compiler((url, cb) => this.call('contentImport', 'resolveAndSave', url).then((result) => cb(null, result)).catch((error) => cb(error.message)))
  }

  init () {
    // case-insensitive: accept TRUE/1/yes as well as true; unrecognised -> false
    this.optimize = parseOptimizeParam(this.queryParams.get().optimize) === true
    this.queryParams.update({ optimize: this.optimize })
    this.compiler.set('optimize', this.optimize)

    // normalizeRuns also maps the literal strings 'undefined'/'null' and any
    // out-of-range / non-integer hash value back to a solc-safe positive int.
    this.runs = normalizeRuns(this.queryParams.get().runs)
    this.queryParams.update({ runs: this.runs })
    this.compiler.set('runs', this.runs)

    // allowlist: only 'tron' is a valid target here; any other hash value
    // (incl. 'undefined'/'null'/garbage) -> null so it can't break the compile.
    this.evmVersion = normalizeEvmVersion(this.queryParams.get().evmVersion)
    this.queryParams.update({ evmVersion: this.evmVersion })
    this.compiler.set('evmVersion', this.evmVersion)
  }

  setOptimize (newOptimizeValue) {
    this.optimize = newOptimizeValue
    this.queryParams.update({ optimize: this.optimize })
    this.compiler.set('optimize', this.optimize)
  }

  setRuns (runs) {
    this.runs = normalizeRuns(runs)
    this.queryParams.update({ runs: this.runs })
    this.compiler.set('runs', this.runs)
  }

  setEvmVersion (newEvmVersion) {
    this.evmVersion = newEvmVersion
    this.queryParams.update({ evmVersion: this.evmVersion })
    this.compiler.set('evmVersion', this.evmVersion)
  }

  async getCompilerState () {
    await this.setCompilerMappings()
    return this.compiler.state
  }

  async setCompilerMappings () {
    // Clear first so an unreadable file or a workspace switch can never reuse
    // remappings loaded from the previous workspace.
    this.compiler.set('remappings', [])
    if (await this.fileManager.exists('remappings.txt')) {
      const content = await this.fileManager.readFile('remappings.txt')
      this.compiler.set('remappings', parseRemappings(content))
    }
  }

  /**
   * Set the compiler to using Solidity or Yul (default to Solidity)
   * @params lang {'Solidity' | 'Yul'} ...
   */
  setLanguage (lang) {
    this.compiler.set('language', lang)
  }

  isCompilableSource (target) {
    return typeof target === 'string' && /\.(sol|yul)$/i.test(target)
  }

  /**
   * Compile a specific file of the file manager
   * @param {string} target the path to the file to compile
   */
  async compileFile (target) {
    if (!target) throw new Error('No target provided for compiliation')
    // Markdown, JSON and other workspace files are editable but are not
    // compiler inputs. Ignore them before touching the compiler so saving a
    // README cannot surface a misleading Solidity parser error.
    if (!this.isCompilableSource(target)) return Promise.resolve(false)
    const provider = this.fileManager.fileProviderOf(target)
    if (!provider) throw new Error(`cannot compile ${target}. Does not belong to any explorer`)
    await this.setCompilerMappings()
    // Clear stale editor annotations up front. runCompiler (the toolbar path)
    // already does this, but a direct compileFile — the remix-plugin API and the
    // AI panel's compile tool — did not, so a previous compile's error markers
    // (e.g. a version-mismatch red on the pragma line) lingered after a later
    // compile SUCCEEDED. Clearing here covers every compile entry point.
    this.event.emit('removeAnnotations')
    return new Promise((resolve, reject) => {
      provider.get(target, (error, content) => {
        if (error) return reject(error)
        const sources = { [target]: { content } }
        this.event.emit('startingCompilation')
        // setTimeout fix the animation on chrome... (animation triggered by 'staringCompilation')
        setTimeout(() => { this.compiler.compile(sources, target); resolve(true) }, 100)
      })
    })
  }

  async isHardhatProject () {
    if (this.fileManager.mode === 'localhost') {
      return await this.fileManager.exists('hardhat.config.js')
    } else return false
  }

  runCompiler (hhCompilation) {
    try {
      // Ctrl/Cmd+S is also the editor's explicit save shortcut. Always persist
      // the current buffer, but only invoke Solidity/Yul compilation for source
      // files; non-contract files should be saved without validation noise.
      this.fileManager.saveCurrentFile()
      var currentFile = this.config.get('currentFile')
      if (!this.isCompilableSource(currentFile)) return false

      if (this.fileManager.mode === 'localhost' && hhCompilation) {
        const { currentVersion, optimize, runs } = this.compiler.state
        if (currentVersion) {
          const fileContent = `module.exports = {
            solidity: '${currentVersion.substring(0, currentVersion.indexOf('+commit'))}',
            settings: {
              optimizer: {
                enabled: ${optimize},
                runs: ${runs}
              }
            }
          }
          `
          const configFilePath = 'remix-compiler.config.js'
          this.fileManager.setFileContent(configFilePath, fileContent)
          this.call('hardhat', 'compile', configFilePath).then((result) => {
            this.call('terminal', 'log', { type: 'info', value: result })
          }).catch((error) => {
            this.call('terminal', 'log', { type: 'error', value: error })
          })
        }
      }
      this.event.emit('removeAnnotations')
      return this.compileFile(currentFile)
    } catch (err) {
      console.error(err)
    }
  }
}
