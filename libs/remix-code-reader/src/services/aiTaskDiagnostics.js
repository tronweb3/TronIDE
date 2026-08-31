/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

export const AI_TASK_DIAGNOSTIC_SCHEMA_VERSION = 1

const ARTIFACT_TYPES = new Set(['analysis', 'contract', 'diff', 'file', 'report', 'test', 'transaction', 'url', 'verification', 'workspace'])
const TASK_STATUSES = new Set(['planned', 'running', 'waiting_for_user', 'succeeded', 'failed', 'cancelled', 'uncertain'])
const RISK_LEVELS = new Set(['R0', 'R1', 'R2', 'R3'])
const SIDE_EFFECTS = new Set(['none', 'local', 'remote', 'chain'])

const clip = (value, max) => String(value == null ? '' : value).slice(0, max)

const finiteTime = (value) => Number.isFinite(value) ? value : null

const isoTime = (value) => {
  const time = finiteTime(value)
  if (time == null) return null
  try { return new Date(time).toISOString() } catch (_) { return null }
}

const duration = (start, end) => {
  const from = finiteTime(start)
  const to = finiteTime(end)
  return from == null || to == null ? null : Math.max(0, to - from)
}

// Diagnostics are intended for issue attachments, so they fail closed on
// credential-shaped text. A bare 32-byte hex string is omitted from arbitrary
// text because a TRON private key and a transaction hash cannot be reliably
// distinguished without trusted field context. Artifact URLs use the stricter
// URL sanitizer below, which can preserve a public transaction path safely.
const redactCredentialShapes = (value, redactAmbiguousHex = true) => String(value == null ? '' : value)
  .replace(/-----BEGIN[\s\S]{0,4096}?PRIVATE KEY-----[\s\S]{0,4096}?-----END[\s\S]{0,80}?PRIVATE KEY-----/gi, '[private key redacted]')
  .replace(/\b(api[_-]?key|token|secret|authorization|private[_ -]?key|mnemonic|seed[_ -]?phrase|password|passwd)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .replace(/\b(Bearer|Basic)\s+[^\s]+/gi, '$1 [redacted]')
  .replace(/\b(?:sk|xai|ghp|gho|github_pat|AIza)-?[A-Za-z0-9_\-]{12,}\b/g, '[credential redacted]')
  .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[credentials-redacted]@')
  .replace(redactAmbiguousHex ? /\b(?:0x)?[a-fA-F0-9]{64}\b/g : /$^/, '[32-byte value redacted]')

export const redactAITaskDiagnosticText = (value, max = 1000) => redactCredentialShapes(clip(value, max))

const safeErrorCode = (value, fallback = 'INTERNAL_ERROR') => {
  const code = redactAITaskDiagnosticText(value, 80)
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : fallback
}

const safeToken = (value, fallback, max = 120) => {
  const token = redactAITaskDiagnosticText(value, max)
  return /^[a-z][a-z0-9_.:-]*$/.test(token) ? token : fallback
}

const safeOpaqueId = (value, fallback, max = 200) => {
  const id = redactAITaskDiagnosticText(value, max).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '')
  return id || fallback
}

const safeStatus = (value) => TASK_STATUSES.has(value) ? value : 'uncertain'

const safeRiskLevel = (value) => RISK_LEVELS.has(value) ? value : ''

const safeSideEffect = (value) => SIDE_EFFECTS.has(value) ? value : ''

const sanitizeUrlParams = (params) => {
  for (const key of [...params.keys()]) {
    const value = params.get(key) || ''
    params.set(key, /(api[_-]?key|token|secret|authorization|password|signature)/i.test(key) ? '[redacted]' : redactCredentialShapes(value, false))
  }
}

const sanitizeUrlHash = (hash) => {
  if (!hash) return ''
  const fragment = hash.slice(1)
  const queryIndex = fragment.indexOf('?')
  const rawRoute = queryIndex < 0 ? fragment : fragment.slice(0, queryIndex)
  let route = rawRoute
  try { route = encodeURI(redactCredentialShapes(decodeURIComponent(rawRoute), false)) } catch (_) { route = redactCredentialShapes(rawRoute, false) }
  if (queryIndex < 0) return `#${route}`
  const params = new URLSearchParams(fragment.slice(queryIndex + 1))
  sanitizeUrlParams(params)
  return `#${route}?${params.toString()}`
}

const sanitizeArtifactRef = (value, type) => {
  const raw = clip(value, 2000)
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return redactAITaskDiagnosticText(raw, 2000)
    url.username = ''
    url.password = ''
    sanitizeUrlParams(url.searchParams)
    url.hash = sanitizeUrlHash(url.hash)
    // A block explorer route commonly lives in the URL fragment, where a
    // normal URLSearchParams pass cannot see it. Run the credential-only
    // redactor over the reconstructed URL while deliberately preserving a
    // public 32-byte transaction hash in the trusted artifact URL context.
    return redactCredentialShapes(url.href, false)
  } catch (_) {
    if (type === 'transaction' && /^(?:0x)?[a-fA-F0-9]{64}$/.test(raw)) return raw
    if (type === 'contract' && (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw) || /^0x[a-fA-F0-9]{40}$/.test(raw))) return raw
    // Non-URL artifact references are bounded labels/paths. Apply the same
    // credential patterns but do not preserve ambiguous bare private keys.
    return redactAITaskDiagnosticText(raw, 2000)
  }
}

const sanitizeArtifact = (artifact) => {
  const rawType = String(artifact?.type || '').toLowerCase()
  const type = ARTIFACT_TYPES.has(rawType) ? rawType : 'artifact'
  return {
    type,
    // Artifact labels are presentation text supplied by individual tools and
    // are not required to diagnose execution. Derive a label rather than
    // trusting that text to be free of source code or contract arguments.
    label: `${type === 'artifact' ? 'Generic' : type[0].toUpperCase() + type.slice(1)} artifact`,
    ref: sanitizeArtifactRef(artifact?.ref || '', type)
  }
}

const resultDiagnostic = (result) => {
  if (!result || typeof result !== 'object') return null
  const code = safeErrorCode(result.code, result.ok ? 'OK' : 'INTERNAL_ERROR')
  return {
    ok: result.ok === true,
    code,
    // Raw summaries/userAction/error strings can contain prompts, source code,
    // contract arguments, provider payloads or secrets. Export only a derived
    // outcome; the original text remains local in task history.
    summary: result.ok === true ? 'Step completed.' : `Step ended with ${code}.`,
    retryable: result.retryable === true,
    hasUserAction: !!result.userAction,
    hasUncertainty: !!result.uncertainty,
    artifacts: Array.isArray(result.artifacts) ? result.artifacts.slice(0, 50).map(sanitizeArtifact) : []
  }
}

const stepDiagnostic = (step) => ({
  stepId: safeOpaqueId(step?.stepId, 'omitted', 200),
  toolName: safeToken(step?.toolName, 'unknown_tool', 100),
  status: safeStatus(step?.status),
  riskLevel: safeRiskLevel(step?.riskLevel),
  sideEffect: safeSideEffect(step?.sideEffect),
  startedAt: isoTime(step?.startedAt),
  finishedAt: isoTime(step?.updatedAt),
  durationMs: duration(step?.startedAt, step?.updatedAt),
  result: resultDiagnostic(step?.result)
})

const eventDiagnostic = (event) => {
  const result = resultDiagnostic(event?.result)
  return {
    type: safeToken(event?.type, 'task.event', 120),
    at: isoTime(event?.at),
    stepId: event?.stepId ? safeOpaqueId(event.stepId, 'omitted', 200) : '',
    toolName: event?.toolName ? safeToken(event.toolName, 'unknown_tool', 100) : '',
    status: event?.status ? safeStatus(event.status) : '',
    riskLevel: safeRiskLevel(event?.riskLevel),
    sideEffect: safeSideEffect(event?.sideEffect),
    outcome: event?.outcome ? safeToken(event.outcome, 'unknown', 80) : '',
    approved: typeof event?.approved === 'boolean' ? event.approved : null,
    resultCode: result?.code || null,
    errorCode: event?.errorCode ? safeErrorCode(event.errorCode, 'INTERNAL_ERROR') : null
  }
}

const workflowDiagnostic = (result) => {
  if (!result?.workflowId) return null
  return {
    workflowId: safeToken(result.workflowId, 'unknown_workflow', 100),
    status: safeToken(result.status, 'incomplete', 40),
    completion: {
      passed: Number.isFinite(result.completion?.passed) ? result.completion.passed : 0,
      required: Number.isFinite(result.completion?.required) ? result.completion.required : 0
    }
  }
}

export const createAITaskDiagnostic = (record, {
  appVersion = 'unknown',
  generatedAt = Date.now(),
  includeEventLog = false
} = {}) => {
  if (!record || typeof record !== 'object' || !record.task) throw new TypeError('AI task diagnostic requires a task record')
  const task = record.task
  const eventLogIncluded = includeEventLog === true
  const steps = Array.isArray(record.steps) ? record.steps.slice(0, 200).map(stepDiagnostic) : []
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts.slice(0, 100).map(sanitizeArtifact) : []
  const events = Array.isArray(record.events) ? record.events : []
  const errorCodes = [...new Set([
    ...steps.map((step) => step.result?.code),
    ...events.map((event) => event?.errorCode ? safeErrorCode(event.errorCode, 'INTERNAL_ERROR') : null)
  ].filter((code) => code && code !== 'OK'))]
  const report = {
    schemaVersion: AI_TASK_DIAGNOSTIC_SCHEMA_VERSION,
    reportType: 'tronide-ai-task-diagnostic',
    appVersion: redactAITaskDiagnosticText(appVersion, 80),
    generatedAt: isoTime(generatedAt),
    task: {
      taskId: safeOpaqueId(task.taskId, 'omitted', 200),
      // The task goal is the user's prompt and is intentionally never exported.
      goal: '[omitted — prompts are not exported]',
      source: safeToken(task.source, 'chat', 80),
      status: safeStatus(task.status),
      createdAt: isoTime(task.createdAt),
      updatedAt: isoTime(task.updatedAt),
      durationMs: duration(task.createdAt, task.updatedAt)
    },
    environment: {
      workspace: redactAITaskDiagnosticText(task.workspace || '(not recorded)', 500),
      branch: redactAITaskDiagnosticText(task.branch || '(not recorded)', 500),
      network: '(not recorded in local task history)',
      account: '(not exported)'
    },
    workflow: workflowDiagnostic(record.workflowResult),
    steps,
    errorCodes,
    artifacts,
    privacy: {
      promptIncluded: false,
      sourceCodeIncluded: false,
      contractArgumentsIncluded: false,
      credentialsIncluded: false,
      eventLogIncluded
    }
  }
  if (eventLogIncluded) {
    report.eventLog = {
      totalEvents: events.length,
      exportedEvents: Math.min(events.length, 100),
      maxEvents: 100,
      truncated: events.length > 100
    }
    report.events = events.slice(-100).map(eventDiagnostic)
  }
  return report
}

const markdownCell = (value) => redactAITaskDiagnosticText(value, 1000).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

const markdownArtifactRef = (value) => redactCredentialShapes(clip(value, 2000), false).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

const markdownTime = (value) => value || 'not recorded'

export const serializeAITaskDiagnostic = (report, format = 'json') => {
  if (!report || report.reportType !== 'tronide-ai-task-diagnostic') throw new TypeError('Invalid AI task diagnostic report')
  if (format === 'json') return JSON.stringify(report, null, 2)
  if (format !== 'markdown') throw new TypeError(`Unsupported AI task diagnostic format: ${format}`)
  const rows = (report.steps || []).map((step) => {
    const code = step.result?.code || ''
    return `| ${markdownCell(step.toolName)} | ${markdownCell(step.status)} | ${markdownCell(step.riskLevel)} | ${step.durationMs == null ? '' : step.durationMs} | ${markdownCell(code)} |`
  })
  const artifactRows = (report.artifacts || []).map((artifact) => `| ${markdownCell(artifact.type)} | ${markdownCell(artifact.label)} | ${markdownArtifactRef(artifact.ref)} |`)
  const eventRows = (report.events || []).map((event) => `| ${markdownCell(event.at)} | ${markdownCell(event.type)} | ${markdownCell(event.toolName)} | ${markdownCell(event.status)} | ${markdownCell(event.resultCode || '')} | ${markdownCell(event.errorCode || '')} |`)
  return [
    '# TronIDE AI Task Diagnostic',
    '',
    `- App version: ${markdownCell(report.appVersion)}`,
    `- Generated: ${markdownTime(report.generatedAt)}`,
    `- Task ID: ${markdownCell(report.task?.taskId)}`,
    `- Status: ${markdownCell(report.task?.status)}`,
    `- Duration: ${report.task?.durationMs == null ? 'not recorded' : `${report.task.durationMs} ms`}`,
    '- Goal/prompt: omitted by privacy policy',
    '',
    '## Environment',
    '',
    `- Workspace: ${markdownCell(report.environment?.workspace)}`,
    `- Branch: ${markdownCell(report.environment?.branch)}`,
    `- Network: ${markdownCell(report.environment?.network)}`,
    '- Account: not exported',
    '',
    '## Steps',
    '',
    '| Tool | Status | Risk | Duration (ms) | Result code |',
    '|---|---|---|---:|---|',
    ...(rows.length ? rows : ['| (none) |  |  |  |  |']),
    '',
    `Error codes: ${(report.errorCodes || []).length ? report.errorCodes.map(markdownCell).join(', ') : 'none'}`,
    '',
    '## Artifacts',
    '',
    '| Type | Label | Reference |',
    '|---|---|---|',
    ...(artifactRows.length ? artifactRows : ['| (none) |  |  |']),
    '',
    ...(report.privacy?.eventLogIncluded ? [
      '## Redacted event log',
      '',
      `Latest ${report.eventLog?.exportedEvents || 0} of ${report.eventLog?.totalEvents || 0} events${report.eventLog?.truncated ? ' (truncated)' : ''}.`,
      '',
      '| At | Event | Tool | Status | Result code | Error code |',
      '|---|---|---|---|---|---|',
      ...(eventRows.length ? eventRows : ['|  | (none) |  |  |  |']),
      ''
    ] : []),
    '> Privacy: prompts, source code, contract arguments, credentials, raw provider payloads and raw error text are not included.'
  ].join('\n')
}

export const aiTaskDiagnosticFilename = (report, format = 'json') => {
  const taskId = String(report?.task?.taskId || 'task').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'task'
  const date = String(report?.generatedAt || '').slice(0, 10).replace(/-/g, '') || 'undated'
  const extension = format === 'markdown' ? 'md' : 'json'
  return `tronide-ai-task-${taskId}-${date}.${extension}`
}
