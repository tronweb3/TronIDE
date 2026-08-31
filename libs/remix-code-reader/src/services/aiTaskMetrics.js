/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import { AI_TASK_STATUS, AI_TOOL_ERROR_CODE } from './aiTaskProtocol.js'

export const AI_LOCAL_METRICS_SCHEMA_VERSION = 2
export const AI_LOCAL_METRICS_STORAGE_KEY = 'tronide.ai.metrics.v2'
export const AI_LOCAL_METRICS_LEGACY_STORAGE_KEY = 'tronide.ai.metrics.v1'
export const AI_LOCAL_METRICS_ENABLED_KEY = 'tronide.ai.metrics.enabled'

const DURATION_BUCKETS = Object.freeze(['under1s', '1to5s', '5to30s', '30sPlus'])
const SAFE_ERROR_CODES = new Set([...Object.values(AI_TOOL_ERROR_CODE), 'OTHER'])
const SAFE_INTEGRATION_ERROR_CODES = new Set(['AUTH', 'RATE_LIMIT', 'UPSTREAM', 'TIMEOUT', 'NETWORK', 'OTHER'])

const safeCount = (value) => Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER) : 0

export const emptyLocalAITaskMetrics = () => ({
  schemaVersion: AI_LOCAL_METRICS_SCHEMA_VERSION,
  workflows: { started: 0, completed: 0, failed: 0 },
  tools: {
    finished: 0,
    failed: 0,
    durationBuckets: Object.fromEntries(DURATION_BUCKETS.map((bucket) => [bucket, 0])),
    errorCodes: {}
  },
  decisions: { approved: 0, rejected: 0, aborted: 0 },
  integrations: {
    bankofai: {
      requests: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      toolCalls: 0,
      durationBuckets: Object.fromEntries(DURATION_BUCKETS.map((bucket) => [bucket, 0])),
      errorCodes: {}
    }
  }
})

const clone = (value) => JSON.parse(JSON.stringify(value))

const sanitizeErrorCode = (value) => {
  const code = String(value || '').toUpperCase()
  return SAFE_ERROR_CODES.has(code) ? code : 'OTHER'
}

const sanitizeStoredMetrics = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![1, AI_LOCAL_METRICS_SCHEMA_VERSION].includes(raw.schemaVersion)) return emptyLocalAITaskMetrics()
  const clean = emptyLocalAITaskMetrics()
  for (const key of Object.keys(clean.workflows)) clean.workflows[key] = safeCount(raw.workflows?.[key])
  clean.tools.finished = safeCount(raw.tools?.finished)
  clean.tools.failed = safeCount(raw.tools?.failed)
  for (const bucket of DURATION_BUCKETS) clean.tools.durationBuckets[bucket] = safeCount(raw.tools?.durationBuckets?.[bucket])
  for (const [rawCode, rawCount] of Object.entries(raw.tools?.errorCodes || {}).slice(0, 100)) {
    const code = sanitizeErrorCode(rawCode)
    clean.tools.errorCodes[code] = safeCount(safeCount(clean.tools.errorCodes[code]) + safeCount(rawCount))
  }
  for (const key of Object.keys(clean.decisions)) clean.decisions[key] = safeCount(raw.decisions?.[key])
  const bank = raw.integrations?.bankofai
  for (const key of ['requests', 'succeeded', 'failed', 'cancelled', 'toolCalls']) clean.integrations.bankofai[key] = safeCount(bank?.[key])
  for (const bucket of DURATION_BUCKETS) clean.integrations.bankofai.durationBuckets[bucket] = safeCount(bank?.durationBuckets?.[bucket])
  for (const [rawCode, rawCount] of Object.entries(bank?.errorCodes || {}).slice(0, 20)) {
    const code = String(rawCode || '').toUpperCase()
    const safeCode = SAFE_INTEGRATION_ERROR_CODES.has(code) ? code : 'OTHER'
    clean.integrations.bankofai.errorCodes[safeCode] = safeCount(safeCount(clean.integrations.bankofai.errorCodes[safeCode]) + safeCount(rawCount))
  }
  return clean
}

const durationBucket = (durationMs) => {
  if (durationMs < 1000) return 'under1s'
  if (durationMs < 5000) return '1to5s'
  if (durationMs < 30000) return '5to30s'
  return '30sPlus'
}

export const readLocalAITaskMetricsEnabled = (storage) => {
  try {
    const target = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null)
    return target?.getItem(AI_LOCAL_METRICS_ENABLED_KEY) !== 'false'
  } catch (_) { return true }
}

export const writeLocalAITaskMetricsEnabled = (enabled, storage) => {
  try {
    const target = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null)
    target?.setItem(AI_LOCAL_METRICS_ENABLED_KEY, enabled ? 'true' : 'false')
  } catch (_) { /* preference remains session-only */ }
  return enabled === true
}

/**
 * Stores aggregate counters only. Raw events, task/step ids, tool names,
 * arbitrary vendor/model names, prompts, source, addresses, transaction
 * arguments and credentials never enter the persisted envelope. Bank of AI is
 * the sole fixed integration identifier, so its aggregate product-health
 * counters cannot become a channel for user-controlled strings.
 */
export class LocalAITaskMetrics {
  constructor ({ driver, enabled = true }) {
    if (!driver || typeof driver.getItem !== 'function' || typeof driver.setItem !== 'function') {
      throw new TypeError('Local AI metrics driver must provide getItem and setItem')
    }
    this.driver = driver
    this.enabled = enabled === true
    this._metrics = emptyLocalAITaskMetrics()
    this._stepStartedAt = new Map()
    this._queue = Promise.resolve()
    this._initialized = null
  }

  initialize () {
    if (this._initialized) return this._initialized
    if (!this.enabled) return Promise.resolve(this.snapshot())
    this._initialized = Promise.resolve(this.driver.getItem(AI_LOCAL_METRICS_STORAGE_KEY))
      .then(async (raw) => {
        let stored = raw
        if (stored == null) {
          const legacy = await this.driver.getItem(AI_LOCAL_METRICS_LEGACY_STORAGE_KEY)
          if (legacy != null) {
            stored = legacy
            this._metrics = sanitizeStoredMetrics(stored)
            await this.driver.setItem(AI_LOCAL_METRICS_STORAGE_KEY, this.snapshot())
            if (typeof this.driver.removeItem === 'function') await this.driver.removeItem(AI_LOCAL_METRICS_LEGACY_STORAGE_KEY)
            return this.snapshot()
          }
        }
        this._metrics = sanitizeStoredMetrics(stored)
        return this.snapshot()
      })
    return this._initialized
  }

  snapshot () {
    return clone(this._metrics)
  }

  _apply (event) {
    const type = String(event?.type || '')
    if (type === 'task.started') this._metrics.workflows.started++
    if (type === 'task.finished') {
      const status = event?.task?.status || event?.status
      if (status === AI_TASK_STATUS.SUCCEEDED) this._metrics.workflows.completed++
      else if (status === AI_TASK_STATUS.FAILED || status === AI_TASK_STATUS.UNCERTAIN) this._metrics.workflows.failed++
      else if (status === AI_TASK_STATUS.CANCELLED) this._metrics.decisions.aborted++
    }
    if (type === 'step.approval' && typeof event?.approved === 'boolean') {
      this._metrics.decisions[event.approved ? 'approved' : 'rejected']++
    }
    if (type === 'step.started' && event?.stepId && Number.isFinite(event?.at)) {
      this._stepStartedAt.set(String(event.stepId), event.at)
    }
    if (type === 'step.finished') {
      this._metrics.tools.finished++
      const stepId = event?.stepId ? String(event.stepId) : ''
      const startedAt = stepId ? this._stepStartedAt.get(stepId) : undefined
      if (stepId) this._stepStartedAt.delete(stepId)
      if (Number.isFinite(startedAt) && Number.isFinite(event?.at)) {
        const bucket = durationBucket(Math.max(0, event.at - startedAt))
        this._metrics.tools.durationBuckets[bucket]++
      }
      if (event?.result?.ok === false) {
        this._metrics.tools.failed++
        const code = sanitizeErrorCode(event.result.code)
        this._metrics.tools.errorCodes[code] = safeCount(this._metrics.tools.errorCodes[code]) + 1
      }
    }
    if (event?.integration === 'bankofai' && type === 'integration.request.finished') {
      const bank = this._metrics.integrations.bankofai
      bank.requests++
      const status = String(event?.status || '')
      if (status === 'succeeded') bank.succeeded++
      else if (status === 'cancelled') bank.cancelled++
      else {
        bank.failed++
        const rawCode = String(event?.errorCode || '').toUpperCase()
        const code = SAFE_INTEGRATION_ERROR_CODES.has(rawCode) ? rawCode : 'OTHER'
        bank.errorCodes[code] = safeCount(bank.errorCodes[code]) + 1
      }
      const bucket = durationBucket(Math.max(0, Number(event?.durationMs) || 0))
      bank.durationBuckets[bucket]++
    }
    if (event?.integration === 'bankofai' && type === 'integration.tool.called') this._metrics.integrations.bankofai.toolCalls++
  }

  recordEvent (event) {
    if (!this.enabled) return Promise.resolve(this.snapshot())
    const write = async () => {
      await this.initialize()
      if (!this.enabled) return this.snapshot()
      this._apply(event)
      await this.driver.setItem(AI_LOCAL_METRICS_STORAGE_KEY, this.snapshot())
      return this.snapshot()
    }
    this._queue = this._queue.then(write, write)
    return this._queue
  }

  setEnabled (enabled) {
    const next = enabled === true
    // Flip the live gate synchronously: an event arriving in the same tick as
    // opt-out must be dropped, while an event after opt-in queues behind the
    // initialization below instead of being lost.
    this.enabled = next
    const write = async () => {
      this._stepStartedAt.clear()
      if (!next) {
        this._metrics = emptyLocalAITaskMetrics()
        this._initialized = null
        if (typeof this.driver.removeItem === 'function') {
          await this.driver.removeItem(AI_LOCAL_METRICS_STORAGE_KEY)
          await this.driver.removeItem(AI_LOCAL_METRICS_LEGACY_STORAGE_KEY)
        }
        else await this.driver.setItem(AI_LOCAL_METRICS_STORAGE_KEY, this.snapshot())
        return this.snapshot()
      }
      this._initialized = null
      return this.initialize()
    }
    this._queue = this._queue.then(write, write)
    return this._queue
  }

  clear () {
    const write = async () => {
      this._metrics = emptyLocalAITaskMetrics()
      this._stepStartedAt.clear()
      if (typeof this.driver.removeItem === 'function') {
        await this.driver.removeItem(AI_LOCAL_METRICS_STORAGE_KEY)
        await this.driver.removeItem(AI_LOCAL_METRICS_LEGACY_STORAGE_KEY)
      }
      else await this.driver.setItem(AI_LOCAL_METRICS_STORAGE_KEY, this.snapshot())
      return this.snapshot()
    }
    this._queue = this._queue.then(write, write)
    return this._queue
  }

  async flush () {
    await this._queue
    return this.snapshot()
  }
}
