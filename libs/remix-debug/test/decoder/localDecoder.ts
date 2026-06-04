/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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
import tape from 'tape'
var compiler = require('solc')
var intLocal = require('./contracts/intLocal')
var miscLocal = require('./contracts/miscLocal')
var structArrayLocal = require('./contracts/structArrayLocal')
var calldataLocal = require('./contracts/calldata')
var vmCall = require('./vmCall')
var intLocalTest = require('./localsTests/int')
var miscLocalTest = require('./localsTests/misc')
var misc2LocalTest = require('./localsTests/misc2')
var structArrayLocalTest = require('./localsTests/structArray')
var calldataLocalTest = require('./localsTests/calldata')
var compilerInput = require('../helpers/compilerHelper').compilerInput

tape('solidity', function (t) {
  t.test('local decoder', async function (st) {
    var privateKey = Buffer.from('dae9801649ba2d95a21e688b56f77905e5667c44ce868ec83f82e838712a2c7a', 'hex')
    var vm = await vmCall.initVM(st, privateKey)
    await test(st, vm, privateKey)
  })
})

async function test (st, vm, privateKey) {
  var output = compiler.compile(compilerInput(intLocal.contract))
  output = JSON.parse(output)
  await intLocalTest(st, vm, privateKey, output.contracts['test.sol']['intLocal'].evm.bytecode.object, output)
  output = compiler.compile(compilerInput(miscLocal.contract))
  output = JSON.parse(output)
  await miscLocalTest(st, vm, privateKey, output.contracts['test.sol']['miscLocal'].evm.bytecode.object, output)
  output = compiler.compile(compilerInput(miscLocal.contract))
  output = JSON.parse(output)
  await misc2LocalTest(st, vm, privateKey, output.contracts['test.sol']['miscLocal2'].evm.bytecode.object, output)
  output = compiler.compile(compilerInput(structArrayLocal.contract))
  output = JSON.parse(output)
  await structArrayLocalTest(st, vm, privateKey, output.contracts['test.sol']['structArrayLocal'].evm.bytecode.object, output)

  output = compiler.compile(compilerInput(calldataLocal.contract))
  output = JSON.parse(output)
  await calldataLocalTest(st, vm, privateKey, output.contracts['test.sol']['calldataLocal'].evm.bytecode.object, output)

  st.end()
}
