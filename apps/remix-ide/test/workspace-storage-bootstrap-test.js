/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const test = require('tape')
const {
  WORKSPACE_LOCK_NAME,
  WORKSPACE_LOCKED,
  acquireWorkspaceWriteLock
} = require('../src/lib/workspace-storage/workspace-lock')
const {
  MODE_LEGACY,
  indexedDbWorkspacesEnabled,
  progressMessage,
  createStorageService,
  bootstrapWorkspaceStorage
} = require('../src/lib/workspace-storage/bootstrap')

function memoryStorage () {
  const values = new Map()
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  }
}

function webLocks (available = true) {
  const calls = []
  return {
    calls,
    request (name, options, callback) {
      calls.push({ name, options })
      return Promise.resolve(callback(available ? { name } : null))
    }
  }
}

test('workspace writer uses one exclusive browser lock for the full session', async (t) => {
  const locks = webLocks(true)
  const lock = await acquireWorkspaceWriteLock({ navigatorObject: { locks } })
  t.equal(locks.calls[0].name, WORKSPACE_LOCK_NAME, 'all tabs compete for the same versioned lock')
  t.deepEqual(locks.calls[0].options, { mode: 'exclusive', ifAvailable: true }, 'lock acquisition never waits behind an invisible writable tab')
  t.equal(lock.kind, 'web-lock', 'the browser-native lock is preferred')
  lock.release()
  await lock.finished
  t.pass('explicit teardown releases the session lock')
  t.end()
})

test('a second writable tab receives a stable user-facing error', async (t) => {
  let error
  try {
    await acquireWorkspaceWriteLock({ navigatorObject: { locks: webLocks(false) } })
  } catch (caught) {
    error = caught
  }
  t.equal(error && error.code, WORKSPACE_LOCKED, 'contention fails before either in-memory mirror can diverge')
  t.match(error && error.message, /another tab/, 'the failure tells users how to recover')
  t.end()
})

test('workspace storage flags and progress copy are deterministic', (t) => {
  t.ok(indexedDbWorkspacesEnabled(undefined), 'IndexedDB workspaces default on')
  t.ok(indexedDbWorkspacesEnabled('true'), 'the rollout can explicitly enable IndexedDB')
  t.notOk(indexedDbWorkspacesEnabled('FALSE'), 'the operational kill switch is case-insensitive')
  t.equal(progressMessage({ phase: 'copying', completed: 3, total: 9 }), 'Migrating workspace files (3/9)…', 'copy progress is concrete without exposing file names')
  t.equal(progressMessage({ phase: 'verifying' }), 'Verifying migrated workspace…', 'verification is distinguishable from copying')
  t.end()
})

test('storage service exposes durability without changing legacy callers', async (t) => {
  const statuses = []
  const controller = {
    checkpoint: () => 7,
    whenDurable: async (sequence) => sequence,
    whenIdle: async () => 7,
    assertWritable: () => true,
    retry: async () => 7,
    getStatus: () => ({ state: 'idle', pending: 0 }),
    subscribe (listener) { listener({ state: 'idle' }); return () => {} }
  }
  const navigatorObject = { storage: { persist: async () => true, persisted: async () => true } }
  const service = createStorageService({ mode: 'indexeddb-mirror', controller, lock: { kind: 'test', release () {} }, navigatorObject })
  service.subscribe((status) => statuses.push(status.state))
  t.equal(service.checkpoint(), 7, 'callers can capture a durability boundary')
  t.equal(await service.whenDurable(7), 7, 'callers can wait for that exact boundary')
  t.deepEqual(statuses, ['idle'], 'save state is observable')
  t.ok(await service.isPersistentStorage(), 'callers can avoid offering a redundant persistence action')
  t.ok(await service.requestPersistentStorage(), 'persistent browser storage remains an explicit user action')
  t.notOk(service.shouldWarnBeforeUnload(), 'idle storage does not trigger an unload prompt')
  t.end()
})

test('bootstrap keeps the LocalStorage kill switch available before activation', async (t) => {
  const storage = memoryStorage()
  const locks = webLocks(true)
  const browserFS = {
    install (target) { this.installed = target },
    getFileSystem (config, callback) {
      t.equal(config.fs, 'LocalStorage', 'legacy mode does not open IndexedDB')
      callback(null, { kind: 'legacy' })
    },
    initialize (root) { this.root = root },
    BFSRequire: () => ({ kind: 'node-fs' })
  }
  const targetWindow = {}
  const service = await bootstrapWorkspaceStorage({
    browserFS,
    targetWindow,
    navigatorObject: { locks },
    storage,
    envValue: 'false'
  })
  t.equal(service.mode, MODE_LEGACY, 'pre-activation kill switch keeps the legacy backend')
  t.equal(targetWindow.remixFileSystem.kind, 'node-fs', 'the existing global fs interface is installed')
  service.release()
  t.end()
})

test('main starts plugins only after storage bootstrap and keeps recovery visible', (t) => {
  const root = path.resolve(__dirname, '../../..')
  const main = fs.readFileSync(path.join(root, 'apps/remix-ide/src/main.js'), 'utf8')
  const webpack = fs.readFileSync(path.join(root, 'apps/remix-ide/webpack.config.js'), 'utf8')
  t.ok(main.indexOf('await bootstrapWorkspaceStorage') < main.indexOf("require('./index')"), 'the plugin engine starts only after the persistent mirror is ready')
  t.ok(main.includes('installUnloadProtection(storageService)'), 'pending persistence protects users from accidental navigation')
  t.ok(main.includes('installRuntimeStorageStatus(storageService)'), 'runtime save state remains visible after the startup splash')
  t.ok(main.includes('workspaceStorageRetry'), 'fatal storage startup errors render a stable retry action')
  t.ok(webpack.includes("'process.env.TRONIDE_INDEXEDDB_WORKSPACES'"), 'production builds expose the pre-activation kill switch')
  t.end()
})
