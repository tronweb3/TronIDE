/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const WORKSPACE_LOCK_NAME = 'tronide-workspace-writer-v1'
const WORKSPACE_LEASE_KEY = 'tronide_workspace_writer_lease_v1'
const WORKSPACE_LOCKED = 'TRONIDE_WORKSPACE_ALREADY_OPEN'

function unavailableLockError () {
  const error = new Error('This TronIDE workspace is already open in another tab. Close that tab and retry.')
  error.code = WORKSPACE_LOCKED
  return error
}

function randomOwner (cryptoObject) {
  const bytes = new Uint8Array(12)
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

async function acquireWebLock (locks) {
  let release
  let settleAcquisition
  const acquired = new Promise((resolve) => { settleAcquisition = resolve })
  const lifetime = new Promise((resolve) => { release = resolve })
  const request = locks.request(WORKSPACE_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) {
      settleAcquisition(null)
      return
    }
    const handle = {
      kind: 'web-lock',
      acquired: true,
      lost: Promise.resolve(false),
      release: () => release()
    }
    settleAcquisition(handle)
    await lifetime
  })
  request.catch((error) => settleAcquisition({ error }))
  const result = await acquired
  if (result && result.error) throw result.error
  if (!result) throw unavailableLockError()
  // Retain the request promise so test runners and explicit teardown can wait
  // for lock release without turning it into an unhandled rejection.
  result.finished = request
  return result
}

function parseLease (raw) {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value.owner !== 'string' || !Number.isSafeInteger(value.expiresAt)) return null
    return value
  } catch (error) {
    return null
  }
}

async function acquireLeaseLock ({ storage, cryptoObject, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, arbitrationDelay = 80 }) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw unavailableLockError()
  const owner = randomOwner(cryptoObject)
  const leaseMs = 8000
  const heartbeatMs = 2000
  const writeLease = () => storage.setItem(WORKSPACE_LEASE_KEY, JSON.stringify({ owner, expiresAt: now() + leaseMs }))
  const current = parseLease(storage.getItem(WORKSPACE_LEASE_KEY))
  if (current && current.owner !== owner && current.expiresAt > now()) throw unavailableLockError()
  writeLease()
  await new Promise((resolve) => setTimeout(resolve, arbitrationDelay))
  const winner = parseLease(storage.getItem(WORKSPACE_LEASE_KEY))
  if (!winner || winner.owner !== owner) throw unavailableLockError()

  let released = false
  let lose
  const lost = new Promise((resolve) => { lose = resolve })
  const timer = setTimer(() => {
    if (released) return
    const active = parseLease(storage.getItem(WORKSPACE_LEASE_KEY))
    if (active && active.owner !== owner && active.expiresAt > now()) {
      released = true
      clearTimer(timer)
      lose(true)
      return
    }
    writeLease()
  }, heartbeatMs)

  return {
    kind: 'lease',
    acquired: true,
    lost,
    release () {
      if (released) return
      released = true
      clearTimer(timer)
      const active = parseLease(storage.getItem(WORKSPACE_LEASE_KEY))
      if (active && active.owner === owner && typeof storage.removeItem === 'function') storage.removeItem(WORKSPACE_LEASE_KEY)
      lose(false)
    }
  }
}

async function acquireWorkspaceWriteLock ({ navigatorObject, storage, cryptoObject, timers } = {}) {
  if (navigatorObject && navigatorObject.locks && typeof navigatorObject.locks.request === 'function') {
    return acquireWebLock(navigatorObject.locks)
  }
  return acquireLeaseLock({
    storage,
    cryptoObject,
    setTimer: timers && timers.setInterval,
    clearTimer: timers && timers.clearInterval,
    arbitrationDelay: timers && Number.isFinite(timers.arbitrationDelay) ? timers.arbitrationDelay : undefined
  })
}

module.exports = {
  WORKSPACE_LOCK_NAME,
  WORKSPACE_LEASE_KEY,
  WORKSPACE_LOCKED,
  parseLease,
  acquireWorkspaceWriteLock
}
