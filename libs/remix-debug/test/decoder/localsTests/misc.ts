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
import { sendTx } from '../vmCall'
import { contractCreationToken } from '../../../src/trace/traceHelper'
import { SolidityProxy } from '../../../src/solidity-decoder/solidityProxy'
import { InternalCallTree } from '../../../src/solidity-decoder/internalCallTree'
import { EventManager } from '../../../src/eventManager'
import * as helper from './helper'
import { TraceManager } from '../../../src/trace/traceManager'
import { CodeManager } from '../../../src/code/codeManager'

module.exports = function (st, vm, privateKey, contractBytecode, compilationResult) {
  return new Promise((resolve) => {
    sendTx(vm, { nonce: 0, privateKey: privateKey }, null, 0, contractBytecode, function (error, data) {
      if (error) {
        return st.fail(error)
      }
      const txHash = data.hash
      vm.web3.eth.getTransaction(txHash, function (error, tx) {
        if (error) {
          return st.fail(error)
        }
        tx.to = contractCreationToken('0')
        var traceManager = new TraceManager({ web3: vm.web3 })
        var codeManager = new CodeManager(traceManager)
        codeManager.clear()
        var solidityProxy = new SolidityProxy({ getCurrentCalledAddressAt: traceManager.getCurrentCalledAddressAt.bind(traceManager), getCode: codeManager.getCode.bind(codeManager) })
        solidityProxy.reset(compilationResult)
        var debuggerEvent = new EventManager()
        var callTree = new InternalCallTree(debuggerEvent, traceManager, solidityProxy, codeManager, { includeLocalVariables: true })
        callTree.event.register('callTreeBuildFailed', (error) => {
          st.fail(error)
        })
        callTree.event.register('callTreeReady', (scopes, scopeStarts) => {
          helper.decodeLocals(st, 84, traceManager, callTree, function (locals) {
            try {
              st.equals(locals['boolFalse'].value, false)
              st.equals(locals['boolTrue'].value, true)
              st.equals(locals['testEnum'].value, 'three')
              st.equals(locals['sender'].value, '0x4B0897B0513FDC7C541B6D9D7E929C4E5364D2DB')
              st.equals(locals['_bytes1'].value, '0x99')
              st.equals(locals['__bytes1'].value, '0x99')
              st.equals(locals['__bytes2'].value, '0x99AB')
              st.equals(locals['__bytes4'].value, '0x99FA0000')
              st.equals(locals['__bytes6'].value, '0x990000000000')
              st.equals(locals['__bytes7'].value, '0x99356700000000')
              st.equals(locals['__bytes8'].value, '0x99ABD41700000000')
              st.equals(locals['__bytes9'].value, '0x99156744AF00000000')
              st.equals(locals['__bytes13'].value, '0x99123423425300000000000000')
              st.equals(locals['__bytes16'].value, '0x99AFAD23432400000000000000000000')
              st.equals(locals['__bytes24'].value, '0x99AFAD234324000000000000000000000000000000000000')
              st.equals(locals['__bytes32'].value, '0x9999ABD41799ABD4170000000000000000000000000000000000000000000000')
              st.equals(Object.keys(locals).length, 16)
            } catch (e) {
              st.fail(e.message)
            }
          })

          helper.decodeLocals(st, 21, traceManager, callTree, function (locals) {
            try {
              // st.equals(Object.keys(locals).length, 0)
              st.equals(0, 0)
            } catch (e) {
              st.fail(e.message)
            }
            resolve({})
          })
        })
        traceManager.resolveTrace(tx).then(() => {
          debuggerEvent.trigger('newTraceLoaded', [traceManager.trace])
        }).catch((error) => {
          st.fail(error)
        })
      })
    })
  })
}
