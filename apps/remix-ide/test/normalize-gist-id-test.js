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
var normalizeGistId = require('../src/lib/normalize-gist-id')

// The hashchange reload path branches on the three-way return of normalizeGistId:
//   '' => no gist param (do nothing), null => invalid id (warn), id => load.
// This is the distinction that lets an address-bar edit like `…&gist=123121`
// surface "Please provide a valid Gist ID or URL." instead of silently no-op'ing.
test('normalizeGistId returns "" when no gist value is present', function (t) {
  t.plan(3)
  t.equal(normalizeGistId(undefined), '', 'undefined -> ""')
  t.equal(normalizeGistId(null), '', 'null -> ""')
  t.equal(normalizeGistId(''), '', 'empty string -> ""')
})

test('normalizeGistId returns null for a non-empty value with no id-shaped token', function (t) {
  t.plan(4)
  // These are exactly the kinds of values that previously "did nothing" on a hash edit.
  t.equal(normalizeGistId('123121'), null, 'too short (6 digits) -> null')
  t.equal(normalizeGistId('12312饿1饿1'), null, 'non-hex chars, short -> null')
  t.equal(normalizeGistId('notagist'), null, 'short non-hex word -> null')
  t.equal(normalizeGistId('zzzzzzzzzzzzzzzz'), null, '16 non-hex chars -> null')
})

test('normalizeGistId extracts a bare 16-40 hex id, including from a full gist URL', function (t) {
  t.plan(4)
  var id32 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
  t.equal(normalizeGistId(id32), id32, 'plain 32-hex id passes through')
  t.equal(normalizeGistId('0123456789abcdef0123'), '0123456789abcdef0123', 'legacy 20-hex id passes through')
  t.equal(normalizeGistId('https://gist.github.com/tron/' + id32), id32, 'id extracted from a full gist URL')
  t.equal(normalizeGistId('#gist=' + id32 + '&evmVersion=null'), id32, 'id extracted out of a hash fragment string')
})
