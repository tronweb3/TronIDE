/*
 * Static regression tests for 2026-06-02 audit remediation.
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
  t.ok(/returned no contract data/.test(source), 'empty 2xx responses continue to the next fallback')
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
