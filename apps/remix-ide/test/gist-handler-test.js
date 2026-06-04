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
