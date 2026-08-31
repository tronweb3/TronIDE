/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import { AI_RISK_LEVEL, AI_RISK_POLICY_DEFAULTS } from './aiTaskProtocol.js'

const policy = (riskLevel, overrides = {}) => Object.freeze({
  riskLevel,
  ...AI_RISK_POLICY_DEFAULTS[riskLevel],
  ...overrides
})

const R0 = AI_RISK_LEVEL.READ_ONLY
const R1 = AI_RISK_LEVEL.LOCAL_WRITE
const R2 = AI_RISK_LEVEL.REMOTE_WRITE
const R3 = AI_RISK_LEVEL.CHAIN_WRITE

// This is the canonical policy registry for every currently exposed workspace
// action. Unknown tools fail closed in getAIToolPolicy instead of inheriting a
// read-only default.
export const AI_TOOL_POLICIES = Object.freeze({
  read_current_file: policy(R0),
  list_open_files: policy(R0),
  open_file: policy(R0),
  search_workspace: policy(R0),
  create_file: policy(R1),
  edit_file: policy(R1),
  undo_last_change: policy(R1),
  delete_file: policy(R1),
  rename_file: policy(R1),
  read_file: policy(R0),
  list_files: policy(R0),
  list_workspaces: policy(R0),
  create_workspace: policy(R1, { timeoutMs: 60000 }),
  switch_workspace: policy(R1, { timeoutMs: 60000 }),
  compile_contract: policy(R0, { timeoutMs: 120000, retryable: true }),
  set_compiler_version: policy(R0, { timeoutMs: 120000, retryable: true }),
  run_static_analysis: policy(R0, { timeoutMs: 120000, retryable: true }),
  run_tests: policy(R0, { timeoutMs: 120000, retryable: true }),
  git_status: policy(R0),
  git_diff: policy(R0),
  git_log: policy(R0),
  git_stage_all: policy(R1, { timeoutMs: 60000 }),
  git_stage: policy(R1, { timeoutMs: 60000 }),
  git_commit: policy(R1, { timeoutMs: 60000 }),
  git_create_branch: policy(R1, { timeoutMs: 60000 }),
  git_checkout: policy(R1, { timeoutMs: 60000 }),
  git_push: policy(R2, { timeoutMs: 120000 }),
  git_pull: policy(R2, { timeoutMs: 120000 }),
  git_clone: policy(R2, { timeoutMs: 120000 }),
  debug_transaction: policy(R0, { timeoutMs: 120000, retryable: true }),
  list_accounts: policy(R0, { timeoutMs: 60000, retryable: true }),
  get_balance: policy(R0, { timeoutMs: 60000, retryable: true }),
  get_environment: policy(R0, { timeoutMs: 60000, retryable: true }),
  preflight_transaction: policy(R0, { timeoutMs: 120000, retryable: true }),
  get_transaction_status: policy(R0, { timeoutMs: 120000, retryable: true }),
  list_deployable_contracts: policy(R0),
  // The udapp method owns a five-minute wallet-signing deadline. Keep the task
  // runtime outside that window so it receives the method's exact result
  // instead of racing it and reporting a false TX_UNKNOWN.
  deploy_contract: policy(R3, { timeoutMs: 360000 }),
  read_contract: policy(R0, { timeoutMs: 60000, retryable: true }),
  write_contract: policy(R3, { timeoutMs: 360000 }),
  check_verification: policy(R0, { timeoutMs: 60000, retryable: true }),
  prepare_verification: policy(R1, { timeoutMs: 60000 }),
  save_recording: policy(R1, { timeoutMs: 60000 }),
  replay_recording: policy(R3, { timeoutMs: 180000 }),
  export_tronbox: policy(R1, { timeoutMs: 60000 })
})

export const getAIToolPolicy = (toolName) => {
  const found = AI_TOOL_POLICIES[toolName]
  if (!found) throw new Error(`No AI tool policy is registered for: ${toolName}`)
  return found
}
