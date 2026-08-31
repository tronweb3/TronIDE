/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')

var storagePromise = import('../../../libs/remix-code-reader/src/services/aiTaskStorage.js')
var runtimePromise = import('../../../libs/remix-code-reader/src/services/aiTaskRuntime.js')

function memoryDriver (initial = {}) {
  var values = new Map(Object.entries(initial))
  return {
    values,
    getItem: async function (key) { return values.has(key) ? values.get(key) : null },
    setItem: async function (key, value) { values.set(key, value); return value },
    removeItem: async function (key) { values.delete(key) }
  }
}

test('AI task store persists ordered task and step history without result data', async function (t) {
  var storage = await storagePromise
  var driver = memoryDriver()
  var store = new storage.AITaskStore({ driver, now: function () { return 50 } })
  var task = {
    schemaVersion: 1,
    taskId: 'task-store-1',
    goal: 'Compile the current contract',
    source: 'chat',
    workspace: 'default_workspace',
    branch: 'release/v2.3.3',
    entry: {
      schemaVersion: 1,
      entryId: 'deploy-next-verification',
      source: 'deploy',
      context: { contractAddress: 'TExample', transactionHash: 'a'.repeat(64), contractName: 'Storage', network: 'Nile', apiKey: 'must-not-persist' }
    },
    status: 'planned',
    createdAt: 1,
    updatedAt: 1
  }

  store.recordEvent({ type: 'task.created', task, at: 1 })
  store.recordEvent({ type: 'step.planned', taskId: task.taskId, stepId: 'step-1', toolName: 'compile_contract', status: 'planned', riskLevel: 'R0', sideEffect: 'none', at: 2 })
  store.recordEvent({ type: 'step.started', taskId: task.taskId, stepId: 'step-1', toolName: 'compile_contract', status: 'running', at: 3 })
  store.recordEvent({
    type: 'step.finished',
    taskId: task.taskId,
    stepId: 'step-1',
    toolName: 'compile_contract',
    status: 'succeeded',
    at: 4,
    result: {
      ok: true,
      code: 'OK',
      summary: 'Compiled successfully',
      retryable: false,
      data: { source: 'must not be persisted' },
      artifacts: [{ type: 'build', label: 'Storage.json', ref: 'artifact://Storage.json' }]
    }
  })
  store.recordEvent({ type: 'task.finished', taskId: task.taskId, status: 'failed', errorCode: 'MODEL_DID_NOT_CALL_TOOL', at: 5 })
  var snapshot = await store.flush()
  var record = snapshot.tasks[0]

  t.equal(record.steps[0].status, 'succeeded', 'latest step status is durable')
  t.equal(record.steps[0].result.summary, 'Compiled successfully', 'result summary is durable')
  t.notOk(Object.prototype.hasOwnProperty.call(record.steps[0].result, 'data'), 'source-bearing result data is not persisted')
  t.equal(record.artifacts[0].ref, 'artifact://Storage.json', 'artifact index is durable')
  t.equal(record.task.entry.entryId, 'deploy-next-verification', 'task entry identity is durable')
  t.equal(record.task.entry.context.contractAddress, 'TExample', 'bounded continuation context is durable')
  t.notOk(Object.prototype.hasOwnProperty.call(record.task.entry.context, 'apiKey'), 'unknown entry context cannot reach storage')
  t.equal(record.events[4].errorCode, 'MODEL_DID_NOT_CALL_TOOL', 'task-level diagnostic code is durable')
  t.deepEqual(record.events.map(function (event) { return event.type }), ['task.created', 'step.planned', 'step.started', 'step.finished', 'task.finished'], 'rapid events remain ordered')
  t.end()
})

test('AI task store reloads versioned history', async function (t) {
  var storage = await storagePromise
  var driver = memoryDriver()
  var first = new storage.AITaskStore({ driver })
  await first.recordEvent({
    type: 'task.created',
    task: { taskId: 'task-store-2', goal: 'Run tests', source: 'home', status: 'planned', createdAt: 1, updatedAt: 1 },
    at: 1
  })

  var second = new storage.AITaskStore({ driver })
  var snapshot = await second.initialize()
  t.equal(snapshot.tasks.length, 1, 'stored task reloads')
  t.equal(snapshot.tasks[0].task.taskId, 'task-store-2', 'task identity is preserved')
  t.equal(snapshot.archive, null, 'valid schema needs no recovery archive')
  t.end()
})

test('AI task store reloads the evidence needed to block an uncertain R3 retry', async function (t) {
  var storage = await storagePromise
  var runtime = await runtimePromise
  var driver = memoryDriver()
  var first = new storage.AITaskStore({ driver, maxEvents: 1 })
  await first.recordEvent({
    type: 'task.created',
    task: { taskId: 'task-r3-uncertain', goal: 'Deploy safely', status: 'running', createdAt: 1, updatedAt: 1 },
    at: 1
  })
  await first.recordEvent({ type: 'step.planned', taskId: 'task-r3-uncertain', stepId: 'deploy-1', toolName: 'deploy_contract', status: 'planned', riskLevel: 'R3', sideEffect: 'chain', at: 2 })
  await first.recordEvent({
    type: 'step.finished',
    taskId: 'task-r3-uncertain',
    stepId: 'deploy-1',
    toolName: 'deploy_contract',
    status: 'uncertain',
    result: { ok: false, code: 'TX_UNKNOWN', summary: 'Broadcast outcome unknown.', retryable: false, uncertainty: 'May have been sent.' },
    at: 3
  })
  await first.flush()

  var second = new storage.AITaskStore({ driver, maxEvents: 1 })
  var record = (await second.initialize()).tasks[0]
  t.equal(record.events.length, 1, 'bounded event history can discard the original R3 planning event')
  t.equal(record.steps[0].riskLevel, 'R3', 'aggregated step history retains the original risk level')
  t.equal(record.steps[0].status, 'uncertain', 'aggregated step history retains the uncertain outcome')
  t.equal(runtime.hasUnresolvedChainWrite(record.steps), true, 'Continue can restore the R3 safety latch after reload')
  t.end()
})

test('AI task store preserves approval and bounded lock-expiry evidence', async function (t) {
  var storage = await storagePromise
  var driver = memoryDriver()
  var store = new storage.AITaskStore({ driver })
  await store.recordEvent({
    type: 'task.created',
    task: { taskId: 'task-lock-evidence', goal: 'Edit safely', status: 'running', createdAt: 1, updatedAt: 1 },
    at: 1
  })
  await store.recordEvent({ type: 'step.approval', taskId: 'task-lock-evidence', stepId: 'step-1', toolName: 'edit_file', status: 'running', approved: true, at: 2 })
  await store.recordEvent({ type: 'task.write_lock_preserved', taskId: 'task-lock-evidence', status: 'uncertain', expiresAt: 5000, at: 3 })
  var record = (await store.flush()).tasks[0]

  t.equal(record.events[1].approved, true, 'approval decision is durable')
  t.equal(record.events[2].expiresAt, 5000, 'uncertain lock expiry is durable')
  t.end()
})

test('AI task store persists a bounded Golden Workflow result card', async function (t) {
  var storage = await storagePromise
  var driver = memoryDriver()
  var store = new storage.AITaskStore({ driver })
  await store.recordEvent({
    type: 'task.created',
    task: { taskId: 'task-workflow-result', goal: 'Compile and test', source: 'home:home-code-test', status: 'succeeded', createdAt: 1, updatedAt: 2 },
    at: 2
  })
  await store.recordEvent({
    type: 'task.workflow_result',
    taskId: 'task-workflow-result',
    at: 3,
    workflowResult: {
      schemaVersion: 1,
      workflowId: 'wf-code-test',
      number: 'WF-1',
      title: 'Edit, compile, and test',
      status: 'completed',
      summary: 'All required phases have evidence.',
      completion: { passed: 5, required: 5 },
      resultFields: ['changed files', 'compiler version', 'test result'],
      evidence: [{ phaseId: 'compile', title: 'Compile', optional: false, status: 'passed', toolName: 'compile_contract', summary: 'Compiled.', userAction: '' }],
      artifacts: [{ type: 'build', label: 'Storage build', ref: 'artifact://Storage' }],
      nextAction: 'Review the result.'
    }
  })
  var record = (await store.flush()).tasks[0]

  t.equal(record.workflowResult.status, 'completed', 'workflow status is durable')
  t.equal(record.workflowResult.evidence[0].toolName, 'compile_contract', 'bounded phase evidence is durable')
  t.equal(record.workflowResult.artifacts[0].ref, 'artifact://Storage', 'result-card artifacts are durable')
  t.equal(record.task.status, 'succeeded', 'workflow result does not overwrite the canonical task status')
  t.end()
})

test('AI task store preserves unknown schemas and writes to a recovery key', async function (t) {
  var storage = await storagePromise
  var unknown = { schemaVersion: 99, tasks: [{ secret: 'preserve me' }] }
  var driver = memoryDriver({ [storage.AI_TASK_STORAGE_KEY]: unknown })
  var store = new storage.AITaskStore({ driver })
  var initialized = await store.initialize()

  t.ok(initialized.archive, 'unsupported history is reported as a read-only archive')
  t.deepEqual(store.getReadOnlyArchive().raw, unknown, 'unknown history remains available for read-only export')
  await store.recordEvent({
    type: 'task.created',
    task: { taskId: 'task-recovered', goal: 'New task', status: 'planned', createdAt: 1, updatedAt: 1 },
    at: 1
  })
  t.deepEqual(driver.values.get(storage.AI_TASK_STORAGE_KEY), unknown, 'unknown primary data is never overwritten')
  t.equal(driver.values.get(storage.AI_TASK_RECOVERY_STORAGE_KEY).tasks.length, 1, 'new history continues in the recovery store')
  t.end()
})

test('AI task store enforces bounded task and event retention', async function (t) {
  var storage = await storagePromise
  var driver = memoryDriver()
  var store = new storage.AITaskStore({ driver, maxTasks: 2, maxEvents: 2 })

  for (var index = 1; index <= 3; index++) {
    await store.recordEvent({
      type: 'task.created',
      task: { taskId: `task-${index}`, goal: `Task ${index}`, status: 'planned', createdAt: index, updatedAt: index },
      at: index
    })
  }
  await store.recordEvent({ type: 'task.started', task: { taskId: 'task-3', goal: 'Task 3', status: 'running', createdAt: 3, updatedAt: 4 }, at: 4 })
  await store.recordEvent({ type: 'task.finished', task: { taskId: 'task-3', goal: 'Task 3', status: 'succeeded', createdAt: 3, updatedAt: 5 }, at: 5 })
  var snapshot = await store.flush()

  t.deepEqual(snapshot.tasks.map(function (record) { return record.task.taskId }), ['task-2', 'task-3'], 'only newest tasks are retained')
  t.deepEqual(snapshot.tasks[1].events.map(function (event) { return event.type }), ['task.started', 'task.finished'], 'only newest task events are retained')
  t.end()
})

test('AI task store clears active history without deleting an incompatible archive', async function (t) {
  var storage = await storagePromise
  var unknown = { schemaVersion: 99, tasks: [{ keep: true }] }
  var driver = memoryDriver({ [storage.AI_TASK_STORAGE_KEY]: unknown })
  var store = new storage.AITaskStore({ driver })
  await store.recordEvent({
    type: 'task.created',
    task: { taskId: 'task-clear', goal: 'Temporary task', status: 'planned', createdAt: 1, updatedAt: 1 },
    at: 1
  })
  var snapshot = await store.clear()

  t.equal(snapshot.tasks.length, 0, 'active task history is cleared')
  t.deepEqual(driver.values.get(storage.AI_TASK_STORAGE_KEY), unknown, 'read-only incompatible archive is preserved')
  t.notOk(driver.values.has(storage.AI_TASK_RECOVERY_STORAGE_KEY), 'recovery history is removed')
  t.end()
})
