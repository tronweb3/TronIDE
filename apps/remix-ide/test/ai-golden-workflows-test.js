/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.resolve(__dirname, '../../..')
var workflowsPromise = import('../../../libs/remix-code-reader/src/services/aiGoldenWorkflows.js')
var stepCounter = 0

function finished (toolName, options = {}) {
  var status = options.status || 'succeeded'
  var ok = options.ok !== false
  return {
    type: 'step.finished',
    taskId: 'task-fixture',
    stepId: `step-${toolName}-${++stepCounter}`,
    toolName,
    status,
    result: {
      ok,
      code: options.code || (ok ? 'OK' : 'INTERNAL_ERROR'),
      summary: options.summary || `${toolName} ${ok ? 'passed' : 'failed'}`,
      retryable: false,
      userAction: options.userAction,
      uncertainty: options.uncertainty,
      data: options.data,
      artifacts: options.artifacts || []
    }
  }
}

function successfulEvents (workflow) {
  return workflow.phases
    .filter(function (phase) { return !phase.optional })
    .map(function (phase) { return finished(phase.tools[0]) })
}

test('Golden Workflow registry is versioned, ordered, and bound to four Home entries', async function (t) {
  var workflows = await workflowsPromise
  var registry = workflows.AI_GOLDEN_WORKFLOWS

  t.equal(workflows.AI_GOLDEN_WORKFLOW_SCHEMA_VERSION, 1, 'workflow recipe schema is versioned')
  t.equal(registry.length, 4, 'all four P0 Golden Workflows are defined')
  t.deepEqual(registry.map(function (workflow) { return workflow.number }), ['WF-1', 'WF-2', 'WF-3', 'WF-4'], 'workflow order matches the release plan')
  t.equal(new Set(registry.map(function (workflow) { return workflow.entryId })).size, 4, 'each workflow has one distinct Home entry')
  t.ok(registry.every(function (workflow) { return workflow.phases.length >= 4 }), 'every workflow has a concrete ordered recipe')
  t.ok(registry.every(function (workflow) { return workflow.resultFields.length >= 3 }), 'every result card declares its required evidence fields')
  t.ok(Object.isFrozen(registry) && Object.isFrozen(registry[0].phases), 'workflow recipes are immutable')
  t.end()
})

test('four Golden Workflow happy paths produce complete evidence cards', async function (t) {
  var workflows = await workflowsPromise
  workflows.AI_GOLDEN_WORKFLOWS.forEach(function (workflow) {
    var result = workflows.createGoldenWorkflowResult({
      workflowId: workflow.id,
      stepEvents: successfulEvents(workflow),
      taskStatus: 'succeeded'
    })
    t.equal(result.status, 'completed', `${workflow.number} completes with every required phase in order`)
    t.equal(result.completion.passed, result.completion.required, `${workflow.number} reports a full evidence count`)
    t.ok(result.evidence.every(function (item) { return item.optional || item.status === 'passed' }), `${workflow.number} has no guessed required evidence`)
  })
  t.end()
})

test('Golden Workflow task status requires runtime evidence, not merely a finished model reply', async function (t) {
  var workflows = await workflowsPromise
  var workflow = workflows.getGoldenWorkflow('wf-nile-deploy')
  var noDeploy = workflows.evaluateGoldenWorkflowRun({ workflowId: workflow.id, stepEvents: [], taskStatus: 'running' })
  var complete = workflows.evaluateGoldenWorkflowRun({ workflowId: workflow.id, stepEvents: successfulEvents(workflow), taskStatus: 'running' })
  var uncertain = workflows.evaluateGoldenWorkflowRun({ workflowId: workflow.id, stepEvents: successfulEvents(workflow), taskStatus: 'uncertain' })

  t.equal(noDeploy.taskStatus, 'waiting_for_user', 'a clarification reply without deploy evidence remains waiting')
  t.equal(noDeploy.workflowResult.status, 'incomplete', 'missing deploy phases are recorded as incomplete')
  t.equal(complete.taskStatus, 'succeeded', 'all ordered runtime evidence can mark the task successful')
  t.equal(uncertain.taskStatus, 'uncertain', 'chain uncertainty cannot be overwritten by a completed model reply')
  t.end()
})

test('Golden Workflow continuation accepts an ordered successful retry', async function (t) {
  var workflows = await workflowsPromise
  var workflow = workflows.getGoldenWorkflow('wf-code-test')
  var events = [
    finished('search_workspace'),
    finished('edit_file'),
    finished('git_diff'),
    finished('compile_contract', { ok: false, status: 'failed', summary: 'Compilation failed.' }),
    finished('compile_contract'),
    finished('run_tests')
  ]
  var result = workflows.createGoldenWorkflowResult({ workflowId: workflow.id, stepEvents: events, taskStatus: 'succeeded' })

  t.equal(result.status, 'completed', 'a successful same-phase retry supersedes its persisted failure')
  t.equal(result.evidence.find(function (item) { return item.phaseId === 'compile' }).status, 'passed', 'the result card uses the successful retry evidence')
  t.end()
})

test('WF-2 optional write is visible but does not block the read-first workflow', async function (t) {
  var workflows = await workflowsPromise
  var workflow = workflows.getGoldenWorkflow('wf-nile-deploy')
  var withoutWrite = workflows.createGoldenWorkflowResult({ workflowId: workflow.id, stepEvents: successfulEvents(workflow), taskStatus: 'succeeded' })
  var withWrite = workflows.createGoldenWorkflowResult({ workflowId: workflow.id, stepEvents: successfulEvents(workflow).concat(finished('write_contract')), taskStatus: 'succeeded' })
  var rejectedWrite = workflows.createGoldenWorkflowResult({ workflowId: workflow.id, stepEvents: successfulEvents(workflow).concat(finished('write_contract', { ok: false, status: 'cancelled', code: 'USER_REJECTED' })), taskStatus: 'succeeded' })

  t.equal(withoutWrite.status, 'completed', 'a write is not required to prove Nile deploy/read success')
  t.equal(withoutWrite.evidence.find(function (item) { return item.phaseId === 'write' }).status, 'optional', 'skipped write is labelled optional')
  t.equal(withWrite.evidence.find(function (item) { return item.phaseId === 'write' }).status, 'passed', 'an explicitly chosen write records evidence')
  t.equal(rejectedWrite.status, 'completed', 'rejecting the optional write does not erase the completed read-first workflow')
  t.end()
})

test('WF-2 does not count a blocked VM environment check as verified Nile evidence', async function (t) {
  var workflows = await workflowsPromise
  var workflow = workflows.getGoldenWorkflow('wf-nile-deploy')
  var events = [
    finished('compile_contract'),
    finished('list_deployable_contracts'),
    finished('get_environment', {
      ok: false,
      status: 'waiting_for_user',
      code: 'NOT_READY',
      summary: 'Deploy & Run provider: vm',
      userAction: 'Switch only Deploy & Run to Injected TronWeb.'
    })
  ]
  var evaluation = workflows.evaluateGoldenWorkflowRun({ workflowId: workflow.id, stepEvents: events, taskStatus: 'running' })
  var environment = evaluation.workflowResult.evidence.find(function (item) { return item.phaseId === 'environment' })

  t.equal(evaluation.taskStatus, 'waiting_for_user', 'the task remains resumable')
  t.equal(environment.status, 'missing', 'a VM snapshot is not verified Nile evidence')
  t.equal(evaluation.workflowResult.completion.passed, 2, 'only compile and artifact selection count as passed')
  t.equal(evaluation.workflowResult.nextAction, 'Switch only Deploy & Run to Injected TronWeb.', 'the result card shows the concrete recovery action')
  t.end()
})

test('twelve deterministic failure/recovery scenarios have honest result states', async function (t) {
  var workflows = await workflowsPromise
  var wf1 = workflows.getGoldenWorkflow('wf-code-test')
  var wf2 = workflows.getGoldenWorkflow('wf-nile-deploy')
  var wf3 = workflows.getGoldenWorkflow('wf-tronscan-verification')
  var wf4 = workflows.getGoldenWorkflow('wf-recorder-tronbox')
  var cases = [
    { name: 'WF-1 missing diff', workflow: wf1, events: successfulEvents(wf1).filter(function (event) { return event.toolName !== 'git_diff' }), task: 'succeeded', status: 'incomplete' },
    { name: 'WF-1 compiler error', workflow: wf1, events: successfulEvents(wf1).map(function (event) { return event.toolName === 'compile_contract' ? finished('compile_contract', { ok: false, status: 'failed', summary: 'Compiler version is unavailable.' }) : event }), task: 'succeeded', status: 'failed' },
    { name: 'WF-1 focused test failure', workflow: wf1, events: successfulEvents(wf1).map(function (event) { return event.toolName === 'run_tests' ? finished('run_tests', { ok: false, status: 'failed', summary: 'Storage.test.js: stores value failed.' }) : event }), task: 'failed', status: 'failed' },
    { name: 'WF-2 missing environment', workflow: wf2, events: successfulEvents(wf2).filter(function (event) { return event.toolName !== 'get_environment' }), task: 'succeeded', status: 'incomplete' },
    { name: 'WF-2 wallet rejection', workflow: wf2, events: successfulEvents(wf2).slice(0, 4).concat(finished('deploy_contract', { ok: false, status: 'cancelled', code: 'USER_REJECTED', userAction: 'Approve a new preview only if intended.' })), task: 'cancelled', status: 'cancelled' },
    { name: 'WF-2 broadcast uncertainty', workflow: wf2, events: successfulEvents(wf2).map(function (event) { return event.toolName === 'deploy_contract' ? finished('deploy_contract', { ok: false, status: 'uncertain', code: 'TX_UNKNOWN', uncertainty: 'Broadcast may have completed.' }) : event }), task: 'uncertain', status: 'uncertain' },
    { name: 'WF-2 out-of-order preflight', workflow: wf2, events: [finished('preflight_transaction')].concat(successfulEvents(wf2).filter(function (event) { return event.toolName !== 'preflight_transaction' })), task: 'succeeded', status: 'incomplete' },
    { name: 'WF-3 address not found', workflow: wf3, events: successfulEvents(wf3).map(function (event) { return event.toolName === 'check_verification' ? finished('check_verification', { ok: false, status: 'failed', summary: 'Address not found on Nile.' }) : event }), task: 'failed', status: 'failed' },
    { name: 'WF-3 missing generated diff', workflow: wf3, events: successfulEvents(wf3).filter(function (event) { return event.toolName !== 'git_diff' }), task: 'succeeded', status: 'incomplete' },
    { name: 'WF-4 replay failure', workflow: wf4, events: successfulEvents(wf4).map(function (event) { return event.toolName === 'replay_recording' ? finished('replay_recording', { ok: false, status: 'failed', summary: 'Recorded transaction reverted; TODO retained.' }) : event }), task: 'failed', status: 'failed' },
    { name: 'WF-4 missing export', workflow: wf4, events: successfulEvents(wf4).filter(function (event) { return event.toolName !== 'export_tronbox' }), task: 'succeeded', status: 'incomplete' },
    { name: 'WF-4 user cancellation', workflow: wf4, events: successfulEvents(wf4).slice(0, 1), task: 'cancelled', status: 'cancelled' }
  ]

  cases.forEach(function (fixture) {
    var result = workflows.createGoldenWorkflowResult({ workflowId: fixture.workflow.id, stepEvents: fixture.events, taskStatus: fixture.task })
    t.equal(result.status, fixture.status, fixture.name)
    t.ok(result.nextAction, `${fixture.name} provides a recovery or handoff action`)
  })
  t.equal(cases.length, 12, 'the release gate contains at least twelve deterministic abnormal scenarios')
  t.end()
})

test('Golden Workflow results preserve artifacts, redact credentials, and fail closed', async function (t) {
  var workflows = await workflowsPromise
  var workflow = workflows.getGoldenWorkflow('wf-code-test')
  var secret = ['sk', 'syntheticcredential12345'].join('-')
  var events = successfulEvents(workflow)
  events[events.length - 1] = finished('run_tests', {
    summary: `Tests passed with api_key=${secret}`,
    artifacts: [{ type: 'test', label: 'Focused tests', ref: 'artifact://tests/storage' }]
  })
  var result = workflows.createGoldenWorkflowResult({ workflowId: workflow.id, stepEvents: events, taskStatus: 'succeeded' })

  t.equal(result.status, 'completed', 'valid ordered evidence completes')
  t.equal(result.artifacts[0].ref, 'artifact://tests/storage', 'structured artifacts reach the result card')
  t.notOk(JSON.stringify(result).includes(secret), 'credential-shaped evidence is redacted')
  t.ok(Object.isFrozen(result) && Object.isFrozen(result.evidence), 'result card data is immutable')
  t.throws(function () { workflows.createGoldenWorkflowResult({ workflowId: 'unknown', stepEvents: [] }) }, /Unknown Golden Workflow/, 'unknown recipes fail closed')
  t.end()
})

test('Home workflows emit and render one durable result card from runtime evidence', function (t) {
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  var timeline = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/AITaskTimeline/index.js'), 'utf8')
  var storage = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/services/aiTaskStorage.js'), 'utf8')

  t.ok(chat.includes('createGoldenWorkflowResult'), 'Chat derives the result from canonical step events')
  t.ok(chat.includes("type: 'task.workflow_result'"), 'Chat emits a distinct durable workflow-result event')
  t.ok(chat.includes('getGoldenWorkflowForEntry(taskEntry?.entryId)'), 'only a registered Home workflow receives the four-workflow evaluator')
  t.ok(timeline.includes("data-id='aiTaskResultCard'"), 'task history renders a dedicated result card')
  t.ok(timeline.includes('data-phase-status={item.status}'), 'each phase exposes passed, failed, uncertain, or missing evidence')
  t.ok(timeline.includes("maxHeight: 'min(300px, 32vh)'"), 'long task history remains independently scrollable instead of squeezing chat')
  t.ok(timeline.includes('onContinue(record)'), 'Continue passes the durable record, not only its display task')
  t.ok(storage.includes('workflowResult: record?.workflowResult'), 'workflow result survives refresh with the existing task record')
  t.end()
})
