/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var intelligencePromise = import('../src/app/udapp/ai-transaction-intelligence.js')
var transactionStatus = require('../src/app/ui/transaction-status')
var root = path.join(__dirname, '..', '..', '..')

test('AI environment preserves unknown networks instead of guessing from provider metadata', async function (t) {
  var intelligence = await intelligencePromise
  var unknown = intelligence.normalizeAIEnvironment({
    provider: 'injected',
    networkStatus: { network: { id: 'Unknown', name: 'TRON' }, error: new Error('probe failed') },
    walletState: 'connected',
    accounts: ['TAccount'],
    endpoint: 'https://api.trongrid.io'
  })
  var nile = intelligence.normalizeAIEnvironment({
    provider: 'injected',
    networkStatus: { network: { id: 'nile', name: 'TRON', stale: true } },
    walletState: 'connected'
  })

  t.equal(unknown.network.known, false, 'an unknown genesis ID stays unverified')
  t.equal(unknown.network.id, null, 'mainnet is not inferred from a host URL')
  t.equal(unknown.network.name, 'TRON', 'the raw non-authoritative label remains visible')
  t.equal(unknown.endpoint, 'https://api.trongrid.io', 'endpoint exposes origin only')
  t.equal(intelligence.sanitizeAIEndpoint('https://user:secret@example.test/private/key?apiKey=secret'), 'https://example.test', 'endpoint credentials and secret-bearing paths are removed')
  t.equal(intelligence.sanitizeAIErrorMessage('request https://user:secret@example.test/private?token=secret failed'), 'request https://example.test failed', 'provider errors cannot leak URL credentials or tokens')
  t.equal(nile.network.id, 'nile', 'a genesis-derived Nile ID is accepted')
  t.equal(nile.network.name, 'TRON Nile', 'known ID receives an explicit display name')
  t.equal(nile.network.stale, true, 'cached identity is explicitly marked stale')
  t.end()
})

test('AI environment waits for the Deploy & Run provider selection to settle', async function (t) {
  var intelligence = await intelligencePromise
  var activeProvider = 'vm'
  var polls = 0
  var settled = await intelligence.waitForAIExecutionContext({
    getActiveProvider: function () { return activeProvider },
    getSelectedProvider: function () { return 'injected' },
    timeoutMs: 100,
    pollIntervalMs: 25,
    wait: async function () {
      polls++
      if (polls === 2) activeProvider = 'injected'
    }
  })
  var timedOut = await intelligence.waitForAIExecutionContext({
    getActiveProvider: function () { return 'vm' },
    getSelectedProvider: function () { return 'injected' },
    timeoutMs: 50,
    pollIntervalMs: 25,
    wait: async function () {}
  })

  t.equal(intelligence.normalizeAIProviderSelection('vm-tron'), 'vm', 'the VM dropdown value maps to the active provider kind')
  t.equal(settled.activeProvider, 'injected', 'the snapshot reads the provider after the async switch')
  t.equal(settled.settled, true, 'a completed provider switch is marked settled')
  t.equal(timedOut.activeProvider, 'vm', 'a failed switch keeps the real active provider')
  t.equal(timedOut.selectedProvider, 'injected', 'a failed switch preserves the requested provider for diagnostics')
  t.equal(timedOut.settled, false, 'a timed-out provider mismatch stays explicit')
  t.end()
})

test('AI transaction status distinguishes success, revert, pending and unknown', async function (t) {
  var intelligence = await intelligencePromise
  var hash = 'a'.repeat(64)
  var success = intelligence.normalizeAITransactionStatus({ txHash: hash, networkId: 'main', receipt: { id: hash, receipt: { result: 'SUCCESS' }, blockNumber: 42 } })
  var reverted = intelligence.normalizeAITransactionStatus({ txHash: hash, networkId: 'nile', receipt: { id: hash, receipt: { result: 'FAILED', energy_usage_total: 9 } } })
  var pending = intelligence.normalizeAITransactionStatus({ txHash: hash, networkId: 'shasta', transaction: { txID: hash } })
  var unknown = intelligence.normalizeAITransactionStatus({ txHash: hash, networkId: null, error: new Error('node offline') })

  t.equal(success.status, 'success', 'successful receipt is final')
  t.equal(success.explorerUrl, 'https://tronscan.org/#/transaction/' + hash, 'mainnet link is exact')
  t.equal(reverted.status, 'reverted', 'failed TRON receipt is not reported as success')
  t.equal(reverted.explorerUrl, 'https://nile.tronscan.org/#/transaction/' + hash, 'Nile link is exact')
  t.equal(pending.status, 'pending', 'known transaction without receipt remains pending')
  t.ok(/Do not resubmit/.test(pending.userAction), 'pending transaction warns against blind retry')
  t.equal(unknown.status, 'unknown', 'lookup error preserves uncertainty')
  t.equal(unknown.explorerUrl, null, 'unknown network never gets a guessed explorer link')
  t.equal(transactionStatus.receiptStatus({ receipt: { result: 'SUCCESS' } }), 'SUCCESS', 'UI status reads the native TRON receipt result')
  t.equal(transactionStatus.isSuccessfulReceipt({ receipt: { result: 'SUCCESS' } }), true, 'native TRON success renders as succeeded')
  t.equal(transactionStatus.isFailedReceipt({ receipt: { result: 'FAILED' } }), true, 'native TRON failure renders as failed')
  t.equal(transactionStatus.isFailedReceipt(false), true, 'boolean failure remains a failure')
  t.end()
})

test('AI transaction status fingerprints reject stale or changed execution contexts', async function (t) {
  var intelligence = await intelligencePromise
  var nile = intelligence.createAITransactionEnvironmentFingerprint({
    provider: 'injected',
    network: { known: true, stale: false, id: 'nile' },
    endpoint: 'https://nile.trongrid.io'
  })
  var sameNile = intelligence.createAITransactionEnvironmentFingerprint({
    provider: 'injected',
    network: { known: true, stale: false, id: 'nile' },
    endpoint: 'https://nile.trongrid.io/wallet'
  })
  var main = intelligence.createAITransactionEnvironmentFingerprint({
    provider: 'injected',
    network: { known: true, stale: false, id: 'main' },
    endpoint: 'https://api.trongrid.io'
  })
  var stale = intelligence.createAITransactionEnvironmentFingerprint({
    provider: 'injected',
    network: { known: true, stale: true, id: 'nile' },
    endpoint: 'https://nile.trongrid.io'
  })

  t.equal(nile.valid, true, 'fresh genesis-derived network identity can start a lookup')
  t.equal(intelligence.compareAITransactionEnvironmentFingerprints(nile, sameNile).ok, true, 'paths on the same node origin do not create false drift')
  t.equal(intelligence.compareAITransactionEnvironmentFingerprints(nile, main).ok, false, 'a network and endpoint switch invalidates the lookup')
  t.equal(stale.valid, false, 'stale cached identity cannot authorize a status poll')
  t.equal(intelligence.compareAITransactionEnvironmentFingerprints(nile, stale).ok, false, 'polling fails closed when the current identity is stale')
  t.end()
})

test('AI transaction status waits briefly for a pending receipt to become final', async function (t) {
  var intelligence = await intelligencePromise
  var calls = 0
  var waits = []
  var final = await intelligence.waitForAITransactionFinality({
    lookup: async function () {
      calls++
      return calls < 3 ? { status: 'pending', txHash: 'a'.repeat(64) } : { status: 'success', txHash: 'a'.repeat(64), blockNumber: 42 }
    },
    pollIntervalMs: 25,
    wait: async function (delay) { waits.push(delay) }
  })
  var stillPendingCalls = 0
  var stillPending = await intelligence.waitForAITransactionFinality({
    lookup: async function () { stillPendingCalls++; return { status: 'pending' } },
    maxAttempts: 2,
    wait: async function () {}
  })
  var notFoundCalls = 0
  var notFound = await intelligence.waitForAITransactionFinality({
    lookup: async function () { notFoundCalls++; return { status: 'not_found' } },
    wait: async function () {}
  })

  t.equal(final.status, 'success', 'a receipt observed during the polling window is returned as final')
  t.equal(final.lookupAttempts, 3, 'the final result discloses the number of provider lookups')
  t.deepEqual(waits, [25, 25], 'pending status waits only between lookup attempts')
  t.equal(stillPending.status, 'pending', 'a transaction that stays pending remains honest')
  t.equal(stillPendingCalls, 2, 'the configured attempt limit bounds polling')
  t.equal(notFound.status, 'not_found', 'a missing transaction is returned immediately')
  t.equal(notFoundCalls, 1, 'not_found does not add needless polling')
  t.end()
})

test('AI preflight helpers use exact SUN arithmetic and disclose unavailable estimates', async function (t) {
  var intelligence = await intelligencePromise
  var summary = intelligence.formatAIPreflightSummary({
    environment: { provider: 'vm', network: { name: 'JavaScript VM (Tron)' } },
    from: 'TAccount',
    valueSun: '1',
    balanceTrx: '0.000001',
    feeLimitSun: '400000000',
    resourceEstimate: { status: 'unavailable' },
    issues: [{ message: 'Estimator unavailable' }]
  })

  t.equal(intelligence.trxBalanceToSun('12.345678'), '12345678', 'TRX converts to SUN without floating-point rounding')
  t.equal(intelligence.trxBalanceToSun('invalid'), null, 'invalid balance stays unavailable')
  t.ok(summary.indexOf('Fee limit: 400000000 SUN (400 TRX maximum)') !== -1, 'fee limit shows both SUN and TRX so the model cannot misread the unit')
  t.ok(summary.indexOf('Energy estimate: unavailable') !== -1, 'summary never invents an estimate')
  t.ok(summary.indexOf('Estimator unavailable') !== -1, 'summary surfaces preflight issues')
  t.end()
})

test('AI approval snapshots are canonical and fail closed on transaction drift', async function (t) {
  var intelligence = await intelligencePromise
  var environment = { provider: 'injected', network: { known: true, stale: false, id: 'nile' } }
  var approved = intelligence.createAIApprovalSnapshot({
    environment: environment,
    operation: 'write',
    target: { method: 'store', address: 'TContract', args: [{ b: 2, a: 1 }], artifactFingerprint: '0xabc' },
    from: 'TOne',
    valueSun: '0',
    feeLimitSun: '400000000'
  })
  var reordered = intelligence.createAIApprovalSnapshot({
    environment: environment,
    operation: 'write',
    target: { artifactFingerprint: '0xabc', args: [{ a: 1, b: 2 }], address: 'TContract', method: 'store' },
    from: 'TOne',
    valueSun: 0,
    feeLimitSun: 400000000
  })
  var drifted = intelligence.createAIApprovalSnapshot({ ...reordered, environment: environment, from: 'TTwo' })

  t.equal(intelligence.compareAIApprovalSnapshots(approved, reordered).ok, true, 'object key order does not create false drift')
  t.equal(intelligence.compareAIApprovalSnapshots(approved, drifted).ok, false, 'account drift invalidates approval')
  t.equal(intelligence.compareAIApprovalSnapshots(null, reordered).ok, false, 'missing approval fails closed')
  t.end()
})

test('AI deploy and write paths enforce preflight before confirmation', function (t) {
  var runTab = fs.readFileSync(path.join(root, 'apps/remix-ide/src/app/udapp/run-tab.js'), 'utf8')
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')

  t.ok(runTab.indexOf("'aiGetEnvironment', 'aiPreflightTransaction', 'aiGetTransactionStatus'") !== -1, 'udapp exposes all three read-only intelligence methods')
  t.ok(runTab.indexOf('INJECTED_VALUE_PRECISION_UNSUPPORTED') !== -1, 'injected unsafe SUN values fail closed before AI confirmation')
  t.ok(chat.indexOf("operation: 'deploy'") !== -1, 'deploy runs preflight')
  t.ok(chat.indexOf("operation: 'write'") !== -1, 'write runs preflight')
  t.ok(chat.indexOf('blocked by preflight — nothing was sent') !== -1, 'blocked preflight cannot fall through to a write')
  t.ok(chat.indexOf('FINAL MAINNET CONFIRMATION') !== -1, 'Mainnet chain writes require a second confirmation')
  t.ok(chat.indexOf('approvalSnapshot: preflight.approvalSnapshot') !== -1, 'approved snapshot reaches the broadcast boundary')
  t.ok(runTab.indexOf('_aiAssertApprovalSnapshot(approvalSnapshot') !== -1, 'udapp rechecks approval immediately before chain execution')
  t.ok(chat.indexOf("result.code === AI_TOOL_ERROR_CODE.STATE_CHANGED || result.status === 'unknown'") !== -1, 'transaction-status context drift enters the canonical failure protocol')
  t.ok(chat.indexOf('stateChanged ? AI_TOOL_ERROR_CODE.STATE_CHANGED : AI_TOOL_ERROR_CODE.TX_UNKNOWN') !== -1, 'unknown status cannot be recorded as a successful AI step')
  t.end()
})
