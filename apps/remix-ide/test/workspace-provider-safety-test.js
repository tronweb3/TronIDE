/*
 * Regression coverage for workspace name and path boundary checks.
 */

'use strict'

var Module = require('module')
var test = require('tape')

function loadWorkspaceProvider () {
  var originalLoad = Module._load
  var lastWorkspaceWrites = []

  class StubFileProvider {
    constructor (name) {
      this.type = name
    }

    removePrefix (value) {
      value = value.indexOf(this.type) === 0 ? value.replace(this.type, '') : value
      return value === '' ? '/' : value
    }
  }

  var stubs = {
    './fileProvider': StubFileProvider,
    '../../lib/last-workspace': {
      set: function (value) { lastWorkspaceWrites.push(value) }
    }
  }

  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }

  var modulePath = require.resolve('../src/app/files/workspaceFileProvider')
  delete require.cache[modulePath]
  try {
    return { Provider: require(modulePath), lastWorkspaceWrites: lastWorkspaceWrites }
  } finally {
    Module._load = originalLoad
  }
}

test('WorkspaceFileProvider rejects unsafe names and preserves path boundaries', function (t) {
  var loaded = loadWorkspaceProvider()
  var provider = new loaded.Provider()

  provider.setWorkspace('foo')
  t.equal(provider.getWorkspace(), 'foo', 'a simple workspace name is accepted')
  t.equal(provider.removePrefix('foobar/secret.sol'), '.workspaces/foo/foobar/secret.sol', 'a sibling prefix cannot escape into another workspace')
  t.equal(provider.removePrefix('.workspaces/foo/contracts/A.sol'), '.workspaces/foo/contracts/A.sol', 'an already-scoped path remains in the active workspace')
  t.throws(function () { provider.removePrefix('foo/../secret.sol') }, /outside workspace/, 'dot-segment traversal is rejected')
  t.throws(function () { provider.removePrefix('foo\\..\\secret.sol') }, /POSIX separators/, 'backslash traversal is rejected')

  ;['..', '.', 'foo/bar', 'foo\\bar', ''].forEach(function (unsafe) {
    t.throws(function () { provider.setWorkspace(unsafe) }, /single safe path segment/, 'unsafe workspace name is rejected: ' + JSON.stringify(unsafe))
  })

  provider.setWorkspace('/bar/')
  t.equal(provider.getWorkspace(), 'bar', 'outer slashes are normalized without adding path segments')
  t.deepEqual(loaded.lastWorkspaceWrites, ['foo', 'bar'], 'only normalized names are persisted')
  t.end()
})
