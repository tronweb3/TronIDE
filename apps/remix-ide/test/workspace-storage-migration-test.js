/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const test = require('tape')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  MIGRATION_STATE_KEY,
  sanitizeState,
  loadMigrationState,
  saveMigrationState
} = require('../src/lib/workspace-storage/migration-state')
const {
  ACTIVE_STORE_MISSING,
  scanTree,
  synchronizeTree,
  randomStoreName,
  openOrMigrateWorkspaceStorage
} = require('../src/lib/workspace-storage/migration')

function temporaryDirectory (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function cleanup (...directories) {
  directories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }))
}

function memoryStorage () {
  const values = new Map()
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  }
}

function scopedNodeFs (root) {
  const scoped = (value) => {
    const relative = String(value || '/').replace(/^\/+/, '')
    const resolved = path.resolve(root, relative)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('path escaped fake BrowserFS root')
    return resolved
  }
  return {
    stat: (value, callback) => fs.stat(scoped(value), callback),
    readdir: (value, callback) => fs.readdir(scoped(value), callback),
    readFile: (value, ...args) => fs.readFile(scoped(value), ...args),
    writeFile: (value, ...args) => fs.writeFile(scoped(value), ...args),
    mkdir: (value, callback) => fs.mkdir(scoped(value), callback),
    rmdir: (value, callback) => fs.rmdir(scoped(value), callback),
    unlink: (value, callback) => fs.unlink(scoped(value), callback)
  }
}

function fakeBrowserFS (legacyRoot, storesRoot) {
  const stores = new Map()
  return {
    FileSystem: {},
    getFileSystem (config, callback) {
      if (config.fs === 'LocalStorage') return callback(null, { root: legacyRoot, kind: 'legacy' })
      if (config.fs === 'IndexedDB') {
        const name = config.options.storeName
        if (!stores.has(name)) {
          const root = path.join(storesRoot, name)
          fs.mkdirSync(root, { recursive: true })
          stores.set(name, { root, kind: 'indexeddb', name })
        }
        return callback(null, stores.get(name))
      }
      callback(new Error(`unsupported fake file system ${config.fs}`))
    },
    initialize (root) { this.root = root },
    BFSRequire (name) {
      if (name !== 'fs') throw new Error(`unsupported fake BrowserFS module ${name}`)
      return scopedNodeFs(this.root.root)
    },
    stores
  }
}

test('migration state is versioned, bounded, and fail closed on corrupt input', (t) => {
  const storage = memoryStorage()
  const fingerprint = 'a'.repeat(64)
  const state = saveMigrationState(storage, {
    phase: 'copying',
    targetStore: 'tronide-workspaces-v1-0011',
    sourceFingerprint: fingerprint,
    fileCount: 2,
    directoryCount: 1,
    totalBytes: 42
  }, 123)
  t.equal(state.updatedAt, 123, 'state records its last update')
  t.deepEqual(loadMigrationState(storage), state, 'valid state round-trips')
  storage.setItem(MIGRATION_STATE_KEY, '{broken')
  t.equal(loadMigrationState(storage), null, 'invalid JSON is ignored')
  t.equal(sanitizeState({ version: 1, phase: 'active', targetStore: '../escape', sourceFingerprint: fingerprint }), null, 'unsafe target stores cannot become active')
  t.equal(sanitizeState({ version: 1, phase: 'active', targetStore: 'safe', sourceFingerprint: 'short' }), null, 'active state requires a complete fingerprint')
  const legacyMigrationSource = fs.readFileSync(path.join(__dirname, '../src/migrateFileSystem.js'), 'utf8')
  t.ok(legacyMigrationSource.includes("normalized !== '.tronide-workspace-storage-v1'"), 'the internal IndexedDB marker cannot leak into legacy recovery workspaces')
  const filePanelSource = fs.readFileSync(path.join(__dirname, '../src/app/panels/file-panel.js'), 'utf8')
  t.ok(filePanelSource.includes('userRootEntries') && filePanelSource.includes('STORAGE_MARKER_PATH'), 'the storage marker does not suppress first-run default workspace creation')
  t.end()
})

test('tree migration preserves Unicode, binary files, empty directories, and exact target shape', async (t) => {
  const sourceRoot = temporaryDirectory('tronide-storage-source-')
  const targetRoot = temporaryDirectory('tronide-storage-target-')
  try {
    fs.mkdirSync(path.join(sourceRoot, '.workspaces', '示例', 'contracts'), { recursive: true })
    fs.mkdirSync(path.join(sourceRoot, '.workspaces', '示例', 'empty'), { recursive: true })
    fs.mkdirSync(path.join(sourceRoot, '.workspaces', '示例', '.git', 'objects'), { recursive: true })
    fs.writeFileSync(path.join(sourceRoot, '.workspaces', '示例', 'contracts', 'Token.sol'), 'contract Token {}\n')
    fs.writeFileSync(path.join(sourceRoot, '.workspaces', '示例', '.git', 'objects', 'binary'), Buffer.from([0, 1, 2, 127, 128, 255]))

    fs.mkdirSync(path.join(targetRoot, 'stale', 'nested'), { recursive: true })
    fs.writeFileSync(path.join(targetRoot, 'stale', 'nested', 'old.sol'), 'remove me')
    fs.writeFileSync(path.join(targetRoot, '.workspaces'), 'wrong type')

    const source = await scanTree(fs, sourceRoot, { includeContent: true })
    await synchronizeTree(fs, targetRoot, source)
    const target = await scanTree(fs, targetRoot)

    t.equal(target.fingerprint, source.fingerprint, 'target manifest exactly matches the source')
    t.deepEqual(fs.readFileSync(path.join(targetRoot, '.workspaces', '示例', '.git', 'objects', 'binary')), Buffer.from([0, 1, 2, 127, 128, 255]), 'binary Git data remains byte-for-byte identical')
    t.ok(fs.statSync(path.join(targetRoot, '.workspaces', '示例', 'empty')).isDirectory(), 'empty directories are retained')
    t.notOk(fs.existsSync(path.join(targetRoot, 'stale')), 'stale staging paths are removed')
  } finally {
    cleanup(sourceRoot, targetRoot)
  }
  t.end()
})

test('workspace migration activates only a verified IndexedDB store and reopens it on later boots', async (t) => {
  const legacyRoot = temporaryDirectory('tronide-storage-legacy-')
  const storesRoot = temporaryDirectory('tronide-storage-idb-')
  try {
    fs.mkdirSync(path.join(legacyRoot, '.workspaces', 'default_workspace', 'contracts'), { recursive: true })
    fs.writeFileSync(path.join(legacyRoot, '.workspaces', 'default_workspace', 'contracts', 'Counter.sol'), 'contract Counter {}')
    const storage = memoryStorage()
    const browserFS = fakeBrowserFS(legacyRoot, storesRoot)
    const cryptoObject = { getRandomValues: (bytes) => bytes.fill(7) }
    const progress = []

    const first = await openOrMigrateWorkspaceStorage({
      browserFS,
      storage,
      targetWindow: {},
      cryptoObject,
      onProgress: (event) => progress.push(event.phase)
    })

    t.ok(first.migrated, 'the first boot migrates the legacy tree')
    t.equal(first.state.phase, 'active', 'activation happens after verification')
    t.equal(first.state.targetStore, randomStoreName(cryptoObject), 'the staging store uses a stable safe identifier')
    t.deepEqual(fs.readFileSync(path.join(first.fileSystem.root, '.workspaces', 'default_workspace', 'contracts', 'Counter.sol'), 'utf8'), 'contract Counter {}', 'the active IndexedDB store contains the workspace')
    t.match(fs.readFileSync(path.join(first.fileSystem.root, '.tronide-workspace-storage-v1'), 'utf8'), /"version":1/, 'the active store carries an independently verified marker')
    t.deepEqual(progress.filter((phase, index) => index === 0 || phase !== progress[index - 1]), ['scanning', 'copying', 'verifying', 'active'], 'progress exposes every user-visible migration phase')

    const second = await openOrMigrateWorkspaceStorage({ browserFS, storage, targetWindow: {}, cryptoObject })
    t.notOk(second.migrated, 'later boots skip the legacy migration')
    t.equal(second.state.targetStore, first.state.targetStore, 'later boots reopen the exact active store')
  } finally {
    cleanup(legacyRoot, storesRoot)
  }
  t.end()
})

test('an active migration state never falls back silently when its IndexedDB store disappears', async (t) => {
  const legacyRoot = temporaryDirectory('tronide-storage-legacy-missing-')
  const storesRoot = temporaryDirectory('tronide-storage-idb-missing-')
  try {
    const storage = memoryStorage()
    saveMigrationState(storage, {
      phase: 'active',
      targetStore: 'tronide-workspaces-v1-missing',
      sourceFingerprint: 'b'.repeat(64),
      fileCount: 1,
      directoryCount: 1,
      totalBytes: 10
    })
    const browserFS = fakeBrowserFS(legacyRoot, storesRoot)
    let error
    try {
      await openOrMigrateWorkspaceStorage({ browserFS, storage, targetWindow: {} })
    } catch (caught) {
      error = caught
    }
    t.equal(error && error.code, ACTIVE_STORE_MISSING, 'missing IndexedDB data opens recovery instead of a stale legacy snapshot')
    t.equal(loadMigrationState(storage).phase, 'active', 'the authoritative active pointer is not silently downgraded')
  } finally {
    cleanup(legacyRoot, storesRoot)
  }
  t.end()
})
