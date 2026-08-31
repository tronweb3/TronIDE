/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const { validateStoreName } = require('./browserfs-factory')

const MIGRATION_VERSION = 1
const MIGRATION_STATE_KEY = 'tronide_workspace_storage_state_v1'
const PHASES = new Set(['scanning', 'copying', 'verifying', 'active', 'failed'])

function safeInteger (value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function sanitizeState (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== MIGRATION_VERSION || !PHASES.has(value.phase)) return null
  let targetStore
  try { targetStore = validateStoreName(value.targetStore) } catch (error) { return null }
  const sourceFingerprint = typeof value.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.sourceFingerprint)
    ? value.sourceFingerprint
    : ''
  if (value.phase !== 'scanning' && !sourceFingerprint) return null
  return {
    version: MIGRATION_VERSION,
    phase: value.phase,
    targetStore,
    sourceFingerprint,
    fileCount: safeInteger(value.fileCount),
    directoryCount: safeInteger(value.directoryCount),
    totalBytes: safeInteger(value.totalBytes),
    errorCode: typeof value.errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.errorCode) ? value.errorCode : '',
    updatedAt: safeInteger(value.updatedAt)
  }
}

function loadMigrationState (storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  let raw
  try { raw = storage.getItem(MIGRATION_STATE_KEY) } catch (error) { return null }
  if (!raw) return null
  try { return sanitizeState(JSON.parse(raw)) } catch (error) { return null }
}

function saveMigrationState (storage, value, now = Date.now()) {
  if (!storage || typeof storage.setItem !== 'function') throw new Error('Workspace migration state storage is unavailable.')
  const state = sanitizeState({ ...value, version: MIGRATION_VERSION, updatedAt: safeInteger(now) })
  if (!state) throw new Error('Workspace migration state is invalid.')
  storage.setItem(MIGRATION_STATE_KEY, JSON.stringify(state))
  return state
}

module.exports = {
  MIGRATION_VERSION,
  MIGRATION_STATE_KEY,
  sanitizeState,
  loadMigrationState,
  saveMigrationState
}
