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

  getCompilerState () {
    return this.compiler.state
  }

  /**
   * Set the compiler to using Solidity or Yul (default to Solidity)
   * @params lang {'Solidity' | 'Yul'} ...
   */
  setLanguage (lang) {
    this.compiler.set('language', lang)
  }

  /**
   * Compile a specific file of the file manager
   * @param {string} target the path to the file to compile
   */
  compileFile (target) {
    if (!target) throw new Error('No target provided for compiliation')
    const provider = this.fileManager.fileProviderOf(target)
    if (!provider) throw new Error(`cannot compile ${target}. Does not belong to any explorer`)
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
      this.fileManager.saveCurrentFile()
      this.event.emit('removeAnnotations')
      var currentFile = this.config.get('currentFile')
      return this.compileFile(currentFile)
    } catch (err) {
      console.error(err)
    }
  }
}
