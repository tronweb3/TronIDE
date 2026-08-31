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

const semver = require('semver')
const minixhr = require('minixhr')
/* global Worker */

export const baseURLBin = 'https://binaries.soliditylang.org/bin'
export const baseURLWasm = 'https://binaries.soliditylang.org/wasm'
// The solc version of the BUNDLED fallback compiler (apps/remix-ide/src/assets/
// js/soljson.js). Every user-facing "built-in compiler (x.y.z)" string and the
// builtin pragma-matching MUST use this constant: the asset was once 0.8.6 and
// the hardcoded labels silently went stale when it was swapped for 0.8.20.
// Keep in sync when replacing the asset — TC-CMP-VER-008 compiles the builtin
// and fails if the binary reports a different version, and
// scripts/check-compiler-source-consistency.cjs pins the mirrors.
export const BUILTIN_SOLC_VERSION = '0.8.20'
// export const baseURLTron = 'https://tronsuper.github.io/tron-solc-bin/bin'
export const tronCompilerSourceProvider = {
  baseURL: 'https://tronprotocol.github.io/solc-bin/wasm',
  versionListURL: 'https://tronprotocol.github.io/solc-bin/wasm/list.json',
  timeoutMs: 30000,
  retries: 1,
  constructVersionURL: (version) => `${pathToURL[version]}/${version}`
}
export const baseURLTron = tronCompilerSourceProvider.baseURL

export const pathToURL = {}
// sha256 values from the trusted compiler manifest, keyed by the exact file
// name. The compiler loader uses these values as SRI for script loads and as a
// byte-for-byte verification step before a worker imports a compiler.
export const pathToIntegrity = {}

const compilerSourceMockParam = 'mockCompilerSource'
const compilerSourceMockEnabledParam = 'tronideAllowCompilerSourceMock'
export const ALLOWED_COMPILER_ORIGINS = [
  'https://tronprotocol.github.io',
  'https://binaries.soliditylang.org'
]

export function isCompilerSourceMockEnabled () {
  if (typeof window === 'undefined') return false
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(window.location.search)
  return hashParams.get(compilerSourceMockEnabledParam) === '1' ||
    searchParams.get(compilerSourceMockEnabledParam) === '1' ||
    window.localStorage.getItem(compilerSourceMockEnabledParam) === '1' ||
    window['tronideAllowCompilerSourceMock'] === true
}

export function compilerSourceMockMode () {
  if (typeof window === 'undefined' || !isCompilerSourceMockEnabled()) return ''

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(window.location.search)
  return hashParams.get(compilerSourceMockParam) || searchParams.get(compilerSourceMockParam) || window.localStorage.getItem(compilerSourceMockParam) || ''
}

// `window` only exists on the main thread, but this check also runs inside the
// compiler web worker (compiler-worker re-validates before importScripts).
// Basing same-origin detection on `window` silently disabled the same-origin
// carve-outs there, so the worker rejected the app's own builtin compiler —
// the very build every offline/failure path falls back to. `self.location` is
// available on both the main thread and in workers; neither exists in node
// (remix-tests), where the provider base URL fallback keeps applying.
function executionScopeHref (): string | null {
  if (typeof self !== 'undefined' && self.location && self.location.href) return self.location.href
  if (typeof window !== 'undefined') return window.location.href
  return null
}

export function assertAllowedCompilerURL (url) {
  const scopeHref = executionScopeHref()
  const parsed = new URL(url, scopeHref || tronCompilerSourceProvider.baseURL)
  const sameOrigin = !!scopeHref && parsed.origin === new URL(scopeHref).origin
  // The mock opt-in flag lives in window/localStorage, which a worker cannot
  // read. Inside a worker the main thread has already enforced the opt-in
  // (Compiler.loadVersion validates before postMessage), so same-origin plus
  // the reserved mock path prefix is sufficient there.
  const mockAllowed = typeof window !== 'undefined' ? isCompilerSourceMockEnabled() : true
  if (sameOrigin && parsed.pathname.indexOf('/__remix_mock_compiler_source_') === 0 && mockAllowed) return parsed.href
  // The app's own bundled builtin compiler (assets/js/soljson.js) is served
  // same-origin and is as trustworthy as the app itself. It is the offline
  // fallback when the version list is unreachable; rejecting it made that
  // fallback throw "origin is not allowed".
  if (sameOrigin && /\/assets\/js\/soljson\.js$/.test(parsed.pathname)) return parsed.href
  if (!ALLOWED_COMPILER_ORIGINS.includes(parsed.origin)) {
    throw new Error(`Compiler URL origin is not allowed: ${parsed.origin}`)
  }
  return parsed.href
}

export function maybeMockCompilerSourceURL (url) {
  const mockMode = compilerSourceMockMode()
  if (!mockMode) return assertAllowedCompilerURL(url)

  if (mockMode === 'unreachable') {
    return 'http://127.0.0.1:9/__remix_mock_compiler_source_unreachable__/soljson.js'
  }

  if (mockMode === '500') {
    return `${window.location.origin}/__remix_mock_compiler_source_500__/soljson.js`
  }

  if (mockMode === 'timeout') {
    return `${window.location.origin}/__remix_mock_compiler_source_timeout__/soljson.js`
  }

  if (mockMode === 'custom') return assertAllowedCompilerURL(url)

  return assertAllowedCompilerURL(url)
}

/**
 * Retrieves the URL of the given compiler version
 * @param version is the version of compiler with or without 'soljson-v' prefix and .js postfix
 */
export function urlFromVersion (version) {
  const selectedVersion = String(version || '').trim()
  if (!selectedVersion) throw new Error('A compiler version is required')
  if (/^https?:\/\//i.test(selectedVersion)) return assertAllowedCompilerURL(selectedVersion)
  if (selectedVersion === 'builtin') {
    if (typeof window === 'undefined' || !window.location) throw new Error('The built-in compiler is only available in the browser')
    let path = window.location.pathname
    if (!path.startsWith('/')) path = '/' + path
    if (path.endsWith('index.html')) path = path.substring(0, path.length - 10)
    if (!path.endsWith('/')) path += '/'
    return assertAllowedCompilerURL(`${window.location.protocol}//${window.location.host}${path}assets/js/soljson.js`)
  }
  const candidates = [
    selectedVersion,
    `soljson-v${selectedVersion}.js`,
    `soljson-${selectedVersion}.js`,
    `soljson_v${selectedVersion}.js`
  ]
  const compilerPath = candidates.find((candidate) => pathToURL[candidate])
  const baseURL = compilerPath && pathToURL[compilerPath]
  if (!baseURL) throw new Error(`Compiler version is not present in the loaded manifest: ${selectedVersion}`)
  return `${baseURL.replace(/\/$/, '')}/${compilerPath}`
}

/** Return the manifest hash for a compiler URL, when one is available. */
export function integrityFromCompilerURL (url: string): string | undefined {
  try {
    const fileName = decodeURIComponent(new URL(url).pathname).split('/').pop()
    return fileName ? pathToIntegrity[fileName] : undefined
  } catch (_) {
    return undefined
  }
}

/** Convert a manifest sha256 hex digest to the browser's SRI format. */
export function compilerIntegrityToSRI (hash?: string): string | undefined {
  if (!hash) return undefined
  if (/^sha256-[A-Za-z0-9+/]+=*$/.test(hash)) return hash
  const hex = String(hash).replace(/^0x/i, '')
  if (!/^[0-9a-f]{64}$/i.test(hex)) return undefined
  let binary = ''
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  if (typeof btoa !== 'function') return undefined
  return `sha256-${btoa(binary)}`
}

/**
 * Checks if the worker can be used to load a compiler.
 * checks a compiler whitelist, browser support and OS.
 */
export function canUseWorker (selectedVersion) {
  const version = semver.coerce(selectedVersion)
  return !!version && browserSupportWorker() && semver.gt(version, '0.5.13')
}

function browserSupportWorker () {
  return typeof document !== 'undefined' && document.location.protocol !== 'file:' && typeof Worker !== 'undefined'
}

// returns a promise for minixhr
export function promisedMiniXhr (url) {
  return new Promise((resolve, reject) => {
    minixhr(url, (json, event) => {
      resolve({ json, event })
    })
  })
}
