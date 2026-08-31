/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const cryptoJs = require('crypto-js')
const {
  createLegacyFileSystem,
  createIndexedDbFileSystem,
  installRootFileSystem
} = require('./browserfs-factory')
const {
  loadMigrationState,
  saveMigrationState
} = require('./migration-state')

const TARGET_STORE_PREFIX = 'tronide-workspaces-v1-'
const MIGRATION_FAILED = 'TRONIDE_WORKSPACE_MIGRATION_FAILED'
const STORAGE_MARKER_PATH = '/.tronide-workspace-storage-v1'
const ACTIVE_STORE_MISSING = 'TRONIDE_ACTIVE_WORKSPACE_STORE_MISSING'

function fsCall (fs, method, ...args) {
  return new Promise((resolve, reject) => {
    fs[method](...args, (error, value) => error ? reject(error) : resolve(value))
  })
}

function normalizeRelativePath (value) {
  if (typeof value !== 'string') throw new Error('Workspace migration paths must be strings.')
  const path = value.replace(/^\/+|\/+$/g, '')
  if (!path) return ''
  if (path.includes('\\') || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Workspace migration encountered an unsafe path.')
  }
  return path
}

function rootedPath (root, relativePath) {
  const base = '/' + normalizeRelativePath(root)
  const relative = normalizeRelativePath(relativePath)
  return relative ? `${base}/${relative}` : base
}

function sha256Bytes (value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0)
  return cryptoJs.SHA256(cryptoJs.lib.WordArray.create(bytes)).toString()
}

function manifestView (entries) {
  return entries.map((entry) => ({
    path: entry.path,
    type: entry.type,
    size: entry.type === 'file' ? entry.size : 0,
    hash: entry.type === 'file' ? entry.hash : ''
  }))
}

function fingerprintManifest (entries) {
  return cryptoJs.SHA256(JSON.stringify(manifestView(entries))).toString()
}

async function pathStat (fs, path) {
  try { return await fsCall(fs, 'stat', path) } catch (error) {
    if (error && (error.code === 'ENOENT' || error.errno === 2)) return null
    throw error
  }
}

async function scanTree (fs, root = '/', { includeContent = false, onProgress = () => {} } = {}) {
  const entries = []
  let totalBytes = 0
  let fileCount = 0
  let directoryCount = 0

  async function visit (relativePath) {
    const absolutePath = rootedPath(root, relativePath)
    const stat = await pathStat(fs, absolutePath)
    if (!stat) return
    if (stat.isDirectory()) {
      if (relativePath) {
        entries.push({ path: relativePath, type: 'directory', size: 0, hash: '' })
        directoryCount++
      }
      const children = (await fsCall(fs, 'readdir', absolutePath)).slice().sort()
      for (const name of children) {
        const safeName = normalizeRelativePath(name)
        if (safeName.includes('/')) throw new Error('Workspace migration directory entries must be single path segments.')
        await visit(relativePath ? `${relativePath}/${safeName}` : safeName)
      }
      return
    }
    if (!stat.isFile()) throw new Error(`Unsupported workspace entry type at ${relativePath}.`)
    const content = await fsCall(fs, 'readFile', absolutePath)
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(content)
    const entry = {
      path: relativePath,
      type: 'file',
      size: bytes.byteLength,
      hash: sha256Bytes(bytes)
    }
    if (includeContent) entry.content = content
    entries.push(entry)
    fileCount++
    totalBytes += bytes.byteLength
    onProgress({ phase: 'scanning', fileCount, directoryCount, totalBytes })
  }

  await visit('')
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return {
    entries,
    fingerprint: fingerprintManifest(entries),
    fileCount,
    directoryCount,
    totalBytes
  }
}

async function removePath (fs, path, stat) {
  const current = stat || await pathStat(fs, path)
  if (!current) return
  if (current.isDirectory()) {
    const children = await fsCall(fs, 'readdir', path)
    for (const child of children) await removePath(fs, `${path.replace(/\/$/, '')}/${child}`)
    await fsCall(fs, 'rmdir', path)
  } else {
    await fsCall(fs, 'unlink', path)
  }
}

async function ensureDirectory (fs, path) {
  if (path === '/') return
  const existing = await pathStat(fs, path)
  if (existing && existing.isDirectory()) return
  if (existing) await removePath(fs, path, existing)
  const parent = path.slice(0, path.lastIndexOf('/')) || '/'
  await ensureDirectory(fs, parent)
  try { await fsCall(fs, 'mkdir', path) } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error
  }
}

async function synchronizeTree (fs, targetRoot, source, { onProgress = () => {} } = {}) {
  await ensureDirectory(fs, rootedPath(targetRoot, ''))
  const target = await scanTree(fs, rootedPath(targetRoot, ''))
  const sourceByPath = new Map(source.entries.map((entry) => [entry.path, entry]))

  // A resumed staging store may contain paths from an interrupted or older
  // attempt. Remove them deepest-first so verification compares exact trees.
  const stale = target.entries
    .filter((entry) => !sourceByPath.has(entry.path) || sourceByPath.get(entry.path).type !== entry.type)
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length)
  for (const entry of stale) await removePath(fs, rootedPath(targetRoot, entry.path))

  const directories = source.entries
    .filter((entry) => entry.type === 'directory')
    .sort((left, right) => left.path.split('/').length - right.path.split('/').length)
  for (const entry of directories) await ensureDirectory(fs, rootedPath(targetRoot, entry.path))

  let completed = 0
  let copiedBytes = 0
  for (const entry of source.entries.filter((candidate) => candidate.type === 'file')) {
    const targetPath = rootedPath(targetRoot, entry.path)
    await ensureDirectory(fs, targetPath.slice(0, targetPath.lastIndexOf('/')) || '/')
    let alreadyCurrent = false
    const existing = await pathStat(fs, targetPath)
    if (existing && existing.isFile() && existing.size === entry.size) {
      const current = await fsCall(fs, 'readFile', targetPath)
      alreadyCurrent = sha256Bytes(current) === entry.hash
    }
    if (!alreadyCurrent) {
      if (existing && !existing.isFile()) await removePath(fs, targetPath, existing)
      await fsCall(fs, 'writeFile', targetPath, entry.content)
      const written = await fsCall(fs, 'readFile', targetPath)
      if (sha256Bytes(written) !== entry.hash) throw new Error(`Workspace migration verification failed for ${entry.path}.`)
    }
    completed++
    copiedBytes += entry.size
    onProgress({ phase: 'copying', completed, total: source.fileCount, copiedBytes, totalBytes: source.totalBytes })
  }
}

function randomStoreName (cryptoObject = typeof crypto !== 'undefined' ? crypto : null) {
  let suffix = ''
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    const bytes = new Uint8Array(12)
    cryptoObject.getRandomValues(bytes)
    suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } else {
    suffix = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`
  }
  return (TARGET_STORE_PREFIX + suffix).slice(0, 120)
}

function safeErrorCode (error) {
  const code = String((error && error.code) || MIGRATION_FAILED).toUpperCase()
  return /^[A-Z0-9_]{1,80}$/.test(code) ? code : MIGRATION_FAILED
}

function markerContent (targetStore) {
  return JSON.stringify({ version: 1, targetStore })
}

async function writeStorageMarker (fs, targetStore) {
  const expected = markerContent(targetStore)
  await fsCall(fs, 'writeFile', STORAGE_MARKER_PATH, expected, 'utf8')
  const actual = await fsCall(fs, 'readFile', STORAGE_MARKER_PATH, 'utf8')
  if (actual !== expected) throw new Error('IndexedDB workspace marker could not be verified.')
}

async function assertStorageMarker (fs, targetStore) {
  try {
    const actual = await fsCall(fs, 'readFile', STORAGE_MARKER_PATH, 'utf8')
    if (actual === markerContent(targetStore)) return true
  } catch (error) {
    if (!error || (error.code !== 'ENOENT' && error.errno !== 2)) throw error
  }
  const error = new Error('The active IndexedDB workspace store is missing or incomplete. Retry recovery instead of opening a stale LocalStorage snapshot.')
  error.code = ACTIVE_STORE_MISSING
  throw error
}

async function openOrMigrateWorkspaceStorage ({
  browserFS,
  storage,
  targetWindow,
  cryptoObject,
  onProgress = () => {}
}) {
  const previous = loadMigrationState(storage)
  if (previous && previous.phase === 'active') {
    const fileSystem = await createIndexedDbFileSystem(browserFS, previous.targetStore)
    const activeFs = installRootFileSystem(browserFS, fileSystem, targetWindow)
    await assertStorageMarker(activeFs, previous.targetStore)
    return { fileSystem, state: previous, migrated: false }
  }

  const legacyFileSystem = await createLegacyFileSystem(browserFS)
  const legacyFs = installRootFileSystem(browserFS, legacyFileSystem, targetWindow)
  onProgress({ phase: 'scanning' })
  const source = await scanTree(legacyFs, '/', { includeContent: true, onProgress })
  const canResume = previous && previous.targetStore && previous.sourceFingerprint === source.fingerprint
  const targetStore = canResume ? previous.targetStore : randomStoreName(cryptoObject)
  let state = saveMigrationState(storage, {
    version: 1,
    phase: 'copying',
    targetStore,
    sourceFingerprint: source.fingerprint,
    fileCount: source.fileCount,
    directoryCount: source.directoryCount,
    totalBytes: source.totalBytes
  })

  try {
    const targetFileSystem = await createIndexedDbFileSystem(browserFS, targetStore)
    const targetFs = installRootFileSystem(browserFS, targetFileSystem, targetWindow)
    await synchronizeTree(targetFs, '/', source, { onProgress })
    state = saveMigrationState(storage, { ...state, phase: 'verifying' })
    onProgress({ phase: 'verifying', fileCount: source.fileCount, totalBytes: source.totalBytes })
    const verified = await scanTree(targetFs, '/')
    if (verified.fingerprint !== source.fingerprint) throw new Error('The migrated workspace tree does not match the LocalStorage source.')
    await writeStorageMarker(targetFs, targetStore)
    state = saveMigrationState(storage, { ...state, phase: 'active', errorCode: '' })
    onProgress({ phase: 'active', fileCount: source.fileCount, totalBytes: source.totalBytes })
    return { fileSystem: targetFileSystem, state, migrated: true }
  } catch (error) {
    saveMigrationState(storage, { ...state, phase: 'failed', errorCode: safeErrorCode(error) })
    error.code = error.code || MIGRATION_FAILED
    throw error
  }
}

module.exports = {
  TARGET_STORE_PREFIX,
  MIGRATION_FAILED,
  STORAGE_MARKER_PATH,
  ACTIVE_STORE_MISSING,
  normalizeRelativePath,
  sha256Bytes,
  fingerprintManifest,
  scanTree,
  synchronizeTree,
  randomStoreName,
  assertStorageMarker,
  openOrMigrateWorkspaceStorage
}
