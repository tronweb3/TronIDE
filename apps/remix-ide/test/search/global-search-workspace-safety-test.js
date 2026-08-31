/*
 * Regression coverage for global-search operations that outlive a workspace
 * switch or close-all-files event.
 */

'use strict'

var assert = require('assert')
var EventEmitter = require('events')
var Module = require('module')

var originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'yo-yo') return function () { return {} }
  if (request === 'csjs-inject') return function () { return {} }
  return originalLoad.call(this, request, parent, isMain)
}

global.window = {
  localStorage: {
    getItem: function () { return '[]' },
    setItem: function () {},
    removeItem: function () {}
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  confirm: function () { return true }
}

var GlobalSearchPanel = require('../../src/app/search/global-search-panel')
Module._load = originalLoad

var events = new EventEmitter()
var currentContext = { workspace: 'workspace-a', generation: 1 }
var provider = { captureMutationContext: function () { return currentContext } }
var writes = []
var fileManager = {
  events: events,
  fileProviderOf: function () { return provider },
  writeFile: async function () { writes.push(Array.from(arguments)) }
}
var panel = new GlobalSearchPanel(fileManager, null)
panel.query = 'needle'
panel.runSearchNow = async function () {}

panel.replacePreview = {
  canApply: true,
  totalMatches: 1,
  updates: [{ path: 'contracts/A.sol', content: 'new', previousContent: 'old' }]
}
panel._replaceIdentity = {
  identity: panel._captureWorkspaceIdentity(),
  epoch: panel._workspaceEpoch
}

;(async function () {
  await panel.applyReplace()
  assert.strictEqual(writes.length, 1, 'replace writes the preview exactly once')
  assert.deepStrictEqual(writes[0][2], currentContext, 'replace writes use the captured workspace context')

  currentContext = { workspace: 'workspace-b', generation: 2 }
  await panel.undoReplace()
  assert.strictEqual(writes.length, 1, 'undo does not write after the workspace changes')
  assert.strictEqual(panel.error.type, 'workspace', 'stale undo reports a workspace error')

  panel.results = [{ path: 'contracts/A.sol' }]
  panel.replacePreview = { canApply: true }
  events.emit('filesAllClosed')
  assert.deepStrictEqual(panel.results, [], 'close-all-files invalidates stale search results')
  assert.strictEqual(panel.replacePreview, null, 'close-all-files clears the replace preview')

  panel.onQueryInput('')
  assert.strictEqual(panel.replacePreview, null, 'clearing the query removes any replace preview')
  console.log('global search workspace safety tests passed')
})().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})

