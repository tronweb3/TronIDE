/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

import sha256 from 'crypto-js/sha256.js'

// Keep approval rendering bounded. create_file is already limited to 200k
// characters; edit_file can target larger generated sources, so an oversized
// replacement must be split rather than showing a clipped preview and applying
// an unseen tail.
export const AI_APPROVAL_MAX_REVIEW_CHARS = 400000

const normalizedApproval = ({ operation, path, before, after, reviewBody }) => ({
  schemaVersion: 1,
  operation: String(operation || ''),
  path: String(path || ''),
  before: before == null ? null : String(before),
  after: after == null ? null : String(after),
  reviewBody: String(reviewBody || '')
})

const approvalDigest = (fields) => sha256(JSON.stringify(normalizedApproval(fields))).toString()

/**
 * Bind the exact review text to the exact before/after file payload. Callers
 * display digest in the modal, then verify the same envelope immediately
 * before writing, after their normal workspace/path/TOCTOU checks.
 */
export const createAIApprovalEnvelope = (fields) => Object.freeze({
  ...normalizedApproval(fields),
  digest: approvalDigest(fields)
})

export const verifyAIApprovalEnvelope = (envelope, fields) => {
  if (!envelope || typeof envelope.digest !== 'string') return false
  const current = normalizedApproval(fields)
  return envelope.digest === approvalDigest(current) &&
    envelope.operation === current.operation &&
    envelope.path === current.path &&
    envelope.before === current.before &&
    envelope.after === current.after &&
    envelope.reviewBody === current.reviewBody
}
