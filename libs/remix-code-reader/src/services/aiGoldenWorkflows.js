/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

export const AI_GOLDEN_WORKFLOW_SCHEMA_VERSION = 1

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

const phase = (id, title, tools, options = {}) => ({
  id,
  title,
  tools,
  optional: options.optional === true,
  acceptance: options.acceptance || ''
})

export const AI_GOLDEN_WORKFLOWS = deepFreeze([
  {
    schemaVersion: AI_GOLDEN_WORKFLOW_SCHEMA_VERSION,
    id: 'wf-code-test',
    number: 'WF-1',
    title: 'Edit, compile, and test',
    entryId: 'home-code-test',
    skillId: 'trc20-code-test',
    resultFields: ['changed files', 'compiler version', 'test result'],
    phases: [
      phase('inspect', 'Understand and inspect the workspace', ['search_workspace', 'read_current_file', 'read_file', 'list_files'], { acceptance: 'At least one real source location is inspected.' }),
      phase('change', 'Apply a reviewed minimal change', ['edit_file', 'create_file'], { acceptance: 'A local write receives approval and remains undoable.' }),
      phase('diff', 'Show the resulting diff', ['git_diff'], { acceptance: 'The exact changed files and lines are visible.' }),
      phase('compile', 'Compile with an explicit compiler', ['compile_contract'], { acceptance: 'The actual compiler result and version are reported.' }),
      phase('test', 'Run focused tests', ['run_tests'], { acceptance: 'The focused test result or exact failing case is reported.' })
    ]
  },
  {
    schemaVersion: AI_GOLDEN_WORKFLOW_SCHEMA_VERSION,
    id: 'wf-nile-deploy',
    number: 'WF-2',
    title: 'Nile deploy and interact',
    entryId: 'home-nile-deploy',
    skillId: 'tronlink-nile-deploy',
    resultFields: ['verified network', 'contract address', 'transaction status', 'read result'],
    phases: [
      phase('compile', 'Compile one deployable artifact', ['compile_contract']),
      phase('select', 'Select the exact compiled contract', ['list_deployable_contracts']),
      phase('environment', 'Verify network, wallet, and account', ['get_environment']),
      phase('preflight', 'Preflight without broadcasting', ['preflight_transaction']),
      phase('deploy', 'Approve, sign, and deploy', ['deploy_contract']),
      phase('status', 'Resolve the same transaction', ['get_transaction_status'], { acceptance: 'A broadcast timeout stays uncertain and is queried, never retried blindly.' }),
      phase('read', 'Verify one read interaction', ['read_contract']),
      phase('write', 'Optionally verify one approved write', ['write_contract'], { optional: true })
    ]
  },
  {
    schemaVersion: AI_GOLDEN_WORKFLOW_SCHEMA_VERSION,
    id: 'wf-tronscan-verification',
    number: 'WF-3',
    title: 'Deployment to TronScan verification material',
    entryId: 'home-tronscan-verification',
    skillId: 'tronscan-verification',
    resultFields: ['address and network', 'source root', 'compiler settings', 'verification state', 'artifact path'],
    phases: [
      phase('bind', 'Bind address, network, source, and settings', ['read_current_file', 'read_file', 'search_workspace']),
      phase('compile', 'Prove compiler and optimizer inputs', ['compile_contract']),
      phase('query', 'Query the real TronScan state', ['check_verification']),
      phase('prepare', 'Prepare reviewed verification material', ['prepare_verification']),
      phase('diff', 'Show generated local files', ['git_diff'])
    ]
  },
  {
    schemaVersion: AI_GOLDEN_WORKFLOW_SCHEMA_VERSION,
    id: 'wf-recorder-tronbox',
    number: 'WF-4',
    title: 'Recorder to TronBox handoff',
    entryId: 'home-recorder-tronbox',
    skillId: 'recorder-tronbox-handoff',
    resultFields: ['scenario transaction count', 'environment', 'compiler version', 'export path', 'compatibility TODOs'],
    phases: [
      phase('inspect', 'Inspect the Recorder scenario and environment', ['get_environment', 'read_file', 'list_files']),
      phase('save', 'Save the live scenario after approval', ['save_recording']),
      phase('replay', 'Replay-check without hiding failures', ['replay_recording']),
      phase('export', 'Export a deterministic TronBox project', ['export_tronbox']),
      phase('diff', 'Show the complete handoff diff', ['git_diff'])
    ],
    externalGate: 'A fixed published TronBox version must compile and validate the exported fixture in P0-11.'
  }
])

const WORKFLOW_BY_ID = new Map(AI_GOLDEN_WORKFLOWS.map((workflow) => [workflow.id, workflow]))
const WORKFLOW_BY_ENTRY = new Map(AI_GOLDEN_WORKFLOWS.map((workflow) => [workflow.entryId, workflow]))

export const getGoldenWorkflow = (id) => WORKFLOW_BY_ID.get(String(id || '').trim()) || null
export const getGoldenWorkflowForEntry = (entryId) => WORKFLOW_BY_ENTRY.get(String(entryId || '').trim()) || null

const clip = (value, max = 500) => String(value == null ? '' : value)
  .split('')
  .filter((character) => character.charCodeAt(0) >= 32 || character === '\n' || character === '\t')
  .join('')
  .replace(/\b(?:sk|key|token)-[A-Za-z0-9._-]{12,}\b/gi, '[REDACTED]')
  .replace(/\b(?:authorization|api[_ -]?key|token)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
  .trim()
  .slice(0, max)

const normalizeStep = (event) => ({
  stepId: clip(event?.stepId, 200),
  toolName: clip(event?.toolName, 100),
  status: clip(event?.status, 40),
  result: event?.result && typeof event.result === 'object'
    ? {
      ok: event.result.ok === true,
      code: clip(event.result.code || (event.result.ok ? 'OK' : 'INTERNAL_ERROR'), 80),
      summary: clip(event.result.summary, 1000),
      userAction: clip(event.result.userAction, 500),
      uncertainty: clip(event.result.uncertainty, 500),
      data: event.result.data && typeof event.result.data === 'object' ? event.result.data : null,
      artifacts: Array.isArray(event.result.artifacts) ? event.result.artifacts.slice(0, 20).map((artifact) => ({
        type: clip(artifact?.type || 'artifact', 80),
        label: clip(artifact?.label || artifact?.ref || 'Artifact', 200),
        ref: clip(artifact?.ref, 1000)
      })).filter((artifact) => artifact.ref) : []
    }
    : null
})

const workflowFailureNextAction = (evidence) => {
  const failed = evidence.find((item) => item.status === 'failed' || item.status === 'uncertain')
  if (failed?.userAction) return failed.userAction
  if (failed) return `Resolve ${failed.title}, inspect its evidence, and continue only the remaining read-only or explicitly approved phases.`
  const missing = evidence.find((item) => item.status === 'missing')
  if (missing?.userAction) return missing.userAction
  return missing ? `Continue with ${missing.title}; do not claim the workflow completed until its real tool evidence exists.` : ''
}

export const createGoldenWorkflowResult = ({ workflowId, stepEvents = [], taskStatus = 'succeeded' } = {}) => {
  const workflow = getGoldenWorkflow(workflowId)
  if (!workflow) throw new TypeError(`Unknown Golden Workflow: ${String(workflowId || '')}`)
  const finished = (Array.isArray(stepEvents) ? stepEvents : [])
    .filter((event) => event?.type === 'step.finished' && event.toolName)
    .map(normalizeStep)
  let cursor = 0
  const evidence = []
  const artifacts = []

  for (const definition of workflow.phases) {
    const candidates = finished.slice(cursor)
      .map((step, relative) => ({ step, index: cursor + relative }))
      .filter(({ step }) => definition.tools.includes(step.toolName))
    if (!candidates.length) {
      evidence.push({
        phaseId: definition.id,
        title: definition.title,
        optional: definition.optional,
        status: definition.optional ? 'optional' : 'missing',
        toolName: '',
        summary: definition.optional ? 'Optional phase was not requested.' : 'No ordered runtime evidence was recorded.',
        userAction: ''
      })
      continue
    }
    // A resumed task may retry the same phase after a persisted NOT_READY or
    // failed result. Prefer the first later successful retry; otherwise retain
    // the newest failed evidence. The cursor still enforces phase order, so a
    // retry after a later phase cannot make an out-of-order workflow complete.
    const selected = candidates.find(({ step }) => step.status === 'succeeded' && step.result?.ok) || candidates[candidates.length - 1]
    const step = selected.step
    cursor = selected.index + 1
    let status = 'passed'
    if (step.status === 'uncertain' || step.result?.uncertainty || step.result?.code === 'TX_UNKNOWN') status = 'uncertain'
    else if (step.status === 'waiting_for_user' || ['NOT_READY', 'NETWORK_UNAVAILABLE', 'WALLET_LOCKED'].includes(step.result?.code)) status = 'missing'
    else if (step.status !== 'succeeded' || !step.result?.ok) status = 'failed'
    evidence.push({
      phaseId: definition.id,
      title: definition.title,
      optional: definition.optional,
      status,
      toolName: step.toolName,
      summary: step.result?.summary || `${step.toolName} ${step.status || 'finished'}.`,
      userAction: step.result?.userAction || ''
    })
    for (const artifact of (step.result?.artifacts || [])) {
      if (!artifacts.some((item) => item.type === artifact.type && item.ref === artifact.ref)) artifacts.push(artifact)
    }
  }

  const required = evidence.filter((item) => !item.optional)
  const passed = required.filter((item) => item.status === 'passed').length
  const hasUncertainty = taskStatus === 'uncertain' || required.some((item) => item.status === 'uncertain')
  const hasFailure = taskStatus === 'failed' || required.some((item) => item.status === 'failed')
  const cancelled = taskStatus === 'cancelled'
  const missing = required.some((item) => item.status === 'missing')
  const status = hasUncertainty ? 'uncertain' : (cancelled ? 'cancelled' : (hasFailure ? 'failed' : (missing ? 'incomplete' : 'completed')))
  const summary = status === 'completed'
    ? `${workflow.number} completed with ordered evidence for all ${required.length} required phases.`
    : `${workflow.number} ${status}: ${passed}/${required.length} required phases have successful ordered evidence.`
  const nextAction = status === 'completed'
    ? (workflow.externalGate || 'Review the result fields and artifacts before handing off the task.')
    : workflowFailureNextAction(evidence)

  return deepFreeze({
    schemaVersion: AI_GOLDEN_WORKFLOW_SCHEMA_VERSION,
    workflowId: workflow.id,
    number: workflow.number,
    title: workflow.title,
    status,
    summary,
    completion: { passed, required: required.length },
    resultFields: [...workflow.resultFields],
    evidence,
    artifacts: artifacts.slice(0, 50),
    nextAction
  })
}

// A model finishing its reply is not proof that a workflow finished. Resolve
// the task status from ordered runtime evidence so a clarification request or
// a partial plan remains waiting instead of being labelled successful.
export const evaluateGoldenWorkflowRun = ({ workflowId, stepEvents = [], taskStatus = 'running' } = {}) => {
  const workflowResult = createGoldenWorkflowResult({ workflowId, stepEvents, taskStatus })
  let resolvedTaskStatus = 'waiting_for_user'
  if (workflowResult.status === 'completed') resolvedTaskStatus = 'succeeded'
  else if (workflowResult.status === 'uncertain') resolvedTaskStatus = 'uncertain'
  else if (workflowResult.status === 'failed') resolvedTaskStatus = 'failed'
  else if (workflowResult.status === 'cancelled') resolvedTaskStatus = 'cancelled'
  return deepFreeze({ taskStatus: resolvedTaskStatus, workflowResult })
}
