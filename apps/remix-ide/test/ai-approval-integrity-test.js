/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var integrityPromise = import('../../../libs/remix-code-reader/src/services/aiApprovalIntegrity.js')

test('AI file approval digest binds review text and the complete before/after payload', async function (t) {
  var integrity = await integrityPromise
  var fields = {
    operation: 'edit_file',
    path: 'contracts/Safe.sol',
    before: 'contract Safe { /* old */ }',
    after: 'contract Safe { /* reviewed */ }',
    reviewBody: 'Complete replacement patch\n-old\n+reviewed'
  }
  var envelope = integrity.createAIApprovalEnvelope(fields)

  t.equal(envelope.digest.length, 64, 'approval exposes a full SHA-256 digest')
  t.ok(integrity.verifyAIApprovalEnvelope(envelope, fields), 'the exact reviewed payload verifies')
  t.notOk(integrity.verifyAIApprovalEnvelope(envelope, { ...fields, after: fields.after + '\n// hidden tail' }), 'an unreviewed payload tail causes a hash mismatch')
  t.notOk(integrity.verifyAIApprovalEnvelope(envelope, { ...fields, reviewBody: fields.reviewBody + '\n+hidden' }), 'a changed review body causes a hash mismatch')
  t.notOk(integrity.verifyAIApprovalEnvelope({ ...envelope, digest: '0'.repeat(64) }, fields), 'a forged approval digest is rejected')
  t.end()
})
