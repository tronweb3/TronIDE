/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const Module = require('module')
const test = require('tape')
const { DurableMirrorController, STORAGE_UNAVAILABLE } = require('../src/lib/workspace-storage/durable-mirror')
const { createStorageService } = require('../src/lib/workspace-storage/bootstrap')

function loadFileProvider (targetWindow) {
  const originalLoad = Module._load
  class Storage {
    set () {}
    get () { return undefined }
    remove () {}
    exists () { return false }
    keys () { return [] }
  }
  const stubs = {
    '@remix-project/core-plugin': { CompilerImports: class {} },
    '../ui/modal-dialog-custom': { alert () {} },
    '../ui/tooltip': function () {},
    '@remix-project/remix-lib': { Storage }
  }
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const babelRegister = require('@babel/register')
  // This focused test stubs every UI dependency it needs. Keep Babel on the
  // single ESM transform so the reduced CI sandbox does not load the full
  // repository-wide Nx/React Babel toolchain.
  babelRegister({
    extensions: ['.js'],
    cache: false,
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs']
  })
  const modulePath = require.resolve('../src/app/files/fileProvider')
  delete require.cache[modulePath]
  global.window = targetWindow
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function persistenceHarness () {
  const pending = []
  const asyncFileSystem = {
    writeFile (filePath, content, callback) {
      pending.push({ filePath, content, callback })
    }
  }
  const mirror = { _queue: [], _queueRunning: false, enqueueOp () {} }
  const controller = new DurableMirrorController(asyncFileSystem).install(mirror)
  const files = new Map([['/contract.sol', 'before']])
  const targetWindow = {
    remixFileSystem: {
      existsSync: (filePath) => files.has(filePath),
      readFileSync: (filePath) => files.get(filePath),
      writeFileSync (filePath, content) {
        files.set(filePath, content)
        mirror.enqueueOp({ apiMethod: 'writeFile', arguments: [filePath, content] })
      }
    }
  }
  targetWindow.tronideWorkspaceStorage = createStorageService({
    mode: 'indexeddb-mirror',
    controller,
    lock: { kind: 'test', release () {} }
  })
  return { controller, files, pending, targetWindow }
}

test('workspace writes report success only after IndexedDB persistence', async (t) => {
  const harness = persistenceHarness()
  const FileProvider = loadFileProvider(harness.targetWindow)
  const provider = new FileProvider('browser')
  let callbackResult = 'pending'
  const saved = provider.set('browser/contract.sol', 'after', (error) => { callbackResult = error || 'saved' })
  let duplicateCallback = 'pending'
  const duplicate = provider.set('browser/contract.sol', 'after', (error) => { duplicateCallback = error || 'saved' })

  t.equal(harness.files.get('/contract.sol'), 'after', 'the AsyncMirror-facing copy changes in the same event turn')
  t.equal(callbackResult, 'pending', 'the UI callback is held behind the durability checkpoint')
  t.equal(duplicateCallback, 'pending', 'an identical autosave joins the pending durability checkpoint')
  t.equal(harness.controller.getStatus().state, 'saving', 'runtime status exposes the pending IndexedDB write')
  t.equal(harness.pending.length, 1, 'the persistent backend received the write')

  harness.pending.shift().callback()
  t.equal(await saved, true, 'the provider resolves after the persistent backend acknowledges the write')
  t.equal(await duplicate, true, 'a duplicate save resolves from the same durable boundary')
  t.equal(callbackResult, 'saved', 'saved UI events can now be emitted truthfully')
  t.equal(duplicateCallback, 'saved', 'duplicate saved UI events are also truthful')
  t.equal(harness.controller.getStatus().state, 'idle', 'the durability checkpoint becomes idle')
  t.end()
})

test('a failed IndexedDB write blocks later workspace mutations', async (t) => {
  const harness = persistenceHarness()
  const FileProvider = loadFileProvider(harness.targetWindow)
  const provider = new FileProvider('browser')
  let callbackError
  const failed = provider.set('browser/contract.sol', 'not durable', (error) => { callbackError = error })
  const diskError = new Error('quota exceeded')
  harness.pending.shift().callback(diskError)

  try {
    await failed
    t.fail('the failed durability checkpoint must reject')
  } catch (error) {
    t.equal(error, diskError, 'the original IndexedDB failure reaches awaiting callers')
  }
  t.equal(callbackError, diskError, 'legacy callbacks receive the same persistence failure')
  t.equal(harness.controller.getStatus().state, 'failed', 'the storage service remains visibly failed')

  let blockedError
  const blocked = provider.set('browser/contract.sol', 'must not land', (error) => { blockedError = error })
  t.equal(blocked, false, 'later writes fail closed instead of changing memory only')
  t.equal(blockedError && blockedError.code, STORAGE_UNAVAILABLE, 'the blocked write has a stable recovery code')
  t.equal(harness.files.get('/contract.sol'), 'not durable', 'no later bytes enter the in-memory workspace')
  t.end()
})

test('save, Git, and runtime UI paths consume the durability barrier', (t) => {
  const root = path.resolve(__dirname, '../../..')
  const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
  const fileManager = read('apps/remix-ide/src/app/files/fileManager.js')
  const gitProvider = read('apps/remix-ide/src/app/files/dgitProvider.js')
  const main = read('apps/remix-ide/src/main.js')

  t.ok(/provider\.set\(currentFile, input, \(error\) => \{[\s\S]*this\.emit\('fileSaved'/.test(fileManager), 'fileSaved is emitted from the durable provider callback')
  t.ok(gitProvider.includes('await this._waitForWorkspaceDurability()'), 'Git rewrite operations wait for IndexedDB before unlocking editors')
  t.ok(gitProvider.includes('storage.assertWritable()'), 'new Git mutations are refused after a persistence failure')
  t.ok(main.includes('Saving locally…') && main.includes('Saved locally.') && main.includes('Local save failed.'), 'the workbench distinguishes saving, saved, and failed states')
  t.ok(main.includes('Protect local workspaces'), 'persistent storage remains an explicit user action')
  t.end()
})
