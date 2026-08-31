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
  _decodeTimeout
  _decodeGeneration

  constructor (tx, _stepManager, _traceManager, _codeManager, _solidityProxy) {
    this.event = new EventManager()
    this.storageResolver = null
    this.stepManager = _stepManager
    this.traceManager = _traceManager
    this.codeManager = _codeManager
    this.solidityProxy = _solidityProxy
    this.stateVariablesByAddresses = {}
    this.tx = tx
    this._decodeTimeout = null
    this._decodeGeneration = 0
  }

  init (index) {
    const generation = ++this._decodeGeneration
    const stepIndex = index
    this._clearDecodeTimeout()
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
    this.event.trigger('solidityStateUpdating')
    const decodeTimeout = setTimeout(() => {
      if (this._decodeTimeout === decodeTimeout) this._decodeTimeout = null
      if (!this._isCurrentDecode(generation, stepIndex)) return
      // necessary due to some states that can crash the debugger
      try {
        this.decode(stepIndex, generation)
      } catch (err) {
        this.event.trigger('solidityState', [{}])
      }
    }, 500)
    this._decodeTimeout = decodeTimeout
  }

  reset () {
    ++this._decodeGeneration
    this._clearDecodeTimeout()
    this.stateVariablesByAddresses = {}
  }

  decode (index, generation = this._decodeGeneration) {
    if (!this._isCurrentDecode(generation, index)) return
    try {
      const address = this.traceManager.getCurrentCalledAddressAt(index)
      if (this.stateVariablesByAddresses[address]) {
        return this.extractStateVariables(this.stateVariablesByAddresses[address], address, index, generation)
      }
      this.solidityProxy.extractStateVariablesAt(index).then((stateVars) => {
        if (!this._isCurrentDecode(generation, index)) return
        this.stateVariablesByAddresses[address] = stateVars
        this.extractStateVariables(stateVars, address, index, generation)
      }).catch((_error) => {
        if (this._isCurrentDecode(generation, index)) this.event.trigger('solidityState', [{}])
      })
    } catch (error) {
      if (this._isCurrentDecode(generation, index)) return this.event.trigger('solidityState', [{}])
    }
  }

  extractStateVariables (stateVars, address, stepIndex = this.stepManager.currentStepIndex, generation = this._decodeGeneration) {
    if (!this._isCurrentDecode(generation, stepIndex)) return
    const storageViewer = new StorageViewer({ stepIndex, tx: this.tx, address: address }, this.storageResolver, this.traceManager)
    decodeState(stateVars, storageViewer).then((result) => {
      if (!this._isCurrentDecode(generation, stepIndex)) return
      this.event.trigger('solidityStateMessage', [''])
      if (result['error']) {
        return this.event.trigger('solidityStateMessage', [result['error']])
      }
      this.event.trigger('solidityState', [result])
    }).catch((error) => {
      if (this._isCurrentDecode(generation, stepIndex)) {
        this.event.trigger('solidityStateMessage', [error.message || error])
      }
    })
  }

  _clearDecodeTimeout () {
    if (this._decodeTimeout !== null) {
      clearTimeout(this._decodeTimeout)
      this._decodeTimeout = null
    }
  }

  _isCurrentDecode (generation, stepIndex) {
    return generation === this._decodeGeneration && stepIndex === this.stepManager.currentStepIndex
  }
}
