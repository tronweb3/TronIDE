'use strict'
import tape from 'tape'
import { createRuntimeFacade } from '../src/execution/runtimeFacade'

tape('runtimeFacade validates tron transaction guardrails', function (t) {
  t.plan(4)

  const facade = createRuntimeFacade({ kind: 'tvm', environment: 'injected' })
  const invalid = facade.validateTransaction({ tokenId: 0, tokenValue: 1, feeLimit: '9007199254740993' })
  t.equal(invalid.ok, false)
  t.equal(invalid.errors.length >= 2, true)

  const valid = facade.validateTransaction({ tokenId: 1000001, tokenValue: 1, feeLimit: 100000000, from: 'TAccount' })
  t.equal(valid.ok, true)
  t.equal(valid.warnings.length, 0)
})

tape('runtimeFacade accepts a 256-bit callValue beyond the safe-integer range', function (t) {
  t.plan(3)

  const facade = createRuntimeFacade({ kind: 'tvm', environment: 'injected', account: 'TAccount' })
  // 1e18 wei (1 ETH) is a normal JS-VM transaction value but exceeds 2^53-1;
  // it must NOT be rejected (regression guard for the over-eager safe-integer cap).
  t.equal(facade.validateTransaction({ callValue: '1000000000000000000', from: 'TAccount' }).ok, true)
  // malformed and negative callValue are still rejected.
  t.equal(facade.validateTransaction({ callValue: 'not-a-number', from: 'TAccount' }).ok, false)
  t.equal(facade.validateTransaction({ callValue: '-5', from: 'TAccount' }).ok, false)
})

tape('runtimeFacade builds transaction summary and invalidates stale pending signatures', function (t) {
  t.plan(10)

  const facade = createRuntimeFacade({ kind: 'tvm', environment: 'injected', account: 'TAccount1', network: 'Nile' })
  const summary = facade.createTransactionSummary({
    to: 'TContract',
    feeLimit: 100000000,
    callValue: 1,
    tokenId: 1000001,
    tokenValue: 2,
    data: `0x${'a'.repeat(80)}`
  })

  t.equal(summary.from, 'TAccount1')
  t.equal(summary.network, 'Nile')
  t.equal(summary.to, 'TContract')
  t.equal(summary.dataPreview?.endsWith('...'), true)

  const snapshot = facade.createTransactionSnapshot({ from: 'TAccount1', network: 'Nile' })
  t.equal(facade.validatePendingTransaction(snapshot, { account: 'TAccount1', network: 'Nile' }).ok, true)

  const accountChanged = facade.validatePendingTransaction(snapshot, { account: 'TAccount2', network: 'Nile' })
  t.equal(accountChanged.errors[0], 'Wallet account changed. Please reconnect TronLink.')

  const networkChanged = facade.validatePendingTransaction(snapshot, { account: 'TAccount1', network: 'Shasta' })
  t.equal(networkChanged.errors[0], 'Wallet network changed. Please review the selected network.')

  // Regression: account vanishing (disconnect/lock) during pending signature must abort, not pass.
  const accountVanished = facade.validatePendingTransaction(snapshot, { network: 'Nile' })
  t.equal(accountVanished.ok, false, 'missing current account aborts the pending broadcast')
  t.equal(accountVanished.errors[0], 'Wallet account changed. Please reconnect TronLink.')
  // Network detection being transiently unavailable should NOT, by itself, abort.
  t.equal(facade.validatePendingTransaction(snapshot, { account: 'TAccount1' }).ok, true, 'missing current network does not false-abort')
})

tape('runtimeFacade normalizes tron receipts and provider errors', function (t) {
  t.plan(4)

  const facade = createRuntimeFacade({ kind: 'tvm', environment: 'http' })
  const success = facade.normalizeReceipt({ txID: 'abc', receipt: { result: 'SUCCESS' } })
  t.equal(success.transactionHash, 'abc')
  t.equal(success.status, 'success')

  const failure = facade.normalizeReceipt({ transactionHash: 'def', result: 'REVERT', error: new Error('Wallet disconnected') })
  t.equal(failure.status, 'failure')
  t.equal(failure.error?.code, 'WALLET_DISCONNECTED')
})

tape('runtimeFacade exposes tron trace fallback capability', function (t) {
  t.plan(5)

  const unsupported = createRuntimeFacade({ kind: 'tvm', environment: 'http' }).getTraceStrategy()
  t.equal(unsupported.supportsTrace, false)
  t.equal(unsupported.fallback, 'unsupported')
  t.ok(unsupported.reason.includes('TRON trace unsupported'))

  const supported = createRuntimeFacade({ kind: 'tvm', environment: 'custom', provider: { supportsDebugTrace: true } }).getTraceStrategy()
  t.equal(supported.supportsTrace, true)
  t.equal(supported.fallback, 'debug-rpc')
})
