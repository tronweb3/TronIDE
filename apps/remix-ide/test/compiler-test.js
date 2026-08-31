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

var Compiler = require('../../../build/libs/remix-solidity/src/index.js').Compiler

test('compiler.compile smoke', function (t) {
  t.plan(1)

  var noop = function () {}
  var fakeImport = function (url, cb) { cb('Not implemented') }
  var compiler = new Compiler(fakeImport)
  compiler.compileJSON = noop
  compiler.compile({ 'test': '' }, 'test')
  t.ok(compiler)
})


test('compiler browser non-Worker path loads only the solc wrapper and compiles', function (t) {
  var oldWindow = global.window
  var oldWorker = global.Worker
  global.window = { Module: require('solc/soljson') }
  global.Worker = false

  var compiler = new Compiler(function () {})
  return compiler.onInternalCompilerLoaded().then(function () {
    t.match(compiler.state.currentVersion, /^0\.8\.25/, 'the injected soljson reports its real version')
    t.equal(typeof compiler.state.compileJSON, 'function', 'the browser wrapper installs the compile function')

    compiler.event.register('compilationFinished', function (success, data) {
      t.equal(success, true, 'the lazy browser wrapper compiles end to end')
      t.ok(data.contracts && data.contracts['Test.sol'] && data.contracts['Test.sol'].Test, 'compiled contract output is present')
    })
    compiler.compile({
      'Test.sol': {
        content: '// SPDX-License-Identifier: UNLICENSED\npragma solidity ^0.8.0; contract Test { function value() external pure returns (uint) { return 1; } }'
      }
    }, 'Test.sol')
  }).catch(function (error) {
    t.fail(error && error.stack ? error.stack : String(error))
  }).then(function () {
    global.window = oldWindow
    global.Worker = oldWorker
    t.end()
  })
})
