/*
 * Focused regression coverage for the UI findings fixed in v2.3.3.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var EventEmitter = require('events')
var test = require('tape')

var repoRoot = path.join(__dirname, '../..', '..')

function read (relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('FileExplorer action listeners are instance-scoped and removable', function (t) {
  var actions = require('../../../libs/remix-ui/file-explorer/src/lib/actions/fileSystem.ts')
  var provider = new EventEmitter()
  provider.event = provider
  provider.type = 'browser'
  provider.resolveDirectory = function (folder, callback) {
    setTimeout(function () { callback(null, {}) }, 5)
  }
  provider.isReadOnly = function () { return false }
  var plugin = new EventEmitter()
  var registry = { get: function () { return { api: { get: function () {}, currentContent: function () { return '' } } } } }
  var dispatched = []
  var cleanup = actions.init(provider, plugin, registry)(function (action) { dispatched.push(action) })

  t.equal(provider.listenerCount('fileAdded'), 1, 'init registers one provider listener')
  cleanup()
  t.equal(provider.listenerCount('fileAdded'), 0, 'cleanup removes the provider listener')
  provider.emit('fileAdded', 'browser/example.sol')
  setTimeout(function () {
    t.equal(dispatched.filter(function (action) { return action.type === 'FILE_ADDED' }).length, 0, 'events after cleanup cannot dispatch stale state')
    t.end()
  }, 15)
})

test('FileSystem reducer keeps previous trees immutable', function (t) {
  var reducer = require('../../../libs/remix-ui/file-explorer/src/lib/reducers/fileSystem.ts').fileSystemReducer
  var provider = { type: 'browser' }
  var state = reducer(undefined, { type: 'FETCH_PROVIDER_SUCCESS', payload: provider })
  state = reducer(state, {
    type: 'FETCH_DIRECTORY_SUCCESS',
    payload: { path: 'browser', files: { browser: { 'browser/example.sol': { type: 'file' } } } }
  })
  var previousTree = state.files.files
  var next = reducer(state, {
    type: 'FILE_REMOVED',
    payload: { path: 'browser', removePath: 'browser/example.sol' }
  })

  t.notEqual(next.files.files, previousTree, 'a removal returns a new tree')
  t.ok(previousTree.browser['browser/example.sol'], 'the previous tree still contains its file')
  t.notOk(next.files.files.browser['browser/example.sol'], 'the next tree removes its file')
  t.end()
})

test('UI fixes retain their fail-closed guards', function (t) {
  var actions = read('libs/remix-ui/file-explorer/src/lib/actions/fileSystem.ts')
  var explorer = read('libs/remix-ui/file-explorer/src/lib/file-explorer.tsx')
  var menu = read('libs/remix-ui/file-explorer/src/lib/file-explorer-context-menu.tsx')
  var reducer = read('libs/remix-ui/file-explorer/src/lib/reducers/fileSystem.ts')
  var panel = read('apps/remix-ide/src/app/panels/file-panel.js')
  var tabs = read('apps/remix-ide/src/app/panels/tab-proxy.js')
  var toaster = read('libs/remix-ui/toaster/src/lib/toaster.tsx')
  var modal = read('libs/remix-ui/modal-dialog/src/lib/remix-ui-modal-dialog.tsx')
  var terminal = read('apps/remix-ide/src/app/panels/terminal.js')
  var ipfs = read('libs/remix-ui/publish-to-storage/src/lib/publishToIPFS.tsx')
  var swarm = read('libs/remix-ui/publish-to-storage/src/lib/publishOnSwarm.tsx')

  t.ok(actions.indexOf('return () => {') !== -1 && actions.indexOf('const queuedEvents = []') > actions.indexOf('export const init'), 'file-system listeners are scoped to init')
  t.ok(explorer.indexOf('return init(props.filesProvider, props.plugin, props.registry)(dispatch)') !== -1, 'FileExplorer returns listener cleanup')
  t.ok(explorer.indexOf('}, [removedContextMenuItems])') !== -1, 'removed menu items trigger their own effect')
  t.ok(menu.indexOf('try {') !== -1 && menu.indexOf('new RegExp(value).test(itemPath)') !== -1, 'malformed patterns fail closed during rendering')
  t.ok(panel.indexOf('Invalid pattern matching criteria provided') !== -1, 'plugin patterns are validated at registration')
  t.ok(tabs.indexOf('tab.name.slice(oldPrefix.length)') !== -1, 'folder tab renames use the complete old prefix')
  t.ok(reducer.indexOf('const setAtPath') !== -1 && reducer.indexOf('delete prevFiles.child') === -1, 'reducer updates do not mutate the previous tree')
  t.ok(toaster.indexOf('messageGeneration') !== -1 && toaster.indexOf('clearAutoHideTimer') !== -1, 'toaster timers are generation-scoped and cleaned up')
  t.ok(modal.indexOf('runActionAndHide') !== -1, 'modal actions always run the hide path')
  t.equal(terminal.indexOf("self.event.trigger('resize', [])\n      self.event.trigger('resize', [])"), -1, 'terminal resize is not emitted twice by one listener')
  t.ok(ipfs.indexOf('new Promise') !== -1 && ipfs.indexOf('const sourceFiles = await Promise.all') !== -1, 'IPFS waits for every provider read')
  t.ok(swarm.indexOf('new Promise') !== -1 && swarm.indexOf('const sourceFiles = await Promise.all') !== -1, 'Swarm waits for every provider read')
  t.end()
})
