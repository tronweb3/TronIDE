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

import { EventManager } from '../eventManager'
import { decodeState } from '../solidity-decoder/stateDecoder'
import { StorageViewer } from '../storage/storageViewer'

export class DebuggerSolidityState {
  event
  storageResolver
  stepManager
  traceManager
  codeManager
  solidityProxy
  stateVariablesByAddresses
  tx

  constructor (tx, _stepManager, _traceManager, _codeManager, _solidityProxy) {
    this.event = new EventManager()
    this.storageResolver = null
    this.stepManager = _stepManager
    this.traceManager = _traceManager
    this.codeManager = _codeManager
    this.solidityProxy = _solidityProxy
    this.stateVariablesByAddresses = {}
    this.tx = tx
  }

  init (index) {
    let decodeTimeout = null
    if (index < 0) {
      return this.event.trigger('solidityStateMessage', ['invalid step index'])
    }

    if (this.stepManager.currentStepIndex !== index) return
    if (!this.solidityProxy.loaded()) {
      return this.event.trigger('solidityStateMessage', ['invalid step index'])
    }

    if (!this.storageResolver) {
      return
    }
    if (decodeTimeout) {
      window.clearTimeout(decodeTimeout)
    }
    this.event.trigger('solidityStateUpdating')
    decodeTimeout = setTimeout(() => {
      // necessary due to some states that can crash the debugger
      try {
        this.decode(index)
      } catch (err) {
        console.dir('====> error')
        console.dir(err)
      }
    }, 500)
  }

  reset () {
    this.stateVariablesByAddresses = {}
  }

  decode (index) {
    try {
      const address = this.traceManager.getCurrentCalledAddressAt(this.stepManager.currentStepIndex)
      if (this.stateVariablesByAddresses[address]) {
        return this.extractStateVariables(this.stateVariablesByAddresses[address], address)
      }
      this.solidityProxy.extractStateVariablesAt(index).then((stateVars) => {
        this.stateVariablesByAddresses[address] = stateVars
        this.extractStateVariables(stateVars, address)
      }).catch((_error) => {
        this.event.trigger('solidityState', [{}])
      })
    } catch (error) {
      return this.event.trigger('solidityState', [{}])
    }
  }

  extractStateVariables (stateVars, address) {
    const storageViewer = new StorageViewer({ stepIndex: this.stepManager.currentStepIndex, tx: this.tx, address: address }, this.storageResolver, this.traceManager)
    decodeState(stateVars, storageViewer).then((result) => {
      this.event.trigger('solidityStateMessage', [''])
      if (result['error']) {
        return this.event.trigger('solidityStateMessage', [result['error']])
      }
      this.event.trigger('solidityState', [result])
    })
  }
}
