/*
 * Static regression tests for TronGrid polling and rate-limit handling.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function readSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

test('network detection caches Tron genesis lookup and backs off after rate limits', function (t) {
  const executionContextSource = readSource('blockchain/execution-context.js')
  const blockchainSource = readSource('blockchain/blockchain.js')

  t.ok(/this\._networkDetectionCache\s*=\s*null/.test(executionContextSource), 'ExecutionContext stores network detection cache')
  t.ok(/this\._networkDetectionBackoffUntil\s*=\s*0/.test(executionContextSource), 'ExecutionContext tracks network detection cooldown')
  t.ok(/this\._lastNetworkStatus\s*=\s*null/.test(executionContextSource), 'ExecutionContext keeps last successful network status')
  t.ok(/_isRateLimitError\s*\(error\)/.test(executionContextSource), 'ExecutionContext detects TronGrid rate-limit errors')
  t.ok(/_recordNetworkDetectionFailure\s*\(err\)/.test(executionContextSource), 'ExecutionContext records detectNetwork failures')
  t.ok(/_getCachedNetworkStatus\s*\(\)/.test(executionContextSource), 'ExecutionContext can return cached network status')
  t.ok(/Date\.now\(\)\s*<\s*this\._networkDetectionBackoffUntil[\s\S]*callback\(null, cachedNetwork\)/.test(executionContextSource), 'detectNetwork serves cached network while cooling down')
  t.ok(/this\._networkDetectionCache[\s\S]*blockID/.test(executionContextSource), 'detectNetwork caches genesis block lookup result')
  t.ok(/callback\(null, cachedNetwork\)/.test(executionContextSource), 'rate-limited detection keeps UI on last known network instead of erroring')
  t.ok(/NETWORK_STATUS_POLL_INTERVAL\s*=\s*30000/.test(blockchainSource), 'network status polling is reduced to 30 seconds')
  t.notOk(/},\s*3000\)/.test(blockchainSource), 'blockchain no longer polls network status every 3 seconds')
  t.end()
})

test('SettingsUI slows TronGrid balance polling and pauses while hidden', function (t) {
  const source = readSource('app/tabs/runTab/settings.js')

  t.ok(/ACCOUNT_BALANCE_POLL_INTERVAL\s*=\s*30000/.test(source), 'account balance polling interval is 30 seconds')
  t.ok(/document\.visibilityState\s*===\s*'hidden'/.test(source), 'account balance refresh is skipped while the document is hidden')
  t.ok(/this\._lastBalanceRateLimitAt\s*=\s*0/.test(source), 'SettingsUI tracks balance rate-limit cooldown')
  t.ok(/BALANCE_RATE_LIMIT_BACKOFF\s*=\s*60000/.test(source), 'SettingsUI applies a 60 second balance rate-limit backoff')
  t.ok(/_isRateLimitError\s*\(err\)/.test(source), 'SettingsUI detects balance rate-limit errors')
  t.ok(/Date\.now\(\)\s*-\s*this\._lastBalanceRateLimitAt\s*<\s*BALANCE_RATE_LIMIT_BACKOFF/.test(source), 'balance refresh returns early during rate-limit backoff')
  t.notOk(/},\s*3000\)/.test(source), 'SettingsUI no longer polls balances every 3 seconds')
  t.end()
})
