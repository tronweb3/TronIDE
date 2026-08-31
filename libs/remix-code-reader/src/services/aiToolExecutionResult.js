/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import {
  AI_TOOL_ERROR_CODE,
  createToolErrorResult,
  createToolSuccessResult,
  normalizeToolResult
} from './aiTaskProtocol.js'

// Legacy tool implementations still build human-readable summaries internally.
// This adapter is their single boundary into the Task Runtime: every result is
// converted to the canonical protocol and known failure text is never allowed
// to masquerade as a successful step.
const WRITE_SUCCESS = Object.freeze({
  create_file: /^(?:Created|Overwrote)\s/,
  edit_file: /^Edited\s/,
  undo_last_change: /^Undone\s/,
  delete_file: /^Deleted\s/,
  rename_file: /^Renamed\s/,
  create_workspace: /^Created workspace\s/,
  switch_workspace: /^Switched to workspace\s/,
  git_stage_all: /^Staged\s/,
  git_stage: /^Staged\s/,
  git_commit: /^Committed\s/,
  git_create_branch: /^Created and switched to branch\s/,
  git_checkout: /^Switched to branch\s/,
  git_push: /^Pushed\s/,
  git_pull: /^Pulled\s/,
  git_clone: /^Cloned\s/,
  prepare_verification: /^Verification metadata ready\s/,
  save_recording: /^Saved the recording\s/,
  replay_recording: /^Replayed\s/,
  export_tronbox: /^Exported\s/,
  write_contract: /^Sent\s/
})

const readToolFailure = (toolName, summary) => {
  if (toolName === 'compile_contract' && !/^Compilation SUCCEEDED\s/.test(summary)) return AI_TOOL_ERROR_CODE.INVALID_INPUT
  if (toolName === 'run_tests' && (!/^Ran \d+ test file\(s\):/.test(summary) || /\b[1-9]\d* failing\b|^- (?:FAIL|ERROR)\s/m.test(summary))) return AI_TOOL_ERROR_CODE.INVALID_INPUT
  if (toolName === 'set_compiler_version' && !/^Compiler (?:is already|switched to)\s/.test(summary)) return AI_TOOL_ERROR_CODE.NOT_READY
  if (toolName === 'run_static_analysis' && !/^Static analysis\s/.test(summary)) return AI_TOOL_ERROR_CODE.NOT_READY
  if (toolName === 'open_file' && !/^Opened\s/.test(summary)) return AI_TOOL_ERROR_CODE.INVALID_INPUT
  if (toolName === 'read_contract' && !/\(\)\s→\s/.test(summary)) return AI_TOOL_ERROR_CODE.INTERNAL_ERROR
  if (toolName === 'list_accounts' && !/^Accounts\s/.test(summary)) return AI_TOOL_ERROR_CODE.NOT_READY
  if (toolName === 'list_deployable_contracts' && !/^Deployable contracts\s/.test(summary)) return AI_TOOL_ERROR_CODE.NOT_READY
  if (toolName === 'get_transaction_status' && !/^Transaction\s/.test(summary)) return AI_TOOL_ERROR_CODE.NETWORK_UNAVAILABLE
  return null
}

const classifyFailure = (toolName, summary) => {
  if (/^User rejected\b|^.+ stopped before\b|^.+ stopped after\b/i.test(summary)) return AI_TOOL_ERROR_CODE.USER_REJECTED
  if (/did not finish(?: loading)? in time|timed out/i.test(summary)) return AI_TOOL_ERROR_CODE.TIMEOUT
  if (/changed while|appeared while|integrity check failed|context changed|workspace version|could not bind|could not determine the current workspace|could not prove/i.test(summary)) return AI_TOOL_ERROR_CODE.STATE_CHANGED
  if (/network (?:is )?(?:unknown|stale|unavailable)|wallet state|offline|could not (?:verify|re-check|resolve|read) (?:the )?(?:replay |execution |transaction )?(?:environment|status)|compiler may still be downloading/i.test(summary)) return AI_TOOL_ERROR_CODE.NETWORK_UNAVAILABLE
  if (/^(?:Provide|Pass)\b|^Invalid\b|^Only \.sol\b|^No such\b|^No workspace named\b|^No file at\b|does not exist|was not found|appears \d+ times|are identical|too large to display safely|is not a solc version|Compiler .* does not exist|\bneeds address\b/i.test(summary)) return AI_TOOL_ERROR_CODE.INVALID_INPUT
  if (/^Compilation FAILED\b|^Transaction failed\b|^Deployment failed\b|^Replay failed\b/i.test(summary)) {
    return ['deploy_contract', 'write_contract', 'replay_recording'].includes(toolName)
      ? AI_TOOL_ERROR_CODE.EXECUTION_REVERTED
      : AI_TOOL_ERROR_CODE.INVALID_INPUT
  }
  if (/^(?:Could not|Cannot|Refusing|Search failed|Write failed|Edit failed|Delete failed|Rename failed|Undo failed|Commit failed|Push failed|Pull failed|Clone failed|Export failed|Save failed|Replay blocked|Transaction blocked|Transaction preflight failed|Deployment blocked|Nothing compiled yet|Static analysis produced no result|The test run produced no result|Not a git repository|No accounts available)\b/i.test(summary)) return AI_TOOL_ERROR_CODE.INTERNAL_ERROR
  return readToolFailure(toolName, summary)
}

export const canonicalizeAIToolExecutionResult = (toolName, result) => {
  if (result && typeof result === 'object') return normalizeToolResult(result)
  if (typeof result !== 'string' || !result.trim()) {
    return createToolErrorResult({
      code: AI_TOOL_ERROR_CODE.INTERNAL_ERROR,
      summary: `${toolName} returned no canonical result.`,
      retryable: false,
      userAction: 'Inspect the IDE state and run the step again only after the result can be verified.'
    })
  }

  const summary = result.trim()
  // read_file may legitimately return arbitrary source/text beginning with an
  // error-like phrase. Its provider-error branch is structured at the source,
  // so all remaining text here is file content rather than a status message.
  if (toolName === 'read_file') return createToolSuccessResult({ summary })
  const writeSuccess = WRITE_SUCCESS[toolName]
  let code = classifyFailure(toolName, summary)
  if (!code && writeSuccess && !writeSuccess.test(summary)) code = AI_TOOL_ERROR_CODE.INTERNAL_ERROR
  // Deploy success is already structured with its address and transaction
  // evidence. Any text-only deploy outcome is therefore incomplete/failing.
  if (!code && toolName === 'deploy_contract') code = AI_TOOL_ERROR_CODE.INTERNAL_ERROR

  if (!code) return createToolSuccessResult({ summary })
  const mayHaveChangedState = /partial|may have changed|may already|could not prove|completed without a resolvable/i.test(summary)
  return createToolErrorResult({
    code,
    summary,
    retryable: false,
    userAction: code === AI_TOOL_ERROR_CODE.USER_REJECTED
      ? 'Change the request or approve a new preview explicitly if you want to continue.'
      : 'Review this step and the current IDE state before continuing.',
    ...(mayHaveChangedState ? { uncertainty: 'The tool reported that state may have changed without complete evidence.' } : {})
  })
}
