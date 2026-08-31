/*
 * Copyright 2026 [TronIDE]
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Canonical, vendor-neutral protocol for the v2.3.3 AI task runtime. Keep this
// module free of React, plugin-bus and model-SDK dependencies so storage,
// adapters, UI and deterministic tests can share the same invariants.

export const AI_TASK_SCHEMA_VERSION = 1

export const AI_TASK_STATUS = Object.freeze({
  PLANNED: 'planned',
  RUNNING: 'running',
  WAITING_FOR_USER: 'waiting_for_user',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNCERTAIN: 'uncertain'
})

export const AI_STEP_STATUS = AI_TASK_STATUS

export const AI_RISK_LEVEL = Object.freeze({
  READ_ONLY: 'R0',
  LOCAL_WRITE: 'R1',
  REMOTE_WRITE: 'R2',
  CHAIN_WRITE: 'R3'
})

export const AI_SIDE_EFFECT = Object.freeze({
  NONE: 'none',
  LOCAL: 'local',
  REMOTE: 'remote',
  CHAIN: 'chain'
})

export const AI_TOOL_ERROR_CODE = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_READY: 'NOT_READY',
  NETWORK_UNAVAILABLE: 'NETWORK_UNAVAILABLE',
  WALLET_LOCKED: 'WALLET_LOCKED',
  USER_REJECTED: 'USER_REJECTED',
  TIMEOUT: 'TIMEOUT',
  STATE_CHANGED: 'STATE_CHANGED',
  TX_UNKNOWN: 'TX_UNKNOWN',
  EXECUTION_REVERTED: 'EXECUTION_REVERTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
})

// Task-level failures are kept separate from tool execution results. This
// lets diagnostics distinguish a model that never emitted a Workspace Action
// from a tool that was emitted and then failed inside the IDE runtime.
export const AI_TASK_ERROR_CODE = Object.freeze({
  MODEL_DID_NOT_CALL_TOOL: 'MODEL_DID_NOT_CALL_TOOL'
})

export const AI_RISK_POLICY_DEFAULTS = Object.freeze({
  [AI_RISK_LEVEL.READ_ONLY]: Object.freeze({
    sideEffect: AI_SIDE_EFFECT.NONE,
    approvalRequired: false,
    autoRetry: false,
    timeoutMs: 30000
  }),
  [AI_RISK_LEVEL.LOCAL_WRITE]: Object.freeze({
    sideEffect: AI_SIDE_EFFECT.LOCAL,
    approvalRequired: true,
    autoRetry: false,
    timeoutMs: 30000
  }),
  [AI_RISK_LEVEL.REMOTE_WRITE]: Object.freeze({
    sideEffect: AI_SIDE_EFFECT.REMOTE,
    approvalRequired: true,
    autoRetry: false,
    timeoutMs: 60000
  }),
  [AI_RISK_LEVEL.CHAIN_WRITE]: Object.freeze({
    sideEffect: AI_SIDE_EFFECT.CHAIN,
    approvalRequired: true,
    autoRetry: false,
    timeoutMs: 120000
  })
})

const TERMINAL_STATUSES = new Set([
  AI_TASK_STATUS.SUCCEEDED,
  AI_TASK_STATUS.FAILED,
  AI_TASK_STATUS.CANCELLED
])

const STATUS_TRANSITIONS = Object.freeze({
  [AI_TASK_STATUS.PLANNED]: Object.freeze([
    AI_TASK_STATUS.RUNNING,
    AI_TASK_STATUS.CANCELLED
  ]),
  [AI_TASK_STATUS.RUNNING]: Object.freeze([
    AI_TASK_STATUS.WAITING_FOR_USER,
    AI_TASK_STATUS.SUCCEEDED,
    AI_TASK_STATUS.FAILED,
    AI_TASK_STATUS.CANCELLED,
    AI_TASK_STATUS.UNCERTAIN
  ]),
  [AI_TASK_STATUS.WAITING_FOR_USER]: Object.freeze([
    AI_TASK_STATUS.RUNNING,
    AI_TASK_STATUS.FAILED,
    AI_TASK_STATUS.CANCELLED,
    AI_TASK_STATUS.UNCERTAIN
  ]),
  [AI_TASK_STATUS.UNCERTAIN]: Object.freeze([
    AI_TASK_STATUS.RUNNING,
    AI_TASK_STATUS.SUCCEEDED,
    AI_TASK_STATUS.FAILED,
    AI_TASK_STATUS.CANCELLED
  ]),
  [AI_TASK_STATUS.SUCCEEDED]: Object.freeze([]),
  [AI_TASK_STATUS.FAILED]: Object.freeze([]),
  [AI_TASK_STATUS.CANCELLED]: Object.freeze([])
})

const assertNonEmptyString = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`)
  return value.trim()
}

const assertTimestamp = (value, field) => {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a non-negative finite timestamp`)
  return value
}

const assertStatus = (status) => {
  if (!Object.values(AI_TASK_STATUS).includes(status)) throw new TypeError(`Unknown AI task status: ${status}`)
  return status
}

const sanitizeArtifact = (artifact) => {
  if (!artifact || typeof artifact !== 'object') throw new TypeError('artifact must be an object')
  return Object.freeze({
    type: assertNonEmptyString(artifact.type, 'artifact.type'),
    label: assertNonEmptyString(artifact.label, 'artifact.label'),
    ref: assertNonEmptyString(artifact.ref, 'artifact.ref')
  })
}

export const isTerminalTaskStatus = (status) => TERMINAL_STATUSES.has(assertStatus(status))

export const canTransitionTaskStatus = (from, to) => {
  assertStatus(from)
  assertStatus(to)
  return STATUS_TRANSITIONS[from].includes(to)
}

export const transitionTaskStatus = (task, nextStatus, now = Date.now()) => {
  if (!task || typeof task !== 'object') throw new TypeError('task must be an object')
  const current = assertStatus(task.status)
  assertStatus(nextStatus)
  assertTimestamp(now, 'now')
  if (!canTransitionTaskStatus(current, nextStatus)) {
    throw new Error(`Invalid AI task transition: ${current} -> ${nextStatus}`)
  }
  return Object.freeze({ ...task, status: nextStatus, updatedAt: now })
}

const sanitizeTaskEntrySnapshot = (entry) => {
  if (entry == null) return null
  if (!entry || typeof entry !== 'object') throw new TypeError('task entry snapshot must be an object')
  const source = entry.context && typeof entry.context === 'object' ? entry.context : {}
  const context = {}
  for (const [field, max] of Object.entries({ contractAddress: 80, transactionHash: 80, contractName: 80, network: 32 })) {
    if (source[field] != null && String(source[field]).trim()) context[field] = String(source[field]).trim().slice(0, max)
  }
  return Object.freeze({
    schemaVersion: Number.isFinite(entry.schemaVersion) ? entry.schemaVersion : 1,
    entryId: assertNonEmptyString(entry.entryId, 'task entry snapshot entryId').slice(0, 100),
    source: assertNonEmptyString(entry.source, 'task entry snapshot source').slice(0, 32),
    context: Object.freeze(context)
  })
}

export const resumeAITask = (task, now = Date.now()) => {
  if (!task || typeof task !== 'object') throw new TypeError('task must be an object')
  const status = assertStatus(task.status)
  assertTimestamp(now, 'now')
  if (![AI_TASK_STATUS.PLANNED, AI_TASK_STATUS.RUNNING, AI_TASK_STATUS.WAITING_FOR_USER, AI_TASK_STATUS.FAILED, AI_TASK_STATUS.UNCERTAIN].includes(status)) {
    throw new Error(`AI task cannot be resumed from: ${status}`)
  }
  return Object.freeze({ ...task, status: AI_TASK_STATUS.RUNNING, updatedAt: now })
}

export const createAITask = ({ taskId, goal, source = 'chat', workspace = null, branch = null, entry = null, now = Date.now() }) => {
  assertTimestamp(now, 'now')
  return Object.freeze({
    schemaVersion: AI_TASK_SCHEMA_VERSION,
    taskId: assertNonEmptyString(taskId, 'taskId'),
    goal: assertNonEmptyString(goal, 'goal'),
    source: assertNonEmptyString(source, 'source'),
    workspace: workspace == null ? null : assertNonEmptyString(workspace, 'workspace'),
    branch: branch == null ? null : assertNonEmptyString(branch, 'branch'),
    entry: sanitizeTaskEntrySnapshot(entry),
    status: AI_TASK_STATUS.PLANNED,
    createdAt: now,
    updatedAt: now,
    steps: Object.freeze([]),
    artifacts: Object.freeze([])
  })
}

export const createAITaskStep = ({ taskId, stepId, toolName, riskLevel, inputSummary = '', now = Date.now() }) => {
  assertTimestamp(now, 'now')
  const policy = AI_RISK_POLICY_DEFAULTS[riskLevel]
  if (!policy) throw new TypeError(`Unknown AI risk level: ${riskLevel}`)
  return Object.freeze({
    schemaVersion: AI_TASK_SCHEMA_VERSION,
    taskId: assertNonEmptyString(taskId, 'taskId'),
    stepId: assertNonEmptyString(stepId, 'stepId'),
    toolName: assertNonEmptyString(toolName, 'toolName'),
    riskLevel,
    sideEffect: policy.sideEffect,
    status: AI_STEP_STATUS.PLANNED,
    inputSummary: typeof inputSummary === 'string' ? inputSummary : String(inputSummary),
    createdAt: now,
    updatedAt: now
  })
}

export const normalizeToolResult = (result) => {
  if (!result || typeof result !== 'object') throw new TypeError('tool result must be a canonical structured object')
  if (typeof result.ok !== 'boolean') throw new TypeError('tool result ok must be a boolean')

  const code = assertNonEmptyString(result.code || (result.ok ? 'OK' : AI_TOOL_ERROR_CODE.INTERNAL_ERROR), 'tool result code')
  const summary = assertNonEmptyString(result.summary, 'tool result summary')
  const normalized = {
    ok: result.ok,
    code,
    summary,
    retryable: result.retryable === true,
    artifacts: Object.freeze((result.artifacts || []).map(sanitizeArtifact))
  }
  if (Object.prototype.hasOwnProperty.call(result, 'data')) normalized.data = result.data
  if (result.userAction != null) normalized.userAction = assertNonEmptyString(result.userAction, 'tool result userAction')
  if (result.uncertainty != null) normalized.uncertainty = assertNonEmptyString(result.uncertainty, 'tool result uncertainty')
  return Object.freeze(normalized)
}

export const createToolSuccessResult = (options = {}) => {
  const { summary, data, artifacts = [] } = options
  return normalizeToolResult({
    ok: true,
    code: 'OK',
    summary,
    retryable: false,
    ...(Object.prototype.hasOwnProperty.call(options, 'data') ? { data } : {}),
    artifacts
  })
}

export const createToolErrorResult = ({ code = AI_TOOL_ERROR_CODE.INTERNAL_ERROR, summary, retryable = false, userAction, uncertainty, artifacts = [] }) => {
  if (!Object.values(AI_TOOL_ERROR_CODE).includes(code)) throw new TypeError(`Unknown AI tool error code: ${code}`)
  return normalizeToolResult({
    ok: false,
    code,
    summary,
    retryable,
    userAction,
    uncertainty,
    artifacts
  })
}
