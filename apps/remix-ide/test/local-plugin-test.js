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
var LocalPlugin = require('../src/app/components/local-plugin')

test('LocalPlugin.assertSafePluginUrl accepts localhost and rejects unsafe URLs', function (t) {
  t.plan(4)

  t.equal(LocalPlugin.assertSafePluginUrl('http://localhost:3000').ok, true)
  t.equal(LocalPlugin.assertSafePluginUrl('https://127.0.0.1:8443').ok, true)
  t.throws(function () { LocalPlugin.assertSafePluginUrl('file:///tmp/plugin.html') }, /http\(s\)/)
  t.throws(function () { LocalPlugin.assertSafePluginUrl('https://evil.test/plugin') }, /approved/)
})
