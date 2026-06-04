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
          helper.decodeLocals(st, 63, traceManager, callTree, function (locals) {
            try {
              st.equals(locals['dynbytes'].value, '0x64796e616d69636279746573')
              st.equals(locals['smallstring'].value, 'test_test_test')
              st.equals(Object.keys(locals).length, 2)
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
