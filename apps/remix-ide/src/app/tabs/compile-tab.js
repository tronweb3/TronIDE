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

/* global */
import React from 'react' // eslint-disable-line
import ReactDOM from 'react-dom'
import { SolidityCompiler, CompileTab as CompileTabLogic, parseContracts } from '@remix-ui/solidity-compiler' // eslint-disable-line
import { compile } from '@remix-project/remix-solidity'
import { ViewPlugin } from '@remixproject/engine-web'
import * as packageJson from '../../../../../package.json'

const EventEmitter = require('events')
const $ = require('jquery')
const yo = require('yo-yo')
var QueryParams = require('../../lib/query-params')
const addTooltip = require('../ui/tooltip')
const globalRegistry = require('../../global/registry')
const { requireUserPermission } = require('../ui/permission-security')

const profile = {
  name: 'solidity',
  displayName: 'Solidity compiler',
  icon: 'assets/img/solidity.webp',
  description: 'Compile solidity contracts',
  kind: 'compiler',
  permission: true,
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version,
  methods: ['getCompilationResult', 'compile', 'compileWithParameters', 'setCompilerConfig', 'compileFile', 'getCompilerVersion'],
  events: ['compilationFinished']
}

// EditorApi:
// - events: ['compilationFinished'],
// - methods: ['getCompilationResult']

class CompileTab extends ViewPlugin {
  constructor (editor, config, fileProvider, fileManager, contentImport) {
    super(profile)
    this.events = new EventEmitter()
    this._view = {
      el: null,
      warnCompilationSlow: null,
      errorContainer: null,
      contractEl: null
    }
    this.contentImport = contentImport
    this.queryParams = new QueryParams()
    this.fileProvider = fileProvider
    // dependencies
    this.editor = editor
    this.config = config
    this.fileManager = fileManager
    this.contractsDetails = {}
    this.data = {
      eventHandlers: {},
      loading: false
    }
    this.compileTabLogic = new CompileTabLogic(
      this.queryParams,
      this.fileManager,
      this.editor,
      this.config,
      this.fileProvider,
      this.contentImport,
      this.setCompileErrors.bind(this)
    )
    this.compiler = this.compileTabLogic.compiler
    this.compileTabLogic.init()
    this.contractMap = {}
    this.isHardHatProject = false
    this.compileErrors = {}
    this.compiledFileName = ''
    this.selectedVersion = ''
    this.configurationSettings = null

    this.el = document.createElement('div')
    this.el.setAttribute('id', 'compileTabView')
    this.el.remixEnsureRendered = () => this.ensureRendered()
  }

  _withUserPermission (method, message, action) {
    if (!this.currentRequest) return action()
    return requireUserPermission(this, method, message).then(action)
  }

  resetResults () {
    this.currentFile = ''
    this.contractsDetails = {}
    this.contractMap = {}
    this.compileErrors = {}
    this.compiledFileName = ''
    this.data.loading = false
    this.emit('statusChanged', { key: 'none' })
    this.renderComponent()
  }

  setCompileErrors (data) {
    this.compileErrors = data
    this.renderComponent()
  }

  isBuiltinCompilerUrl (url) {
    try {
      const parsed = new URL(url, window.location.href)
      return parsed.origin === window.location.origin && /\/assets\/js\/soljson\.js$/.test(parsed.pathname)
    } catch (e) {
      return false
    }
  }

  /************
   * EVENTS
   */

  listenToEvents () {
    this.data.eventHandlers.onContentChanged = () => {
      this.emit('statusChanged', { key: 'edited', title: 'the content has changed, needs recompilation', type: 'info' })
    }
    this.editor.event.register('contentChanged', this.data.eventHandlers.onContentChanged)

    this.data.eventHandlers.onLoadingCompiler = () => {
      this.ensureRendered()
      this.data.loading = true
      this.setCompileErrors({})
      this.emit('statusChanged', { key: 'loading', title: 'loading compiler...', type: 'info' })
    }
    this.compiler.event.register('loadingCompiler', this.data.eventHandlers.onLoadingCompiler)

    this.data.eventHandlers.onCompilerLoaded = () => {
      this.ensureRendered()
      this.data.loading = false
      this.emit('statusChanged', { key: 'none' })
    }
    this.compiler.event.register('compilerLoaded', this.data.eventHandlers.onCompilerLoaded)

    this.data.eventHandlers.onCompilerLoadedFromWorker = () => {
      this.ensureRendered()
      this.data.loading = false
      this.emit('statusChanged', { key: 'none' })
    }
    this.compiler.event.register('loadedFromWorker', this.data.eventHandlers.onCompilerLoadedFromWorker)

    this.data.eventHandlers.onCompilerLoadFailed = (message, url) => {
      this.data.loading = false
      this.setCompileErrors({ error: { formattedMessage: message, severity: 'error' } })
      this.ensureRendered()
      if (url && !this.isBuiltinCompilerUrl(url)) {
        // The compiler panel automatically recovers a failed remote load with
        // the bundled compiler. Keep the toolbar in a loading state during that
        // handoff instead of flashing a red error that disappears moments later.
        this.emit('statusChanged', { key: 'loading', title: 'loading built-in compiler fallback...', type: 'info' })
      } else {
        this.emit('statusChanged', { key: 'failed', title: message, type: 'error' })
      }
    }
    this.compiler.event.register('compilerLoadFailed', this.data.eventHandlers.onCompilerLoadFailed)

    this.data.eventHandlers.onStartingCompilation = () => {
      this.ensureRendered()
      this.setCompileErrors({})
      this.emit('statusChanged', { key: 'loading', title: 'compiling...', type: 'info' })
    }

    this.data.eventHandlers.onRemoveAnnotations = () => {
      this.call('editor', 'clearAnnotations')
    }

    this.data.eventHandlers.onWorkspaceChanged = (workspace) => {
      this.compileTabLogic.isHardhatProject().then((result) => {
        if (result && workspace.isLocalhost) this.isHardHatProject = true
        else this.isHardHatProject = false
        this.renderComponent()
      })
      this.resetResults()
    }
    this.on('filePanel', 'setWorkspace', this.data.eventHandlers.onWorkspaceChanged)

    this.compileTabLogic.event.on('startingCompilation', this.data.eventHandlers.onStartingCompilation)
    this.compileTabLogic.event.on('removeAnnotations', this.data.eventHandlers.onRemoveAnnotations)

    this.data.eventHandlers.onCurrentFileChanged = (name) => {
      this.currentFile = name
      this.renderComponent()
    }
    this.fileManager.events.on('currentFileChanged', this.data.eventHandlers.onCurrentFileChanged)

    this.data.eventHandlers.onNoFileSelected = () => {
      this.resetResults()
    }
    this.fileManager.events.on('noFileSelected', this.data.eventHandlers.onNoFileSelected)

    this.data.eventHandlers.onCompilationFinished = (success, data, source, context) => {
      this.data.loading = false
      this.setCompileErrors(data)
      const isCompilerLoadFailure = !success && context && context.compilerLoadFailure
      if (success) {
        // forwarding the event to the appManager infra. The 4th arg is the
        // language version: pass the real solc version the binary reported
        // (compiler.state.currentVersion, e.g. "0.8.20+commit.a1b79de6"),
        // not the literal 'soljson' the upstream code hardcoded — downstream
        // (compilerArtefacts.__last.languageversion, CV plugin, TronBox
        // export) all read this field and were forced to recover the version
        // from contract metadata instead (the stale-languageversion root cause).
        //
        // If the binary never reported a version, do NOT fall back to a fake
        // 'soljson' string (that re-breaks the version-honesty fix by lying
        // about the version). Emit an explicit 'unknown' instead — still a
        // string so downstream `.indexOf` consumers don't crash, but honest.
        const reportedVersion = this.compileTabLogic.compiler &&
          this.compileTabLogic.compiler.state &&
          this.compileTabLogic.compiler.state.currentVersion
        const languageVersion = reportedVersion || 'unknown'
        this.emit('compilationFinished', source.target, source, languageVersion, data)
        if (data.errors && data.errors.length > 0) {
          this.emit('statusChanged', {
            key: data.errors.length,
            title: `compilation finished successful with warning${data.errors.length > 1 ? 's' : ''}`,
            type: 'warning'
          })
        } else this.emit('statusChanged', { key: 'succeed', title: 'compilation successful', type: 'success' })
        // Store the contracts
        this.contractsDetails = {}
        this.compiler.visitContracts((contract) => {
          this.contractsDetails[contract.name] = parseContracts(
            contract.name,
            contract.object,
            this.compiler.getSource(contract.file)
          )
        })
      } else {
        const count = (data.errors ? data.errors.filter(error => error.severity === 'error').length : 0) + (data.error ? 1 : 0)
        // compilerLoadFailed runs immediately after this synthetic result. Let
        // that handler distinguish a recoverable remote load from a failed
        // builtin load; otherwise the toolbar briefly renders a red badge even
        // though recovery is already in progress.
        if (!isCompilerLoadFailure) {
          this.emit('statusChanged', { key: count, title: `compilation failed with ${count} error${count > 1 ? 's' : ''}`, type: 'error' })
        }
        // The bus 'compilationFinished' above is success-only, so consumers that
        // need to know a compile FAILED (e.g. the AI panel's compile tool, which
        // would otherwise wait out its timeout) get a dedicated event carrying
        // the same error data. A separate name keeps success-only consumers
        // (index builders, artifact stores) untouched.
        this.emit('compilationFailed', data, source && source.target, source)
      }
      // Update contract Selection
      this.contractMap = {}
      if (success) this.compiler.visitContracts((contract) => { this.contractMap[contract.name] = contract })
      this.renderComponent()
    }
    this.compiler.event.register('compilationFinished', this.data.eventHandlers.onCompilationFinished)

    this.data.eventHandlers.onThemeChanged = (theme) => {
      const invert = theme.quality === 'dark' ? 1 : 0
      const img = document.getElementById('swarmLogo')
      if (img) {
        img.style.filter = `invert(${invert})`
      }
    }
    globalRegistry.get('themeModule').api.events.on('themeChanged', this.data.eventHandlers.onThemeChanged)

    // Run the compiler instead of trying to save the website
    this.data.eventHandlers.onSaveShortcut = (e) => {
      // ctrl+s or command+s
      if ((e.metaKey || e.ctrlKey) && e.keyCode === 83) {
        e.preventDefault()
        this.compileTabLogic.runCompiler(this.hhCompilation)
      }
    }
    $(window).on('keydown', this.data.eventHandlers.onSaveShortcut)
  }

  setHardHatCompilation (value) {
    this.hhCompilation = value
  }

  setSelectedVersion (version) {
    this.selectedVersion = version
  }

  getCompilationResult () {
    return this._withUserPermission('getCompilationResult', 'read the latest compilation result', () => {
      return this.compileTabLogic.compiler.state.lastCompilationResult
    })
  }

  /**
   * compile using @arg fileName.
   * The module UI will be updated accordingly to the new compilation result.
   * This function is used by remix-plugin compiler API.
   * @param {string} fileName to compile
   */
  compile (fileName) {
    return this._withUserPermission('compile', 'compile a workspace file', () => {
      if (this.currentRequest) {
        addTooltip(yo`<div><b>${this.currentRequest.from}</b> is requiring to compile <b>${fileName}</b></div>`)
      }
      return this.compileTabLogic.compileFile(fileName)
    })
  }

  /**
   * compile using @arg compilationTargets and @arg settings
   * The module UI will *not* be updated, the compilation result is returned
   * This function is used by remix-plugin compiler API.
   * @param {object} map of source files.
   * @param {object} settings {evmVersion, optimize, runs, version, language}
   */
  async compileWithParameters (compilationTargets, settings) {
    await requireUserPermission(this, 'compileWithParameters', 'compile supplied source code')
    settings = { ...(settings || {}) }
    settings.version = settings.version || this.selectedVersion
    const contentResolver = (url, cb) => this.call('contentImport', 'resolveAndSave', url)
      .then((result) => cb(null, result))
      .catch((error) => cb(error && error.message ? error.message : String(error)))
    const res = await compile(compilationTargets, settings, contentResolver)
    return res
  }

  // This function is used for passing the compiler configuration to 'remix-tests'
  getCurrentCompilerConfig () {
    return {
      currentVersion: this.selectedVersion,
      evmVersion: this.compileTabLogic.evmVersion,
      optimize: this.compileTabLogic.optimize,
      runs: this.compileTabLogic.runs
    }
  }

  // The version string of the compiler binary that is actually LOADED (e.g.
  // "0.8.27+commit.19164bed.Emscripten.clang"), or '' before any loads. Lets
  // callers (the AI panel's set-version tool) confirm a version finished loading
  // rather than guess. Distinct from getCurrentCompilerConfig().currentVersion,
  // which reflects the SELECTION, not what has actually loaded.
  getCompilerVersion () {
    return this._withUserPermission('getCompilerVersion', 'read the loaded compiler version', () => {
      const c = this.compileTabLogic && this.compileTabLogic.compiler
      return (c && c.state && c.state.currentVersion) || ''
    })
  }

  /**
   * set the compiler configuration
   * This function is used by remix-plugin compiler API.
   * @param {object} settings {evmVersion, optimize, runs, version, language}
   */
  setCompilerConfig (settings) {
    return this._withUserPermission('setCompilerConfig', 'change the compiler configuration', () => {
      this.configurationSettings = settings
      this.renderComponent()
      // @todo(#2875) should use loading compiler return value to check whether the compiler is loaded instead of "setInterval"
      if (this.currentRequest) {
        addTooltip(yo`<div><b>${this.currentRequest.from}</b> is updating the <b>Solidity compiler configuration</b>.<pre class="text-left">${JSON.stringify(settings, null, '\t')}</pre></div>`)
      }
    })
  }

  // TODO : Add success alert when compilation succeed
  contractCompiledSuccess () {
    return yo`<div></div>`
  }

  // TODO : Add error alert when compilation failed
  contractCompiledError () {
    return yo`<div></div>`
  }

  /************
   * METHODS
   */

  selectContract (contractName) {
    this.selectedContract = contractName
  }

  render () {
    this.renderComponent()
    return this.el
  }

  renderComponent () {
    ReactDOM.render(
      <SolidityCompiler plugin={this}/>
      , this.el)
  }

  ensureRendered () {
    if (!this.el || this.el.childElementCount > 0) return
    this.renderComponent()
  }

  onActivation () {
    this.call('manager', 'activatePlugin', 'solidity-logic')
    this.listenToEvents()
    this.call('filePanel', 'registerContextMenuItem', {
      id: 'solidity',
      name: 'compileFile',
      label: 'Compile',
      type: [],
      extension: ['.sol'],
      path: [],
      pattern: []
    })
  }

  compileFile (event) {
    return this._withUserPermission('compileFile', 'compile a selected workspace file', () => {
      if (event.path.length > 0) {
        return this.compileTabLogic.compileFile(event.path[0])
      }
    })
  }

  onDeactivation () {
    this.editor.event.unregister('contentChanged')
    this.editor.event.unregister('sessionSwitched')
    this.editor.event.unregister('contentChanged', this.data.eventHandlers.onContentChanged)
    this.compiler.event.unregister('loadingCompiler', this.data.eventHandlers.onLoadingCompiler)
    this.compiler.event.unregister('compilerLoaded', this.data.eventHandlers.onCompilerLoaded)
    this.compiler.event.unregister('loadedFromWorker', this.data.eventHandlers.onCompilerLoadedFromWorker)
    this.compiler.event.unregister('compilerLoadFailed', this.data.eventHandlers.onCompilerLoadFailed)
    this.compileTabLogic.event.removeListener('startingCompilation', this.data.eventHandlers.onStartingCompilation)
    this.compileTabLogic.event.removeListener('removeAnnotations', this.data.eventHandlers.onRemoveAnnotations)
    this.fileManager.events.removeListener('currentFileChanged', this.data.eventHandlers.onCurrentFileChanged)
    this.fileManager.events.removeListener('noFileSelected', this.data.eventHandlers.onNoFileSelected)
    this.compiler.event.unregister('compilationFinished', this.data.eventHandlers.onCompilationFinished)
    globalRegistry.get('themeModule').api.events.removeListener('themeChanged', this.data.eventHandlers.onThemeChanged)
    this.off('filePanel', 'setWorkspace')
    $(window).off('keydown', this.data.eventHandlers.onSaveShortcut)
    this.call('manager', 'deactivatePlugin', 'solidity-logic')
  }
}

module.exports = CompileTab
