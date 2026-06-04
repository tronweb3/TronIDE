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

var QueryParams = require('../src/lib/query-params')

test('queryParams.get', function (t) {
  t.plan(2)

  var fakeWindow = {location: {hash: '#wat=sup&foo=bar', search: ''}}
  var params = new QueryParams(fakeWindow).get()
  t.equal(params.wat, 'sup')
  t.equal(params.foo, 'bar')
})

test('queryParams.update', function (t) {
  t.plan(1)

  var fakeWindow = {location: {hash: '#wat=sup', search: ''}}
  var qp = new QueryParams(fakeWindow)
  qp.update({foo: 'bar'})
  t.equal(fakeWindow.location.hash, '#wat=sup&foo=bar')
})
