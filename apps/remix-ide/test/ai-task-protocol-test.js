/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')

var protocolPromise = import('../../../libs/remix-code-reader/src/services/aiTaskProtocol.js')

test('AI task protocol creates versioned task and step fixtures', async function (t) {
  var protocol = await protocolPromise
  var task = protocol.createAITask({
    taskId: 'task-1',
    goal: 'Compile and test the current contract',
    workspace: 'default_workspace',
    branch: 'release/v2.3.3',
    now: 100
  })
  var step = protocol.createAITaskStep({
    taskId: task.taskId,
    stepId: 'step-1',
    toolName: 'compile_contract',
    riskLevel: protocol.AI_RISK_LEVEL.READ_ONLY,
    inputSummary: 'contracts/Storage.sol',
    now: 101
  })

  t.equal(task.schemaVersion, 1, 'task schema is versioned')
  t.equal(task.status, 'planned', 'new task starts planned')
  t.equal(task.createdAt, 100, 'task timestamp is deterministic')
  t.equal(task.entry, null, 'plain chat tasks have no registry snapshot')
  t.equal(step.sideEffect, 'none', 'R0 step derives no side effect')
  t.equal(step.status, 'planned', 'new step starts planned')
  t.ok(Object.isFrozen(task), 'task fixture is immutable')
  t.end()
})

test('AI task protocol enforces state transitions and resolves uncertainty', async function (t) {
  var protocol = await protocolPromise
  var task = protocol.createAITask({ taskId: 'task-2', goal: 'Deploy on Nile', now: 1 })
  task = protocol.transitionTaskStatus(task, protocol.AI_TASK_STATUS.RUNNING, 2)
  task = protocol.transitionTaskStatus(task, protocol.AI_TASK_STATUS.WAITING_FOR_USER, 3)
  task = protocol.transitionTaskStatus(task, protocol.AI_TASK_STATUS.RUNNING, 4)
  task = protocol.transitionTaskStatus(task, protocol.AI_TASK_STATUS.UNCERTAIN, 5)
  task = protocol.transitionTaskStatus(task, protocol.AI_TASK_STATUS.SUCCEEDED, 6)

  t.equal(task.status, 'succeeded', 'uncertain transaction can resolve successfully')
  t.ok(protocol.isTerminalTaskStatus(task.status), 'succeeded is terminal')
  t.throws(function () {
    protocol.transitionTaskStatus(task, protocol.AI_TASK_STATUS.RUNNING, 7)
  }, /Invalid AI task transition/, 'terminal task cannot restart silently')

  var failed = protocol.createAITask({ taskId: 'task-resume', goal: 'Fix compilation', now: 10 })
  failed = protocol.transitionTaskStatus(failed, protocol.AI_TASK_STATUS.RUNNING, 11)
  failed = protocol.transitionTaskStatus(failed, protocol.AI_TASK_STATUS.FAILED, 12)
  var resumed = protocol.resumeAITask(failed, 13)
  t.equal(resumed.taskId, failed.taskId, 'explicit continuation preserves the original task id')
  t.equal(resumed.status, protocol.AI_TASK_STATUS.RUNNING, 'an explicit continuation can resume a failed task')
  t.end()
})

test('AI risk defaults fail closed for every side effect', async function (t) {
  var protocol = await protocolPromise
  var policies = protocol.AI_RISK_POLICY_DEFAULTS

  t.equal(policies.R0.approvalRequired, false, 'R0 stays approval-free')
  for (var risk of ['R1', 'R2', 'R3']) {
    t.equal(policies[risk].approvalRequired, true, `${risk} requires approval`)
    t.equal(policies[risk].autoRetry, false, `${risk} never retries automatically`)
  }
  t.throws(function () {
    protocol.createAITaskStep({ taskId: 'task-3', stepId: 'step-1', toolName: 'unknown', riskLevel: 'R9' })
  }, /Unknown AI risk level/, 'unknown risk level is rejected instead of treated as read-only')
  t.end()
})

test('AI tool results require canonical structured evidence', async function (t) {
  var protocol = await protocolPromise
  var success = protocol.createToolSuccessResult({ summary: 'Compiled successfully' })
  var failure = protocol.createToolErrorResult({
    code: protocol.AI_TOOL_ERROR_CODE.STATE_CHANGED,
    summary: 'Workspace changed after approval',
    userAction: 'Review the new workspace and approve again',
    artifacts: [{ type: 'diff', label: 'Pending changes', ref: 'workspace://diff/1' }]
  })

  t.deepEqual(success, {
    ok: true,
    code: 'OK',
    summary: 'Compiled successfully',
    retryable: false,
    artifacts: []
  }, 'structured success is normalized')
  t.throws(function () { protocol.normalizeToolResult('Compilation FAILED') }, /canonical structured object/, 'raw text cannot silently become success')
  t.equal(failure.ok, false, 'structured failure is preserved')
  t.equal(failure.code, 'STATE_CHANGED', 'canonical error code is preserved')
  t.equal(failure.artifacts[0].type, 'diff', 'artifact is normalized')
  t.throws(function () {
    protocol.createToolErrorResult({ code: 'UNKNOWN', summary: 'bad' })
  }, /Unknown AI tool error code/, 'unknown errors cannot enter the canonical protocol')
  t.end()
})
