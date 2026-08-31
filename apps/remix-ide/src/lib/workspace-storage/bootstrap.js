/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const {
  createLegacyFileSystem,
  createAsyncMirror,
  installRootFileSystem
} = require('./browserfs-factory')
const { DurableMirrorController } = require('./durable-mirror')
const { openOrMigrateWorkspaceStorage, ACTIVE_STORE_MISSING } = require('./migration')
const { loadMigrationState } = require('./migration-state')
const { acquireWorkspaceWriteLock } = require('./workspace-lock')

const MODE_INDEXED_DB = 'indexeddb-mirror'
const MODE_LEGACY = 'legacy-localstorage'

function indexedDbWorkspacesEnabled (envValue) {
  return String(envValue === undefined ? 'true' : envValue).toLowerCase() !== 'false'
}

function progressMessage (progress = {}) {
  switch (progress.phase) {
    case 'scanning': return 'Preparing local workspace storage…'
    case 'copying': return Number.isSafeInteger(progress.completed) && Number.isSafeInteger(progress.total)
      ? `Migrating workspace files (${progress.completed}/${progress.total})…`
      : 'Migrating workspace files…'
    case 'verifying': return 'Verifying migrated workspace…'
    case 'active': return 'Opening TRON IDE…'
    default: return 'Preparing TRON IDE…'
  }
}

function createStorageService ({ mode, controller = null, lock, migration = null, fallbackError = null, navigatorObject = null }) {
  return Object.freeze({
    mode,
    migration,
    fallbackError,
    lockKind: lock && lock.kind,
    checkpoint: () => controller ? controller.checkpoint() : 0,
    whenDurable: (sequence) => controller ? controller.whenDurable(sequence) : Promise.resolve(0),
    whenIdle: () => controller ? controller.whenIdle() : Promise.resolve(0),
    assertWritable: () => controller ? controller.assertWritable() : true,
    retry: () => controller ? controller.retry() : Promise.resolve(0),
    getStatus: () => controller ? controller.getStatus() : Object.freeze({ state: 'legacy', sequence: 0, durableSequence: 0, pending: 0, error: fallbackError }),
    subscribe: (listener) => controller ? controller.subscribe(listener) : () => {},
    shouldWarnBeforeUnload: () => controller ? controller.getStatus().state !== 'idle' : false,
    isPersistentStorage: async () => {
      const storage = navigatorObject && navigatorObject.storage
      if (!storage || typeof storage.persisted !== 'function') return false
      return storage.persisted()
    },
    requestPersistentStorage: async () => {
      const storage = navigatorObject && navigatorObject.storage
      if (!storage || typeof storage.persist !== 'function') return false
      return storage.persist()
    },
    release: () => lock && lock.release()
  })
}

async function installLegacyStorage ({ browserFS, targetWindow, lock, error, navigatorObject }) {
  const fileSystem = await createLegacyFileSystem(browserFS)
  installRootFileSystem(browserFS, fileSystem, targetWindow)
  const service = createStorageService({ mode: MODE_LEGACY, lock, fallbackError: error, navigatorObject })
  targetWindow.tronideWorkspaceStorage = service
  return service
}

async function bootstrapWorkspaceStorage ({
  browserFS,
  targetWindow,
  navigatorObject,
  storage,
  cryptoObject,
  envValue,
  onProgress = () => {},
  timers
}) {
  if (!browserFS || !targetWindow) throw new Error('Workspace storage bootstrap requires BrowserFS and a window.')
  browserFS.install(targetWindow)
  const lock = await acquireWorkspaceWriteLock({ navigatorObject, storage, cryptoObject, timers })
  const previous = loadMigrationState(storage)

  if (!indexedDbWorkspacesEnabled(envValue)) {
    // Once a browser has activated IndexedDB, returning to an old LocalStorage
    // snapshot would hide newer user work. The operational kill switch is safe
    // only for browsers that have not crossed the activation boundary.
    if (previous && previous.phase === 'active') {
      const error = new Error('IndexedDB workspace storage is already active for this browser and cannot be downgraded safely.')
      error.code = 'TRONIDE_STORAGE_DOWNGRADE_BLOCKED'
      throw error
    }
    return installLegacyStorage({ browserFS, targetWindow, lock, navigatorObject })
  }

  let migration
  try {
    migration = await openOrMigrateWorkspaceStorage({
      browserFS,
      storage,
      targetWindow,
      cryptoObject,
      onProgress: (progress) => {
        onProgress({ ...progress, message: progressMessage(progress) })
      }
    })
  } catch (error) {
    if ((previous && previous.phase === 'active') || error.code === ACTIVE_STORE_MISSING) throw error
    onProgress({ phase: 'failed', recoverable: true, message: 'Workspace upgrade failed; continuing with the unchanged legacy storage.' })
    return installLegacyStorage({ browserFS, targetWindow, lock, error, navigatorObject })
  }

  const mirror = await createAsyncMirror(browserFS, migration.fileSystem)
  const controller = new DurableMirrorController(migration.fileSystem).install(mirror)
  installRootFileSystem(browserFS, mirror, targetWindow)
  const service = createStorageService({ mode: MODE_INDEXED_DB, controller, lock, migration: migration.state, navigatorObject })
  targetWindow.tronideWorkspaceStorage = service
  return service
}

module.exports = {
  MODE_INDEXED_DB,
  MODE_LEGACY,
  indexedDbWorkspacesEnabled,
  progressMessage,
  createStorageService,
  bootstrapWorkspaceStorage
}
