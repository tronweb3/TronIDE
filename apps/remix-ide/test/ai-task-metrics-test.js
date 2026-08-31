/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var fs = require('fs')
var path = require('path')

var metricsPromise = import('../../../libs/remix-code-reader/src/services/aiTaskMetrics.js')
var root = path.resolve(__dirname, '../../..')

function memoryDriver (initial = {}) {
  var values = new Map(Object.entries(initial))
  var calls = { get: 0, set: 0, remove: 0 }
  return {
    values,
    calls,
    getItem: async function (key) { calls.get++; return values.has(key) ? values.get(key) : null },
    setItem: async function (key, value) { calls.set++; values.set(key, value); return value },
    removeItem: async function (key) { calls.remove++; values.delete(key) }
  }
}

function memoryPreference (initial = {}) {
  var values = new Map(Object.entries(initial))
  return {
    values,
    getItem: function (key) { return values.has(key) ? values.get(key) : null },
    setItem: function (key, value) { values.set(key, value) }
  }
}

test('local AI metrics preference defaults on and persists an explicit opt-out', async function (t) {
  var metrics = await metricsPromise
  var storage = memoryPreference()

  t.equal(metrics.readLocalAITaskMetricsEnabled(storage), true, 'local-only aggregation defaults on')
  metrics.writeLocalAITaskMetricsEnabled(false, storage)
  t.equal(metrics.readLocalAITaskMetricsEnabled(storage), false, 'explicit opt-out is persisted')
  metrics.writeLocalAITaskMetricsEnabled(true, storage)
  t.equal(metrics.readLocalAITaskMetricsEnabled(storage), true, 'the user can opt back in')
  t.end()
})

test('local AI metrics aggregate only workflow, duration, error, approval and abort counters', async function (t) {
  var metrics = await metricsPromise
  var driver = memoryDriver()
  var store = new metrics.LocalAITaskMetrics({ driver })
  var secret = 'private prompt source TSecretAddress api-key-123'

  store.recordEvent({ type: 'task.started', task: { taskId: 'task-secret', goal: secret, status: 'running' }, at: 1 })
  store.recordEvent({ type: 'step.approval', taskId: 'task-secret', stepId: 'step-secret', toolName: 'write_contract', approved: true, input: { source: secret }, at: 2 })
  store.recordEvent({ type: 'step.approval', taskId: 'task-secret', stepId: 'step-secret', toolName: 'write_contract', approved: false, at: 3 })
  store.recordEvent({ type: 'step.started', taskId: 'task-secret', stepId: 'step-secret', toolName: 'write_contract', at: 1000 })
  store.recordEvent({
    type: 'step.finished',
    taskId: 'task-secret',
    stepId: 'step-secret',
    toolName: 'write_contract',
    status: 'failed',
    at: 7000,
    result: { ok: false, code: 'TIMEOUT', summary: secret, data: { prompt: secret } }
  })
  store.recordEvent({ type: 'task.finished', task: { taskId: 'task-secret', goal: secret, status: 'failed' }, error: secret, at: 8000 })
  var snapshot = await store.flush()
  var persisted = driver.values.get(metrics.AI_LOCAL_METRICS_STORAGE_KEY)

  t.deepEqual(snapshot.workflows, { started: 1, completed: 0, failed: 1 }, 'workflow lifecycle is counted')
  t.equal(snapshot.tools.finished, 1, 'finished tool steps are counted')
  t.equal(snapshot.tools.failed, 1, 'failed tool steps are counted')
  t.equal(snapshot.tools.durationBuckets['5to30s'], 1, 'tool duration is reduced to a bucket')
  t.deepEqual(snapshot.tools.errorCodes, { TIMEOUT: 1 }, 'only the canonical error code is retained')
  t.deepEqual(snapshot.decisions, { approved: 1, rejected: 1, aborted: 0 }, 'approval decisions are counted')
  t.notOk(JSON.stringify(persisted).includes(secret), 'prompt, source, address, key and raw error text never reach storage')
  t.notOk(JSON.stringify(persisted).includes('task-secret'), 'task and step identifiers never reach storage')
  t.notOk(JSON.stringify(persisted).includes('write_contract'), 'tool names never reach storage')
  t.end()
})

test('local AI metrics bucket durations and normalize unknown error codes', async function (t) {
  var metrics = await metricsPromise
  var store = new metrics.LocalAITaskMetrics({ driver: memoryDriver() })
  var durations = [500, 2500, 12000, 45000]

  durations.forEach(function (duration, index) {
    store.recordEvent({ type: 'step.started', stepId: `step-${index}`, at: 100000 * index })
    store.recordEvent({
      type: 'step.finished',
      stepId: `step-${index}`,
      at: 100000 * index + duration,
      result: { ok: index !== 3, code: index === 3 ? 'secret-error-message' : 'OK' }
    })
  })
  var snapshot = await store.flush()

  t.deepEqual(snapshot.tools.durationBuckets, { under1s: 1, '1to5s': 1, '5to30s': 1, '30sPlus': 1 }, 'all duration buckets have deterministic boundaries')
  t.deepEqual(snapshot.tools.errorCodes, { OTHER: 1 }, 'unknown values cannot become persisted error-code keys')
  t.end()
})

test('local AI metrics keep only fixed Bank of AI integration aggregates', async function (t) {
  var metrics = await metricsPromise
  var driver = memoryDriver()
  var store = new metrics.LocalAITaskMetrics({ driver })
  var secret = 'private-prompt-and-api-key'

  store.recordEvent({ type: 'integration.request.finished', integration: 'bankofai', status: 'succeeded', durationMs: 750, model: secret })
  store.recordEvent({ type: 'integration.request.finished', integration: 'bankofai', status: 'failed', durationMs: 7000, errorCode: 'RATE_LIMIT', error: secret })
  store.recordEvent({ type: 'integration.request.finished', integration: 'bankofai', status: 'cancelled', durationMs: 32000 })
  store.recordEvent({ type: 'integration.tool.called', integration: 'bankofai', toolName: secret })
  store.recordEvent({ type: 'integration.request.finished', integration: 'attacker-controlled', status: 'failed', durationMs: 1, errorCode: secret })
  var snapshot = await store.flush()
  var bank = snapshot.integrations.bankofai
  var persisted = JSON.stringify(driver.values.get(metrics.AI_LOCAL_METRICS_STORAGE_KEY))

  t.deepEqual({ requests: bank.requests, succeeded: bank.succeeded, failed: bank.failed, cancelled: bank.cancelled, toolCalls: bank.toolCalls }, { requests: 3, succeeded: 1, failed: 1, cancelled: 1, toolCalls: 1 }, 'only the fixed Bank of AI counters are updated')
  t.deepEqual(bank.durationBuckets, { under1s: 1, '1to5s': 0, '5to30s': 1, '30sPlus': 1 }, 'provider latency is stored only as bounded buckets')
  t.deepEqual(bank.errorCodes, { RATE_LIMIT: 1 }, 'provider errors use a fixed safe registry')
  t.notOk(persisted.includes(secret), 'model names, raw errors, tools, prompts and keys cannot reach provider metrics')
  t.notOk(persisted.includes('attacker-controlled'), 'arbitrary integration identifiers cannot become stored keys')
  t.end()
})

test('v1 local AI metrics migrate into the v2 fixed envelope without losing task counts', async function (t) {
  var metrics = await metricsPromise
  var driver = memoryDriver({
    [metrics.AI_LOCAL_METRICS_LEGACY_STORAGE_KEY]: {
      schemaVersion: 1,
      workflows: { started: 4, completed: 3, failed: 1 },
      tools: { finished: 2, failed: 0, durationBuckets: {}, errorCodes: {} },
      decisions: { approved: 1, rejected: 0, aborted: 0 }
    }
  })
  var snapshot = await new metrics.LocalAITaskMetrics({ driver }).initialize()

  t.equal(snapshot.schemaVersion, 2, 'the migrated envelope uses the current schema')
  t.deepEqual(snapshot.workflows, { started: 4, completed: 3, failed: 1 }, 'existing workflow counters survive migration')
  t.ok(driver.values.has(metrics.AI_LOCAL_METRICS_STORAGE_KEY), 'the migrated envelope is written under the v2 key')
  t.notOk(driver.values.has(metrics.AI_LOCAL_METRICS_LEGACY_STORAGE_KEY), 'the legacy key is removed after migration')
  t.end()
})

test('disabled local AI metrics neither read nor write and opt-out deletes aggregates', async function (t) {
  var metrics = await metricsPromise
  var driver = memoryDriver({ [metrics.AI_LOCAL_METRICS_STORAGE_KEY]: { schemaVersion: 1, secret: 'do not read' } })
  var store = new metrics.LocalAITaskMetrics({ driver, enabled: false })

  await store.initialize()
  await store.recordEvent({ type: 'task.started', task: { status: 'running' }, at: 1 })
  t.equal(driver.calls.get, 0, 'disabled aggregation does not read existing metrics')
  t.equal(driver.calls.set, 0, 'disabled aggregation does not write metrics')

  await store.setEnabled(true)
  await store.recordEvent({ type: 'task.started', task: { status: 'running' }, at: 2 })
  t.equal((await store.flush()).workflows.started, 1, 're-enabled aggregation records new counters')
  await store.setEnabled(false)
  t.notOk(driver.values.has(metrics.AI_LOCAL_METRICS_STORAGE_KEY), 'opting out deletes the aggregate envelope')
  t.deepEqual(store.snapshot(), metrics.emptyLocalAITaskMetrics(), 'opting out clears the in-memory snapshot')
  t.end()
})

test('local AI metrics sanitize stored envelopes to the fixed aggregate schema', async function (t) {
  var metrics = await metricsPromise
  var driver = memoryDriver({
    [metrics.AI_LOCAL_METRICS_STORAGE_KEY]: {
      schemaVersion: 1,
      workflows: { started: 2, completed: -1, failed: 3, prompt: 'secret' },
      tools: { finished: 4, failed: 1, durationBuckets: { under1s: 5, prompt: 9 }, errorCodes: { TIMEOUT: 2, 'private payload': 7 } },
      decisions: { approved: 6, rejected: 7, aborted: 8, address: 9 },
      source: 'secret source'
    }
  })
  var snapshot = await new metrics.LocalAITaskMetrics({ driver }).initialize()

  t.deepEqual(snapshot.workflows, { started: 2, completed: 0, failed: 3 }, 'only fixed workflow counters survive reload')
  t.deepEqual(snapshot.tools.errorCodes, { TIMEOUT: 2, OTHER: 7 }, 'stored error keys are constrained to the safe registry')
  t.notOk(JSON.stringify(snapshot).includes('secret'), 'unknown stored fields are dropped')
  t.notOk(JSON.stringify(snapshot).includes('address'), 'address-shaped fields are dropped')
  t.end()
})

test('AI settings expose transparent local metrics controls wired to task events', function (t) {
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  var settings = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/ChatSet/index.js'), 'utf8')
  var styles = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/ChatSet/index.css'), 'utf8')

  t.ok(chat.includes('this._aiTaskMetrics.recordEvent(event)'), 'the same canonical task events feed the local aggregator')
  t.ok(settings.includes("data-id='aiLocalMetricsToggle'"), 'settings provide an explicit on/off control')
  t.ok(settings.includes("data-id='aiLocalMetricsClear'"), 'settings provide an explicit clear control')
  t.ok(settings.includes('On-device counts only; never uploaded.'), 'the local-only boundary is visible to users')
  t.ok(settings.includes('No prompts, source code, addresses, transaction arguments, API keys or wallet data.'), 'the excluded sensitive fields remain available in details')
  t.ok(settings.includes("data-id='bankOfAILocalMetrics'"), 'Bank of AI usage is visible as fixed local-only aggregates')
  t.ok(settings.includes("className='ai-local-metrics-panel'"), 'the metrics panel has a theme-aware styling hook')
  t.ok(/\.ai-local-metrics-panel[^}]*color:\s*var\(--ai-text\)/s.test(styles), 'metrics text uses the active theme color')
  t.end()
})
