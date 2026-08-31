/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var adapterPromise = import('../../../libs/remix-code-reader/src/services/aiToolExecutionResult.js')

test('AI tool executor canonicalizes success and failure text at its boundary', async function (t) {
  var adapter = await adapterPromise
  var compileFailure = adapter.canonicalizeAIToolExecutionResult('compile_contract', 'Compilation FAILED for contracts/Broken.sol: ParserError')
  var compileSuccess = adapter.canonicalizeAIToolExecutionResult('compile_contract', 'Compilation SUCCEEDED for contracts/Ready.sol. Contracts: Ready')
  var testFailure = adapter.canonicalizeAIToolExecutionResult('run_tests', 'Ran 1 test file(s): 2 passing, 1 failing.\n- FAIL Ready: expected true')
  var writeSuccess = adapter.canonicalizeAIToolExecutionResult('write_contract', 'Sent Counter.increment() — transaction abc123.')
  var replayFailure = adapter.canonicalizeAIToolExecutionResult('replay_recording', 'Replay failed: transaction 2 reverted')
  var verificationMiss = adapter.canonicalizeAIToolExecutionResult('check_verification', 'Not found: TronScan has no contract at TTest on nile.')
  var errorLikeFile = adapter.canonicalizeAIToolExecutionResult('read_file', 'Could not be simpler: this is ordinary file content.')

  t.equal(compileFailure.ok, false, 'compiler diagnostics become a failed result')
  t.equal(compileSuccess.ok, true, 'successful compilation remains successful')
  t.equal(testFailure.ok, false, 'failing assertions make the test step fail')
  t.equal(writeSuccess.ok, true, 'proven transaction submission remains successful')
  t.equal(replayFailure.ok, false, 'replay errors cannot become successful steps')
  t.equal(verificationMiss.ok, true, 'a completed negative verification lookup remains valid evidence')
  t.equal(errorLikeFile.ok, true, 'error-like user file content is not reclassified as a tool failure')
  ;[compileFailure, compileSuccess, testFailure, writeSuccess, replayFailure, verificationMiss, errorLikeFile].forEach(function (result) {
    t.equal(typeof result.ok, 'boolean', 'every executor outcome has a boolean ok field')
    t.ok(result.code && result.summary, 'every executor outcome has canonical code and summary fields')
  })
  t.end()
})
