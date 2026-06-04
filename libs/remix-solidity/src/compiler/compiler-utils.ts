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

export function assertAllowedCompilerURL (url) {
  const parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : tronCompilerSourceProvider.baseURL)
  const sameOrigin = typeof window !== 'undefined' && parsed.origin === window.location.origin
  if (sameOrigin && parsed.pathname.indexOf('/__remix_mock_compiler_source_') === 0 && isCompilerSourceMockEnabled()) return parsed.href
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
  return tronCompilerSourceProvider.constructVersionURL(version)
  // if (!version.startsWith('soljson_v')) version = 'soljson_v' + version
  // if (!version.endsWith('.js')) version = version + '.js'
  // return `${pathToURL[version]}/${version.replace(/\+commit.[0-9,a-z]+/g, '')}`
}

/**
 * Checks if the worker can be used to load a compiler.
 * checks a compiler whitelist, browser support and OS.
 */
export function canUseWorker (selectedVersion) {
  const version = semver.coerce(selectedVersion)
  return browserSupportWorker() && semver.gt(version, '0.5.13')
}

function browserSupportWorker () {
  return document.location.protocol !== 'file:' && Worker !== undefined
}

// returns a promise for minixhr
export function promisedMiniXhr (url) {
  return new Promise((resolve, reject) => {
    minixhr(url, (json, event) => {
      resolve({ json, event })
    })
  })
}
