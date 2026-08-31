/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import { AI_TASK_SCHEMA_VERSION, AI_TASK_STATUS } from './aiTaskProtocol.js'

export const AI_TASK_STORAGE_KEY = 'tronide.ai.tasks'
export const AI_TASK_RECOVERY_STORAGE_KEY = 'tronide.ai.tasks.v1.recovered'

const clip = (value, max) => String(value == null ? '' : value).slice(0, max)

const clone = (value) => JSON.parse(JSON.stringify(value))

const emptyEnvelope = () => ({
  schemaVersion: AI_TASK_SCHEMA_VERSION,
  tasks: []
})

const parseEnvelope = (raw) => {
  if (raw == null) return { envelope: emptyEnvelope(), valid: true, empty: true }
  let parsed = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch (_) { return { valid: false, reason: 'Task history is not valid JSON.' } }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false, reason: 'Task history root is invalid.' }
  if (parsed.schemaVersion !== AI_TASK_SCHEMA_VERSION) return { valid: false, reason: `Unsupported task history schema: ${parsed.schemaVersion}` }
  if (!Array.isArray(parsed.tasks)) return { valid: false, reason: 'Task history does not contain a task list.' }
  return { envelope: parsed, valid: true, empty: false }
}

const sanitizeArtifact = (artifact) => ({
  type: clip(artifact?.type || 'artifact', 80),
  label: clip(artifact?.label || artifact?.ref || 'Artifact', 240),
  ref: clip(artifact?.ref || '', 2000)
})

const sanitizeResult = (result) => {
  if (!result || typeof result !== 'object') return null
  const sanitized = {
    ok: result.ok === true,
    code: clip(result.code || (result.ok ? 'OK' : 'INTERNAL_ERROR'), 80),
    summary: clip(result.summary || '', 4000),
    retryable: result.retryable === true,
    artifacts: Array.isArray(result.artifacts) ? result.artifacts.slice(0, 50).map(sanitizeArtifact) : []
  }
  if (result.userAction) sanitized.userAction = clip(result.userAction, 2000)
  if (result.uncertainty) sanitized.uncertainty = clip(result.uncertainty, 2000)
  // Deliberately omit result.data: it can contain source code, contract values
  // or large provider payloads. Durable history keeps summaries and artifacts.
  return sanitized
}

const sanitizeWorkflowResult = (result) => {
  if (!result || typeof result !== 'object') return null
  return {
    schemaVersion: Number.isFinite(result.schemaVersion) ? result.schemaVersion : 1,
    workflowId: clip(result.workflowId || '', 100),
    number: clip(result.number || '', 20),
    title: clip(result.title || 'Golden Workflow', 240),
    status: clip(result.status || 'incomplete', 40),
    summary: clip(result.summary || '', 2000),
    completion: {
      passed: Number.isFinite(result.completion?.passed) ? result.completion.passed : 0,
      required: Number.isFinite(result.completion?.required) ? result.completion.required : 0
    },
    resultFields: Array.isArray(result.resultFields) ? result.resultFields.slice(0, 20).map((field) => clip(field, 200)) : [],
    evidence: Array.isArray(result.evidence) ? result.evidence.slice(0, 30).map((item) => ({
      phaseId: clip(item?.phaseId || '', 100),
      title: clip(item?.title || 'Workflow phase', 240),
      optional: item?.optional === true,
      status: clip(item?.status || 'missing', 40),
      toolName: clip(item?.toolName || '', 100),
      summary: clip(item?.summary || '', 2000),
      userAction: clip(item?.userAction || '', 1000)
    })) : [],
    artifacts: Array.isArray(result.artifacts) ? result.artifacts.slice(0, 50).map(sanitizeArtifact) : [],
    nextAction: clip(result.nextAction || '', 2000)
  }
}

const sanitizeTaskEntry = (entry) => {
  if (!entry || typeof entry !== 'object' || !entry.entryId) return null
  const source = entry.context && typeof entry.context === 'object' ? entry.context : {}
  const context = {}
  for (const [field, max] of Object.entries({ contractAddress: 80, transactionHash: 80, contractName: 80, network: 32 })) {
    if (source[field] != null && String(source[field]).trim()) context[field] = clip(source[field], max)
  }
  return {
    schemaVersion: Number.isFinite(entry.schemaVersion) ? entry.schemaVersion : 1,
    entryId: clip(entry.entryId, 100),
    source: clip(entry.source || 'home', 32),
    context
  }
}

const sanitizeTask = (task, now) => ({
  schemaVersion: AI_TASK_SCHEMA_VERSION,
  taskId: clip(task?.taskId || `recovered-${now}`, 200),
  goal: clip(task?.goal || 'Recovered AI task', 1000),
  source: clip(task?.source || 'chat', 80),
  workspace: task?.workspace == null ? null : clip(task.workspace, 500),
  branch: task?.branch == null ? null : clip(task.branch, 500),
  entry: sanitizeTaskEntry(task?.entry),
  status: Object.values(AI_TASK_STATUS).includes(task?.status) ? task.status : AI_TASK_STATUS.UNCERTAIN,
  createdAt: Number.isFinite(task?.createdAt) ? task.createdAt : now,
  updatedAt: Number.isFinite(task?.updatedAt) ? task.updatedAt : now
})

const sanitizeEvent = (event, now) => {
  const sanitized = {
    type: clip(event?.type || 'task.event', 120),
    at: Number.isFinite(event?.at) ? event.at : now
  }
  for (const field of ['taskId', 'stepId', 'toolName', 'status', 'riskLevel', 'sideEffect', 'outcome', 'errorCode']) {
    if (event?.[field] != null) sanitized[field] = clip(event[field], 500)
  }
  if (Number.isFinite(event?.expiresAt)) sanitized.expiresAt = event.expiresAt
  if (typeof event?.approved === 'boolean') sanitized.approved = event.approved
  if (event?.task) sanitized.task = sanitizeTask(event.task, sanitized.at)
  if (event?.result) sanitized.result = sanitizeResult(event.result)
  if (event?.workflowResult) sanitized.workflowResult = sanitizeWorkflowResult(event.workflowResult)
  if (event?.error) sanitized.error = clip(event.error, 2000)
  return sanitized
}

export const reduceAITaskRecord = (record, rawEvent, now = Date.now(), maxEvents = 200) => {
  const event = sanitizeEvent(rawEvent, now)
  const sourceTask = event.task || record?.task || { taskId: event.taskId, status: event.status }
  const task = sanitizeTask(sourceTask, event.at)
  if (event.status && Object.values(AI_TASK_STATUS).includes(event.status) && event.type.startsWith('task.')) task.status = event.status
  if (event.task?.status) task.status = event.task.status
  task.updatedAt = Math.max(task.updatedAt, event.at)

  const next = {
    schemaVersion: AI_TASK_SCHEMA_VERSION,
    task,
    steps: Array.isArray(record?.steps) ? clone(record.steps) : [],
    artifacts: Array.isArray(record?.artifacts) ? clone(record.artifacts) : [],
    workflowResult: record?.workflowResult ? clone(record.workflowResult) : null,
    events: [...(Array.isArray(record?.events) ? record.events : []), event].slice(-maxEvents),
    updatedAt: task.updatedAt
  }

  if (event.stepId) {
    const index = next.steps.findIndex((step) => step.stepId === event.stepId)
    const previous = index >= 0 ? next.steps[index] : { stepId: event.stepId, taskId: event.taskId || task.taskId }
    const step = {
      ...previous,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.riskLevel ? { riskLevel: event.riskLevel } : {}),
      ...(event.sideEffect ? { sideEffect: event.sideEffect } : {}),
      ...(event.type === 'step.started' ? { startedAt: event.at } : {}),
      updatedAt: event.at,
      ...(event.result ? { result: event.result } : {})
    }
    if (index >= 0) next.steps[index] = step
    else next.steps.push(step)
  }

  const artifacts = event.result?.artifacts || []
  for (const artifact of artifacts) {
    if (!next.artifacts.some((item) => item.type === artifact.type && item.ref === artifact.ref)) next.artifacts.push(artifact)
  }
  next.artifacts = next.artifacts.slice(-100)
  if (event.workflowResult) next.workflowResult = event.workflowResult
  return next
}

export class AITaskStore {
  constructor ({ driver, maxTasks = 100, maxEvents = 200, now = () => Date.now() }) {
    if (!driver || typeof driver.getItem !== 'function' || typeof driver.setItem !== 'function') {
      throw new TypeError('AI task storage driver must provide getItem and setItem')
    }
    this.driver = driver
    this.maxTasks = maxTasks
    this.maxEvents = maxEvents
    this.now = now
    this._queue = Promise.resolve()
    this._initialized = null
    this._envelope = null
    this._writeKey = AI_TASK_STORAGE_KEY
    this._archive = null
  }

  async initialize () {
    if (this._initialized) return this._initialized
    this._initialized = (async () => {
      const raw = await this.driver.getItem(AI_TASK_STORAGE_KEY)
      const primary = parseEnvelope(raw)
      if (primary.valid) {
        this._envelope = primary.envelope
      } else {
        this._archive = { key: AI_TASK_STORAGE_KEY, reason: primary.reason, raw }
        this._writeKey = AI_TASK_RECOVERY_STORAGE_KEY
        const recovered = parseEnvelope(await this.driver.getItem(AI_TASK_RECOVERY_STORAGE_KEY))
        this._envelope = recovered.valid ? recovered.envelope : emptyEnvelope()
      }
      this._envelope.tasks = this._envelope.tasks.slice(-this.maxTasks)
      return this.snapshot()
    })()
    return this._initialized
  }

  snapshot () {
    return {
      schemaVersion: AI_TASK_SCHEMA_VERSION,
      tasks: clone(this._envelope?.tasks || []),
      archive: this._archive ? { key: this._archive.key, reason: this._archive.reason } : null
    }
  }

  getReadOnlyArchive () {
    if (!this._archive) return null
    return {
      key: this._archive.key,
      reason: this._archive.reason,
      raw: clone(this._archive.raw)
    }
  }

  recordEvent (event) {
    const write = async () => {
      await this.initialize()
      const now = this.now()
      const taskId = event?.task?.taskId || event?.taskId
      if (!taskId) throw new TypeError('AI task event is missing taskId')
      const index = this._envelope.tasks.findIndex((record) => record?.task?.taskId === taskId)
      const previous = index >= 0 ? this._envelope.tasks[index] : null
      const next = reduceAITaskRecord(previous, event, now, this.maxEvents)
      if (index >= 0) this._envelope.tasks.splice(index, 1)
      this._envelope.tasks.push(next)
      this._envelope.tasks = this._envelope.tasks.slice(-this.maxTasks)
      await this.driver.setItem(this._writeKey, clone(this._envelope))
      return this.snapshot()
    }
    this._queue = this._queue.then(write, write)
    return this._queue
  }

  clear () {
    const write = async () => {
      await this.initialize()
      this._envelope = emptyEnvelope()
      if (typeof this.driver.removeItem === 'function') await this.driver.removeItem(this._writeKey)
      else await this.driver.setItem(this._writeKey, clone(this._envelope))
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
