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

import React, { useEffect, useState, useRef, useReducer } from 'react' // eslint-disable-line
import semver from 'semver'
import { CompilerContainerProps, ConfigurationSettings } from './types'
import * as helper from '../../../../../apps/remix-ide/src/lib/helper'
import { canUseWorker, baseURLTron, tronCompilerSourceProvider, urlFromVersion, pathToURL, pathToIntegrity, promisedMiniXhr, maybeMockCompilerSourceURL, assertAllowedCompilerURL, normalizeRuns, parseOptimizeParam, normalizeEvmVersion, BUILTIN_SOLC_VERSION } from '@remix-project/remix-solidity'
import { compilerReducer, compilerInitialState } from './reducers/compiler'
import { resetEditorMode, listenToEvents } from './actions/compiler'
import { OverlayTrigger, Tooltip } from 'react-bootstrap' // eslint-disable-line
import axios from 'axios'
import './css/style.css'
import { withBoundedRetries } from './compiler-source-retry'

declare global {
  interface Window {
    _paq: any
  }
}

const _paq = window._paq = window._paq || [] //eslint-disable-line

export const CompilerContainer = (props: CompilerContainerProps) => {
  const { editor, config, queryParams, compileTabLogic, tooltip, modal, compiledFileName, setHardHatCompilation, updateCurrentVersion, isHardHatProject, configurationSettings  } = props // eslint-disable-line
  const [state, setState] = useState({
    hideWarnings: false,
    autoCompile: false,
    optimise: false,
    compileTimeout: null,
    timeout: 300,
    allversions: [],
    customVersions: [],
    selectedVersion: null,
    defaultVersion: 'soljson-v0.8.6+commit.0e36fba0.js', // this default version is defined: in makeMockCompiler (for browser test)
    selectedLanguage: '',
    runs: '',
    compiledFileName: '',
    includeNightlies: false,
    language: '',
    evmVersion: '',
    // true only when we AUTO-fell back to the bundled builtin after a download
    // failure — not when the user picks 'builtin' themselves. Drives the banner.
    builtinFallback: false,
    fallbackVersion: ''
  })
  const [disableCompileButton, setDisableCompileButton] = useState<boolean>(false)
  const [isCompilerLoading, setIsCompilerLoading] = useState<boolean>(false)
  const [loadingCompilerVersion, setLoadingCompilerVersion] = useState<string>('')
  const compileIcon = useRef(null)
  const promptMessageInput = useRef(null)
  // A user can click Compile in the short window between the compiler panel
  // appearing and the selected binary becoming ready. Keep that intent and
  // replay it once the worker/script reports compilerLoaded instead of
  // returning the fail-closed "Compiler is still loading" result and silently
  // dropping the click.
  const pendingCompileRef = useRef(false)
  // the compiler load we most recently asked for, so a load failure can be
  // attributed (and the builtin fallback can refuse to loop on itself)
  const lastCompilerLoadRef = useRef<{ url: string, isBuiltin: boolean } | null>(null)
  const [hhCompilation, sethhCompilation] = useState(false)
  const [compilerContainer, dispatch] = useReducer(compilerReducer, compilerInitialState)

  const resolveRequestedVersion = (spec: string, allversions: any[]): string => {
    const raw = String(spec || '')
    if (raw.length > 512) return ''
    let requested: string
    try {
      // QueryParams deliberately preserves raw fragment values. Decode this
      // validated consumer exactly once so URLSearchParams-generated links
      // containing `%2Bcommit...` select the requested manifest build.
      requested = decodeURIComponent(raw).trim()
    } catch (error) {
      return ''
    }
    if (!requested) return ''
    if (requested === 'builtin') return 'builtin'

    const releases = (allversions || []).filter((build) => {
      return build && build.path && build.path !== 'builtin' && build.version &&
        build.longVersion && !build.longVersion.includes('nightly')
    })
    const direct = releases.find((build) => build.path === requested || build.longVersion === requested)
    if (direct) return direct.path

    // Shared links and external callers may use a bare semantic version. Map
    // it to a concrete manifest path before entering the stricter loader.
    const bare = requested.replace(/^v/, '')
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(bare)) return ''
    const exact = releases.filter((build) => build.version === bare)
    const compatible = exact.length
      ? exact
      : releases.filter((build) => build.version.startsWith(`${bare}.`))
    if (!compatible.length) return ''
    return compatible.slice().sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true })).pop().path
  }

  const compilerVersionLabel = (spec: string): string => {
    const value = String(spec || '').trim()
    const version = /(?:^|[^\d])(\d+\.\d+\.\d+)(?:[^\d]|$)/.exec(value)
    const source = value.split('/').pop() || value
    return version ? version[1] : source.slice(0, 120)
  }

  useEffect(() => {
    fetchAllVersion((allversions, selectedVersion, isURL, fallbackVersion = '') => {
      const hashVersion = queryParams.get().version
      // A compiler version in a shared URL is an explicit user choice. Do not
      // replace it with the legacy default merely because the manifest request
      // completed after the component mounted.
      const requestedVersion = hashVersion && hashVersion !== 'null' && hashVersion !== 'undefined'
        ? hashVersion
        : ''
      const resolvedRequestedVersion = resolveRequestedVersion(requestedVersion, allversions)
      const resolvedDefaultVersion = resolveRequestedVersion(state.defaultVersion, allversions) || 'builtin'
      const versionToSelect = fallbackVersion ? 'builtin' : (selectedVersion || resolvedRequestedVersion || resolvedDefaultVersion)
      if (requestedVersion && !resolvedRequestedVersion && !fallbackVersion) {
        tooltip(`Compiler ${requestedVersion.slice(0, 120)} is unavailable. Using ${versionToSelect === 'builtin' ? `built-in compiler (${BUILTIN_SOLC_VERSION})` : versionToSelect}.`)
      }
      setState(prevState => {
        return {
          ...prevState,
          allversions,
          ...(fallbackVersion
            ? { builtinFallback: true, fallbackVersion }
            : {})
        }
      })
      if (isURL) _updateVersionSelector(state.defaultVersion, selectedVersion)
      else {
        setState(prevState => {
          return { ...prevState, selectedVersion: versionToSelect }
        })
        updateCurrentVersion(versionToSelect)
        _updateVersionSelector(versionToSelect, '', fallbackVersion ? { preserveQuery: true } : undefined)
      }
    })
    const currentFileName = config.get('currentFile')

    currentFile(currentFileName)
    listenToEvents(editor, compileTabLogic)(dispatch)
  }, [])

  useEffect(() => {
    if (compileTabLogic && compileTabLogic.compiler) {
      setState(prevState => {
        const params = queryParams.get()
        const optimize = parseOptimizeParam(params.optimize)
        const runs = params.runs
        const evmVersion = params.evmVersion

        return {
          ...prevState,
          hideWarnings: config.get('hideWarnings') || false,
          autoCompile: config.get('autoCompile') || false,
          includeNightlies: config.get('includeNightlies') || false,
          optimise: (optimize !== null) && (optimize !== undefined) ? optimize : config.get('optimise') || false,
          runs: String(normalizeRuns(runs)),
          evmVersion: normalizeEvmVersion(evmVersion) || 'default'
        }
      })
    }
  }, [compileTabLogic])

  useEffect(() => {
    const isDisabled = !compiledFileName || (compiledFileName && !isSolFileSelected(compiledFileName))

    setDisableCompileButton(isDisabled)
    setState(prevState => {
      return { ...prevState, compiledFileName }
    })
  }, [compiledFileName])

  useEffect(() => {
    if (compilerContainer.compiler.mode) {
      switch (compilerContainer.compiler.mode) {
        case 'startingCompilation':
          startingCompilation()
          break
        case 'compilationDuration':
          compilationDuration(compilerContainer.compiler.args[0])
          break
        case 'loadingCompiler':
          loadingCompiler()
          break
        case 'compilerLoaded':
          compilerLoaded()
          break
        case 'compilerLoadFailed':
          compilerLoadFailed()
          autoFallbackToBuiltin(compilerContainer.compiler.args ? compilerContainer.compiler.args[1] : undefined)
          break
        case 'compilationFinished':
          if (compilerContainer.compiler.args && compilerContainer.compiler.args[0] === false) compilerLoadFailed()
          else compilationFinished()
          break
      }
    }
  }, [compilerContainer.compiler.seq])

  useEffect(() => {
    if (compilerContainer.editor.mode) {
      switch (compilerContainer.editor.mode) {
        case 'sessionSwitched':
          sessionSwitched()
          resetEditorMode()(dispatch)
          break
        case 'contentChanged':
          contentChanged()
          resetEditorMode()(dispatch)
          break
      }
    }
  }, [compilerContainer.editor.mode])

  useEffect(() => {
    if (configurationSettings) {
      setConfiguration(configurationSettings)
    }
  }, [configurationSettings])

  // fetching both normal and wasm builds and creating a [version, baseUrl] map
  const fetchAllVersion = async callback => {
    let selectedVersion
    let allVersions: any = [
      { path: 'builtin', longVersion: `Built-in compiler (local) - ${BUILTIN_SOLC_VERSION}` }
    ]
    try {
      // pass the declared timeout so a hung (not refused) connection rejects
      // and falls through to the builtin compiler instead of leaving the
      // version dropdown disabled forever.
      const binRes: any = await withBoundedRetries(
        () => axios.get(tronCompilerSourceProvider.versionListURL, { timeout: tronCompilerSourceProvider.timeoutMs }),
        tronCompilerSourceProvider.retries,
        (error: any) => error && error.code !== 'ECONNABORTED' && error.code !== 'ETIMEDOUT'
      )
      try {
        const versions = binRes.data.builds.slice().reverse()
        allVersions = [...allVersions, ...versions]
        allVersions.forEach(_ => {
          pathToURL[_.path] = baseURLTron
          if (_.sha256) pathToIntegrity[_.path] = _.sha256
        })
      } catch (e) {
        console.error('Could not read the compiler version list:', e)
        tooltip('Compiler versions could not be read. Reload the page or try again later.')
      }
      return callback(allVersions, selectedVersion)
    } catch (e) {
      // The version list is unreachable (offline / blocked / timed out). Degrade
      // to the bundled builtin compiler, but tell the user instead of silently
      // downgrading (silent-failure class).
      console.error('Could not fetch the compiler version list, using the built-in compiler:', e)
      tooltip(`Compiler versions are unavailable. Using built-in compiler (${BUILTIN_SOLC_VERSION}).`)
      selectedVersion = 'builtin'
      const requestedVersion = queryParams.get().version
      const fallbackVersion = requestedVersion && requestedVersion !== 'builtin' && requestedVersion !== 'null' && requestedVersion !== 'undefined'
        ? requestedVersion
        : ''
      return callback(allVersions, selectedVersion, false, fallbackVersion)
    }
  }

  /**
   * Update the compilation button with the name of the current file
   */
  const currentFile = (name = '') => {
    if (name && name !== '') {
      _setCompilerVersionFromPragma(name)
    }
    const compiledFileName = name.split('/').pop()

    setState(prevState => {
      return { ...prevState, compiledFileName }
    })
  }

  // Load solc compiler version according to pragma in contract file
  const _setCompilerVersionFromPragma = (filename: string) => {
    if (!state.allversions) return
    compileTabLogic.fileManager.readFile(filename).then(data => {
      const pragmaArr = data.match(/(pragma solidity (.+?);)/g)
      if (pragmaArr && pragmaArr.length === 1) {
        const pragmaStr = pragmaArr[0].replace('pragma solidity', '').trim()
        const pragma = pragmaStr.substring(0, pragmaStr.length - 1)
        const releasedVersions = state.allversions.filter(obj => !obj.prerelease).map(obj => obj.version)
        const allVersions = state.allversions.map(obj => _retrieveVersion(obj.version))
        const currentCompilerName = _retrieveVersion(state.selectedVersion)
        // contains only numbers part, for example '0.4.22'
        const pureVersion = _retrieveVersion()
        // is nightly build newer than the last release
        const isNewestNightly = currentCompilerName.includes('nightly') && semver.gt(pureVersion, releasedVersions[0])
        // checking if the selected version is in the pragma range
        const isInRange = semver.satisfies(pureVersion, pragma)
        // checking if the selected version is from official compilers list(excluding custom versions) and in range or greater
        const isOfficial = allVersions.includes(currentCompilerName)
        if (isOfficial && (!isInRange && !isNewestNightly)) {
          const compilerToLoad = semver.maxSatisfying(releasedVersions, pragma)
          const compilerPath = state.allversions.filter(obj => !obj.prerelease && obj.version === compilerToLoad)[0].path
          if (state.selectedVersion !== compilerPath) {
            setState((prevState) => {
              return { ...prevState, selectedVersion: compilerPath }
            })
            _updateVersionSelector(compilerPath)
          }
        }
      }
    })
  }

  const isSolFileSelected = (currentFile = '') => {
    if (!currentFile) currentFile = config.get('currentFile')
    if (!currentFile) return false
    const extention = currentFile.substr(currentFile.length - 3, currentFile.length)
    return extention.toLowerCase() === 'sol' || extention.toLowerCase() === 'yul'
  }

  const sessionSwitched = () => {
    if (!compileIcon.current) return
    scheduleCompilation()
  }

  const startingCompilation = () => {
    if (!compileIcon.current) return
    compileIcon.current.setAttribute('title', 'compiling...')
    compileIcon.current.classList.remove('remixui_bouncingIcon')
    compileIcon.current.classList.add('remixui_spinningIcon')
  }

  const compilationDuration = (speed: number) => {
    if (speed > 1000) {
      console.log(`Last compilation took ${speed}ms. We suggest to turn off autocompilation.`)
    }
  }

  const contentChanged = () => {
    if (!compileIcon.current) return
    scheduleCompilation()
    compileIcon.current.classList.add('remixui_bouncingIcon') // @TODO: compileView tab
  }

  const loadingCompiler = () => {
    setIsCompilerLoading(true)
    const loadingURL = compilerContainer.compiler.args ? compilerContainer.compiler.args[0] : ''
    setLoadingCompilerVersion(loadingURL && !isBuiltinCompilerUrl(loadingURL) ? compilerVersionLabel(loadingURL) : '')
    if (!compileIcon.current) return
    compileIcon.current.removeAttribute('title')
    compileIcon.current.parentElement?.querySelectorAll('.sr-only').forEach(el => el.remove())
    compileIcon.current.classList.add('remixui_spinningIcon')
    _updateLanguageSelector()
    setDisableCompileButton(true)
  }

  const compilerLoaded = () => {
    setIsCompilerLoading(false)
    setLoadingCompilerVersion('')
    if (!compileIcon.current) return
    compileIcon.current.removeAttribute('title')
    compileIcon.current.parentElement?.querySelectorAll('.sr-only').forEach(el => el.remove())
    compileIcon.current.classList.remove('remixui_spinningIcon')
    const shouldCompile = pendingCompileRef.current || state.autoCompile
    pendingCompileRef.current = false
    if (shouldCompile) window.setTimeout(() => compileNow(), 0)
    const isDisabled = !compiledFileName || (compiledFileName && !isSolFileSelected(compiledFileName))

    setDisableCompileButton(isDisabled)
  }

  const compilerLoadFailed = () => {
    setIsCompilerLoading(false)
    setLoadingCompilerVersion('')
    if (!compileIcon.current) return
    compileIcon.current.setAttribute('title', 'compiler load failed')
    compileIcon.current.parentElement?.querySelectorAll('.sr-only').forEach(el => el.remove())
    compileIcon.current.classList.remove('remixui_spinningIcon')
    compileIcon.current.classList.remove('remixui_bouncingIcon')
    const isDisabled = !compiledFileName || (compiledFileName && !isSolFileSelected(compiledFileName))

    setDisableCompileButton(isDisabled)
  }

  const compilationFinished = () => {
    setIsCompilerLoading(false)
    setLoadingCompilerVersion('')
    if (!compileIcon.current) return
    compileIcon.current.removeAttribute('title')
    compileIcon.current.parentElement?.querySelectorAll('.sr-only').forEach(el => el.remove())
    compileIcon.current.classList.remove('remixui_spinningIcon')
    compileIcon.current.classList.remove('remixui_bouncingIcon')
    const isDisabled = !compiledFileName || (compiledFileName && !isSolFileSelected(compiledFileName))

    setDisableCompileButton(isDisabled)
    _paq.push(['trackEvent', 'compiler', 'compiled_with_version', _retrieveVersion()])
  }

  const scheduleCompilation = () => {
    if (!state.autoCompile) return
    if (state.compileTimeout) window.clearTimeout(state.compileTimeout)
    const compileTimeout = window.setTimeout(() => {
      state.autoCompile && compile()
    }, state.timeout)

    setState(prevState => {
      return { ...prevState, compileTimeout }
    })
  }

  const compileNow = () => {
    const currentFile = config.get('currentFile')

    if (!isSolFileSelected()) return

    _setCompilerVersionFromPragma(currentFile)
    compileTabLogic.runCompiler(hhCompilation)
    window?.gtag('event', 'click', { event_category: 'compiler_user_action', event_label: 'compile' })
  }

  const compile = () => {
    const compilerState = compileTabLogic && compileTabLogic.compiler && compileTabLogic.compiler.state
    if (isCompilerLoading || !compilerState || !compilerState.currentVersion || typeof compilerState.compileJSON !== 'function') {
      pendingCompileRef.current = true
      return
    }
    compileNow()
  }

  const _retrieveVersion = (version?) => {
    if (!version) version = state.selectedVersion
    // the bundled builtin is its OWN version — mapping it to defaultVersion
    // (the default REMOTE build, 0.8.6) made pragma matching treat a 0.8.20
    // compiler as 0.8.6 and mis-decide auto-switches
    if (version === 'builtin') version = BUILTIN_SOLC_VERSION
    return semver.coerce(version) ? semver.coerce(version).version : ''
  }

  const normalizedCompilerUrl = (url: string) => {
    try {
      return new URL(url, window.location.href).href
    } catch (e) {
      return url
    }
  }

  const isBuiltinCompilerUrl = (url: string) => {
    try {
      const parsed = new URL(url, window.location.href)
      return parsed.origin === window.location.origin && /\/assets\/js\/soljson\.js$/.test(parsed.pathname)
    } catch (e) {
      return false
    }
  }

  // A compiler binary failing to download (offline, blocked CDN, stalled
  // connection) must not leave a dead panel: degrade to the bundled builtin
  // compiler, which needs no network. The builtin itself failing has nothing
  // left to fall back to — bail out rather than loop.
  const autoFallbackToBuiltin = (failedUrl?: string) => {
    const lastLoad = lastCompilerLoadRef.current
    if (!lastLoad) return
    // a failure of a load we already superseded must not yank the selection
    if (failedUrl && normalizedCompilerUrl(failedUrl) !== normalizedCompilerUrl(lastLoad.url)) return
    if (lastLoad.isBuiltin || (failedUrl && isBuiltinCompilerUrl(failedUrl))) return
    lastCompilerLoadRef.current = null
    const requestedVersion = state.selectedVersion && state.selectedVersion !== 'builtin'
      ? state.selectedVersion
      : (queryParams.get().version || '')
    tooltip(`Selected compiler unavailable. Using built-in compiler (${BUILTIN_SOLC_VERSION}).`)
    setState(prevState => {
      return { ...prevState, selectedVersion: 'builtin', builtinFallback: true, fallbackVersion: requestedVersion }
    })
    // Keep the requested version in the URL. This makes a shared link honest
    // and lets a reload retry the requested binary instead of silently
    // canonicalising the link to `version=builtin`.
    _updateVersionSelector('builtin', '', { preserveQuery: true })
  }

  const _updateVersionSelector = (version, customUrl = '', options: { preserveQuery?: boolean } = {}) => {
    try {
      _updateVersionSelectorInternal(version, customUrl, options)
    } catch (e) {
      // a rejected/unreachable compiler source must degrade gracefully, not
      // throw uncaught — fall back to the bundled builtin compiler.
      console.error('Compiler version load failed, falling back to builtin:', e)
      tooltip(`Selected compiler unavailable. Using built-in compiler (${BUILTIN_SOLC_VERSION}).`)
      try { _updateVersionSelectorInternal('builtin', '', { preserveQuery: true }) } catch (inner) { console.error(inner) }
    }
  }

  const _updateVersionSelectorInternal = (version, customUrl = '', options: { preserveQuery?: boolean } = {}) => {
    const { preserveQuery = false } = options
    // update selectedversion of previous one got filtered out
    let selectedVersion = version
    let isBuiltinLoad = false
    if (!selectedVersion || !_shouldBeAdded(selectedVersion)) {
      selectedVersion = state.defaultVersion
      setState(prevState => {
        return { ...prevState, selectedVersion }
      })
    }
    updateCurrentVersion(selectedVersion)
    if (!preserveQuery) queryParams.update({ version: selectedVersion })
    let url

    if (customUrl !== '') {
      selectedVersion = customUrl
      setState(prevState => {
        return { ...prevState, selectedVersion, customVersions: [...state.customVersions, selectedVersion] }
      })
      updateCurrentVersion(selectedVersion)
      url = customUrl
      if (!preserveQuery) queryParams.update({ version: selectedVersion })
    } else if (selectedVersion === 'builtin') {
      let location: string | Location = window.document.location
      let path = location.pathname
      if (!path.startsWith('/')) path = '/' + path
      location = `${location.protocol}//${location.host}${path}assets/js`
      if (location.endsWith('index.html')) location = location.substring(0, location.length - 10)
      if (!location.endsWith('/')) location += '/'
      url = location + 'soljson.js'
      isBuiltinLoad = true
    } else {
      if (selectedVersion.indexOf('soljson') !== 0 || helper.checkSpecialChars(selectedVersion)) {
        return console.log('loading ' + selectedVersion + ' not allowed')
      }
      url = `${urlFromVersion(selectedVersion)}`
    }

    url = maybeMockCompilerSourceURL(url)
    lastCompilerLoadRef.current = { url, isBuiltin: isBuiltinLoad }

    // Workers cannot load js on "file:"-URLs and we get a
    // "Uncaught RangeError: Maximum call stack size exceeded" error on Chromium,
    // resort to non-worker version in that case.
    if (selectedVersion === 'builtin') selectedVersion = BUILTIN_SOLC_VERSION
    if (selectedVersion !== 'builtin' && canUseWorker(selectedVersion)) {
      compileTabLogic.compiler.loadVersion(true, url)
    } else {
      compileTabLogic.compiler.loadVersion(false, url)
    }
  }

  const _shouldBeAdded = (version) => {
    return !version.includes('nightly') ||
           (version.includes('nightly') && state.includeNightlies)
  }

  // Curated TVM-recommended compiler versions (mirrors TronBox's blessed set:
  // the latest 0.8.x plus the 0.5 / 0.4 LTS lines). Resolved against the live
  // Tron solc list so we only surface versions actually available to download.
  // 0.4.x is deliberately NOT recommended: the asm.js 0.4 builds blow the V8
  // call stack in Chromium ("Maximum call stack size exceeded" on compile),
  // so offering it as a quick-pick recommends a crash in the primary browser.
  // It stays available in the full version dropdown for browsers that cope.
  const recommendedSeries = ['0.8', '0.5']
  const getRecommendedBuilds = () => {
    const releases = (state.allversions || []).filter((b) => b && b.version && !b.longVersion.includes('nightly'))
    const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true })
    const picks = []
    for (const series of recommendedSeries) {
      const inSeries = releases.filter((b) => b.version.startsWith(series + '.'))
      if (!inSeries.length) continue
      const latest = inSeries.sort((a, b) => cmp(a.version, b.version))[inSeries.length - 1]
      picks.push(latest)
    }
    return picks
  }

  const promptCompiler = () => {
    // custom url https://solidity-blog.s3.eu-central-1.amazonaws.com/data/08preview/soljson.js
    modal('Add a custom compiler', promptMessage('URL'), 'OK', addCustomCompiler, 'Cancel', () => {})
  }

  const promptMessage = (message) => {
    return (
      <>
        <span>{ message }</span>
        <input type="text" data-id="modalDialogCustomPromptCompiler" className="form-control" ref={promptMessageInput} />
      </>
    )
  }

  const addCustomCompiler = () => {
    const url = promptMessageInput.current.value

    // Reject a disallowed origin up front: show a clear message and leave the
    // current compiler selected, instead of throwing uncaught deeper in the
    // load path and leaving the rejected URL shown as the active version
    // (CMP-CUSTOMURL-1).
    try {
      assertAllowedCompilerURL(url)
    } catch (e) {
      tooltip(`Custom compiler URL not allowed: ${(e && e.message) || url}`)
      return
    }

    setState(prevState => {
      return { ...prevState, selectedVersion: url }
    })
    _updateVersionSelector(state.defaultVersion, url)
  }

  const handleLoadVersion = (value) => {
    warnIfChromiumIncompatible(value)
    setState(prevState => {
      // A deliberate pick clears the auto-fallback banner (retrying a download).
      return { ...prevState, selectedVersion: value, builtinFallback: false, fallbackVersion: '' }
    })
    updateCurrentVersion(value)
    _updateVersionSelector(value)
    _updateLanguageSelector()
  }

  const retryFallbackVersion = () => {
    const resolved = resolveRequestedVersion(state.fallbackVersion, state.allversions)
    if (resolved) return handleLoadVersion(resolved)
    // A failed manifest leaves no safe version-to-URL mapping. Preserve the
    // requested hash and reload so fetchAllVersion can rebuild that mapping.
    window.location.reload()
  }

  // 0.4.x are asm.js builds that overflow the V8 call stack on compile in
  // Chromium ("Maximum call stack size exceeded"). The recommended quick-pick
  // already excludes them, but the full dropdown still offers them, so
  // warn up front rather than letting the compile crash unexplained. Never
  // blocks selection (Firefox can compile 0.4.x fine).
  const warnIfChromiumIncompatible = (value) => {
    try {
      const v = _retrieveVersion(value)
      if (!v || !/^0\.4\./.test(v)) return
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
      const isChromium = /Chrome|Chromium|Edg\//.test(ua) && !/Firefox/.test(ua)
      if (isChromium) {
        tooltip(`Solidity ${v} is not supported in Chromium. Use Firefox or Solidity 0.5.x+.`)
      }
    } catch (e) { /* a warning must never block selection */ }
  }

  const _updateLanguageSelector = () => {
    // This is the first version when Yul is available
    if (!semver.valid(_retrieveVersion()) || semver.lt(_retrieveVersion(), 'v0.5.7+commit.6da8b019.js')) {
      handleLanguageChange('Solidity')
      compileTabLogic.setLanguage('Solidity')
    }
  }

  const handleAutoCompile = (e) => {
    const checked = e.target.checked

    config.set('autoCompile', checked)
    setState(prevState => {
      return { ...prevState, autoCompile: checked }
    })
  }

  const handleOptimizeChange = (value) => {
    const checked = !!value

    config.set('optimise', checked)
    compileTabLogic.setOptimize(checked)
    if (compileTabLogic.optimize) {
      compileTabLogic.setRuns(state.runs)
    } else {
      compileTabLogic.setRuns(200)
    }
    state.autoCompile && compile()
    setState(prevState => {
      return { ...prevState, optimise: checked }
    })
  }

  const onChangeRuns = (value) => {
    const runs = value

    compileTabLogic.setRuns(runs)
    state.autoCompile && compile()
    setState(prevState => {
      return { ...prevState, runs }
    })
  }

  const handleHideWarningsChange = (e) => {
    const checked = e.target.checked

    config.set('hideWarnings', checked)
    state.autoCompile && compile()
    setState(prevState => {
      return { ...prevState, hideWarnings: checked }
    })
  }

  const handleLanguageChange = (value) => {
    compileTabLogic.setLanguage(value)
    state.autoCompile && compile()
    setState(prevState => {
      return { ...prevState, language: value }
    })
  }

  const updatehhCompilation = (event) => {
    const checked = event.target.checked

    sethhCompilation(checked)
    setHardHatCompilation(checked)
  }

  /*
    The following functions map with the above event handlers.
    They are an external API for modifying the compiler configuration.
  */
  // A caller (e.g. the AI set-version tool) may pass a bare version like
  // "0.8.24" without the +commit suffix — resolve it to the newest matching
  // released build from the loaded list so the URL isn't a 404. A full
  // "x.y.z+commit…" is used as-is; an unknown spec is left for handleLoadVersion
  // to reject cleanly.
  const resolveVersionSpec = (spec: string): string => {
    const v = String(spec || '').trim()
    if (!v || v.includes('+commit')) return v
    const releases = (state.allversions || []).filter((b) => b && b.version && b.longVersion && !b.longVersion.includes('nightly'))
    const exact = releases.filter((b) => b.version === v)
    const prefix = exact.length ? exact : releases.filter((b) => b.version.startsWith(v + '.') || b.version.startsWith(v))
    if (!prefix.length) return v
    const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true })
    return prefix.sort((a, b) => cmp(a.version, b.version))[prefix.length - 1].longVersion
  }

  const setConfiguration = (settings: ConfigurationSettings) => {
    handleLoadVersion(`soljson-v${resolveVersionSpec(settings.version)}.js`)
    handleLanguageChange(settings.language)
    handleOptimizeChange(settings.optimize)
    onChangeRuns(settings.runs)
  }

  return (
    <section>
      <article>
        <header className='remixui_compilerSection border-bottom'>
          { state.builtinFallback &&
            <div className="alert alert-warning p-2 mb-2 small" data-id="compilerBuiltinFallbackNotice" role="alert">
              <i className="fas fa-exclamation-triangle mr-1" aria-hidden="true"></i>
              { state.fallbackVersion
                ? <><strong>Requested compiler {compilerVersionLabel(state.fallbackVersion)} is not active.</strong>{' '}It could not be downloaded or verified, so TronIDE switched to the built-in compiler ({BUILTIN_SOLC_VERSION}). Compilations now use {BUILTIN_SOLC_VERSION}.</>
                : <><strong>Online compiler versions are unavailable.</strong>{' '}TronIDE is using the built-in compiler ({BUILTIN_SOLC_VERSION}).</> }
              {' '}Contracts requiring another compiler version may not compile.
              { state.fallbackVersion &&
                <button
                  type="button"
                  className="btn btn-sm btn-link p-0 ml-1 align-baseline"
                  data-id="compilerRetryRequestedVersion"
                  onClick={retryFallbackVersion}
                >Retry {compilerVersionLabel(state.fallbackVersion)}</button> }
            </div>
          }
          { loadingCompilerVersion &&
            <div className="alert alert-info p-2 mb-2 small" data-id="compilerRemoteLoadingNotice" role="status" aria-live="polite">
              <i className="fas fa-circle-notch fa-spin mr-1" aria-hidden="true"></i>
              <strong>Loading TVM compiler {loadingCompilerVersion}…</strong>{' '}Compilation is temporarily unavailable while TronIDE downloads and verifies it.
            </div>
          }
          <div className="mb-2">
            <label className="remixui_compilerLabel form-check-label" htmlFor="versionSelector">
              Compiler
              <button className="far fa-plus-square border-0 p-0 mx-2 btn-sm tooltip-above" onClick={promptCompiler} data-title="Add a custom compiler with URL"></button>
            </label>
            <select value={ state.selectedVersion || state.defaultVersion } onChange={(e) => handleLoadVersion(e.target.value) } className="custom-select" id="versionSelector" disabled={state.allversions.length <= 0}>
              { state.allversions.length <= 0 && <option disabled data-id={state.selectedVersion === state.defaultVersion ? 'selected' : ''}>{ state.defaultVersion }</option> }
              { state.allversions.length <= 0 && <option disabled data-id={state.selectedVersion === 'builtin' ? 'selected' : ''}>builtin</option> }
              { state.customVersions.map((url, i) => <option key={i} data-id={state.selectedVersion === url ? 'selected' : ''} value={url}>custom</option>)}
              { state.allversions.map((build, i) => {
                return _shouldBeAdded(build.longVersion)
                  ? <option key={i} value={build.path} data-id={state.selectedVersion === build.path ? 'selected' : ''}>{build.longVersion}</option>
                  : null
              })
              }
            </select>
            { state.allversions.length > 0 && getRecommendedBuilds().length > 0 &&
              <div className="d-flex flex-wrap align-items-center mt-1" data-id="compilerRecommendedVersions">
                <span className="text-muted mr-2 small">Recommended (TVM — online):</span>
                { getRecommendedBuilds().map((build, i) => {
                  const isLoading = loadingCompilerVersion === build.version
                  return <button
                    key={i}
                    type="button"
                    className="btn btn-sm btn-secondary py-0 px-2 mr-1 mb-1"
                    data-id={`compilerRecommendedVersion-${build.version}`}
                    title={`Download and use Tron Solidity ${build.version}`}
                    disabled={isLoading}
                    aria-busy={isLoading}
                    onClick={() => handleLoadVersion(build.path)}
                  >{isLoading ? `Loading ${build.version}…` : build.version}</button>
                })}
              </div>
            }
          </div>
          <div className="mb-2">
            <label className="remixui_compilerLabel form-check-label" htmlFor="compilierLanguageSelector">Language</label>
            <select onChange={(e) => handleLanguageChange(e.target.value)} value={state.language} className="custom-select" id="compilierLanguageSelector" title="Available since v0.5.7">
              <option value='Solidity'>Solidity</option>
              <option value='Yul'>Yul</option>
            </select>
          </div>
          <div className="mt-3">
            <p className="mt-2 remixui_compilerLabel">Compiler Configuration</p>
            <div className="mt-2 remixui_compilerConfig custom-control custom-checkbox">
              <input className="remixui_autocompile custom-control-input" type="checkbox" onChange={handleAutoCompile} data-id="compilerContainerAutoCompile" id="autoCompile" title="Auto compile" checked={state.autoCompile} />
              <label className="form-check-label custom-control-label" htmlFor="autoCompile">Auto compile</label>
            </div>
            <div className="mt-2 remixui_compilerConfig custom-control custom-checkbox">
              <div className="justify-content-between align-items-center d-flex">
                <input onChange={(e) => { handleOptimizeChange(e.target.checked) }} className="custom-control-input" id="optimize" type="checkbox" checked={state.optimise} />
                <label className="form-check-label custom-control-label" htmlFor="optimize">Enable optimization</label>
                <input
                  min="1"
                  className="custom-select ml-2 remixui_runs"
                  id="runs"
                  placeholder="200"
                  value={state.runs}
                  type="number"
                  title="Estimated number of times each opcode of the deployed code will be executed across the life-time of the contract."
                  onChange={(e) => onChangeRuns(e.target.value)}
                  disabled={!state.optimise}
                />
              </div>
            </div>
            <div className="mt-2 remixui_compilerConfig custom-control custom-checkbox">
              <input className="remixui_autocompile custom-control-input" onChange={handleHideWarningsChange} id="hideWarningsBox" type="checkbox" title="Hide warnings" checked={state.hideWarnings} />
              <label className="form-check-label custom-control-label" htmlFor="hideWarningsBox">Hide warnings</label>
            </div>
          </div>
          {
            isHardHatProject &&
            <div className="mt-3 remixui_compilerConfig custom-control custom-checkbox">
              <input className="remixui_autocompile custom-control-input" onChange={updatehhCompilation} id="enableHardhat" type="checkbox" title="Enable Hardhat Compilation" checked={hhCompilation} />
              <label className="form-check-label custom-control-label" htmlFor="enableHardhat">Enable Hardhat Compilation</label>
              <a className="mt-1 text-nowrap" href='https://remix-ide.readthedocs.io/en/latest/hardhat.html#enable-hardhat-compilation' target={'_blank'}>
                <OverlayTrigger placement={'right'} overlay={
                  <Tooltip className="text-nowrap" id="overlay-tooltip">
                    <span className="p-1 pr-3" style={{ backgroundColor: 'black', minWidth: '230px' }}>Learn how to use Hardhat Compilation</span>
                  </Tooltip>
                }>
                  <i style={{ fontSize: 'medium' }} className={'ml-2 fal fa-info-circle'} aria-hidden="true"></i>
                </OverlayTrigger>
              </a>
            </div>
          }
          <button id="compileBtn" data-id="compilerContainerCompileBtn" className="btn btn-primary btn-block remixui_disabled mt-3" title="Compile" onClick={compile} disabled={disableCompileButton}>
            <span>
              { <i ref={compileIcon} className="fas fa-sync remixui_icon" aria-hidden="true" aria-label={isCompilerLoading ? 'compiler is loading' : ''}></i> }
              Compile { typeof state.compiledFileName === 'string' ? helper.extractNameFromKey(state.compiledFileName) || '<no file selected>' : '<no file selected>' }
            </span>
          </button>
        </header>
      </article>
    </section>
  )
}

export default CompilerContainer
