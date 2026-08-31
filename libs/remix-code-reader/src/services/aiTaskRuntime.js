/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import {
  AI_RISK_LEVEL,
  AI_TASK_STATUS,
  AI_TOOL_ERROR_CODE,
  createAITaskStep,
  createToolErrorResult,
  normalizeToolResult,
  transitionTaskStatus
} from './aiTaskProtocol.js'

const makeAbortError = () => {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

const safeErrorSummary = (error) => {
  if (!error) return 'Unknown tool error'
  if (typeof error === 'string') return error
  return error.message || String(error)
}

export const deriveAITaskStatusFromEvents = (events = [], fallbackStatus = AI_TASK_STATUS.SUCCEEDED, { requireToolStep = false, unresolvedChainWrite = false } = {}) => {
  if (unresolvedChainWrite) return AI_TASK_STATUS.UNCERTAIN
  const finished = (Array.isArray(events) ? events : []).filter((event) => event?.type === 'step.finished')
  if (!finished.length) return requireToolStep ? AI_TASK_STATUS.FAILED : fallbackStatus
  if (finished.some((event) => event.status === AI_TASK_STATUS.UNCERTAIN || event.result?.uncertainty || event.result?.code === AI_TOOL_ERROR_CODE.TX_UNKNOWN)) return AI_TASK_STATUS.UNCERTAIN
  if (finished.some((event) => event.status === AI_TASK_STATUS.FAILED || (event.result?.ok === false && ![AI_TOOL_ERROR_CODE.NOT_READY, AI_TOOL_ERROR_CODE.NETWORK_UNAVAILABLE, AI_TOOL_ERROR_CODE.WALLET_LOCKED, AI_TOOL_ERROR_CODE.USER_REJECTED].includes(event.result?.code)))) return AI_TASK_STATUS.FAILED
  if (finished.some((event) => event.status === AI_TASK_STATUS.WAITING_FOR_USER)) return AI_TASK_STATUS.WAITING_FOR_USER
  if (finished.some((event) => event.status === AI_TASK_STATUS.CANCELLED)) return AI_TASK_STATUS.CANCELLED
  return AI_TASK_STATUS.SUCCEEDED
}

export const hasUnresolvedChainWrite = (steps = []) => (Array.isArray(steps) ? steps : []).some((step) =>
  step?.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE &&
  (step?.status === AI_TASK_STATUS.UNCERTAIN || step?.result?.code === AI_TOOL_ERROR_CODE.TX_UNKNOWN || Boolean(step?.result?.uncertainty))
)

export class AITaskRuntime {
  constructor ({ executeTool, onEvent, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, initialChainWriteUncertain = false }) {
    if (typeof executeTool !== 'function') throw new TypeError('executeTool must be a function')
    this.executeTool = executeTool
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {}
    this.now = now
    // Browser timer functions are Web-IDL methods in some engines. Storing one
    // directly and later invoking `this.setTimer(...)` changes its receiver and
    // can throw "Illegal invocation" after a side-effect tool has already
    // opened its approval modal. Keep the original functions in lexical scope
    // so both native and injected timers are always called as plain functions.
    this.setTimer = (...args) => setTimer(...args)
    this.clearTimer = (...args) => clearTimer(...args)
    // One uncertain chain write poisons the remainder of this task attempt. The
    // seed carries that latch across Continue/refresh so a new Runtime instance
    // cannot turn an unresolved transaction into a duplicate R3 submission.
    this.chainWriteUncertain = initialChainWriteUncertain === true
  }

  _emit (event) {
    try { this.onEvent(Object.freeze(event)) } catch (_) { /* UI/event consumers cannot break tool execution */ }
  }

  _transition (step, status, result) {
    const next = transitionTaskStatus(step, status, this.now())
    const completed = Object.freeze({
      ...next,
      ...(result ? { result } : {}),
      durationMs: Math.max(0, next.updatedAt - next.createdAt)
    })
    this._emit({
      type: status === AI_TASK_STATUS.RUNNING ? 'step.started' : 'step.finished',
      taskId: completed.taskId,
      stepId: completed.stepId,
      toolName: completed.toolName,
      status,
      at: completed.updatedAt,
      ...(result ? { result } : {})
    })
    return completed
  }

  _timeoutResult (policy, toolName) {
    if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE) {
      return createToolErrorResult({
        code: AI_TOOL_ERROR_CODE.TX_UNKNOWN,
        summary: `${toolName} timed out; a transaction may already have been broadcast.`,
        retryable: false,
        userAction: 'Query the transaction or contract state before deciding whether to try again.',
        uncertainty: 'The runtime cannot prove whether the chain write completed.'
      })
    }
    const hasSideEffect = policy.riskLevel !== AI_RISK_LEVEL.READ_ONLY
    return createToolErrorResult({
      code: AI_TOOL_ERROR_CODE.TIMEOUT,
      summary: `${toolName} timed out${hasSideEffect ? '; it may still have changed external state.' : '.'}`,
      retryable: policy.retryable === true && !hasSideEffect,
      userAction: hasSideEffect
        ? 'Inspect the target state before retrying.'
        : 'Retry the read-only step when the dependency is available.',
      ...(hasSideEffect ? { uncertainty: 'The timed-out side effect may have completed after the deadline.' } : {})
    })
  }

  async runStep ({ taskId, stepId, toolName, input = {}, policy, expectedNetwork = null, signal }) {
    if (!policy || !policy.riskLevel) throw new TypeError(`A policy is required for ${toolName}`)
    let step = createAITaskStep({
      taskId,
      stepId,
      toolName,
      riskLevel: policy.riskLevel,
      inputSummary: input && input.path ? String(input.path) : '',
      now: this.now()
    })
    this._emit({
      type: 'step.planned',
      taskId: step.taskId,
      stepId: step.stepId,
      toolName: step.toolName,
      status: step.status,
      riskLevel: step.riskLevel,
      sideEffect: step.sideEffect,
      at: step.createdAt
    })

    if (signal?.aborted) {
      step = this._transition(step, AI_TASK_STATUS.CANCELLED)
      throw makeAbortError()
    }

    step = this._transition(step, AI_TASK_STATUS.RUNNING)
    if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE && this.chainWriteUncertain) {
      const result = createToolErrorResult({
        code: AI_TOOL_ERROR_CODE.TX_UNKNOWN,
        summary: `${toolName} was blocked before approval because an earlier chain write in this task is still uncertain.`,
        retryable: false,
        userAction: 'Resolve the original wallet or transaction state first. Start a new task only after reviewing the chain evidence and approving a new attempt.',
        uncertainty: 'No additional chain write was started.'
      })
      step = this._transition(step, AI_TASK_STATUS.UNCERTAIN, result)
      return Object.freeze({ step, result, timedOut: false, blocked: true })
    }
    const executionController = new AbortController()
    const forwardAbort = () => executionController.abort()
    if (signal) signal.addEventListener('abort', forwardAbort, { once: true })
    let timedOut = false
    const execution = Promise.resolve()
      .then(() => this.executeTool(toolName, input, { signal: executionController.signal, policy, taskId, stepId, expectedNetwork }))
      .then((result) => ({ type: 'result', result }))
      .catch((error) => ({ type: 'error', error }))

    let timer
    const timeout = new Promise((resolve) => {
      timer = this.setTimer(() => resolve({ type: 'timeout' }), policy.timeoutMs)
    })
    let removeAbortListener = () => {}
    const aborted = new Promise((resolve) => {
      if (!signal) return
      const onAbort = () => resolve({ type: 'aborted' })
      signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => signal.removeEventListener('abort', onAbort)
    })

    const outcome = await Promise.race([execution, timeout, aborted])
    this.clearTimer(timer)
    removeAbortListener()
    if (signal) signal.removeEventListener('abort', forwardAbort)

    if (outcome.type === 'timeout') {
      timedOut = true
      executionController.abort()
      const result = this._timeoutResult(policy, toolName)
      const status = policy.riskLevel === AI_RISK_LEVEL.READ_ONLY ? AI_TASK_STATUS.FAILED : AI_TASK_STATUS.UNCERTAIN
      if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE) this.chainWriteUncertain = true
      step = this._transition(step, status, result)
      execution.then((late) => {
        let lateEvent
        if (late.type === 'result') {
          try { lateEvent = { result: normalizeToolResult(late.result) } } catch (error) { lateEvent = { error: safeErrorSummary(error) } }
        } else {
          lateEvent = { error: safeErrorSummary(late.error) }
        }
        this._emit({
          type: 'step.late_result',
          taskId,
          stepId,
          toolName,
          at: this.now(),
          outcome: late.type,
          ...lateEvent
        })
      }).catch(() => {})
      return Object.freeze({ step, result, timedOut })
    }

    if (outcome.type === 'aborted') {
      const status = policy.riskLevel === AI_RISK_LEVEL.READ_ONLY ? AI_TASK_STATUS.CANCELLED : AI_TASK_STATUS.UNCERTAIN
      if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE) this.chainWriteUncertain = true
      step = this._transition(step, status)
      throw makeAbortError()
    }

    if (outcome.type === 'error') {
      if (outcome.error?.name === 'AbortError' || signal?.aborted) {
        const status = policy.riskLevel === AI_RISK_LEVEL.READ_ONLY ? AI_TASK_STATUS.CANCELLED : AI_TASK_STATUS.UNCERTAIN
        if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE) this.chainWriteUncertain = true
        step = this._transition(step, status)
        throw makeAbortError()
      }
      const hasSideEffect = policy.riskLevel !== AI_RISK_LEVEL.READ_ONLY
      const errorCode = policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE
        ? AI_TOOL_ERROR_CODE.TX_UNKNOWN
        : AI_TOOL_ERROR_CODE.INTERNAL_ERROR
      const result = createToolErrorResult({
        code: errorCode,
        summary: `Tool failed: ${safeErrorSummary(outcome.error)}`,
        retryable: !hasSideEffect && policy.retryable === true,
        userAction: hasSideEffect
          ? 'Inspect the target state before deciding whether to retry.'
          : 'Review the error and current IDE state before retrying.',
        ...(hasSideEffect ? { uncertainty: 'The runtime cannot prove that the side effect did not occur.' } : {})
      })
      if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE) this.chainWriteUncertain = true
      step = this._transition(step, hasSideEffect ? AI_TASK_STATUS.UNCERTAIN : AI_TASK_STATUS.FAILED, result)
      return Object.freeze({ step, result, timedOut })
    }

    let result
    try {
      result = normalizeToolResult(outcome.result)
    } catch (error) {
      const hasSideEffect = policy.riskLevel !== AI_RISK_LEVEL.READ_ONLY
      result = createToolErrorResult({
        code: AI_TOOL_ERROR_CODE.INTERNAL_ERROR,
        summary: `Tool returned a non-canonical result: ${safeErrorSummary(error)}`,
        retryable: false,
        userAction: hasSideEffect
          ? 'Inspect the target state before deciding whether to retry.'
          : 'Retry only after the tool executor returns structured success or failure evidence.',
        ...(hasSideEffect ? { uncertainty: 'The runtime cannot infer whether an unstructured side effect completed.' } : {})
      })
      if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE) this.chainWriteUncertain = true
      step = this._transition(step, hasSideEffect ? AI_TASK_STATUS.UNCERTAIN : AI_TASK_STATUS.FAILED, result)
      return Object.freeze({ step, result, timedOut })
    }
    const waitingCodes = new Set([
      AI_TOOL_ERROR_CODE.NOT_READY,
      AI_TOOL_ERROR_CODE.NETWORK_UNAVAILABLE,
      AI_TOOL_ERROR_CODE.WALLET_LOCKED
    ])
    const status = result.ok
      ? AI_TASK_STATUS.SUCCEEDED
      : (result.code === AI_TOOL_ERROR_CODE.TX_UNKNOWN || result.uncertainty
        ? AI_TASK_STATUS.UNCERTAIN
        : (result.code === AI_TOOL_ERROR_CODE.USER_REJECTED
          ? AI_TASK_STATUS.CANCELLED
          : (waitingCodes.has(result.code) ? AI_TASK_STATUS.WAITING_FOR_USER : AI_TASK_STATUS.FAILED)))
    if (policy.riskLevel === AI_RISK_LEVEL.CHAIN_WRITE && status === AI_TASK_STATUS.UNCERTAIN) this.chainWriteUncertain = true
    step = this._transition(step, status, result)
    return Object.freeze({ step, result, timedOut })
  }
}
