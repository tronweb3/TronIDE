/*
 * Regression coverage for asynchronous provider tree operations.
 */

'use strict'

var Module = require('module')
var test = require('tape')

function loadFileProvider (fileSystem) {
  var originalLoad = Module._load
  var Storage = class {
    set () {}
    get () { return undefined }
    remove () {}
    exists () { return false }
    keys () { return [] }
  }
  var stubs = {
    '@remix-project/core-plugin': { CompilerImports: class {} },
    '../ui/modal-dialog-custom': { alert: function () {} },
    '../ui/tooltip': function () {},
    '@remix-project/remix-lib': { Storage: Storage }
  }
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  var babelRegister = require('@babel/register')
  babelRegister({ extensions: ['.js'], cache: false })
  var modulePath = require.resolve('../src/app/files/fileProvider')
  delete require.cache[modulePath]
  global.window = { remixFileSystem: fileSystem }
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function memoryFileSystem (initial) {
  var entries = new Map()
  function normalize (value) {
    var path = String(value || '/').replace(/\\/g, '/').replace(/\/+/g, '/')
    if (path[0] !== '/') path = '/' + path
    if (path.length > 1) path = path.replace(/\/$/, '')
    return path
  }
  function add (path, entry) { entries.set(normalize(path), entry) }
  Object.keys(initial).forEach(function (path) { add(path, initial[path]) })
  function childrenOf (path) {
    var prefix = normalize(path) === '/' ? '/' : normalize(path) + '/'
    return Array.from(entries.keys()).filter(function (candidate) {
      if (!candidate.startsWith(prefix) || candidate === normalize(path)) return false
      return candidate.slice(prefix.length).indexOf('/') === -1
    }).map(function (candidate) { return candidate.slice(prefix.length) })
  }
  return {
    existsSync: function (path) { return entries.has(normalize(path)) },
    statSync: function (path) {
      var entry = entries.get(normalize(path))
      if (!entry) throw new Error('ENOENT')
      return { isDirectory: function () { return entry.type === 'dir' }, isFile: function () { return entry.type === 'file' } }
    },
    readdirSync: function (path) { return childrenOf(path) },
    readFileSync: function (path) {
      var entry = entries.get(normalize(path))
      if (!entry || entry.type !== 'file') throw new Error('EISDIR')
      return entry.content
    },
    unlinkSync: function (path) {
      var normalized = normalize(path)
      if (!entries.delete(normalized)) throw new Error('ENOENT')
    },
    rmdirSync: function (path) {
      var normalized = normalize(path)
      if (childrenOf(normalized).length) throw new Error('ENOTEMPTY')
      if (!entries.delete(normalized)) throw new Error('ENOENT')
    },
    _entries: entries
  }
}

test('FileProvider waits for recursive removal and folder snapshots', async function (t) {
  var fs = memoryFileSystem({
    '/root': { type: 'dir' },
    '/root/one.sol': { type: 'file', content: 'one' },
    '/root/nested': { type: 'dir' },
    '/root/nested/two.sol': { type: 'file', content: 'two' }
  })
  var FileProvider = loadFileProvider(fs)
  var provider = new FileProvider('browser')
  var removed = await provider.remove('browser/root')
  t.equal(removed, true, 'recursive removal resolves only after descendants are gone')
  t.equal(fs._entries.size, 0, 'all nested files and folders are removed before completion')

  fs = memoryFileSystem({
    '/root': { type: 'dir' },
    '/root/one.sol': { type: 'file', content: 'one' },
    '/root/nested': { type: 'dir' },
    '/root/nested/two.sol': { type: 'file', content: 'two' }
  })
  FileProvider = loadFileProvider(fs)
  provider = new FileProvider('browser')
  var visitedFiles = []
  var snapshot = await provider.copyFolderToJson('browser/root', function (file) { visitedFiles.push(file.path) })
  t.deepEqual(visitedFiles.sort(), ['/root/one.sol', '/root/nested/two.sol'].sort(), 'folder snapshots visit every nested file before resolving')
  t.equal(snapshot['/root/nested'].children['/root/nested/two.sol'].content, 'two', 'nested content is retained in the resolved snapshot')
  t.end()
})
