/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict'

var test = require('tape')
var GistHandler = require('../src/lib/gist-handler')

test('GistHandler.handleLoad accepts direct gist ids', function (t) {
  t.plan(2)

  var handler = new GistHandler({})
  var calledWith = null
  var loading = handler.handleLoad({ gist: 'abcdef123456' }, function (gistId) {
    calledWith = gistId
  })

  t.equal(loading, true)
  t.equal(calledWith, 'abcdef123456')
})

test('GistHandler.handleLoad extracts ids from prompted urls', function (t) {
  t.plan(2)

  var modal = {
    prompt: function (_title, _text, _value, ok) {
      ok('https://gist.github.com/tron/abcdef1234567890')
    },
    alert: function () {}
  }
  var handler = new GistHandler(modal)
  var calledWith = null
  var loading = handler.handleLoad({ gist: '' }, function (gistId) {
    calledWith = gistId
  })

  t.equal(loading, true)
  t.equal(calledWith, 'abcdef1234567890')
})

test('GistHandler.handleLoad redacts github token-like values before id extraction', function (t) {
  t.plan(2)

  var alertMessage = null
  var modal = {
    prompt: function (_title, _text, _value, ok) {
      ok('https://gist.github.com/?token=ghp_abcdefghijklmnopqrstuvwxyz')
    },
    alert: function (_title, message) {
      alertMessage = message
    }
  }
  var handler = new GistHandler(modal)
  var called = false
  var loading = handler.handleLoad({ gist: '' }, function () {
    called = true
  })

  t.equal(loading, true)
  t.equal(called || alertMessage === 'Error while loading gist. Please provide a valid Gist ID or URL.', true)
})

// Regression for "gist file shows in the tree but opens empty": loadFromGist must
// write a file's inline content, backfill a truncated file from its raw_url, and
// skip (with an alert) a file whose content cannot be recovered — never writing a
// blank file. fetch + fileManager are stubbed so this is deterministic.
test('GistHandler.loadFromGist writes content, backfills truncated files, and skips unrecoverable ones', function (t) {
  t.plan(4)
  var GID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
  var INLINE = 'contract Inline { uint256 a = 1; }'
  var BIG = 'contract Big { uint256 b = 2; }'
  global.window = {
    fetch: function (url) {
      var u = String(url)
      if (u.indexOf('api.github.com/gists/') !== -1) {
        var payload = JSON.stringify({
          id: GID,
          files: {
            'Inline.sol': { truncated: false, content: INLINE, raw_url: 'https://gist.githubusercontent.com/raw/' + GID + '/Inline.sol' },
            'Big.sol': { truncated: true, content: '', raw_url: 'https://gist.githubusercontent.com/raw/' + GID + '/Big.sol' },
            'Lost.sol': { truncated: true, content: '', raw_url: 'https://gist.githubusercontent.com/raw/' + GID + '/Lost.sol' }
          }
        })
        return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(payload) } })
      }
      if (u.indexOf('/Big.sol') !== -1) return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(BIG) } })
      return Promise.resolve({ ok: false, status: 403, text: function () { return Promise.resolve('rate limited') } }) // Lost.sol raw fails
    }
  }
  var alertMsg = null
  var handler = new GistHandler({ prompt: function () {}, alert: function (_title, m) { alertMsg = m } })
  var fileManager = {
    getProvider: function () { return { lastLoadedGistId: null } },
    setBatchFiles: function (obj, _ws, _override, cb) {
      var keyOf = function (name) { return Object.keys(obj).filter(function (k) { return k.indexOf('/' + name) !== -1 })[0] }
      var inlineKey = keyOf('Inline.sol')
      var bigKey = keyOf('Big.sol')
      t.equal(inlineKey && obj[inlineKey].content, INLINE, 'inline file written with its content')
      t.equal(bigKey && obj[bigKey].content, BIG, 'truncated Big.sol backfilled from raw_url')
      t.equal(keyOf('Lost.sol'), undefined, 'unrecoverable Lost.sol is NOT written (no blank file)')
      t.equal(/Lost\.sol/.test(String(alertMsg)), true, 'an alert names the file that could not be loaded')
      delete global.window
      if (cb) cb()
    }
  }
  handler.loadFromGist({ gist: GID }, fileManager)
})

// Regression for "local compiles but gist read fails with a version-skew error"
// (e.g. Declaration "Arrays" not found): a gist that baked in the resolved dependency
// cache (.deps/npm/...) must NOT have those files written into the workspace — they
// would shadow the import resolver's fresh fetch. The real contract is still written;
// no raw fetch is even attempted for the skipped deps (and they don't show as unresolved).
test('GistHandler.loadFromGist strips .deps/ files baked into a gist', function (t) {
  t.plan(4)
  var GID = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'
  var SRC = 'contract GameItems {}'
  var rawFetched = []
  global.window = {
    fetch: function (url) {
      var u = String(url)
      if (u.indexOf('api.github.com/gists/') !== -1) {
        var payload = JSON.stringify({
          id: GID,
          files: {
            // gist keys are flattened with '...' (loadFromGist turns them back into '/').
            'TRC1155_self.sol': { truncated: false, content: SRC },
            '.deps...npm...@openzeppelin...contracts...utils...Arrays.sol': { truncated: true, content: '', raw_url: 'https://gist.githubusercontent.com/raw/' + GID + '/Arrays.sol' },
            '.deps...npm...@openzeppelin...contracts...token...ERC1155...ERC1155.sol': { truncated: false, content: 'stale' }
          }
        })
        return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(payload) } })
      }
      rawFetched.push(u)
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('should not be fetched') } })
    }
  }
  var alertMsg = null
  var handler = new GistHandler({ prompt: function () {}, alert: function (_title, m) { alertMsg = m } })
  var fileManager = {
    getProvider: function () { return { lastLoadedGistId: null } },
    setBatchFiles: function (obj, _ws, _override, cb) {
      var keys = Object.keys(obj)
      t.equal(keys.filter(function (k) { return k.indexOf('TRC1155_self.sol') !== -1 }).length, 1, 'the real contract is written')
      t.equal(keys.filter(function (k) { return k.indexOf('.deps/') !== -1 }).length, 0, 'no .deps/ files written into the workspace')
      t.equal(rawFetched.length, 0, 'no raw fetch attempted for skipped .deps files')
      t.equal(alertMsg, null, 'skipped deps do not trigger an "unresolved" alert')
      delete global.window
      if (cb) cb()
    }
  }
  handler.loadFromGist({ gist: GID }, fileManager)
})

// Regression for "all raw gist files fail with a CORS error even with a token configured":
// gist.githubusercontent.com only allows CORS-simple GETs, so the raw_url backfill must NOT
// send an Authorization header (that forces an unanswered preflight). The token still goes to
// api.github.com to lift the rate limit. We stub a configured token via the registry and assert
// the raw request is sent header-less while the API request carries the token.
test('GistHandler.loadFromGist does not send Authorization on raw_url fetches (CORS-simple)', function (t) {
  t.plan(3)
  var GID = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7'
  var BIG = 'contract Big { uint256 b = 2; }'

  // Stub the registry so getGistAccessToken() returns a token.
  var registryPath = require.resolve('../src/global/registry')
  var savedRegistry = require.cache[registryPath]
  require.cache[registryPath] = {
    id: registryPath,
    filename: registryPath,
    loaded: true,
    exports: { get: function () { return { api: { get: function () { return 'ghp_testtoken1234567890' } } } } }
  }

  var apiAuth = 'MISSING'
  var rawAuth = 'MISSING'
  global.window = {
    fetch: function (url, opts) {
      var u = String(url)
      var headers = (opts && opts.headers) || {}
      if (u.indexOf('api.github.com/gists/') !== -1) {
        apiAuth = headers.Authorization
        var payload = JSON.stringify({
          id: GID,
          files: { 'Big.sol': { truncated: true, content: '', raw_url: 'https://gist.githubusercontent.com/raw/' + GID + '/Big.sol' } }
        })
        return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(payload) } })
      }
      rawAuth = headers.Authorization
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(BIG) } })
    }
  }
  var handler = new GistHandler({ prompt: function () {}, alert: function () {} })
  var fileManager = {
    getProvider: function () { return { lastLoadedGistId: null } },
    setBatchFiles: function (_obj, _ws, _override, cb) {
      t.equal(apiAuth, 'token ghp_testtoken1234567890', 'api.github.com request carries the token')
      t.equal(rawAuth, undefined, 'raw_url request sends NO Authorization header (stays CORS-simple)')
      t.equal(_obj && Object.keys(_obj).length, 1, 'truncated file still backfilled from raw_url')
      delete global.window
      if (savedRegistry) require.cache[registryPath] = savedRegistry; else delete require.cache[registryPath]
      if (cb) cb()
    }
  }
  handler.loadFromGist({ gist: GID }, fileManager)
})
