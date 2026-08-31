/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var lockPromise = import('../../../libs/remix-code-reader/src/services/aiWriteLock.js')
var policiesPromise = import('../../../libs/remix-code-reader/src/services/aiToolPolicies.js')
var root = path.join(__dirname, '..', '..', '..')

function storage () {
  var values = new Map()
  return {
    getItem: function (key) { return values.has(key) ? values.get(key) : null },
    setItem: function (key, value) { values.set(key, String(value)) },
    removeItem: function (key) { values.delete(key) }
  }
}

test('AI write lock is task-reentrant and blocks concurrent task writers', async function (t) {
  var module = await lockPromise
  var now = 100
  var lock = new module.AITaskWriteLock({ storage: storage(), now: function () { return now }, ttlMs: 1000 })
  var context = { workspace: 'default', branch: 'main' }
  var first = lock.acquire({ taskId: 'task-1', stepId: 'step-1', toolName: 'edit_file', context: context })
  var again = lock.acquire({ taskId: 'task-1', stepId: 'step-2', toolName: 'git_commit', context: context })
  var competing = lock.acquire({ taskId: 'task-2', stepId: 'step-1', toolName: 'edit_file', context: context })

  t.equal(first.ok, true, 'first writer acquires the lock')
  t.equal(again.ok, true, 'the same task can run its next write step')
  t.equal(again.lock.acquiredAt, first.lock.acquiredAt, 'reentrant acquisition preserves the task lease origin')
  t.equal(competing.ok, false, 'a second task cannot write concurrently')
  t.equal(competing.code, 'LOCKED', 'concurrent denial is explicit')
  t.end()
})

test('AI write lock fails closed on workspace or branch drift', async function (t) {
  var module = await lockPromise
  var lock = new module.AITaskWriteLock({ storage: storage(), now: function () { return 100 } })
  var base = { workspace: 'default', branch: 'main', provider: 'injected', networkId: 'nile', account: 'TOne' }
  lock.acquire({ taskId: 'task-1', context: base })
  var drifted = lock.acquire({ taskId: 'task-1', context: { ...base, branch: 'other' } })

  t.equal(drifted.ok, false, 'context drift blocks the next side effect')
  t.equal(drifted.code, 'STATE_CHANGED', 'drift has a canonical state-change category')
  t.equal(lock.snapshot().context.branch, 'main', 'the protected context is not overwritten')
  t.end()
})

test('AI write lock preserves concrete chain identity across local task steps', async function (t) {
  var module = await lockPromise
  var lock = new module.AITaskWriteLock({ storage: storage(), now: function () { return 100 } })
  var chain = { workspace: 'default', branch: 'main', provider: 'injected', networkId: 'nile', account: 'TOne' }
  var local = { workspace: 'default', branch: 'main', provider: null, networkId: null, account: null }

  t.equal(lock.acquire({ taskId: 'task-1', toolName: 'deploy_contract', context: chain }).ok, true, 'chain step acquires the task lock')
  var localStep = lock.acquire({ taskId: 'task-1', toolName: 'save_recording', context: local })
  t.equal(localStep.ok, true, 'same task can continue with a local side effect')
  t.equal(localStep.lock.context.networkId, 'nile', 'local step preserves the stronger chain identity')
  t.equal(localStep.lock.context.account, 'TOne', 'local step preserves the approved account')
  var nextApprovedChainStep = lock.acquire({ taskId: 'task-1', toolName: 'write_contract', context: { ...chain, account: 'TTwo' } })
  t.equal(nextApprovedChainStep.ok, true, 'a newly approved chain step may choose another account')
  t.equal(nextApprovedChainStep.lock.context.account, 'TTwo', 'the diagnostic lease records the latest approved account')
  t.end()
})

test('AI write lock enriches a local lease at the first chain step', async function (t) {
  var module = await lockPromise
  var lock = new module.AITaskWriteLock({ storage: storage(), now: function () { return 100 } })
  var local = { workspace: 'default', branch: 'main' }
  var chain = { ...local, provider: 'vm', networkId: 'vm', account: 'TOne' }

  lock.acquire({ taskId: 'task-1', toolName: 'create_file', context: local })
  var enriched = lock.acquire({ taskId: 'task-1', toolName: 'deploy_contract', context: chain })
  t.equal(enriched.ok, true, 'first R3 step can enrich an existing local lease')
  t.deepEqual(enriched.lock.context, chain, 'enriched lease records the exact chain identity')
  t.end()
})

test('AI write lock supports approved context rebind and owner-only release', async function (t) {
  var module = await lockPromise
  var driver = storage()
  var lock = new module.AITaskWriteLock({ storage: driver, now: function () { return 100 } })
  lock.acquire({ taskId: 'task-1', context: { workspace: 'one', branch: 'main' } })
  var rebound = lock.rebind({ taskId: 'task-1', context: { workspace: 'two', branch: 'release' } })

  t.equal(rebound.ok, true, 'an explicitly approved workspace/branch tool can rebind the lease')
  t.equal(lock.snapshot().context.workspace, 'two', 'new workspace becomes the protected context')
  t.equal(lock.release('task-2'), false, 'another task cannot release the lease')
  t.equal(lock.release('task-1'), true, 'the owner releases the lease')
  t.equal(lock.snapshot(), null, 'released lock is gone')
  t.end()
})

test('AI write lock fails closed when a rebound lease cannot be verified', async function (t) {
  var module = await lockPromise
  var missingDriver = storage()
  var missingLock = new module.AITaskWriteLock({ storage: missingDriver, now: function () { return 100 } })
  missingLock.acquire({ taskId: 'task-missing', context: { workspace: 'one', branch: 'main' } })
  var missingGetItem = missingDriver.getItem
  var missingReads = 0
  missingDriver.getItem = function (key) {
    missingReads++
    return missingReads === 2 ? null : missingGetItem(key)
  }
  var missing = missingLock.rebind({ taskId: 'task-missing', context: { workspace: 'two', branch: 'release' } })

  t.equal(missing.ok, false, 'a missing post-write lease never reports a successful rebind')
  t.equal(missing.code, 'LOCK_LOST', 'missing verification has an explicit fail-closed code')
  t.equal(missing.lock, null, 'the failed result does not invent an owned lease')

  var replacedDriver = storage()
  var replacedLock = new module.AITaskWriteLock({ storage: replacedDriver, now: function () { return 200 } })
  replacedLock.acquire({ taskId: 'task-replaced', context: { workspace: 'one', branch: 'main' } })
  var replacedGetItem = replacedDriver.getItem
  var replacedReads = 0
  replacedDriver.getItem = function (key) {
    replacedReads++
    var raw = replacedGetItem(key)
    if (replacedReads !== 2 || !raw) return raw
    return JSON.stringify({ ...JSON.parse(raw), nonce: 'another-writer' })
  }
  var replaced = replacedLock.rebind({ taskId: 'task-replaced', context: { workspace: 'two', branch: 'release' } })

  t.equal(replaced.ok, false, 'a concurrently replaced nonce never reports a successful rebind')
  t.equal(replaced.code, 'LOCK_LOST', 'nonce mismatch is treated as a lost lease')
  t.equal(replaced.lock.nonce, 'another-writer', 'the conflicting lease remains available for diagnostics')
  t.end()
})

test('AI write lock expires after crashes and preserves uncertain writes briefly', async function (t) {
  var module = await lockPromise
  var driver = storage()
  var now = 100
  var lock = new module.AITaskWriteLock({ storage: driver, now: function () { return now }, ttlMs: 50 })
  lock.acquire({ taskId: 'task-1', context: { workspace: 'default' } })
  t.equal(lock.preserveUntilExpiry('task-1', 200), true, 'uncertain task extends its safety lease')
  now = 250
  t.ok(lock.snapshot(), 'lease remains while the uncertainty window is active')
  now = 301
  t.equal(lock.recoverExpired(), null, 'stale crash lock is automatically recovered')
  t.end()
})

test('AI policy gate wires approvals, workspace switches, and task lock lifecycle', async function (t) {
  var policies = await policiesPromise
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')

  t.equal(policies.getAIToolPolicy('switch_workspace').riskLevel, 'R1', 'workspace switch is a local side effect, not a read')
  t.ok(chat.indexOf('task.write_lock_acquired') !== -1, 'side-effect step records lock acquisition')
  t.ok(chat.indexOf('task.write_lock_released') !== -1, 'completed task releases its lock')
  t.ok(chat.indexOf('task.write_lock_preserved') !== -1, 'uncertain task preserves a bounded lease')
  t.ok(chat.indexOf('AI_TOOL_ERROR_CODE.USER_REJECTED') !== -1, 'approval rejection becomes a canonical tool result')
  t.ok(chat.indexOf('title: riskLabel ?') !== -1, 'approval title exposes the canonical risk level')
  t.ok(chat.indexOf('Workspace/branch write lock: held by this task') !== -1, 'approval preview exposes the task-owned write lock')
  t.ok(chat.indexOf('writeContext: captured.context') !== -1, 'the displayed lock context is the acquired context')
  t.ok(chat.indexOf("'git_commit'") !== -1, 'an unborn repository commit can rebind the materialized branch')
  t.ok(chat.indexOf('_gitStagedSnapshot') !== -1, 'Git commit approval snapshots and rechecks the staged scope')
  t.ok(chat.indexOf('_withGitRemoteConfirmationContext') !== -1, 'remote push/pull confirmations bind the approved remote')
  t.end()
})
