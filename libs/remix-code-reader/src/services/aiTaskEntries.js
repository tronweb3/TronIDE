/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import { WORKSPACE_ACTION_VENDORS } from './aiToolProtocolAdapters.js'
import { BUILTIN_TRON_KNOWLEDGE_PACK, getTronKnowledgeItem } from './aiTronKnowledge.js'

export const AI_TASK_ENTRY_SCHEMA_VERSION = 1

export const isConcreteAITaskNetwork = (value) => ['main', 'nile', 'shasta'].includes(String(value || '').toLowerCase())

export const getNileEnvironmentReadinessIssue = (environment) => {
  const env = environment && typeof environment === 'object' ? environment : null
  const network = env?.network || {}
  if (!env) {
    return {
      code: 'ENVIRONMENT_UNAVAILABLE',
      kind: 'environment',
      userAction: 'Wait for Deploy & Run to load, then check the Nile environment again.'
    }
  }
  if (env.providerTransition?.pending) {
    return {
      code: 'PROVIDER_TRANSITION_PENDING',
      kind: 'provider',
      userAction: 'Wait for the Deploy & Run environment switch to finish, then check the Nile environment again.'
    }
  }
  if (env.provider === 'vm') {
    return {
      code: 'INJECTED_PROVIDER_REQUIRED',
      kind: 'provider',
      userAction: 'Switch only Deploy & Run → Environment to Injected TronWeb, then check the Nile environment again. This VM result does not justify asking to unlock, reconnect, or change TronLink networks.'
    }
  }
  if (env.provider !== 'injected') {
    return {
      code: 'INJECTED_PROVIDER_REQUIRED',
      kind: 'provider',
      userAction: 'Switch Deploy & Run → Environment to Injected TronWeb, then check the Nile environment again.'
    }
  }
  if (env.walletState !== 'connected' || !env.selectedAccount) {
    return {
      code: 'WALLET_NOT_CONNECTED',
      kind: 'wallet',
      userAction: 'Unlock or reconnect TronLink, then check the Nile environment again.'
    }
  }
  if (!network.known || network.stale || network.id !== 'nile') {
    return {
      code: network.stale ? 'NETWORK_STALE' : (network.id === 'main' ? 'MAINNET_BLOCKED' : 'NILE_NETWORK_REQUIRED'),
      kind: 'network',
      userAction: network.id === 'main'
        ? 'Mainnet is blocked for this task. Switch TronLink to Nile, then check the environment again.'
        : 'Switch TronLink to Nile or wait for a fresh genesis-verified network check, then check the environment again.'
    }
  }
  return null
}

const CONTEXT_LIMITS = Object.freeze({
  contractAddress: 80,
  transactionHash: 80,
  contractName: 80,
  network: 32
})

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

const defineEntry = (entry) => deepFreeze({
  schemaVersion: AI_TASK_ENTRY_SCHEMA_VERSION,
  requiresWorkspaceActions: true,
  checklistIds: [],
  ...entry
})

export const HOME_AI_TASK_ENTRIES = deepFreeze([
  defineEntry({
    id: 'home-code-test',
    kind: 'home',
    dataId: 'landingAiTaskCodeTest',
    icon: '</>',
    title: 'Edit, compile, and test',
    description: 'Understand a contract, make a reviewed change, then compile and run focused tests.',
    goal: 'Understand the current contract task, make the smallest safe change, show the diff, compile it, and run focused tests.',
    skillId: 'trc20-code-test',
    checklistIds: ['tron-tvm-security-audit'],
    network: 'Workspace / JavaScript VM (Tron)',
    expectedNetwork: 'any',
    sideEffects: 'Local file writes only after approval',
    requiresTronLink: false
  }),
  defineEntry({
    id: 'home-nile-deploy',
    kind: 'home',
    dataId: 'landingAiTaskNileDeploy',
    icon: '⇗',
    iconClass: 'fas fa-rocket',
    title: 'Deploy and interact on Nile',
    description: 'Verify the wallet and network, preflight, deploy, resolve status, and perform a read check.',
    goal: 'Compile the selected contract, verify an unlocked TronLink account on Nile, preflight and deploy only after approval, resolve the transaction, and verify one read interaction.',
    skillId: 'tronlink-nile-deploy',
    checklistIds: ['energy-bandwidth-optimization'],
    network: 'Nile (verified in task; Mainnet blocked)',
    expectedNetwork: 'nile',
    sideEffects: 'Wallet signature and Nile transaction',
    requiresTronLink: true
  }),
  defineEntry({
    id: 'home-tronscan-verification',
    kind: 'home',
    dataId: 'landingAiTaskVerification',
    icon: '✓',
    title: 'Prepare TronScan verification',
    description: 'Collect the address, source, and compiler settings for verification.',
    goal: 'Check the real TronScan verification state and prepare reviewable verification material bound to the exact source, network, compiler, and optimizer settings.',
    skillId: 'tronscan-verification',
    checklistIds: ['tron-tvm-security-audit'],
    network: 'Mainnet, Nile, or Shasta (explicit)',
    expectedNetwork: 'explicit',
    sideEffects: 'Optional local metadata file after approval',
    requiresTronLink: false
  }),
  defineEntry({
    id: 'home-recorder-tronbox',
    kind: 'home',
    dataId: 'landingAiTaskTronBox',
    icon: '◎',
    title: 'Recorder to TronBox',
    description: 'Review a Recorder flow and export a reproducible TronBox project.',
    goal: 'Inspect the current Recorder scenario, save or replay only with explicit approval, export a deterministic TronBox project, and summarize compatibility evidence and TODOs.',
    skillId: 'recorder-tronbox-handoff',
    checklistIds: ['energy-bandwidth-optimization'],
    network: 'Current explicit environment',
    expectedNetwork: 'explicit',
    sideEffects: 'Local export; replay may send transactions',
    requiresTronLink: false
  })
])

export const DEPLOYMENT_NEXT_STEP_ENTRIES = deepFreeze([
  defineEntry({
    id: 'deploy-next-explain-receipt',
    kind: 'deploy_next',
    dataId: 'aiDeployNextExplain',
    title: 'Explain receipt',
    description: 'Resolve and explain the deployment result without sending another transaction.',
    goal: 'Explain the confirmed deployment result and receipt evidence. Query the same transaction when a hash is available; do not send or retry a transaction.',
    skillId: 'tronlink-nile-deploy',
    network: 'Deployed network',
    expectedNetwork: 'deployment',
    sideEffects: 'None (read-only)',
    requiresTronLink: false
  }),
  defineEntry({
    id: 'deploy-next-interact',
    kind: 'deploy_next',
    dataId: 'aiDeployNextInteract',
    title: 'Verify read / write',
    description: 'Run a read check and offer a separately approved write only when useful.',
    goal: 'Verify the deployed contract with an appropriate read call, then explain one optional write interaction. Never send the write without a separate explicit approval and wallet signature.',
    skillId: 'tronlink-nile-deploy',
    checklistIds: ['energy-bandwidth-optimization'],
    network: 'Deployed network',
    expectedNetwork: 'deployment',
    sideEffects: 'Read-only first; optional approved transaction',
    requiresTronLink: false
  }),
  defineEntry({
    id: 'deploy-next-verification',
    kind: 'deploy_next',
    dataId: 'aiDeployNextVerify',
    title: 'Prepare TronScan verification',
    description: 'Check status and prepare exact source/compiler metadata for review.',
    goal: 'Check the deployed address on the correct TronScan network and prepare reviewable verification materials tied to the exact compiler settings.',
    skillId: 'tronscan-verification',
    checklistIds: ['tron-tvm-security-audit'],
    network: 'Deployed network',
    expectedNetwork: 'deployment',
    sideEffects: 'Optional local metadata file after approval',
    requiresTronLink: false
  }),
  defineEntry({
    id: 'deploy-next-recorder',
    kind: 'deploy_next',
    dataId: 'aiDeployNextRecorder',
    title: 'Save Recorder flow',
    description: 'Preserve the deployment flow as a reviewable Recorder scenario.',
    goal: 'Inspect the live Recorder journal and save the deployment flow to a scenario file only after showing the target and receiving approval.',
    skillId: 'recorder-tronbox-handoff',
    network: 'Deployed network',
    expectedNetwork: 'deployment',
    sideEffects: 'Approved local scenario write',
    requiresTronLink: false
  }),
  defineEntry({
    id: 'deploy-next-dapp-starter',
    kind: 'deploy_next',
    dataId: 'aiDeployNextDapp',
    title: 'Generate DApp starter',
    description: 'Create a minimal front-end starter bound to this contract after reviewing its files.',
    goal: 'Generate a minimal TRON DApp starter for the deployed contract and network. Show every target file and request approval before writing; do not embed private keys or secrets.',
    skillId: 'trc20-code-test',
    checklistIds: ['tron-tvm-security-audit'],
    network: 'Deployed network',
    expectedNetwork: 'deployment',
    sideEffects: 'Approved local workspace files',
    requiresTronLink: false
  })
])

const ALL_ENTRIES = deepFreeze([...HOME_AI_TASK_ENTRIES, ...DEPLOYMENT_NEXT_STEP_ENTRIES])
const ENTRY_BY_ID = new Map(ALL_ENTRIES.map((entry) => [entry.id, entry]))

for (const entry of ALL_ENTRIES) {
  if (!getTronKnowledgeItem(entry.skillId, BUILTIN_TRON_KNOWLEDGE_PACK)) throw new Error(`Unknown task-entry Skill: ${entry.skillId}`)
  for (const checklistId of entry.checklistIds) {
    if (!getTronKnowledgeItem(checklistId, BUILTIN_TRON_KNOWLEDGE_PACK)) throw new Error(`Unknown task-entry Checklist: ${checklistId}`)
  }
}

export const getAITaskEntry = (entryId) => ENTRY_BY_ID.get(String(entryId || '').trim()) || null

const cleanValue = (value, max) => String(value == null ? '' : value)
  .split('')
  .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  .join('')
  .trim()
  .slice(0, max)

export const sanitizeAITaskEntryContext = (context = {}) => {
  const source = context && typeof context === 'object' ? context : {}
  const sanitized = {}
  const address = cleanValue(source.contractAddress || source.address, CONTEXT_LIMITS.contractAddress)
  const hash = cleanValue(source.transactionHash || source.txHash, CONTEXT_LIMITS.transactionHash)
  const name = cleanValue(source.contractName, CONTEXT_LIMITS.contractName).replace(/[^A-Za-z0-9_$.-]/g, '')
  const network = cleanValue(source.network || source.networkName || source.networkId, CONTEXT_LIMITS.network).replace(/[^A-Za-z0-9 _.-]/g, '')
  if (address) sanitized.contractAddress = address
  if (hash) sanitized.transactionHash = hash
  if (name) sanitized.contractName = name
  if (network) sanitized.network = network
  return deepFreeze(sanitized)
}

export const createAITaskEntry = ({ entryId, source = 'home', context = {} } = {}) => {
  const definition = getAITaskEntry(entryId)
  if (!definition) throw new TypeError(`Unknown AI task entry: ${String(entryId || '')}`)
  const safeSource = cleanValue(source, 32).replace(/[^a-z0-9_-]/gi, '') || definition.kind
  const safeContext = sanitizeAITaskEntryContext(context)
  const contextLines = Object.entries(safeContext).map(([key, value]) => `- ${key}: ${value}`)
  const prompt = [
    `Start this TronIDE task: ${definition.goal}`,
    `Recommended Skill: ${definition.skillId}`,
    `Recommended Checklists: ${definition.checklistIds.length ? definition.checklistIds.join(', ') : '(none)'}`,
    `Expected network: ${definition.network}`,
    `Expected side effects: ${definition.sideEffects}`,
    `TronLink prerequisite: ${definition.requiresTronLink ? 'required before the first wallet operation' : 'not required to start'}`,
    ...(contextLines.length ? ['Deployment context:', ...contextLines] : []),
    'Use the shared Task Runtime, canonical tools, R0-R3 Policy Gate, task history, and write lock. Plan first; do not call a model, sign, write, deploy, or send anything unless the user explicitly started this task and each required approval succeeds.'
  ].join('\n')
  return deepFreeze({
    schemaVersion: AI_TASK_ENTRY_SCHEMA_VERSION,
    entryId: definition.id,
    source: safeSource,
    title: definition.title,
    goal: definition.goal,
    prompt,
    skillId: definition.skillId,
    checklistIds: [...definition.checklistIds],
    requiresWorkspaceActions: definition.requiresWorkspaceActions !== false,
    expectedNetwork: definition.expectedNetwork,
    context: safeContext
  })
}

export const createAITaskEntrySnapshot = (entry) => {
  const definition = getAITaskEntry(entry?.entryId)
  if (!definition) throw new TypeError(`Unknown AI task entry: ${String(entry?.entryId || '')}`)
  return deepFreeze({
    schemaVersion: AI_TASK_ENTRY_SCHEMA_VERSION,
    entryId: definition.id,
    source: cleanValue(entry?.source, 32).replace(/[^a-z0-9_-]/gi, '') || definition.kind,
    context: sanitizeAITaskEntryContext(entry?.context)
  })
}

export const restoreAITaskEntry = (task) => {
  const persisted = task?.entry && typeof task.entry === 'object' ? task.entry : null
  let entryId = persisted?.entryId || ''
  let source = persisted?.source || ''
  if (!entryId && typeof task?.source === 'string') {
    const separator = task.source.indexOf(':')
    if (separator > 0) {
      source = task.source.slice(0, separator)
      entryId = task.source.slice(separator + 1)
    }
  }
  if (!getAITaskEntry(entryId)) return null
  return createAITaskEntry({ entryId, source, context: persisted?.context || {} })
}

const readinessIssue = (code, summary, userAction) => deepFreeze({ ok: false, code, summary, userAction })

export const getAITaskEntryReadinessIssue = (entry, readiness = {}, runtimeContext = {}) => {
  const definition = typeof entry === 'string' ? getAITaskEntry(entry) : getAITaskEntry(entry?.entryId || entry?.id)
  const runtime = runtimeContext && typeof runtimeContext === 'object' ? runtimeContext : {}
  if (!definition) return readinessIssue('INVALID_ENTRY', 'This AI task entry is unavailable.', 'Reload TronIDE and choose a supported task card.')
  if (readiness.taskBusy) return readinessIssue('TASK_BUSY', 'Another AI task is already running.', 'Stop or wait for the current task, then choose this task again.')
  if (!readiness.hasModel) return readinessIssue('MODEL_REQUIRED', 'No AI model is selected.', 'Open AI Assistant settings and select a model.')
  if (!readiness.hasKey) return readinessIssue('AI_KEY_REQUIRED', 'No API key is configured for the selected model.', 'Open AI Assistant settings and enter the API key; it remains in browser memory.')
  if (!readiness.workspaceActionsEnabled) return readinessIssue('WORKSPACE_ACTIONS_DISABLED', 'Workspace Actions are disabled.', 'Open AI Assistant settings and enable Workspace Actions.')
  const supportedVendor = WORKSPACE_ACTION_VENDORS.includes(readiness.aiModelVendor)
  if (!readiness.toolProtocolSupported || !supportedVendor) return readinessIssue('TOOL_PROTOCOL_UNSUPPORTED', `${readiness.aiModelVendor || 'The selected model'} does not support this task's Workspace Actions protocol.`, 'Select Anthropic or an OpenAI-compatible provider with tool calling enabled.')
  if (definition.requiresTronLink && runtime.tronLinkDetected === false) return readinessIssue('TRONLINK_REQUIRED', 'TronLink is not detected for this Nile deployment task.', 'Install or unlock TronLink, refresh its account access, then start the task again.')
  if (definition.expectedNetwork === 'nile' && runtime.networkKnown === true && String(runtime.network || '').toLowerCase() !== 'nile') {
    return readinessIssue('WRONG_NETWORK', `This task requires Nile, but ${runtime.network || 'another network'} is selected.`, 'Switch TronLink to Nile; the task will verify the network again before any transaction.')
  }
  return null
}
