/* Regression coverage for the remixd provider's path-keyed cache. */

'use strict'

var Module = require('module')
var test = require('tape')

function loadProvider () {
  var originalLoad = Module._load
  function FileProvider (name) {
    this.type = name
    this.event = { emit: function () {} }
  }
  FileProvider.prototype.removePrefix = function (path) {
    var unprefixed = path.indexOf(this.type) === 0 ? path.replace(this.type, '') : path
    if (unprefixed[0] === '/') return unprefixed.substring(1)
    return unprefixed === '' ? '/' : unprefixed
  }
  Module._load = function (request, parent, isMain) {
    if (request === './fileProvider') return FileProvider
    return originalLoad.call(this, request, parent, isMain)
  }
  var babelRegister = require('@babel/register')
  babelRegister({ extensions: ['.js'], cache: false })
  var modulePath = require.resolve('../src/app/files/remixDProvider')
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

test('RemixDProvider uses canonical cache keys and registers events once', async function (t) {
  var Provider = loadProvider()
  var registrations = []
  var manager = {
    on: function (plugin, event) { registrations.push(plugin + ':' + event) },
    call: function (plugin, method) {
      if (method === 'get') return Promise.resolve({ content: 'cached', readonly: true })
      if (method === 'folderIsReadOnly') return Promise.resolve(false)
      return Promise.resolve(true)
    }
  }
  var provider = new Provider(manager)
  provider._isReady = true
  await new Promise(function (resolve) { provider.get('localhost/contracts/A.sol', function () { resolve() }) })
  t.equal(provider.filesContent['localhost/contracts/A.sol'], 'cached', 'get stores content under the caller-visible path')
  await provider.remove('localhost/contracts/A.sol')
  t.equal(Object.prototype.hasOwnProperty.call(provider.filesContent, 'localhost/contracts/A.sol'), false, 'remove clears the same canonical cache key')

  provider.filesContent['localhost/contracts/Old.sol'] = 'old'
  provider._readOnlyFiles['localhost/contracts/Old.sol'] = 1
  await provider.rename('localhost/contracts/Old.sol', 'localhost/contracts/New.sol', false)
  t.equal(provider.filesContent['localhost/contracts/New.sol'], 'old', 'rename moves cached content to the new visible path')
  t.equal(provider._readOnlyFiles['localhost/contracts/New.sol'], 1, 'rename moves read-only metadata with the content')
  t.equal(Object.prototype.hasOwnProperty.call(provider.filesContent, 'localhost/contracts/Old.sol'), false, 'rename removes the old cache key')

  provider._isReady = false
  await new Promise(function (resolve, reject) {
    provider.init(function (error) { if (error) reject(error); else resolve() })
  })
  var firstRegistrationCount = registrations.length
  provider.close(function () {})
  await new Promise(function (resolve, reject) {
    provider.init(function (error) { if (error) reject(error); else resolve() })
  })
  t.equal(registrations.length, firstRegistrationCount, 'reconnects do not duplicate remixd listeners')
  t.end()
})
