/*
 * Static regression tests for 2026-06-02 audit remediation.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var root = path.join(__dirname, '..', '..', '..')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function readIdeSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

test('app shell and nginx config provide CSP and clickjacking headers', function (t) {
  const indexHtml = readIdeSource('index.html')
  const webpackIndexHtml = readIdeSource('webpack.index.html')
  const nginxConfig = readRoot('apps/remix-ide/nginx.conf')

  t.ok(/http-equiv="Content-Security-Policy"/.test(indexHtml), 'index.html has a CSP meta fallback')
  t.ok(/http-equiv="Content-Security-Policy"/.test(webpackIndexHtml), 'webpack.index.html has a CSP meta fallback')
  t.ok(/default-src 'self'/.test(indexHtml), 'CSP defaults to self')
  t.ok(/object-src 'none'/.test(indexHtml), 'CSP disables object/embed content')
  t.ok(/connect-src/.test(indexHtml), 'CSP defines connect-src for browser RPC/API calls')
  t.ok(/tronprotocol\.github\.io/.test(indexHtml), 'CSP allows TRON compiler source')
  t.ok(/add_header Content-Security-Policy/.test(nginxConfig), 'nginx sends CSP as a response header')
  t.ok(/frame-ancestors 'self'/.test(nginxConfig), 'nginx CSP controls embedding with frame-ancestors')
  t.ok(/add_header X-Frame-Options "SAMEORIGIN" always/.test(nginxConfig), 'nginx sends X-Frame-Options SAMEORIGIN')
  t.end()
})

test('TronGrid API key config is explicitly public and legacy TRON_PRO_API_KEY is not bundled', function (t) {
  const executionContext = readIdeSource('blockchain/execution-context.js')
  const webpackConfig = readRoot('apps/remix-ide/webpack.config.js')
  const envExample = readRoot('.env.example')

  t.notOk(/process\.env\.TRON_PRO_API_KEY/.test(executionContext), 'execution context no longer reads TRON_PRO_API_KEY')
  t.notOk(/process\.env\.TRON_PRO_API_KEY/.test(webpackConfig), 'webpack no longer inlines TRON_PRO_API_KEY')
  t.ok(/TRON_PUBLIC_TRONGRID_API_KEY/.test(executionContext), 'execution context uses the explicitly public TronGrid key name')
  t.ok(/TRON_PUBLIC_TRONGRID_API_KEY/.test(webpackConfig), 'webpack defines the explicitly public TronGrid key name')
  t.notOk(/typeof process !== 'undefined' && process\.env && process\.env\.TRON_PUBLIC_TRONGRID_API_KEY/.test(executionContext), 'public TronGrid key is not hidden behind a runtime process guard after DefinePlugin replacement')
  t.ok(/restricted by referrer\/origin/.test(envExample), 'env example documents origin/referrer restriction for public keys')
  t.end()
})

test('Contract verification API endpoints are configurable and retryable', function (t) {
  const source = readIdeSource('app/tabs/contract-verification-tab.js')
  const webpackConfig = readRoot('apps/remix-ide/webpack.config.js')

  t.ok(/parseEndpointList/.test(source), 'endpoint override parser exists')
  t.ok(/TRONSCAN_MAINNET_CONTRACT_API_URLS/.test(source), 'mainnet contract API endpoint is build-configurable')
  t.ok(/TRONSCAN_NILE_CONTRACT_API_URLS/.test(source), 'nile contract API endpoint is build-configurable')
  t.ok(/TRONSCAN_SHASTA_CONTRACT_API_URLS/.test(source), 'shasta contract API endpoint is build-configurable')
  t.ok(/TRONSCAN_MAINNET_CONTRACT_API_URLS/.test(webpackConfig), 'webpack exposes mainnet contract API override')
  t.notOk(/env\[envName\]/.test(source), 'endpoint overrides use static env references that DefinePlugin can inline')
  t.ok(/const contractApis = target\.apis/.test(source), 'status checks use an endpoint list, not a single hardcoded URL')
  t.ok(/contractApis\.flatMap/.test(source), 'status checks retry both query shapes across configured endpoints')
  t.ok(/contract status endpoint failed/.test(source), 'failed endpoints emit diagnostics before trying fallbacks')
  t.ok(/extractContractFromStatusPayload/.test(source), 'status checks validate response payload semantics before stopping retries')
  t.ok(/reported no contract for the address[\s\S]*?\n\s*continue/.test(source), 'empty 2xx responses continue to the next fallback')
  t.end()
})

test('TVM provider preserves transaction gas and log hex encoding', function (t) {
  const source = readRoot('libs/remix-lib/src/web3Provider/web3VmProvider.ts')

  t.ok(/data\.totalGasSpent/.test(source), 'afterTx gas fallback reads totalGasSpent')
  t.ok(/data\.blockGasSpent/.test(source), 'afterTx gas fallback reads blockGasSpent')
  t.ok(/execResult\.executionGasUsed/.test(source), 'afterTx gas fallback reads executionGasUsed')
  t.ok(/toQuantityHex\(gasUsed\)/.test(source), 'gas values are normalized as JSON-RPC quantity hex')
  t.ok(/function toVmLogHex/.test(source), 'VM log values use a dedicated hex encoder')
  t.ok(/bufferToHex\(value\)/.test(source), 'VM log Uint8Array values are encoded with bufferToHex')
  t.notOk(/toString\('hex'\)/.test(source), 'VM logs no longer rely on Uint8Array.toString("hex")')
  t.end()
})

test('Maintained source no longer has silent empty catch blocks from the 2026-06-02 audit list', function (t) {
  const files = [
    'apps/remix-ide/src/lib/gist-handler.js',
    'apps/remix-ide/src/app/tabs/runTab/settings.js',
    'apps/remix-ide/src/app/components/local-plugin.js',
    'apps/remix-ide/src/app/components/header-panel.js',
    'apps/remix-ide/src/blockchain/blockchain.js',
    'libs/remix-ui/top-header/src/lib/top-header.js'
  ]

  for (const file of files) {
    const source = readRoot(file)
    t.notOk(/catch \((?:error|err|e)\) \{\s*\}/.test(source), `${file} has no empty catch block`)
  }
  t.end()
})

test('Maintained TRON execution code reduces type-suppression escapes', function (t) {
  const runtimeFacade = readRoot('libs/remix-lib/src/execution/runtimeFacade.ts')
  const txExecution = readRoot('libs/remix-lib/src/execution/txExecution.ts')
  const txRunner = readRoot('libs/remix-lib/src/execution/txRunnerWeb3.ts')
  const compilerWorker = readRoot('libs/remix-solidity/src/lib/es-web-worker/compiler-worker.ts')
  const tronAnalyzer = readRoot('libs/remix-analyzer/src/solidity-analyzer/modules/tronTransactionConfig.ts')

  t.notOk(/as any/.test(runtimeFacade), 'runtimeFacade has no as-any escape')
  t.notOk(/as any/.test(txExecution), 'txExecution has no as-any escape')
  t.notOk(/\(this\.getWeb3\(\) as any\)/.test(txRunner), 'txRunnerWeb3 no longer casts getWeb3() to any')
  t.notOk(/@ts-ignore/.test(txRunner), 'txRunnerWeb3 no longer suppresses _jsonInterfaceMethodToString type checking')
  t.notOk(/as any/.test(compilerWorker), 'compiler worker importScripts path uses a precise worker scope type')
  t.notOk(/as any/.test(tronAnalyzer), 'TRON analyzer config assignment no longer casts literal values to any')
  t.end()
})

test('Production dependency audit overrides are explicit and release-scoped', function (t) {
  const rootPackage = JSON.parse(readRoot('package.json'))
  const overrides = rootPackage.pnpm && rootPackage.pnpm.overrides ? rootPackage.pnpm.overrides : {}
  const patchedDependencies = rootPackage.pnpm && rootPackage.pnpm.patchedDependencies ? rootPackage.pnpm.patchedDependencies : {}
  const lockfile = readRoot('pnpm-lock.yaml')
  const requestPatch = readRoot('patches/request@2.88.2.patch')

  t.notOk(Object.prototype.hasOwnProperty.call(rootPackage.dependencies, 'eth-lib'), 'unused eth-lib direct production dependency is removed')
  t.equal(overrides['web3-bzz'], 'link:libs/web3-bzz-disabled', 'unused web3.bzz Swarm module is replaced by a local disabled adapter')
  t.equal(overrides['web3-eth-accounts>uuid'], '11.1.1', 'web3 account UUID generation uses a maintained uuid release')
  t.equal(overrides['uuid@8.3.2'], '11.1.1', 'transitive uuid 8.x resolutions use a maintained uuid release')
  t.equal(overrides['request>uuid'], '11.1.1', 'legacy request UUID generation uses a maintained uuid release')
  t.equal(patchedDependencies['request@2.88.2'], 'patches/request@2.88.2.patch', 'legacy request imports are patched for uuid 11 compatibility')
  t.ok(/require\('uuid'\)\.v4/.test(requestPatch), 'request patch uses the uuid 11 CommonJS entry point')
  t.notOk(/\n  uuid@(3|8)\.\d+\.\d+:\n/.test(lockfile), 'lockfile no longer has vulnerable uuid 3.x/8.x package entries')
  t.notOk(/\n  uuid@(3|8)\.\d+\.\d+: \{\}/.test(lockfile), 'lockfile no longer has vulnerable uuid 3.x/8.x snapshots')
  t.equal(overrides['web3-core-subscriptions'], 'link:libs/web3-core-subscriptions-patched', 'web3 subscription prototype-pollution advisory is patched locally')
  t.equal(overrides['elliptic'], 'link:libs/elliptic-patched', 'elliptic RFC6979 nonce advisory is patched locally')

  const bzzPackage = JSON.parse(readRoot('libs/web3-bzz-disabled/package.json'))
  const bzzSource = readRoot('libs/web3-bzz-disabled/index.js')
  t.equal(bzzPackage.name, 'web3-bzz', 'disabled Swarm adapter keeps the original package name for web3 compatibility')
  t.ok(/web3\.bzz is disabled in TronIDE/.test(bzzSource), 'disabled Swarm adapter fails closed with an explicit message')
  t.end()
})

test('Patched web3-core-subscriptions rejects prototype-polluting names', function (t) {
  const Subscriptions = require(path.join(root, 'libs/web3-core-subscriptions-patched/lib')).subscriptions
  const before = Object.prototype.tronideAuditPolluted
  const unsafeNames = [
    '__proto__.tronideAuditPolluted',
    'prototype.tronideAuditPolluted',
    'constructor.tronideAuditPolluted',
    'eth.__proto__',
    'eth.prototype',
    'eth.constructor'
  ]

  unsafeNames.forEach(function (name) {
    const subscriptions = new Subscriptions({ name, type: 'eth', subscriptions: {} })
    t.throws(function () {
      subscriptions.attachToObject({})
    }, /Invalid subscription name/, `${name} is rejected before object assignment`)
  })

  t.equal(Object.prototype.tronideAuditPolluted, before, 'unsafe subscription names do not mutate Object.prototype')
  delete Object.prototype.tronideAuditPolluted

  const target = {}
  new Subscriptions({ name: 'eth.subscribe', type: 'eth', subscriptions: {} }).attachToObject(target)
  t.equal(typeof target.eth.subscribe, 'function', 'safe nested subscription names still attach normally')
  t.end()
})

test('Patched elliptic keeps RFC6979 nonce candidates at curve-order byte length', function (t) {
  const ellipticSource = readRoot('libs/elliptic-patched/lib/elliptic/ec/index.js')
  const ellipticPackage = JSON.parse(readRoot('libs/elliptic-patched/package.json'))

  t.equal(ellipticPackage.name, 'elliptic', 'patched elliptic adapter keeps the original package name')
  t.equal(ellipticPackage.version, '6.7.0-tronide.0', 'patched elliptic version is outside the vulnerable advisory range')
  t.ok(/CVE-2025-14505/.test(ellipticSource), 'elliptic patch documents the covered advisory')
  t.ok(/_truncateToN\(k,\s*true,\s*bytes\s*\*\s*8\)/.test(ellipticSource), 'RFC6979 k candidates are truncated with the full curve-order byte length')
  t.notOk(/_truncateToN\(k,\s*true\);/.test(ellipticSource), 'elliptic no longer infers k bit length from a leading-zero-stripped BN')

  const elliptic = require(path.join(root, 'libs/elliptic-patched'))
  const ec = new elliptic.ec('secp256k1')
  const privateKey = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex')
  const message = Buffer.from('0101010101010101010101010101010101010101010101010101010101010101', 'hex')
  const signature = ec.sign(message, privateKey, { canonical: true })
  t.ok(ec.verify(message, signature, ec.keyFromPrivate(privateKey).getPublic()), 'patched elliptic still signs and verifies secp256k1 messages')
  t.end()
})
