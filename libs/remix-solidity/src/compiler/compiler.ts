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

'use strict'

import { update } from 'solc/abi'
import compilerInput from './compiler-input'
import EventManager from '../lib/eventManager'
import txHelper from './txHelper'
import { assertAllowedCompilerURL, BUILTIN_SOLC_VERSION, integrityFromCompilerURL, compilerIntegrityToSRI } from './compiler-utils'
import { normalizeRuns } from './runs'
import {
  Source, SourceWithTarget, MessageFromWorker, CompilerState, CompilationResult,
  visitContractsCallbackParam, visitContractsCallbackInterface, CompilationError,
  gatherImportsCallbackInterface,
  isFunctionDescription,
  EsWebWorkerHandlerInterface
} from './types'

/*
  trigger compilationFinished, compilerLoaded, compilationStarted, compilationDuration
*/

// Watchdog for loading a compiler binary. Solc builds are large (9–26 MB) and
// must DOWNLOAD, then PARSE + EXECUTE before window.Module is ready, so on a
// slower connection a good load easily needs 30–60s. The old 30s cut good
// loads short — every version switch would time out mid-download and fall back
// to the builtin, so the version selector looked "stuck". Keep a bound (a
// genuinely dead load must still fail), but a generous one.
const COMPILER_LOAD_TIMEOUT_MS = 120000
// A remote compiler is an optional network dependency. Keep a finite bound,
// but allow enough time for the 15–30 MB Tron solc wasm/asm.js payload on a
// slow or rate-limited connection. The UI still falls back with a clear error
// once this watchdog expires; it must not wait forever or falsely reject a
// healthy, slow download.
const REMOTE_COMPILER_LOAD_TIMEOUT_MS = 60000

export class Compiler {
  event
  state: CompilerState
  workerHandler: EsWebWorkerHandlerInterface
  // watchdog timers of the in-flight load; a stale one firing after a newer
  // loadVersion() would terminate the new worker and misreport the old URL.
  // A Set lets completed timers remove themselves instead of retaining every
  // handle created during a long-lived compiler session.
  private pendingLoadHandles: Set<number> = new Set()
  // Every load (worker or script) owns one generation. Dynamic script downloads
  // are not guaranteed to stop executing merely because their element was
  // removed, so callbacks must also prove they still belong to the newest load.
  private compilerLoadGeneration = 0
  private activeCompilerScript: HTMLScriptElement | null = null
  // A compile request can outlive a later request while imports or a worker are
  // still pending. Carry this generation with the request and discard stale
  // results instead of letting them overwrite the latest artefacts.
  private compilationGeneration = 0
  // Non-UI consumers can request a compile while the selected solc binary is
  // still loading. Replay the newest request after compilerLoaded instead of
  // surfacing the transient "Compiler is still loading" error.
  private pendingCompilation: SourceWithTarget | null = null
  private compilerLoadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'

  constructor (public handleImportCall?: (fileurl: string, cb) => void) {
    this.event = new EventManager()
    this.state = {
      compileJSON: null,
      worker: null,
      currentVersion: null,
      optimize: false,
      runs: 200,
      remappings: [],
      evmVersion: null,
      language: 'Solidity',
      compilationStartTime: null,
      target: null,
      lastCompilationResult: {
        data: null,
        source: null
      }
    }
    this.loadWorkerHandler()

    this.event.register('compilationFinished', (success: boolean, data: CompilationResult, source: SourceWithTarget) => {
      if (success && this.state.compilationStartTime) {
        this.event.trigger('compilationDuration', [(new Date().getTime()) - this.state.compilationStartTime])
      }
      this.state.compilationStartTime = null
    })

    this.event.register('compilationStarted', () => {
      this.state.compilationStartTime = new Date().getTime()
    })
  }

  /**
   * Release resources owned by this compiler instance.
   *
   * AI test runs create a compiler for a single request. A timed-out request
   * must not leave its worker, watchdog timers, compiler script, or pending
   * compilation alive while the next request starts. Generation bumps make
   * callbacks from an uncancellable script/worker stale before the resources
   * are released.
   */
  dispose (): void {
    this.compilerLoadGeneration++
    this.compilationGeneration++
    this.compilerLoadState = 'idle'
    this.pendingCompilation = null
    this.clearPendingLoadHandles()
    this.removeActiveCompilerScript()
    if (this.state.worker) {
      try {
        this.state.worker.terminate()
      } catch (e) {
        // A worker may already have terminated after reporting an error.
      }
      this.state.worker = null
    }
    this.state.compileJSON = null
    this.state.compilationStartTime = null
    this.state.currentVersion = null
    this.state.lastCompilationResult = { data: null, source: null }
  }

  /**
   * @dev Setter function for CompilerState's properties (used by IDE)
   * @param key key
   * @param value value of key in CompilerState
   */

  set <K extends keyof CompilerState> (key: K, value: CompilerState[K]): void {
    this.state[key] = value
    if (key === 'runs') this.state['runs'] = normalizeRuns(value)
  }

  async loadWorkerHandler () {
    if (this.workerHandler) return
    if (typeof (window) !== 'undefined' && Worker) {
      const ESWebWorker = await import('../lib/es-web-worker/es-web-worker-handler')
      this.workerHandler = new ESWebWorker.default()
    }
  }

  /**
   * @dev Internal function to compile the contract after gathering imports
   * @param files source file
   * @param missingInputs missing import file path list
   */

  internalCompile (files: Source, missingInputs?: string[], request?: SourceWithTarget): void {
    const compilationRequest: SourceWithTarget = request || {
      sources: files,
      target: this.state.target,
      generation: this.compilationGeneration
    }
    this.gatherImports(files, missingInputs, (error, input) => {
      if (compilationRequest.generation !== undefined && compilationRequest.generation !== this.compilationGeneration) return
      if (error) {
        this.state.lastCompilationResult = null
        this.event.trigger('compilationFinished', [false, { error: { formattedMessage: error instanceof Error ? error.message : String(error), severity: 'error' } }, compilationRequest])
      } else if (this.state.compileJSON && input) {
        this.state.compileJSON({
          ...input,
          target: compilationRequest.target,
          generation: compilationRequest.generation
        })
      } else if (!this.state.compileJSON) {
        this.onCompilationFinished({ error: { formattedMessage: 'Compiler is not ready', severity: 'error' } }, undefined, compilationRequest)
      }
    })
  }

  /**
   * @dev Compile source files (used by IDE)
   * @param files source files
   * @param target target file name (This is passed as it is to IDE)
   */

  compile (files: Source, target: string): void {
    const generation = ++this.compilationGeneration
    this.state.target = target
    this.event.trigger('compilationStarted', [])
    const request = { sources: files, target, generation }
    if (!this.state.currentVersion && this.compilerLoadState === 'loading') {
      this.pendingCompilation = request
      return
    }
    this.pendingCompilation = null
    this.internalCompile(files, undefined, request)
  }

  /**
   * @dev Called when compiler is loaded, set current compiler version
   * @param version compiler version
   */

  onCompilerLoaded (version: string): void {
    this.state.currentVersion = version
    this.compilerLoadState = 'ready'
    const pending = this.pendingCompilation
    this.pendingCompilation = null
    this.event.trigger('compilerLoaded', [version])
    if (pending && pending.generation === this.compilationGeneration) {
      // Let compilerLoaded listeners finish updating their UI before replaying
      // the request, and avoid re-entrant compilation from those listeners.
      Promise.resolve().then(() => {
        if (pending.generation === this.compilationGeneration && this.state.currentVersion) {
          this.internalCompile(pending.sources, undefined, pending)
        }
      })
    }
  }

  onCompilerLoadFailed (message: string, url?: string, invalidateCompiler = false): void {
    this.compilerLoadState = 'failed'
    const pending = this.pendingCompilation
    this.pendingCompilation = null
    if (invalidateCompiler) {
      if (this.state.worker) this.state.worker.terminate()
      this.state.worker = null
      this.setCompilerUnavailable(message)
    }
    this.state.lastCompilationResult = null
    // Mark this synthetic compilation result so UI consumers can keep the
    // loading state while a remote-source failure is being recovered with the
    // builtin compiler. Real contract diagnostics must still surface as red
    // failures; compilerLoadFailed below decides whether recovery is possible.
    this.event.trigger('compilationFinished', [
      false,
      { error: { formattedMessage: message, severity: 'error' } },
      pending || {},
      { compilerLoadFailure: true, url }
    ])
    this.event.trigger('compilerLoadFailed', [message, url])
  }

  private setCompilerUnavailable (message = 'Compiler not yet loaded.'): void {
    this.state.currentVersion = null
    this.state.lastCompilationResult = null
    this.state.compileJSON = (source: SourceWithTarget) => {
      this.onCompilationFinished({ error: { formattedMessage: message, severity: 'error' } }, undefined, source)
    }
  }

  /**
   * @dev Called when compiler is loaded internally (without worker)
   */

  async onInternalCompilerLoaded (loadGeneration = this.compilerLoadGeneration, pendingModule?: any, expectedVersion?: string | null, requestedUrl?: string): Promise<void> {
    if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== null) return
    try {
      // The browser already downloads the selected soljson binary as a
      // versioned script (or the bundled assets/js/soljson.js fallback). A
      // static dependency on the full solc package also embedded its own
      // ~9 MB soljson in main.js, duplicating the compiler before the user opened
      // the compiler panel. Load only the small wrapper on the browser path;
      // keep the full Node compiler behind an async boundary for CLI users.
      let compiler: any
      const internalModule = pendingModule || (typeof window !== 'undefined' && window['Module'])
      if (typeof window !== 'undefined' && internalModule) {
        const wrapperModule: any = await import(/* webpackChunkName: "solc-wrapper" */ 'solc/wrapper')
        // A version switch can replace Module or start a Worker while this
        // tiny wrapper chunk is loading. Never let the stale request overwrite
        // the newer compiler state.
        if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== null) return
        const wrapper = wrapperModule.default || wrapperModule
        compiler = wrapper(internalModule)
      } else {
        const solcModule: any = await import(/* webpackChunkName: "solc-node" */ 'solc')
        if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== null) return
        compiler = solcModule.default || solcModule
      }
      const loadedVersion = compiler.version()
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== null) return
      if (expectedVersion && !this.compilerVersionMatches(loadedVersion, expectedVersion)) {
        this.onCompilerLoadFailed(`Loaded compiler version ${loadedVersion} does not match requested version ${expectedVersion}`, requestedUrl, true)
        return
      }
      const compileJSON = (source: SourceWithTarget) => {
        const missingInputs: string[] = []
        const missingInputsCallback = (path: string) => {
          missingInputs.push(path)
          return { error: 'Deferred import' }
        }
        let result: CompilationResult = {}
        try {
          if (source && source.sources) {
            const { optimize, runs, remappings, evmVersion, language } = this.state
            const input = compilerInput(source.sources, { optimize, runs, remappings, evmVersion, language })
            result = JSON.parse(compiler.compile(input, { import: missingInputsCallback }))
          }
        } catch (exception) {
          result = { error: { formattedMessage: 'Uncaught JavaScript exception:\n' + exception, severity: 'error', mode: 'panic' } }
        }
        this.onCompilationFinished(result, missingInputs, source)
      }
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== null) return
      this.state.compileJSON = compileJSON
      this.onCompilerLoaded(loadedVersion)
    } catch (error) {
      if (!this.isCurrentCompilerLoad(loadGeneration)) return
      this.onCompilerLoadFailed(`Failed to initialise compiler: ${error && error.message ? error.message : String(error)}`, requestedUrl, true)
    }
  }

  /**
   * @dev Called when compilation is finished
   * @param data compilation result data
   * @param missingInputs missing imports
   * @param source Source
   */

  onCompilationFinished (data: CompilationResult, missingInputs?: string[], source?: SourceWithTarget): void {
    // A later compile supersedes an older asynchronous request. Do not emit a
    // stale success/failure event or replace lastCompilationResult with it.
    if (source && source.generation !== undefined && source.generation !== this.compilationGeneration) return
    let noFatalErrors = true // ie warnings are ok

    const checkIfFatalError = (error: CompilationError) => {
      // Ignore warnings and the 'Deferred import' error as those are generated by us as a workaround
      const isValidError = (error.message && error.message.includes('Deferred import')) ? false : error.severity !== 'warning'
      if (isValidError) noFatalErrors = false
    }
    if (data.error) checkIfFatalError(data.error)
    if (data.errors) data.errors.forEach((err) => checkIfFatalError(err))
    if (!noFatalErrors) {
      // There are fatal errors, abort here
      this.state.lastCompilationResult = null
      this.event.trigger('compilationFinished', [false, data, source])
    } else if (missingInputs !== undefined && missingInputs.length > 0 && source && source.sources) {
      // try compiling again with the new set of inputs
      this.internalCompile(source.sources, missingInputs, source)
    } else {
      data = this.updateInterface(data)
      if (source) {
        source = {
          ...source,
          target: source.target !== undefined ? source.target : this.state.target
        }
        this.state.lastCompilationResult = {
          data: data,
          source: source
        }
      }
      this.event.trigger('compilationFinished', [true, data, source])
    }
  }

  /**
   * @dev Load compiler using given version (used by remix-tests CLI)
   * @param version compiler version
   */

  loadRemoteVersion (version: string): void {
    console.log(`Loading remote solc version ${version} ...`)
    this.compilerLoadState = 'loading'
    const loadGeneration = ++this.compilerLoadGeneration
    this.clearPendingLoadHandles()
    this.removeActiveCompilerScript()
    if (this.state.worker) {
      this.state.worker.terminate()
      this.state.worker = null
    }
    // Do not leave a previously loaded compiler available while the requested
    // remote compiler is being imported.
    this.setCompilerUnavailable()
    let remoteLoadTimeout: number | undefined
    const failRemoteLoad = (message: string) => {
      if (!this.isCurrentCompilerLoad(loadGeneration)) return
      this.clearLoadHandle(remoteLoadTimeout)
      // Invalidate the generation before surfacing the error. The dynamic
      // import and solc callback cannot be cancelled and must not publish a
      // compiler after the watchdog has failed the request.
      this.compilerLoadGeneration++
      this.onCompilerLoadFailed(message, version, true)
    }
    const onRemoteLoadFinished = () => {
      this.clearLoadHandle(remoteLoadTimeout)
      remoteLoadTimeout = undefined
    }
    remoteLoadTimeout = this.registerLoadHandle(this.createLoadTimeout(() => {
      failRemoteLoad(`Remote solc compiler load timed out after ${Math.round(COMPILER_LOAD_TIMEOUT_MS / 1000)}s: ${version}`)
    }, COMPILER_LOAD_TIMEOUT_MS))
    // This API is for remix-tests/CLI. Keep it available without forcing the
    // full native solc payload into the browser's first-load dependency graph.
    import(/* webpackChunkName: "solc-node" */ 'solc').then((solcModule: any) => {
      if (!this.isCurrentCompilerLoad(loadGeneration)) return
      const compiler: any = solcModule.default || solcModule
      const wantedMatch = version.match(/(v\d+\.\d+\.\d+)/)
      if (!wantedMatch) {
        onRemoteLoadFinished()
        failRemoteLoad(`Invalid remote solc version: ${version}`)
        return
      }
      const wanted = wantedMatch[1]
      try {
        compiler.loadRemoteVersion(wanted, (err, remoteCompiler) => {
          if (!this.isCurrentCompilerLoad(loadGeneration)) return
          onRemoteLoadFinished()
          if (err) {
            console.error('Error in loading remote solc compiler: ', err)
            failRemoteLoad(`Error loading remote solc compiler ${wanted}: ${err.message || err}`)
          } else {
            this.state.compileJSON = (source: SourceWithTarget) => {
              const missingInputs: string[] = []
              const missingInputsCallback = (path: string) => {
                missingInputs.push(path)
                return { error: 'Deferred import' }
              }
              let result: CompilationResult = {}
              try {
                if (source && source.sources) {
                  const { optimize, runs, remappings, evmVersion, language } = this.state
                  const input = compilerInput(source.sources, { optimize, runs, remappings, evmVersion, language })
                  result = JSON.parse(remoteCompiler.compile(input, { import: missingInputsCallback }))
                }
              } catch (exception) {
                result = { error: { formattedMessage: 'Uncaught JavaScript exception:\n' + exception, severity: 'error', mode: 'panic' } }
              }
              this.onCompilationFinished(result, missingInputs, source)
            }
            this.onCompilerLoaded(wanted)
          }
        })
      } catch (error) {
        onRemoteLoadFinished()
        failRemoteLoad(`Error loading remote solc compiler ${wanted}: ${error && error.message ? error.message : String(error)}`)
      }
    }).catch((error) => {
      console.error('Error in loading solc module: ', error)
      if (!this.isCurrentCompilerLoad(loadGeneration)) return
      onRemoteLoadFinished()
      failRemoteLoad(`Error loading solc module: ${error && error.message ? error.message : String(error)}`)
    })
  }

  /**
   * @dev Load compiler using given URL (used by IDE)
   * @param usingWorker if true, load compiler using worker
   * @param url URL to load compiler from
   */

  async loadVersion (usingWorker: boolean, url: string): Promise<void> {
    try {
      url = assertAllowedCompilerURL(url)
    } catch (e) {
      // surface through the standard failure path (panel error + event)
      // instead of an unhandled promise rejection nothing listens to
      this.onCompilerLoadFailed(e && e.message ? e.message : String(e), url)
      return
    }
    const loadGeneration = ++this.compilerLoadGeneration
    this.compilerLoadState = 'loading'
    this.clearPendingLoadHandles()
    this.removeActiveCompilerScript()
    if (this.state.worker) {
      this.state.worker.terminate()
      this.state.worker = null
    }
    // A valid selection supersedes the old compiler immediately. The UI does
    // not disable every compile entry point while the worker-handler chunk or
    // compiler script is loading, so retaining the old function here could
    // compile with A after the user selected B.
    this.setCompilerUnavailable()
    console.log('Loading ' + url + ' ' + (usingWorker ? 'with worker' : 'without worker'))
    this.event.trigger('loadingCompiler', [url, usingWorker])
    if (usingWorker) {
      try {
        await Promise.race([
          this.loadWorkerHandler(),
          new Promise((resolve, reject) => window.setTimeout(() => reject(new Error('Worker handler load timed out after 5s')), 5000))
        ])
      } catch (e) {
        console.warn(e)
      }
      if (!this.isCurrentCompilerLoad(loadGeneration)) return
      const loadTimeoutMs = this.compilerLoadTimeoutMs(url)
      if (this.workerHandler) this.loadWorker(url, loadGeneration, integrityFromCompilerURL(url), loadTimeoutMs)
      else this.loadInternal(url, loadGeneration, integrityFromCompilerURL(url), loadTimeoutMs)
    } else {
      this.loadInternal(url, loadGeneration, integrityFromCompilerURL(url))
    }
  }

  private isCurrentCompilerLoad (loadGeneration: number): boolean {
    return loadGeneration === this.compilerLoadGeneration
  }

  private clearPendingLoadHandles (): void {
    // clearTimeout also clears interval handles (they share one namespace)
    for (const handle of this.pendingLoadHandles) this.clearLoadHandle(handle)
    this.pendingLoadHandles.clear()
  }

  private registerLoadHandle (handle: number): number {
    this.pendingLoadHandles.add(handle)
    return handle
  }

  private clearLoadHandle (handle: number | undefined, interval = false): void {
    if (handle === undefined) return
    if (typeof window !== 'undefined') {
      if (interval) window.clearInterval(handle)
      else window.clearTimeout(handle)
    } else if (interval) {
      clearInterval(handle as any)
    } else {
      clearTimeout(handle as any)
    }
    this.pendingLoadHandles.delete(handle)
  }

  private createLoadTimeout (callback: () => void, delay: number): number {
    if (typeof window !== 'undefined') return window.setTimeout(callback, delay)
    return setTimeout(callback, delay) as unknown as number
  }

  private removeActiveCompilerScript (): void {
    const script = this.activeCompilerScript
    this.activeCompilerScript = null
    if (script && script.parentNode) script.parentNode.removeChild(script)
  }

  private expectedCompilerVersion (url: string): string | null {
    try {
      const pathname = decodeURIComponent(new URL(url, window.location.href).pathname)
      if (/\/assets\/js\/soljson\.js$/.test(pathname)) return BUILTIN_SOLC_VERSION
      // A compiler release is identified by both semver and commit. Comparing
      // only x.y.z accepts a different build published under the same semantic
      // version. Builtin intentionally remains semver-only because its local
      // asset is pinned and independently checked by the build consistency job.
      const fileName = pathname.substring(pathname.lastIndexOf('/') + 1)
      const version = /soljson[-_]v?(\d+\.\d+\.\d+)/i.exec(fileName)
      if (!version) return null
      const commit = /\+commit\.([0-9a-z]+)/i.exec(fileName)
      return commit ? `${version[1]}+commit.${commit[1]}` : version[1]
    } catch (_) {
      return null
    }
  }

  private compilerLoadTimeoutMs (url: string): number {
    try {
      const pathname = decodeURIComponent(new URL(url, typeof window !== 'undefined' ? window.location.href : undefined).pathname)
      return /\/assets\/js\/soljson\.js$/.test(pathname) ? COMPILER_LOAD_TIMEOUT_MS : REMOTE_COMPILER_LOAD_TIMEOUT_MS
    } catch (_) {
      return REMOTE_COMPILER_LOAD_TIMEOUT_MS
    }
  }

  private compilerVersionMatches (actualVersion: string, expectedVersion: string): boolean {
    const semanticVersion = (value: string) => /^v?(\d+\.\d+\.\d+)/i.exec(value || '')
    const commitIdentity = (value: string) => /\+commit\.([0-9a-z]+)/i.exec(value || '')
    const actual = semanticVersion(actualVersion)
    const expected = semanticVersion(expectedVersion)
    if (!actual || !expected || actual[1] !== expected[1]) return false
    const actualCommit = commitIdentity(actualVersion)
    const expectedCommit = commitIdentity(expectedVersion)
    // A URL without a commit (including the builtin pin) can only assert the
    // semantic version. When the URL supplies a commit, require that exact
    // identity while allowing solc's trailing platform label.
    return !expectedCommit || (!!actualCommit && actualCommit[1].toLowerCase() === expectedCommit[1].toLowerCase())
  }

  /**
   * @dev Load compiler using 'script' element (without worker)
   * @param url URL to load compiler from
   */

  loadInternal (url: string, loadGeneration = this.compilerLoadGeneration, integrity?: string, loadTimeoutMs = this.compilerLoadTimeoutMs(url)): void {
    if (!this.isCurrentCompilerLoad(loadGeneration)) return
    delete window['Module']
    // NOTE: workaround some browsers?
    window['Module'] = undefined
    // loadVersion already installed a fail-closed compile function. Keep the
    // direct loadInternal API safe as well.
    this.setCompilerUnavailable()
    const newScript: HTMLScriptElement = document.createElement('script')
    newScript.type = 'text/javascript'
    newScript.src = url
    const sri = compilerIntegrityToSRI(integrity)
    if (sri) {
      newScript.integrity = sri
      newScript.crossOrigin = 'anonymous'
    }
    this.activeCompilerScript = newScript
    const expectedVersion = this.expectedCompilerVersion(url)
    let check: number | undefined
    let loadTimeout: number | undefined
    let scriptLoaded = false
    let initialising = false
    const cleanup = () => {
      this.clearLoadHandle(check, true)
      this.clearLoadHandle(loadTimeout)
      check = undefined
      loadTimeout = undefined
      if (this.activeCompilerScript === newScript) this.removeActiveCompilerScript()
    }
    const initialise = () => {
      // Emscripten creates Module before wiring cwrap.  `script.onload` may
      // therefore fire while the object exists but is not usable yet; waiting
      // for cwrap keeps the non-worker retry from racing compiler setup.
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.activeCompilerScript !== newScript || !scriptLoaded || initialising || !window['Module'] || typeof window['Module'].cwrap !== 'function') return
      initialising = true
      const loadedModule = window['Module']
      cleanup()
      this.onInternalCompilerLoaded(loadGeneration, loadedModule, expectedVersion, url)
    }
    check = this.registerLoadHandle(window.setInterval(() => {
      if (!this.isCurrentCompilerLoad(loadGeneration)) return
      initialise()
    }, 200))
    loadTimeout = this.registerLoadHandle(window.setTimeout(() => {
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.activeCompilerScript !== newScript) return
      cleanup()
      this.onCompilerLoadFailed(`Compiler load timed out after ${Math.round(loadTimeoutMs / 1000)}s: ${url}`, url, true)
    }, loadTimeoutMs))
    newScript.onload = () => {
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.activeCompilerScript !== newScript) return
      scriptLoaded = true
      initialise()
    }
    newScript.onerror = () => {
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.activeCompilerScript !== newScript) return
      cleanup()
      this.onCompilerLoadFailed(`Failed to load compiler from ${url}`, url, true)
    }
    document.getElementsByTagName('head')[0].appendChild(newScript)
  }

  /**
   * @dev Load compiler using web worker
   * @param url URL to load compiler from
   */

  loadWorker (url: string, loadGeneration = this.compilerLoadGeneration, integrity?: string, loadTimeoutMs = this.compilerLoadTimeoutMs(url)): void {
    if (!this.isCurrentCompilerLoad(loadGeneration)) return
    this.state.worker = this.workerHandler.getWorker()
    const worker = this.state.worker
    const expectedVersion = this.expectedCompilerVersion(url)
    const jobs = new Map<number, SourceWithTarget>()
    const recycledJobIds: number[] = []
    let nextJobId = 0
    let workerReady = false
    let loadTimeout: number | undefined
    const clearWorkerLoadTimeout = () => {
      this.clearLoadHandle(loadTimeout)
      loadTimeout = undefined
    }

    this.state.worker.addEventListener('message', (msg: Record <'data', MessageFromWorker>) => {
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== worker) return
      const data: MessageFromWorker = msg.data
      switch (data.cmd) {
        case 'versionLoaded':
          clearWorkerLoadTimeout()
          if (!data.data) {
            this.onCompilerLoadFailed('Worker compiler loaded without reporting a version', url, true)
          } else if (expectedVersion && !this.compilerVersionMatches(data.data, expectedVersion)) {
            this.onCompilerLoadFailed(`Loaded compiler version ${data.data} does not match requested version ${expectedVersion}`, url, true)
          } else {
            workerReady = true
            this.state.compileJSON = postCompile
            this.onCompilerLoaded(data.data)
          }
          break
        case 'compiled':
        {
          let result: CompilationResult
          if (data.job === undefined || !Number.isInteger(data.job) || data.job < 0 || !jobs.has(data.job)) {
            this.onCompilerLoadFailed('Worker returned an unknown compilation job', url, true)
            break
          }
          try {
            result = data.data ? JSON.parse(data.data) : { error: { formattedMessage: 'Worker returned empty compiler output', severity: 'error' } }
          } catch (exception) {
            result = { error: { formattedMessage: 'Invalid JSON output from the compiler: ' + exception, severity: 'error' } }
          }
          const source = jobs.get(data.job)
          jobs.delete(data.job)
          recycledJobIds.push(data.job)
          this.onCompilationFinished(result, data.missingInputs, source)
          break
        }
        case 'loadFailed':
          {
            const detail = data.error || 'Worker failed to load compiler'
            this.onCompilerLoadFailed(/^Worker error\s*:/i.test(detail) ? detail : `Worker error: ${detail}`, url, true)
          }
          break
      }
    })

    this.state.worker.addEventListener('error', (event: ErrorEvent) => {
      // Stop the worker's importScripts NetworkError (and any other worker
      // throw) from bubbling to window and tripping the webpack-dev-server
      // runtime-error overlay. We're surfacing it via onCompilationFinished
      // below, which is the user-visible path.
      event.preventDefault()
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== worker) return
      clearWorkerLoadTimeout()
      const detail = event.message || event.error?.message || event.filename || 'unknown error'
      this.onCompilerLoadFailed('Worker error: ' + detail, url, true)
    })

    const postCompile = (source: SourceWithTarget) => {
      if (source && source.sources) {
        const { optimize, runs, remappings, evmVersion, language } = this.state
        const job = recycledJobIds.length > 0 ? recycledJobIds.pop() as number : nextJobId++
        jobs.set(job, source)
        this.state.worker.postMessage({
          cmd: 'compile',
          job,
          input: compilerInput(source.sources, { optimize, runs, remappings, evmVersion, language })
        })
      }
    }
    // Keep the compiler fail-closed until the worker has imported soljson and
    // reported a version. A compile request during this window must produce a
    // deterministic failure, never a silently dropped job.
    this.state.compileJSON = (source: SourceWithTarget) => {
      if (!workerReady) {
        this.onCompilationFinished({ error: { formattedMessage: 'Compiler is still loading', severity: 'error' } }, undefined, source)
        return
      }
      postCompile(source)
    }

    loadTimeout = this.registerLoadHandle(window.setTimeout(() => {
      if (!this.isCurrentCompilerLoad(loadGeneration) || this.state.worker !== worker) return
      clearWorkerLoadTimeout()
      if (this.state.worker) {
        worker.terminate()
        this.state.worker = null
      }
      this.onCompilerLoadFailed(`Worker compiler load timed out after ${Math.round(loadTimeoutMs / 1000)}s: ${url}`, url, true)
    }, loadTimeoutMs))
    this.state.worker.postMessage({
      cmd: 'loadVersion',
      data: url,
      integrity
    })
  }

  /**
   * @dev Gather imports for compilation
   * @param files file sources
   * @param importHints import file list
   * @param cb callback
   */

  gatherImports (files: Source, importHints?: string[], cb?: gatherImportsCallbackInterface): void {
    importHints = importHints || []
    // FIXME: This will only match imports if the file begins with one '.'
    // It should tokenize by lines and check each.
    const importRegex = /^\s*import\s*['"]([^'"]+)['"];/g
    for (const fileName in files) {
      let match: RegExpExecArray | null
      while ((match = importRegex.exec(files[fileName].content))) {
        let importFilePath = match[1]
        if (importFilePath.startsWith('./')) {
          const path: RegExpExecArray | null = /(.*\/).*/.exec(fileName)
          importFilePath = path ? importFilePath.replace('./', path[1]) : importFilePath.slice(2)
        }
        if (!importHints.includes(importFilePath)) importHints.push(importFilePath)
      }
    }
    while (importHints.length > 0) {
      const m: string = importHints.pop() as string
      if (m && m in files) continue

      if (this.handleImportCall) {
        this.handleImportCall(m, (err, content: string) => {
          if (err && cb) cb(err)
          else {
            files[m] = { content }
            this.gatherImports(files, importHints, cb)
          }
        })
      } else if (cb) {
        cb(new Error(`Unable to resolve imported file: ${m}`))
      }
      return
    }
    if (cb) { cb(null, { sources: files }) }
  }

  /**
   * @dev Truncate version string
   * @param version version
   */

  truncateVersion (version: string): string {
    const tmp: RegExpExecArray | null = /^(\d+.\d+.\d+)/.exec(version)
    return tmp ? tmp[1] : version
  }

  /**
   * @dev Update ABI according to current compiler version
   * @param data Compilation result
   */

  updateInterface (data: CompilationResult) : CompilationResult {
    txHelper.visitContracts(data.contracts, (contract : visitContractsCallbackParam) => {
      if (!contract.object.abi) contract.object.abi = []
      if (this.state.language === 'Yul' && contract.object.abi.length === 0) {
        // yul compiler does not return any abi,
        // we default to accept the fallback function (which expect raw data as argument).
        contract.object.abi.push({
          payable: true,
          stateMutability: 'payable',
          type: 'fallback'
        })
      }
      if (data && data.contracts && this.state.currentVersion) {
        const version = this.truncateVersion(this.state.currentVersion)
        data.contracts[contract.file][contract.name].abi = update(version, contract.object.abi)
        // if "constant" , payable must not be true and stateMutability must be view.
        // see https://github.com/ethereum/solc-js/issues/500
        for (const item of data.contracts[contract.file][contract.name].abi) {
          if (isFunctionDescription(item) && item.constant) {
            item.payable = false
            item.stateMutability = 'view'
          }
        }
      }
    })
    return data
  }

  /**
   * @dev Get contract obj of the given contract name from last compilation result.
   * @param name contract name
   */

  getContract (name: string): Record<string, any> | null {
    if (this.state.lastCompilationResult && this.state.lastCompilationResult.data && this.state.lastCompilationResult.data.contracts) {
      return txHelper.getContract(name, this.state.lastCompilationResult.data.contracts)
    }
    return null
  }

  /**
   * @dev Call the given callback for all the contracts from last compilation result
   * @param cb callback
   */

  visitContracts (cb: visitContractsCallbackInterface) : void | null {
    if (this.state.lastCompilationResult && this.state.lastCompilationResult.data && this.state.lastCompilationResult.data.contracts) {
      return txHelper.visitContracts(this.state.lastCompilationResult.data.contracts, cb)
    }
    return null
  }

  /**
   * @dev Get the compiled contracts data from last compilation result
   */

  getContracts () : CompilationResult['contracts'] | null {
    if (this.state.lastCompilationResult && this.state.lastCompilationResult.data && this.state.lastCompilationResult.data.contracts) {
      return this.state.lastCompilationResult.data.contracts
    }
    return null
  }

  /**
   * @dev Get sources from last compilation result
   */

  getSources () : Source | null | undefined {
    if (this.state.lastCompilationResult && this.state.lastCompilationResult.source) {
      return this.state.lastCompilationResult.source.sources
    }
    return null
  }

  /**
   * @dev Get sources of passed file name from last compilation result
   * @param fileName file name
   */

  getSource (fileName: string) : Source['filename'] | null {
    if (this.state.lastCompilationResult && this.state.lastCompilationResult.source && this.state.lastCompilationResult.source.sources) {
      return this.state.lastCompilationResult.source.sources[fileName]
    }
    return null
  }

  /**
   * @dev Get source name at passed index from last compilation result
   * @param index    - index of the source
   */

  getSourceName (index: number): string | null {
    if (this.state.lastCompilationResult && this.state.lastCompilationResult.data && this.state.lastCompilationResult.data.sources) {
      return Object.keys(this.state.lastCompilationResult.data.sources)[index]
    }
    return null
  }
}
