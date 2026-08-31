/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')

var protocolPromise = import('../../../libs/remix-code-reader/src/services/aiTaskProtocol.js')
var policiesPromise = import('../../../libs/remix-code-reader/src/services/aiToolPolicies.js')
var runtimePromise = import('../../../libs/remix-code-reader/src/services/aiTaskRuntime.js')

test('AI tool policy registry covers the complete workspace tool belt', async function (t) {
  var toolsApi = await import('../../../libs/remix-code-reader/src/services/toolsApi.js')
  var policies = await policiesPromise
  var toolNames = toolsApi.AI_WORKSPACE_TOOLS.map(function (tool) { return tool.name }).sort()
  var policyNames = Object.keys(policies.AI_TOOL_POLICIES).sort()

  t.equal(toolNames.length, 44, 'the v2.3.3 tool belt exposes the 41-tool baseline plus 3 transaction-intelligence tools')
  t.deepEqual(policyNames, toolNames, 'every exposed tool has exactly one policy')
  t.throws(function () { policies.getAIToolPolicy('unregistered_tool') }, /No AI tool policy/, 'unknown tool fails closed')
  t.end()
})

test('AI task runtime emits structured lifecycle events for canonical output', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var events = []
  var ticks = [10, 11, 15]
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function () { return protocol.createToolSuccessResult({ summary: 'Compiled successfully' }) },
    onEvent: function (event) { events.push(event) },
    now: function () { return ticks.shift() }
  })
  var run = await runtime.runStep({
    taskId: 'task-runtime-1',
    stepId: 'step-1',
    toolName: 'compile_contract',
    policy: policies.getAIToolPolicy('compile_contract')
  })

  t.equal(run.step.status, protocol.AI_TASK_STATUS.SUCCEEDED, 'successful tool completes the step')
  t.equal(run.result.summary, 'Compiled successfully', 'canonical summary is preserved')
  t.deepEqual(events.map(function (event) { return event.type }), ['step.planned', 'step.started', 'step.finished'], 'lifecycle is observable')
  t.equal(events[2].result.code, 'OK', 'completion event carries the canonical result')
  t.end()
})

test('AI task runtime fails closed on unstructured tool text', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function () { return 'Compilation FAILED for contracts/Broken.sol' }
  })
  var run = await runtime.runStep({
    taskId: 'task-runtime-raw-text',
    stepId: 'compile',
    toolName: 'compile_contract',
    policy: policies.getAIToolPolicy('compile_contract')
  })

  t.equal(run.step.status, protocol.AI_TASK_STATUS.FAILED, 'raw failure text cannot become a succeeded step')
  t.equal(run.result.ok, false, 'the protocol violation becomes a canonical failure')
  t.equal(run.result.code, protocol.AI_TOOL_ERROR_CODE.INTERNAL_ERROR, 'the failure has a stable error code')
  t.end()
})

test('AI task runtime never rebinds browser timer receivers', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var setReceiver = 'not-called'
  var clearReceiver = 'not-called'
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function () { return protocol.createToolSuccessResult({ summary: 'ready' }) },
    setTimer: function (callback, delay) {
      setReceiver = this
      return setTimeout(callback, delay)
    },
    clearTimer: function (timer) {
      clearReceiver = this
      clearTimeout(timer)
    }
  })

  var run = await runtime.runStep({
    taskId: 'task-runtime-timer-receiver',
    stepId: 'step-1',
    toolName: 'git_status',
    policy: policies.getAIToolPolicy('git_status')
  })

  t.equal(run.result.summary, 'ready', 'tool execution still completes')
  t.equal(setReceiver, undefined, 'setTimer is called as a plain function')
  t.equal(clearReceiver, undefined, 'clearTimer is called as a plain function')
  t.end()
})

test('AI task status is derived from every finished step', async function (t) {
  var protocol = await protocolPromise
  var runtimeModule = await runtimePromise
  var failed = { type: 'step.finished', status: protocol.AI_TASK_STATUS.FAILED, result: protocol.createToolErrorResult({ code: protocol.AI_TOOL_ERROR_CODE.INVALID_INPUT, summary: 'Compilation failed.' }) }
  var succeeded = { type: 'step.finished', status: protocol.AI_TASK_STATUS.SUCCEEDED, result: protocol.createToolSuccessResult({ summary: 'Model replied.' }) }
  var uncertain = { type: 'step.finished', status: protocol.AI_TASK_STATUS.UNCERTAIN, result: protocol.createToolErrorResult({ code: protocol.AI_TOOL_ERROR_CODE.TX_UNKNOWN, summary: 'Broadcast unknown.', uncertainty: 'May have been sent.' }) }

  t.equal(runtimeModule.deriveAITaskStatusFromEvents([failed, succeeded]), protocol.AI_TASK_STATUS.FAILED, 'a later model reply cannot erase a failed tool step')
  t.equal(runtimeModule.deriveAITaskStatusFromEvents([failed, uncertain]), protocol.AI_TASK_STATUS.UNCERTAIN, 'chain uncertainty has the highest safety precedence')
  t.equal(runtimeModule.deriveAITaskStatusFromEvents([]), protocol.AI_TASK_STATUS.SUCCEEDED, 'chat without tool steps can still finish normally')
  t.equal(runtimeModule.deriveAITaskStatusFromEvents([], protocol.AI_TASK_STATUS.FAILED), protocol.AI_TASK_STATUS.FAILED, 'a resumed failure cannot become successful from a model-only reply')
  t.equal(runtimeModule.deriveAITaskStatusFromEvents([], protocol.AI_TASK_STATUS.SUCCEEDED, { requireToolStep: true }), protocol.AI_TASK_STATUS.FAILED, 'action-required tasks fail when the model emits no tool step')
  t.equal(runtimeModule.deriveAITaskStatusFromEvents([succeeded], protocol.AI_TASK_STATUS.SUCCEEDED, { unresolvedChainWrite: true }), protocol.AI_TASK_STATUS.UNCERTAIN, 'an unresolved R3 latch cannot be overwritten by a successful read or model reply')
  t.end()
})

test('AI task runtime distinguishes read timeout from uncertain chain timeout', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var never = function () { return new Promise(function () {}) }
  var runtime = new runtimeModule.AITaskRuntime({ executeTool: never })
  var readPolicy = { ...policies.getAIToolPolicy('read_contract'), timeoutMs: 5 }
  var chainPolicy = { ...policies.getAIToolPolicy('write_contract'), timeoutMs: 5 }

  var read = await runtime.runStep({ taskId: 'task-runtime-2', stepId: 'read', toolName: 'read_contract', policy: readPolicy })
  var chain = await runtime.runStep({ taskId: 'task-runtime-2', stepId: 'write', toolName: 'write_contract', policy: chainPolicy })

  t.equal(read.step.status, protocol.AI_TASK_STATUS.FAILED, 'read-only timeout is a failure')
  t.equal(read.result.code, protocol.AI_TOOL_ERROR_CODE.TIMEOUT, 'read timeout has TIMEOUT code')
  t.equal(read.result.retryable, true, 'read timeout can be retried manually')
  t.equal(chain.step.status, protocol.AI_TASK_STATUS.UNCERTAIN, 'chain timeout remains uncertain')
  t.equal(chain.result.code, protocol.AI_TOOL_ERROR_CODE.TX_UNKNOWN, 'chain timeout never claims failure')
  t.equal(chain.result.retryable, false, 'chain timeout cannot be retried automatically')
  t.end()
})

test('AI task runtime blocks another chain write after uncertainty in the same model turn', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var calls = 0
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function () {
      calls++
      if (calls === 1) {
        return protocol.createToolErrorResult({
          code: protocol.AI_TOOL_ERROR_CODE.TX_UNKNOWN,
          summary: 'The wallet result is unknown.',
          retryable: false,
          uncertainty: 'The transaction may still be signed or broadcast.'
        })
      }
      return protocol.createToolSuccessResult({ summary: 'This duplicate write must never run.' })
    }
  })
  var policy = policies.getAIToolPolicy('deploy_contract')

  var first = await runtime.runStep({ taskId: 'task-chain-guard', stepId: 'deploy-1', toolName: 'deploy_contract', policy: policy })
  var second = await runtime.runStep({ taskId: 'task-chain-guard', stepId: 'deploy-2', toolName: 'deploy_contract', policy: policy })

  t.equal(first.step.status, protocol.AI_TASK_STATUS.UNCERTAIN, 'the first unknown write marks the chain state uncertain')
  t.equal(second.blocked, true, 'the second chain write is stopped before execution')
  t.equal(second.result.code, protocol.AI_TOOL_ERROR_CODE.TX_UNKNOWN, 'the guard preserves the uncertainty signal')
  t.ok(/blocked before approval/.test(second.result.summary), 'the model is told that no second approval or write started')
  t.equal(calls, 1, 'the duplicate chain-write executor is never called')
  t.end()
})

test('AI task runtime restores the uncertain chain-write latch across Continue', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var firstRuntime = new runtimeModule.AITaskRuntime({
    executeTool: async function () {
      return protocol.createToolErrorResult({
        code: protocol.AI_TOOL_ERROR_CODE.TX_UNKNOWN,
        summary: 'The original deploy may have been broadcast.',
        retryable: false,
        uncertainty: 'The transaction outcome is not known.'
      })
    }
  })
  var first = await firstRuntime.runStep({
    taskId: 'task-chain-resume',
    stepId: 'deploy-1',
    toolName: 'deploy_contract',
    policy: policies.getAIToolPolicy('deploy_contract')
  })
  var persistedSteps = [first.step]
  var resumedCalls = []
  var resumedRuntime = new runtimeModule.AITaskRuntime({
    initialChainWriteUncertain: runtimeModule.hasUnresolvedChainWrite(persistedSteps),
    executeTool: async function (name) {
      resumedCalls.push(name)
      return protocol.createToolSuccessResult({ summary: `Resolved by ${name}` })
    }
  })

  var lookup = await resumedRuntime.runStep({
    taskId: 'task-chain-resume',
    stepId: 'lookup-1',
    toolName: 'get_transaction_status',
    policy: policies.getAIToolPolicy('get_transaction_status')
  })
  var duplicate = await resumedRuntime.runStep({
    taskId: 'task-chain-resume',
    stepId: 'deploy-2',
    toolName: 'deploy_contract',
    policy: policies.getAIToolPolicy('deploy_contract')
  })

  t.equal(runtimeModule.hasUnresolvedChainWrite(persistedSteps), true, 'a persisted uncertain R3 step restores the safety latch')
  t.equal(lookup.result.ok, true, 'the resumed task may still run read-only status resolution')
  t.equal(duplicate.blocked, true, 'the resumed task cannot submit another R3 step')
  t.equal(duplicate.result.code, protocol.AI_TOOL_ERROR_CODE.TX_UNKNOWN, 'the resumed guard preserves the original uncertainty')
  t.deepEqual(resumedCalls, ['get_transaction_status'], 'only the read-only resolver reaches the executor')
  t.equal(runtimeModule.hasUnresolvedChainWrite([{ riskLevel: protocol.AI_RISK_LEVEL.LOCAL_WRITE, status: protocol.AI_TASK_STATUS.UNCERTAIN }]), false, 'non-chain uncertainty does not masquerade as an R3 latch')
  t.equal(runtimeModule.hasUnresolvedChainWrite([{ riskLevel: protocol.AI_RISK_LEVEL.CHAIN_WRITE, status: protocol.AI_TASK_STATUS.FAILED, result: { code: protocol.AI_TOOL_ERROR_CODE.EXECUTION_REVERTED } }]), false, 'a proven revert does not leave the chain-write latch set')
  t.end()
})

test('AI task runtime keeps unmet prerequisites waiting instead of failing', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var observedExpectedNetwork = null
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function (name, input, context) {
      observedExpectedNetwork = context.expectedNetwork
      return protocol.createToolErrorResult({
        code: protocol.AI_TOOL_ERROR_CODE.NOT_READY,
        summary: 'Deploy & Run is still using the local VM.',
        retryable: false,
        userAction: 'Switch only Deploy & Run to Injected TronWeb.'
      })
    }
  })
  var run = await runtime.runStep({
    taskId: 'task-runtime-not-ready',
    stepId: 'environment',
    toolName: 'get_environment',
    policy: policies.getAIToolPolicy('get_environment'),
    expectedNetwork: 'nile'
  })

  t.equal(run.step.status, protocol.AI_TASK_STATUS.WAITING_FOR_USER, 'an unmet environment prerequisite waits for user action')
  t.equal(observedExpectedNetwork, 'nile', 'the task network requirement reaches the tool executor')
  t.end()
})

test('AI task runtime aborts the executor signal when a step times out', async function (t) {
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var observedAbort = false
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function (name, input, context) {
      return new Promise(function (resolve) {
        context.signal.addEventListener('abort', function () { observedAbort = true; resolve('stopped before mutation') }, { once: true })
      })
    }
  })
  var run = await runtime.runStep({
    taskId: 'task-runtime-timeout-abort',
    stepId: 'step-1',
    toolName: 'git_status',
    policy: { ...policies.getAIToolPolicy('git_status'), timeoutMs: 5 }
  })

  await new Promise(function (resolve) { setTimeout(resolve, 0) })
  t.equal(run.timedOut, true, 'step reports the timeout')
  t.equal(observedAbort, true, 'late executor receives an abort signal')
  t.end()
})

test('AI task runtime aborts read-only work and records side-effect uncertainty', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var controller = new AbortController()
  controller.abort()
  var events = []
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function () { return 'should not run' },
    onEvent: function (event) { events.push(event) }
  })

  try {
    await runtime.runStep({
      taskId: 'task-runtime-3',
      stepId: 'step-1',
      toolName: 'git_status',
      policy: policies.getAIToolPolicy('git_status'),
      signal: controller.signal
    })
    t.fail('aborted step should reject')
  } catch (error) {
    t.equal(error.name, 'AbortError', 'abort remains visible to the outer tool loop')
  }
  t.equal(events[1].status, protocol.AI_TASK_STATUS.CANCELLED, 'read-only abort is cancelled, not failed')
  t.end()
})

test('AI task runtime fails closed when a side-effecting executor throws', async function (t) {
  var protocol = await protocolPromise
  var policies = await policiesPromise
  var runtimeModule = await runtimePromise
  var runtime = new runtimeModule.AITaskRuntime({
    executeTool: async function () { throw new Error('connection closed after send') }
  })
  var run = await runtime.runStep({
    taskId: 'task-runtime-4',
    stepId: 'step-1',
    toolName: 'git_push',
    policy: policies.getAIToolPolicy('git_push')
  })

  t.equal(run.step.status, protocol.AI_TASK_STATUS.UNCERTAIN, 'remote write is not falsely reported as failed')
  t.equal(run.result.retryable, false, 'remote write exception cannot auto-retry')
  t.ok(run.result.uncertainty, 'result explains that external state is unknown')
  t.end()
})
