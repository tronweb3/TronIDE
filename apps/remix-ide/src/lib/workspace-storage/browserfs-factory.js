/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const DEFAULT_INDEXED_DB_STORE = 'tronide-workspaces-v1'

function validateBrowserFS (browserFS) {
  if (!browserFS || typeof browserFS.getFileSystem !== 'function' || typeof browserFS.initialize !== 'function') {
    throw new Error('BrowserFS is unavailable or incomplete.')
  }
  return browserFS
}

function validateStoreName (storeName) {
  if (typeof storeName !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(storeName)) {
    throw new Error('IndexedDB workspace store name is invalid.')
  }
  return storeName
}

function getFileSystem (browserFS, config) {
  validateBrowserFS(browserFS)
  return new Promise((resolve, reject) => {
    browserFS.getFileSystem(config, (error, fileSystem) => {
      if (error) return reject(error)
      if (!fileSystem) return reject(new Error('BrowserFS did not return a file system.'))
      resolve(fileSystem)
    })
  })
}

function createLegacyFileSystem (browserFS) {
  return getFileSystem(browserFS, { fs: 'LocalStorage' })
}

async function createIndexedDbFileSystem (browserFS, storeName = DEFAULT_INDEXED_DB_STORE) {
  const fileSystem = await getFileSystem(browserFS, {
    fs: 'IndexedDB',
    options: { storeName: validateStoreName(storeName) }
  })
  // The BrowserFS bundle shipped by TronIDE constructs IndexedDBFileSystem
  // without invoking its asynchronous `init` helper. A brand-new object store
  // therefore has no `/` inode and its first mkdir fails with ENOENT. The
  // inherited helper is idempotent, so run it for both new and existing stores
  // before migration or AsyncMirror hydration begins.
  if (typeof fileSystem.makeRootDirectory === 'function') {
    await new Promise((resolve, reject) => {
      fileSystem.makeRootDirectory((error) => error ? reject(error) : resolve())
    })
  }
  return fileSystem
}

function createInMemoryFileSystem (browserFS) {
  return getFileSystem(browserFS, { fs: 'InMemory' })
}

async function createAsyncMirror (browserFS, asyncFileSystem) {
  validateBrowserFS(browserFS)
  if (!asyncFileSystem) throw new Error('AsyncMirror requires an IndexedDB file system.')
  if (!browserFS.FileSystem || !browserFS.FileSystem.AsyncMirror || typeof browserFS.FileSystem.AsyncMirror.Create !== 'function') {
    throw new Error('This BrowserFS build does not provide AsyncMirror.')
  }

  const syncFileSystem = await createInMemoryFileSystem(browserFS)
  return new Promise((resolve, reject) => {
    browserFS.FileSystem.AsyncMirror.Create({
      sync: syncFileSystem,
      async: asyncFileSystem
    }, (error, mirror) => {
      if (error) return reject(error)
      if (!mirror) return reject(new Error('BrowserFS did not create an AsyncMirror.'))
      resolve(mirror)
    })
  })
}

function installRootFileSystem (browserFS, rootFileSystem, targetWindow) {
  validateBrowserFS(browserFS)
  if (!rootFileSystem) throw new Error('A BrowserFS root file system is required.')
  browserFS.initialize(rootFileSystem)
  const fs = browserFS.BFSRequire('fs')
  if (!fs) throw new Error('BrowserFS did not expose its Node-compatible fs API.')
  if (targetWindow) targetWindow.remixFileSystem = fs
  return fs
}

module.exports = {
  DEFAULT_INDEXED_DB_STORE,
  validateStoreName,
  getFileSystem,
  createLegacyFileSystem,
  createIndexedDbFileSystem,
  createInMemoryFileSystem,
  createAsyncMirror,
  installRootFileSystem
}
