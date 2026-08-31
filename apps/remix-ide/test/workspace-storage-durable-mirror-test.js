/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const test = require('tape')
const {
  STORAGE_UNAVAILABLE,
  DurableMirrorController
} = require('../src/lib/workspace-storage/durable-mirror')
const {
  DEFAULT_INDEXED_DB_STORE,
  validateStoreName,
  createIndexedDbFileSystem,
  createAsyncMirror,
  installRootFileSystem
} = require('../src/lib/workspace-storage/browserfs-factory')

function fakeAsyncFileSystem () {
  const calls = []
  return {
    calls,
    writeFile (...args) {
      const callback = args.pop()
      calls.push({ method: 'writeFile', args, callback })
    },
    rename (...args) {
      const callback = args.pop()
      calls.push({ method: 'rename', args, callback })
    }
  }
}

test('durable mirror preserves BrowserFS operation order and exposes checkpoints', async (t) => {
  const persistent = fakeAsyncFileSystem()
  const mirror = { enqueueOp () {}, _queue: [], _queueRunning: false }
  const controller = new DurableMirrorController(persistent).install(mirror)

  mirror.enqueueOp({ apiMethod: 'writeFile', arguments: ['/a.sol', 'a'] })
  const first = controller.checkpoint()
  mirror.enqueueOp({ apiMethod: 'rename', arguments: ['/a.sol', '/b.sol'] })
  const second = controller.checkpoint()

  t.equal(first, 1, 'first write receives a durability sequence')
  t.equal(second, 2, 'later writes receive ordered sequences')
  t.equal(persistent.calls.length, 1, 'only one IndexedDB operation runs at a time')
  t.equal(controller.getStatus().state, 'saving', 'pending persistence is visible')

  let secondDurable = false
  const waiting = controller.whenDurable(second).then(() => { secondDurable = true })
  persistent.calls[0].callback()
  await Promise.resolve()
  t.equal(persistent.calls.length, 2, 'the next operation starts after acknowledgement')
  t.notOk(secondDurable, 'later checkpoints remain pending')
  persistent.calls[1].callback()
  await waiting

  t.equal(controller.getStatus().durableSequence, second, 'the durable sequence reaches the requested checkpoint')
  t.equal(controller.getStatus().state, 'idle', 'the controller becomes idle after persistence')
  t.end()
})

test('durable mirror contains persistence failures and retries the failed operation', async (t) => {
  const persistent = fakeAsyncFileSystem()
  const mirror = { enqueueOp () {}, _queue: [], _queueRunning: false }
  const controller = new DurableMirrorController(persistent).install(mirror)
  const statuses = []
  controller.subscribe((status) => statuses.push(status.state))

  mirror.enqueueOp({ apiMethod: 'writeFile', arguments: ['/a.sol', 'a'] })
  const waiting = controller.whenIdle()
  const rejected = waiting.then(() => {
    t.fail('durability wait unexpectedly succeeded')
  }, (error) => {
    t.match(error.message, /quota full/, 'durability waiters see the persistence failure')
  })
  const quota = new Error('quota full')
  quota.code = 'ENOSPC'
  persistent.calls[0].callback(quota)

  await rejected
  t.equal(controller.getStatus().state, 'failed', 'failure is retained instead of becoming an uncaught throw')
  t.equal(controller.getStatus().pending, 1, 'the failed operation remains available for retry')
  let writeError
  try { controller.assertWritable() } catch (error) { writeError = error }
  t.equal(writeError && writeError.code, STORAGE_UNAVAILABLE, 'later writes can fail closed at their boundary')

  const retried = controller.retry()
  t.equal(persistent.calls.length, 2, 'retry replays the same ordered operation')
  persistent.calls[1].callback()
  await retried
  t.equal(controller.getStatus().state, 'idle', 'successful retry recovers the controller')
  t.ok(statuses.includes('failed'), 'status listeners can surface the failure in the UI')
  t.end()
})

test('IndexedDB factory initializes the BrowserFS root inode before use', async (t) => {
  let rootReady = false
  const persistent = {
    makeRootDirectory (callback) {
      rootReady = true
      callback()
    }
  }
  const browserFS = {
    initialize () {},
    getFileSystem (config, callback) {
      t.deepEqual(config, { fs: 'IndexedDB', options: { storeName: 'tronide-workspaces-v1-test' } }, 'the store name is isolated and explicit')
      callback(null, persistent)
    }
  }
  t.equal(await createIndexedDbFileSystem(browserFS, 'tronide-workspaces-v1-test'), persistent, 'the initialized filesystem is returned')
  t.ok(rootReady, 'new stores receive their missing root inode')
  t.end()
})

test('BrowserFS factory creates an in-memory synchronous mirror over a supplied IndexedDB fs', async (t) => {
  const persistent = { name: 'idb' }
  const sync = { name: 'memory' }
  let mirrorOptions
  const browserFS = {
    getFileSystem (config, callback) {
      t.equal(config.fs, 'InMemory', 'AsyncMirror uses InMemory rather than LocalStorage for synchronous calls')
      callback(null, sync)
    },
    initialize (root) { this.root = root },
    BFSRequire (name) {
      t.equal(name, 'fs', 'factory requests the Node-compatible fs API')
      return { root: this.root }
    },
    FileSystem: {
      AsyncMirror: {
        Create (options, callback) {
          mirrorOptions = options
          callback(null, { type: 'mirror' })
        }
      }
    }
  }

  t.equal(DEFAULT_INDEXED_DB_STORE, 'tronide-workspaces-v1', 'the initial IndexedDB schema has a stable store name')
  t.equal(validateStoreName('tronide-workspaces-v1.stage_2'), 'tronide-workspaces-v1.stage_2', 'safe versioned store names are accepted')
  t.throws(() => validateStoreName('../workspace'), /invalid/, 'unsafe store names are rejected')
  const mirror = await createAsyncMirror(browserFS, persistent)
  t.equal(mirrorOptions.sync, sync, 'the synchronous side is the in-memory file system')
  t.equal(mirrorOptions.async, persistent, 'the persistent side is the supplied IndexedDB file system')
  const targetWindow = {}
  const fs = installRootFileSystem(browserFS, mirror, targetWindow)
  t.equal(fs.root, mirror, 'the mirror becomes the BrowserFS root')
  t.equal(targetWindow.remixFileSystem, fs, 'the existing TronIDE global fs contract is preserved')
  t.end()
})
