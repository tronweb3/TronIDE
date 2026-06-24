/*
 * Static regression tests for 2026-05-20 audit remediation.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8')
}

function readIdeSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

function readLibSource (relativePath) {
  return readRoot(path.join('libs/remix-solidity/src', relativePath))
}

test('compiler source mock overrides are dev-gated and compiler URLs are allowlisted', function (t) {
  const utilsSource = readLibSource('compiler/compiler-utils.ts')
  const compilerSource = readLibSource('compiler/compiler.ts')
  const workerSource = readLibSource('lib/es-web-worker/compiler-worker.ts')

  t.ok(/function isCompilerSourceMockEnabled/.test(utilsSource), 'compiler mock mode has an explicit enablement helper')
  t.ok(/tronideAllowCompilerSourceMock/.test(utilsSource), 'mock mode requires explicit window opt-in')
  t.ok(/mockMode === 'custom'/.test(utilsSource), 'only an explicit custom mock mode can use a supplied custom compiler URL')
  t.ok(/export function assertAllowedCompilerURL/.test(utilsSource), 'compiler URL allowlist helper is exported')
  t.ok(/ALLOWED_COMPILER_ORIGINS/.test(utilsSource), 'compiler URLs are checked against known compiler origins')
  t.ok(/assertAllowedCompilerURL\(url\)/.test(compilerSource), 'main-thread compiler loading validates URL before script insertion or worker postMessage')
  t.ok(/assertAllowedCompilerURL\(data\.data\)/.test(workerSource), 'worker validates compiler URL before importScripts')
  t.end()
})

test('terminal HTML links are protocol-filtered after sanitization', function (t) {
  const source = readIdeSource('app/panels/terminal.js')

  t.ok(/TERMINAL_ALLOWED_LINK_PROTOCOLS/.test(source), 'terminal defines an explicit link protocol allowlist')
  t.ok(/sanitizeTerminalLinks/.test(source), 'terminal sanitizes link hrefs after DOMPurify')
  t.ok(/new URL\(href, window\.location\.href\)/.test(source), 'terminal parses hrefs relative to the current page')
  t.ok(/anchor\.removeAttribute\('href'\)/.test(source), 'terminal removes disallowed or malformed hrefs')
  t.ok(/sanitizeTerminalLinks\(el\)/.test(source), 'terminal applies link sanitizer to HTML log output')
  t.end()
})

test('remixd websocket authenticates localhost session and validates message schema', function (t) {
  const source = readIdeSource('lib/remixd.js')

  t.ok(/createSessionToken/.test(source), 'remixd client creates an unpredictable session token')
  t.ok(/remixdToken=/.test(source), 'remixd client sends token in websocket URL')
  t.ok(/this\.authenticated\s*=\s*false/.test(source), 'remixd client starts unauthenticated')
  t.ok(/data\.type === 'handshake'/.test(source), 'remixd client waits for handshake message')
  t.ok(/data\.token !== this\.sessionToken/.test(source), 'remixd client rejects mismatched handshake token')
  t.ok(/isValidRemixdMessage/.test(source), 'remixd client validates incoming message schema')
  t.ok(/this\.event\.trigger\('diagnostic'/.test(source), 'remixd client emits diagnostics for malformed lifecycle events')
  t.end()
})

test('TRC10 and transaction formatting avoid JavaScript number precision loss', function (t) {
  const settingsSource = readIdeSource('app/tabs/runTab/settings.js')
  const txIntegerSource = readRoot('libs/remix-lib/src/execution/txIntegerUtils.ts')
  const web3ProviderSource = readIdeSource('app/tabs/web3-provider.js')

  t.ok(/validateTrc10Inputs\s*\(tokenId: BN \| string \| number, tokenValue: BN \| string \| number\)/.test(txIntegerSource), 'TRC10 validator accepts BN/string values')
  t.ok(/const tokenIdBN = toBN\(tokenId\)/.test(txIntegerSource), 'TRC10 validator normalizes token ID to BN')
  t.ok(/const tokenValueBN = toBN\(tokenValue\)/.test(txIntegerSource), 'TRC10 validator normalizes token value to BN')
  t.notOk(/tokenId\.toNumber\(\)/.test(settingsSource), 'settings TRC10 validation does not convert token ID to number')
  t.notOk(/tokenValue\.toNumber\(\)/.test(settingsSource), 'settings TRC10 validation does not convert token value to number')
  t.ok(/validateTrc10Inputs\(tokenId, tokenValue\)/.test(settingsSource), 'settings passes BN values into TRC10 validation')
  t.ok(/formatTronValueHex/.test(web3ProviderSource), 'web3 provider uses a dedicated precise value formatter')
  t.notOk(/Number\(callValue\)\.toString\(16\)/.test(web3ProviderSource), 'web3 provider does not use Number(callValue)')
  t.ok(/new BN\(String\(value \|\| 0\), 10\)\.toString\(16\)/.test(web3ProviderSource), 'web3 provider formats value with BN')
  t.end()
})

test('message signing shows deterministic pre-sign summary and rechecks signer context', function (t) {
  const source = readIdeSource('app/tabs/runTab/settings.js')

  t.ok(/showSignMessageConfirmation/.test(source), 'sign-message flow has a pre-sign confirmation helper')
  t.ok(/Provider/.test(source) && /Network/.test(source) && /Account/.test(source) && /Message hash/.test(source), 'confirmation includes provider, network, account, and hash labels')
  t.ok(/hashPersonalMessage\(Buffer\.from\(message\)\)/.test(source), 'confirmation computes the expected personal-message hash before signing')
  t.ok(/getSignMessageContext/.test(source), 'sign-message flow snapshots provider/network/account context')
  t.ok(/assertSignMessageContextUnchanged/.test(source), 'sign-message flow rechecks signer context before signing')
  t.ok(/modalDialog\('Confirm message signature'/.test(source), 'sign-message flow requires explicit confirmation')
  t.end()
})

test('empty catch blocks now emit diagnostics', function (t) {
  const searchSource = readIdeSource('app/search/global-search-panel.js')
  const remixdSource = readIdeSource('lib/remixd.js')

  t.notOk(/catch \(error\) \{\}/.test(searchSource), 'global search no longer swallows localStorage errors silently')
  t.ok(/console\.debug\('\[global-search\]/.test(searchSource), 'global search emits debug diagnostics for storage errors')
  t.notOk(/catch \(e\) \{\}/.test(remixdSource), 'remixd close errors are not swallowed silently')
  t.ok(/this\.event\.trigger\('diagnostic'/.test(remixdSource), 'remixd emits diagnostic events for close/message errors')
  t.end()
})

test('production ws advisory is pinned to patched ws version', function (t) {
  const packageJson = JSON.parse(readRoot('package.json'))
  const lockfile = readRoot('pnpm-lock.yaml')

  // Pin must stay an exact version, but accept forward patch bumps: CVE-2024-37890
  // is fixed in 8.17.1, so any version >= 8.17.1 is acceptable (don't hardcode the
  // current patch level or this test goes red every time ws is upgraded).
  const wsOverride = packageJson.pnpm.overrides.ws
  t.ok(/^\d+\.\d+\.\d+$/.test(wsOverride), `ws override is pinned to an exact version (${wsOverride})`)
  const [maj, min, pat] = wsOverride.split('.').map(Number)
  const patched = maj > 8 || (maj === 8 && (min > 17 || (min === 17 && pat >= 1)))
  t.ok(patched, `ws override ${wsOverride} is at or above the patched 8.17.1`)
  t.ok(new RegExp('ws@' + wsOverride.replace(/\./g, '\\.') + ':').test(lockfile), 'lockfile resolves the overridden ws version')
  t.notOk(/ws@8\.17\.0:|ws@8\.18\.0:|ws@8\.20\.0:/.test(lockfile), 'lockfile no longer resolves vulnerable ws 8.x versions')
  t.end()
})
