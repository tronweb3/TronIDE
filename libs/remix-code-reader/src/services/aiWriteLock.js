/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

export const AI_WRITE_LOCK_SCHEMA_VERSION = 1
export const AI_WRITE_LOCK_STORAGE_KEY = 'tronide.ai.write-lock.v1'

const canonicalContext = (context = {}) => ({
  workspace: context.workspace || null,
  branch: context.branch || null,
  provider: context.provider || null,
  networkId: context.networkId || null,
  account: context.account || null
})

// Workspace/branch identify the target protected by this task-wide write lock
// and must always match. Chain identity is a per-step approval/CAS concern: a
// reviewed workflow may intentionally deploy with account 0 and then call with
// account 1, or change networks before starting a newly approved step. Keep the
// latest concrete R3 identity for diagnostics, preserve it across R1 steps,
// and rely on each chain tool's frozen preflight + post-approval recheck to
// reject changes while that approval is open.
const mergeCompatibleContext = (left, right) => {
  const existing = canonicalContext(left)
  const next = canonicalContext(right)
  for (const key of ['workspace', 'branch']) {
    if (existing[key] !== next[key]) return null
  }
  const merged = { ...existing }
  for (const key of ['provider', 'networkId', 'account']) {
    merged[key] = next[key] || existing[key] || null
  }
  return merged
}

class MemoryStorage {
  constructor () { this.values = new Map() }
  getItem (key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem (key, value) { this.values.set(key, String(value)) }
  removeItem (key) { this.values.delete(key) }
}

export class AITaskWriteLock {
  constructor ({ storage, now = () => Date.now(), ttlMs = 10 * 60 * 1000 } = {}) {
    this.storage = storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
      ? storage
      : new MemoryStorage()
    this.now = now
    this.ttlMs = ttlMs
  }

  _read () {
    try {
      const raw = this.storage.getItem(AI_WRITE_LOCK_STORAGE_KEY)
      if (!raw) return null
      const lock = JSON.parse(raw)
      if (!lock || lock.schemaVersion !== AI_WRITE_LOCK_SCHEMA_VERSION || !lock.taskId || !Number.isFinite(lock.expiresAt)) {
        this.storage.removeItem(AI_WRITE_LOCK_STORAGE_KEY)
        return null
      }
      if (lock.expiresAt <= this.now()) {
        this.storage.removeItem(AI_WRITE_LOCK_STORAGE_KEY)
        return null
      }
      return lock
    } catch (e) {
      try { this.storage.removeItem(AI_WRITE_LOCK_STORAGE_KEY) } catch (_) {}
      return null
    }
  }

  snapshot () {
    const lock = this._read()
    return lock ? JSON.parse(JSON.stringify(lock)) : null
  }

  acquire ({ taskId, stepId, toolName, context } = {}) {
    if (!taskId) return { ok: false, code: 'NOT_READY', reason: 'A task ID is required for a write lock.' }
    const now = this.now()
    const existing = this._read()
    if (existing && existing.taskId !== taskId) {
      return {
        ok: false,
        code: 'LOCKED',
        reason: `Write access is held by task ${existing.taskId} until ${new Date(existing.expiresAt).toISOString()}.`,
        lock: existing
      }
    }
    const nextContext = existing ? mergeCompatibleContext(existing.context, context) : canonicalContext(context)
    if (!nextContext) {
      return {
        ok: false,
        code: 'STATE_CHANGED',
        reason: 'Workspace, branch, network, or account changed while the task write lock was held.',
        lock: existing
      }
    }

    const nonce = `${taskId}:${now}:${Math.random().toString(36).slice(2)}`
    const lock = {
      schemaVersion: AI_WRITE_LOCK_SCHEMA_VERSION,
      taskId,
      stepId: stepId || null,
      toolName: toolName || null,
      context: nextContext,
      acquiredAt: existing ? existing.acquiredAt : now,
      updatedAt: now,
      expiresAt: now + this.ttlMs,
      nonce
    }
    try {
      this.storage.setItem(AI_WRITE_LOCK_STORAGE_KEY, JSON.stringify(lock))
      const verified = this._read()
      if (!verified || verified.nonce !== nonce) {
        return { ok: false, code: 'LOCKED', reason: 'Another task acquired the write lock concurrently.', lock: verified }
      }
      return { ok: true, lock: verified }
    } catch (e) {
      return { ok: false, code: 'NOT_READY', reason: 'Write-lock storage is unavailable; the side effect was blocked.' }
    }
  }

  rebind ({ taskId, stepId, toolName, context } = {}) {
    const existing = this._read()
    if (!existing || existing.taskId !== taskId) return { ok: false, code: 'LOCK_LOST', reason: 'The task no longer owns the write lock.' }
    const now = this.now()
    const lock = {
      ...existing,
      stepId: stepId || existing.stepId,
      toolName: toolName || existing.toolName,
      context: canonicalContext(context),
      updatedAt: now,
      expiresAt: now + this.ttlMs,
      nonce: `${taskId}:${now}:${Math.random().toString(36).slice(2)}`
    }
    try {
      this.storage.setItem(AI_WRITE_LOCK_STORAGE_KEY, JSON.stringify(lock))
      const verified = this._read()
      if (!verified || verified.taskId !== taskId || verified.nonce !== lock.nonce) {
        return {
          ok: false,
          code: 'LOCK_LOST',
          reason: 'The write lock could not be verified after the approved context change.',
          lock: verified
        }
      }
      return { ok: true, lock: verified }
    } catch (e) {
      return { ok: false, code: 'NOT_READY', reason: 'The write lock could not be rebound after the approved context change.' }
    }
  }

  preserveUntilExpiry (taskId, ttlMs = this.ttlMs) {
    const existing = this._read()
    if (!existing || existing.taskId !== taskId) return false
    const now = this.now()
    try {
      this.storage.setItem(AI_WRITE_LOCK_STORAGE_KEY, JSON.stringify({ ...existing, updatedAt: now, expiresAt: now + ttlMs }))
      return true
    } catch (e) { return false }
  }

  release (taskId) {
    const existing = this._read()
    if (!existing) return true
    if (existing.taskId !== taskId) return false
    try { this.storage.removeItem(AI_WRITE_LOCK_STORAGE_KEY); return true } catch (e) { return false }
  }

  recoverExpired () {
    return this._read()
  }
}
