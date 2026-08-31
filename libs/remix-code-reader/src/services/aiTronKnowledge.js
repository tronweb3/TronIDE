/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import { AI_RISK_LEVEL } from './aiTaskProtocol.js'
import { AI_TOOL_POLICIES } from './aiToolPolicies.js'

export const TRON_KNOWLEDGE_SCHEMA_ID = 'tronide.tron-knowledge-pack'
export const TRON_KNOWLEDGE_SCHEMA_VERSION = 1
export const TRON_KNOWLEDGE_TRUSTED_DIR = '.tronide/ai/'

export const TRON_KNOWLEDGE_PACK_SCHEMA = Object.freeze({
  $id: 'tronide://schemas/tron-knowledge-pack/v1',
  type: 'object',
  required: ['schema', 'schemaVersion', 'packVersion', 'skills', 'checklists'],
  properties: Object.freeze({
    schema: Object.freeze({ const: TRON_KNOWLEDGE_SCHEMA_ID }),
    schemaVersion: Object.freeze({ const: TRON_KNOWLEDGE_SCHEMA_VERSION }),
    packVersion: Object.freeze({ type: 'string' }),
    skills: Object.freeze({ type: 'array', minItems: 1 }),
    checklists: Object.freeze({ type: 'array', minItems: 1 })
  }),
  additionalProperties: false
})

const skill = (definition) => ({
  kind: 'skill',
  version: '1.0.0',
  execution: { mode: 'declarative', policy: 'canonical', sideEffects: 'sequential' },
  ...definition
})

const checklist = (definition) => ({
  kind: 'checklist',
  version: '1.0.0',
  execution: { mode: 'declarative', policy: 'canonical', sideEffects: 'none' },
  ...definition
})

const BUILTIN_PACK_SOURCE = {
  schema: TRON_KNOWLEDGE_SCHEMA_ID,
  schemaVersion: TRON_KNOWLEDGE_SCHEMA_VERSION,
  packVersion: '2.3.3',
  skills: [
    skill({
      id: 'trc20-code-test',
      title: 'TRC20 contract development, compile, and test',
      objective: 'Understand or implement a TRC20 contract, show the exact diff, then prove it with the selected TRON compiler and focused tests.',
      inputs: ['workspace', 'target contract or requirement', 'expected TRC20 behavior'],
      allowedTools: ['list_files', 'search_workspace', 'read_current_file', 'read_file', 'create_file', 'edit_file', 'undo_last_change', 'git_diff', 'set_compiler_version', 'compile_contract', 'run_static_analysis', 'run_tests'],
      steps: [
        { id: 'inspect', title: 'Locate the contract and tests', tools: ['list_files', 'search_workspace', 'read_current_file', 'read_file'], evidence: ['source location', 'existing test location'] },
        { id: 'change', title: 'Apply a minimal reviewed change', tools: ['create_file', 'edit_file', 'git_diff'], evidence: ['user-approved write', 'post-change diff'] },
        { id: 'verify', title: 'Compile and run focused quality gates', tools: ['set_compiler_version', 'compile_contract', 'run_static_analysis', 'run_tests'], evidence: ['actual compiler version', 'compile result', 'test result'] },
        { id: 'summarize', title: 'Report artifacts and reversible next steps', tools: ['git_diff'], evidence: ['changed files', 'remaining failures or needs_review items'] }
      ],
      constraints: [
        'Use TVM and TRC20 semantics; do not substitute EVM-only assumptions.',
        'Never claim compilation or tests passed without a successful tool result.',
        'Every file write remains subject to R1 approval, CAS checks, write lock, and Undo.'
      ]
    }),
    skill({
      id: 'tronlink-nile-deploy',
      title: 'TronLink and Nile deployment with interaction',
      objective: 'Compile, prove the exact Nile wallet context, preflight, deploy after approval/signature, resolve the transaction, then verify with read-only interaction.',
      inputs: ['compiled contract', 'constructor arguments', 'Nile TronLink account', 'fee limit'],
      allowedTools: ['compile_contract', 'list_deployable_contracts', 'get_environment', 'list_accounts', 'get_balance', 'preflight_transaction', 'deploy_contract', 'get_transaction_status', 'read_contract', 'write_contract'],
      steps: [
        { id: 'prepare', title: 'Compile and select one deployable artifact', tools: ['compile_contract', 'list_deployable_contracts'], evidence: ['artifact fingerprint', 'compiler version'] },
        { id: 'environment', title: 'Verify Nile, wallet, account, and balance', tools: ['get_environment', 'list_accounts', 'get_balance'], evidence: ['genesis-verified network', 'selected account', 'balance'] },
        { id: 'preflight', title: 'Preflight without broadcasting', tools: ['preflight_transaction'], evidence: ['fee limit', 'blocking issues', 'estimate availability'] },
        { id: 'deploy', title: 'Approve, sign, and resolve the same transaction', tools: ['deploy_contract', 'get_transaction_status'], evidence: ['approval snapshot', 'transaction hash', 'contract address or uncertainty'] },
        { id: 'interact', title: 'Verify a read and offer an optional approved write', tools: ['read_contract', 'write_contract'], evidence: ['method and result', 'separate approval for an optional write'] }
      ],
      constraints: [
        'Treat an explicit workspace contract path or contract name supplied by the user in the current task as the selected target; compile that target directly and do not require the same file to also be open in the editor.',
        'A stale or unknown network blocks deployment; never infer Nile from a hostname.',
        'If Deploy & Run still reports the JavaScript VM, ask ONLY to switch its Environment to Injected TronWeb and re-check. Do not ask the user to unlock, reconnect, or change TronLink networks until the injected environment check proves that specific problem; a VM snapshot says nothing about TronLink state.',
        'A rejected signature stops the task and is never retried automatically.',
        'A broadcast timeout is uncertain: query the same hash before considering another write.',
        'For token contracts, read decimals() before converting totalSupply or balances to display units; never assume 18 decimals, and report raw units when decimals is unavailable.',
        'Mainnet is outside this Skill; if detected, stop and require a new explicit task.'
      ]
    }),
    skill({
      id: 'tronscan-verification',
      title: 'TronScan verification material preparation',
      objective: 'Bind deployment evidence to exact source and compiler settings, query real verification state, and prepare a user-reviewed submission package.',
      inputs: ['network', 'contract address', 'contract name', 'source root', 'compiler and optimizer settings'],
      allowedTools: ['get_environment', 'read_file', 'search_workspace', 'compile_contract', 'check_verification', 'prepare_verification', 'git_diff'],
      steps: [
        { id: 'bind', title: 'Bind address, source root, and compiler settings', tools: ['get_environment', 'read_file', 'search_workspace', 'compile_contract'], evidence: ['network identity', 'source root', 'compiler settings'] },
        { id: 'query', title: 'Query the actual TronScan verification state', tools: ['check_verification'], evidence: ['verified, unverified, missing-address, or network-error result'] },
        { id: 'package', title: 'Prepare reviewable verification artifacts', tools: ['prepare_verification', 'git_diff'], evidence: ['user-approved files', 'artifact paths', 'manual submission checklist'] }
      ],
      constraints: [
        'Do not claim TronScan verification succeeded unless the status query confirms it.',
        'Do not replace TRON addresses or TVM compiler settings with Etherscan/EVM defaults.',
        'Generated files remain R1 writes with approval, write lock, and Undo.'
      ]
    }),
    skill({
      id: 'recorder-tronbox-handoff',
      title: 'Recorder scenario to TronBox handoff',
      objective: 'Inspect and preserve a Recorder scenario, validate replay behavior, export a deterministic TronBox project, and produce an honest compatibility handoff.',
      inputs: ['Recorder scenario', 'environment', 'export directory', 'actual compiler version'],
      allowedTools: ['get_environment', 'save_recording', 'replay_recording', 'export_tronbox', 'list_files', 'read_file', 'git_diff'],
      steps: [
        { id: 'inspect', title: 'Inspect the scenario and environment', tools: ['get_environment', 'list_files', 'read_file'], evidence: ['transaction count', 'environment', 'scenario source'] },
        { id: 'preserve', title: 'Save and replay only after explicit approval', tools: ['save_recording', 'replay_recording'], evidence: ['saved path', 'replay alerts', 'revert or unknown steps'] },
        { id: 'export', title: 'Export the project without dropping unsupported steps', tools: ['export_tronbox', 'git_diff'], evidence: ['export path', 'compiler version', 'TODO markers', 'handoff summary'] }
      ],
      constraints: [
        'Replay is a chain write and always uses R3 approval; live replay is never automatic.',
        'Keep revert or unconvertible steps as explicit TODO items rather than silently dropping them.',
        'TronBox is an export and CI compatibility target, not a browser runtime dependency.'
      ]
    })
  ],
  checklists: [
    checklist({
      id: 'tron-tvm-security-audit',
      title: 'TRON/TVM Security Audit Checklist',
      objective: 'Produce evidence-backed TRON/TVM findings with severity, source location, evidence, and remediation.',
      allowedTools: ['list_files', 'search_workspace', 'read_file', 'compile_contract', 'run_static_analysis', 'run_tests', 'git_diff'],
      rules: [
        { id: 'SEC-AUTH', title: 'Authorization and privileged paths', severity: 'high', verify: 'Trace every owner/admin/role check and sensitive external entry point.' },
        { id: 'SEC-UPGRADE', title: 'Proxy and upgrade safety', severity: 'critical', verify: 'Verify implementation/admin control, initializer protection, storage layout, and upgrade events.' },
        { id: 'SEC-CALL', title: 'External calls and reentrancy', severity: 'high', verify: 'Review call order, callbacks, fallback paths, state updates, and reentrancy protection under TVM behavior.' },
        { id: 'SEC-PRECISION', title: 'Precision, rounding, and token units', severity: 'medium', verify: 'Check SUN/TRX and TRC20 decimals, division order, truncation direction, and economic invariants.' },
        { id: 'SEC-RESOURCE', title: 'Denial of service and resource bounds', severity: 'medium', verify: 'Identify unbounded work, expensive storage, revert propagation, and resource-exhaustion paths.' },
        { id: 'SEC-NETWORK', title: 'Network, address, and Mainnet configuration', severity: 'high', verify: 'Verify Base58/hex conversion, exact network identity, endpoints, fee limits, and Mainnet safeguards.' }
      ],
      constraints: [
        'A passed or finding status requires a source location or tool-evidence reference.',
        'If evidence is incomplete, use needs_review rather than guessing.',
        'Do not import EVM-only gas, Etherscan, Foundry, or OpenZeppelin conclusions without TVM/TRON verification.'
      ]
    }),
    checklist({
      id: 'energy-bandwidth-optimization',
      title: 'Energy and Bandwidth Optimization Checklist',
      objective: 'Identify measurable TVM resource costs and propose verifiable optimizations without inventing energy estimates.',
      allowedTools: ['list_files', 'search_workspace', 'read_file', 'compile_contract', 'run_static_analysis', 'run_tests', 'get_environment', 'preflight_transaction', 'git_diff'],
      rules: [
        { id: 'RES-STORAGE', title: 'Persistent storage writes', severity: 'high', verify: 'Find repeated or avoidable storage writes and prove state-equivalent reductions.' },
        { id: 'RES-LOOPS', title: 'Loop and collection bounds', severity: 'high', verify: 'Trace user-controlled iteration, nested loops, and growing arrays or mappings.' },
        { id: 'RES-CALLS', title: 'External call and event cost', severity: 'medium', verify: 'Review external calls, return-data handling, event payload size, and failure behavior.' },
        { id: 'RES-BANDWIDTH', title: 'Transaction and calldata bandwidth', severity: 'medium', verify: 'Review argument encoding, batch size, event data, and transaction count.' },
        { id: 'RES-FEELIMIT', title: 'Fee limit and resource assumptions', severity: 'high', verify: 'Use an actual preflight when available; disclose unavailable estimates and never invent a number.' },
        { id: 'RES-REGRESSION', title: 'Optimization regression proof', severity: 'medium', verify: 'Compile and test the same behavior before accepting an optimization.' }
      ],
      constraints: [
        'Energy is not EVM gas; use TVM evidence and label unavailable estimates.',
        'Every recommendation includes a measurement or a needs_review status.',
        'The checklist is read-only and cannot apply optimizations itself.'
      ]
    })
  ]
}

const plainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
const cleanString = (value, max = 1000) => String(value == null ? '' : value).trim().slice(0, max)
const versionPattern = /^\d+\.\d+\.\d+$/
const idPattern = /^[a-z0-9][a-z0-9-]{2,63}$/
const forbiddenKeys = new Set(['code', 'execute', 'handler', 'script', 'remote', 'download', 'mcpServer', 'url', '__proto__', 'prototype', 'constructor'])

const cloneJson = (value) => JSON.parse(JSON.stringify(value))
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

const findForbiddenContent = (value, path = '$', errors = [], seen = new WeakSet(), depth = 0) => {
  if (typeof value === 'function') errors.push(`${path} contains executable code.`)
  if (!value || typeof value !== 'object') return errors
  if (depth > 32) { errors.push(`${path} exceeds the maximum knowledge-pack depth.`); return errors }
  if (seen.has(value)) { errors.push(`${path} contains a cyclic reference.`); return errors }
  seen.add(value)
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) errors.push(`${path}.${key} is not allowed in a declarative knowledge pack.`)
    findForbiddenContent(child, `${path}.${key}`, errors, seen, depth + 1)
  }
  return errors
}

const validateKnowledgeItem = (item, kind, availableTools, seenIds, errors) => {
  const at = `${kind}:${cleanString(item?.id) || '(missing id)'}`
  if (!plainObject(item)) { errors.push(`${at} must be an object.`); return }
  if (item.kind !== kind) errors.push(`${at} has the wrong kind.`)
  if (!idPattern.test(item.id || '')) errors.push(`${at} has an invalid id.`)
  if (seenIds.has(item.id)) errors.push(`${at} duplicates another knowledge id.`)
  seenIds.add(item.id)
  if (!versionPattern.test(item.version || '')) errors.push(`${at} has an invalid semantic version.`)
  if (!cleanString(item.title) || !cleanString(item.objective)) errors.push(`${at} requires title and objective.`)
  if (item.execution?.mode !== 'declarative' || item.execution?.policy !== 'canonical') errors.push(`${at} must use declarative canonical execution.`)
  if (kind === 'skill' && item.execution?.sideEffects !== 'sequential') errors.push(`${at} must execute side effects sequentially.`)
  if (kind === 'checklist' && item.execution?.sideEffects !== 'none') errors.push(`${at} must remain read-only.`)
  const allowedTools = Array.isArray(item.allowedTools) ? item.allowedTools : []
  if (!allowedTools.length) errors.push(`${at} requires allowedTools.`)
  for (const toolName of allowedTools) {
    if (!availableTools.has(toolName)) errors.push(`${at} references unknown tool ${toolName}.`)
    if (kind === 'checklist' && AI_TOOL_POLICIES[toolName]?.riskLevel !== AI_RISK_LEVEL.READ_ONLY) errors.push(`${at} cannot allow side-effect tool ${toolName}.`)
  }
  const details = kind === 'skill' ? item.steps : item.rules
  if (!Array.isArray(details) || !details.length) errors.push(`${at} requires ${kind === 'skill' ? 'steps' : 'rules'}.`)
  if (kind === 'skill' && Array.isArray(details)) {
    for (const step of details) {
      if (!idPattern.test(step?.id || '') || !cleanString(step?.title)) errors.push(`${at} has an invalid step.`)
      if (!Array.isArray(step?.tools) || step.tools.some((toolName) => !allowedTools.includes(toolName))) errors.push(`${at} step ${step?.id || '(missing)'} uses a tool outside allowedTools.`)
      if (!Array.isArray(step?.evidence) || !step.evidence.length) errors.push(`${at} step ${step?.id || '(missing)'} requires evidence declarations.`)
    }
  }
  if (kind === 'checklist' && Array.isArray(details)) {
    const ruleIds = new Set()
    for (const rule of details) {
      if (!/^[A-Z][A-Z0-9-]{2,63}$/.test(rule?.id || '') || !cleanString(rule?.title) || !cleanString(rule?.verify)) errors.push(`${at} has an invalid rule.`)
      if (ruleIds.has(rule?.id)) errors.push(`${at} duplicates rule ${rule.id}.`)
      ruleIds.add(rule?.id)
    }
  }
  if (!Array.isArray(item.constraints) || !item.constraints.length) errors.push(`${at} requires safety constraints.`)
}

export const validateTronKnowledgePack = (candidate, { availableTools = Object.keys(AI_TOOL_POLICIES) } = {}) => {
  const errors = []
  if (!plainObject(candidate)) return Object.freeze({ ok: false, code: 'INVALID_PACK', errors: ['Knowledge pack must be an object.'] })
  const topLevelKeys = new Set(['schema', 'schemaVersion', 'packVersion', 'skills', 'checklists'])
  for (const key of Object.keys(candidate)) {
    if (!topLevelKeys.has(key)) errors.push(`Unknown top-level knowledge-pack field: ${key}.`)
  }
  if (candidate.schema !== TRON_KNOWLEDGE_SCHEMA_ID) errors.push(`Unsupported schema: ${cleanString(candidate.schema) || '(missing)'}.`)
  if (candidate.schemaVersion !== TRON_KNOWLEDGE_SCHEMA_VERSION) errors.push(`Unsupported schema version: ${cleanString(candidate.schemaVersion) || '(missing)'}.`)
  if (!versionPattern.test(candidate.packVersion || '')) errors.push('packVersion must use semantic versioning.')
  const available = new Set((Array.isArray(availableTools) ? availableTools : []).filter((toolName) => AI_TOOL_POLICIES[toolName]))
  const seenIds = new Set()
  if (!Array.isArray(candidate.skills) || !candidate.skills.length) errors.push('At least one Skill is required.')
  else for (const item of candidate.skills) validateKnowledgeItem(item, 'skill', available, seenIds, errors)
  if (!Array.isArray(candidate.checklists) || !candidate.checklists.length) errors.push('At least one Checklist is required.')
  else for (const item of candidate.checklists) validateKnowledgeItem(item, 'checklist', available, seenIds, errors)
  findForbiddenContent(candidate, '$', errors)
  if (errors.length) return Object.freeze({ ok: false, code: candidate.schemaVersion === TRON_KNOWLEDGE_SCHEMA_VERSION ? 'INVALID_PACK' : 'UNSUPPORTED_VERSION', errors: Object.freeze(errors) })
  const pack = deepFreeze(cloneJson(candidate))
  return Object.freeze({ ok: true, code: 'OK', pack, errors: Object.freeze([]) })
}

const builtInValidation = validateTronKnowledgePack(BUILTIN_PACK_SOURCE)
if (!builtInValidation.ok) throw new Error(`Invalid built-in TRON knowledge pack: ${builtInValidation.errors.join(' ')}`)
export const BUILTIN_TRON_KNOWLEDGE_PACK = builtInValidation.pack

export const getTronKnowledgeItem = (id, pack = BUILTIN_TRON_KNOWLEDGE_PACK) => {
  const wanted = cleanString(id, 64)
  return [...(pack?.skills || []), ...(pack?.checklists || [])].find((item) => item.id === wanted) || null
}

export const isTrustedTronKnowledgePath = (value) => {
  const path = cleanString(value, 300).replace(/\\/g, '/')
  const hasControlCharacter = [...path].some((character) => character.charCodeAt(0) < 32)
  if (!path || hasControlCharacter || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '')) return false
  return path.startsWith(TRON_KNOWLEDGE_TRUSTED_DIR) && path.endsWith('.json')
}

const loadFailure = (code, message, path) => Object.freeze({
  ok: false,
  code,
  message: redactKnowledgeText(message),
  path: redactKnowledgeText(path, 300),
  pack: null
})

export const loadTrustedWorkspaceTronKnowledgePack = async ({ path, readFile, maxBytes = 256 * 1024 } = {}) => {
  if (!isTrustedTronKnowledgePath(path)) return loadFailure('UNTRUSTED_PATH', `Workspace knowledge packs must be JSON files under ${TRON_KNOWLEDGE_TRUSTED_DIR}`, path)
  if (typeof readFile !== 'function') return loadFailure('NOT_READY', 'Workspace file reader is unavailable.', path)
  try {
    const content = await readFile(path)
    if (typeof content !== 'string') return loadFailure('CORRUPT_PACK', 'Workspace knowledge pack is not text JSON.', path)
    if (new TextEncoder().encode(content).byteLength > maxBytes) return loadFailure('PACK_TOO_LARGE', `Workspace knowledge pack exceeds ${maxBytes} bytes.`, path)
    let parsed
    try { parsed = JSON.parse(content) } catch (_) { return loadFailure('CORRUPT_PACK', 'Workspace knowledge pack contains invalid JSON.', path) }
    const validation = validateTronKnowledgePack(parsed)
    if (!validation.ok) return loadFailure(validation.code, validation.errors.join(' '), path)
    return Object.freeze({ ok: true, code: 'OK', message: 'Trusted workspace knowledge pack loaded.', path: cleanString(path, 300), pack: validation.pack })
  } catch (error) {
    return loadFailure('PACK_MISSING', `Workspace knowledge pack could not be read: ${error?.message || error}`, path)
  }
}

export const buildTronKnowledgePrompt = (pack = BUILTIN_TRON_KNOWLEDGE_PACK) => {
  const validation = validateTronKnowledgePack(pack)
  if (!validation.ok) return ''
  const lines = [
    '\n\nTRONIDE TRUSTED TRON KNOWLEDGE PACK (declarative, read-only metadata):',
    'A Skill constrains planning only. It never executes code or bypasses the canonical Tool Runtime, R0-R3 Policy Gate, approval snapshot, or write lock.',
    'When the user names or starts a matching task, follow that item\'s declared order and allowed tools. For any unsupported or unverified claim, report needs_review.'
  ]
  for (const item of [...validation.pack.skills, ...validation.pack.checklists]) {
    lines.push(`- ${item.kind.toUpperCase()} ${item.id}: ${item.objective}`)
    lines.push(`  allowed tools: ${item.allowedTools.join(', ')}`)
    lines.push(`  constraints: ${item.constraints.join(' ')}`)
    if (item.kind === 'skill') {
      item.steps.forEach((step, index) => lines.push(`  step ${index + 1} ${step.id}: ${step.title}; tools: ${step.tools.join(', ')}; required evidence: ${step.evidence.join(', ')}`))
    } else {
      item.rules.forEach((rule) => lines.push(`  rule ${rule.id} (${rule.severity}): ${rule.title}; verify: ${rule.verify}`))
    }
  }
  lines.push('Checklist findings must contain ruleId, severity, location, evidence, remediation, and status. Passed/finding without traceable evidence becomes needs_review.')
  return lines.join('\n')
}

const redactKnowledgeText = (value, max = 1000) => cleanString(value, max)
  .replace(/\b(api[_-]?key|token|secret|authorization|private[_ -]?key|mnemonic|seed[_ -]?phrase)\s*[:=]\s*\S+/gi, '$1=[redacted]')
  .replace(/\b(Bearer)\s+\S+/gi, '$1 [redacted]')
  .replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_\-]{12,}\b/gi, '[credential redacted]')
  .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[credentials-redacted]@')

const safeLocation = (value) => {
  const location = redactKnowledgeText(value, 300).replace(/\\/g, '/')
  if (!location || location.startsWith('/') || location.split('/').some((part) => part === '..')) return ''
  return location
}

export const createTronChecklistReport = ({ checklistId, findings = [], generatedAt = Date.now(), pack = BUILTIN_TRON_KNOWLEDGE_PACK } = {}) => {
  const activePack = pack === BUILTIN_TRON_KNOWLEDGE_PACK ? pack : validateTronKnowledgePack(pack).pack
  if (!activePack) throw new Error('Invalid TRON knowledge pack for checklist reporting.')
  const checklistItem = getTronKnowledgeItem(checklistId, activePack)
  if (!checklistItem || checklistItem.kind !== 'checklist') throw new Error(`Unknown TRON checklist: ${checklistId}`)
  const rules = new Map(checklistItem.rules.map((rule) => [rule.id, rule]))
  const allowedTools = new Set(checklistItem.allowedTools)
  const normalized = (Array.isArray(findings) ? findings : []).map((finding, index) => {
    const rule = rules.get(finding?.ruleId)
    const requestedStatus = ['passed', 'finding', 'needs_review', 'not_applicable'].includes(finding?.status) ? finding.status : 'needs_review'
    const evidence = (Array.isArray(finding?.evidence) ? finding.evidence : []).map((item) => ({
      tool: cleanString(item?.tool, 80),
      ref: safeLocation(item?.ref),
      summary: redactKnowledgeText(item?.summary, 500)
    })).filter((item) => allowedTools.has(item.tool) && item.summary)
    const location = safeLocation(finding?.location)
    const remediation = redactKnowledgeText(finding?.remediation, 1000)
    const traceable = !!location || evidence.some((item) => item.ref)
    const complete = !!rule && evidence.length > 0 && traceable && (requestedStatus !== 'finding' || !!remediation)
    return Object.freeze({
      findingId: cleanString(finding?.findingId, 80) || `${checklistItem.id}-${index + 1}`,
      ruleId: rule?.id || cleanString(finding?.ruleId, 80) || 'UNKNOWN',
      title: redactKnowledgeText(finding?.title, 300) || rule?.title || 'Unclassified review item',
      severity: ['critical', 'high', 'medium', 'low', 'info'].includes(finding?.severity) ? finding.severity : (rule?.severity || 'info'),
      status: complete ? requestedStatus : 'needs_review',
      location,
      evidence: Object.freeze(evidence.map(Object.freeze)),
      remediation,
      note: complete ? '' : 'Evidence is missing, untrusted, or not traceable; manual review is required.'
    })
  })
  const counts = Object.freeze(normalized.reduce((total, finding) => ({ ...total, [finding.status]: (total[finding.status] || 0) + 1 }), { passed: 0, finding: 0, needs_review: 0, not_applicable: 0 }))
  return deepFreeze({
    schema: 'tronide.tron-checklist-report',
    schemaVersion: 1,
    checklistId: checklistItem.id,
    checklistVersion: checklistItem.version,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
    readOnly: true,
    counts,
    findings: normalized
  })
}

const markdownCell = (value) => redactKnowledgeText(value, 1000).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export const exportTronChecklistReport = (report, format = 'json', { pack = BUILTIN_TRON_KNOWLEDGE_PACK } = {}) => {
  if (!plainObject(report) || report.schema !== 'tronide.tron-checklist-report' || report.schemaVersion !== 1) throw new Error('Invalid TRON checklist report.')
  const safeReport = createTronChecklistReport({
    checklistId: report.checklistId,
    findings: report.findings,
    generatedAt: Number.isFinite(report.generatedAt) ? report.generatedAt : Date.now(),
    pack
  })
  if (format === 'json') return JSON.stringify(safeReport, null, 2)
  if (format !== 'markdown') throw new Error(`Unsupported checklist export format: ${format}`)
  const lines = [
    `# ${markdownCell(safeReport.checklistId)} report`,
    '',
    `Generated: ${new Date(safeReport.generatedAt).toISOString()}`,
    '',
    '| Rule | Severity | Status | Location | Evidence | Remediation |',
    '|---|---|---|---|---|---|'
  ]
  for (const finding of safeReport.findings) {
    const evidence = (finding.evidence || []).map((item) => `${item.tool}${item.ref ? ` (${item.ref})` : ''}: ${item.summary}`).join('; ')
    lines.push(`| ${markdownCell(finding.ruleId)} | ${markdownCell(finding.severity)} | ${markdownCell(finding.status)} | ${markdownCell(finding.location || '-')} | ${markdownCell(evidence || finding.note || '-')} | ${markdownCell(finding.remediation || '-')} |`)
  }
  return lines.join('\n')
}

export const knowledgeToolPolicyEvidence = (itemId, pack = BUILTIN_TRON_KNOWLEDGE_PACK) => {
  const item = getTronKnowledgeItem(itemId, pack)
  if (!item) return Object.freeze([])
  return Object.freeze(item.allowedTools.map((toolName) => {
    const policy = AI_TOOL_POLICIES[toolName]
    return Object.freeze({
      toolName,
      riskLevel: policy.riskLevel,
      requiresApproval: policy.approvalRequired,
      automaticRetry: policy.autoRetry,
      sideEffect: policy.sideEffect || (policy.riskLevel === AI_RISK_LEVEL.READ_ONLY ? 'none' : policy.riskLevel)
    })
  }))
}
