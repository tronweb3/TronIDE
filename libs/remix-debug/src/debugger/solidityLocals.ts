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
import { solidityLocals } from '../solidity-decoder/localDecoder'
import { StorageViewer } from '../storage/storageViewer'

export class DebuggerSolidityLocals {
  event
  stepManager
  internalTreeCall
  storageResolver
  traceManager
  tx
  _sourceLocation
  _decodeTimeout
  _decodeGeneration

  constructor (tx, _stepManager, _traceManager, _internalTreeCall) {
    this.event = new EventManager()
    this.stepManager = _stepManager
    this.internalTreeCall = _internalTreeCall
    this.storageResolver = null
    this.traceManager = _traceManager
    this.tx = tx
    this._decodeTimeout = null
    this._decodeGeneration = 0
  }

  init (sourceLocation) {
    this._sourceLocation = sourceLocation
    const generation = ++this._decodeGeneration
    const stepIndex = this.stepManager.currentStepIndex
    this._clearDecodeTimeout()
    if (!this.storageResolver) {
      return this.event.trigger('solidityLocalsMessage', ['storage not ready'])
    }
    this.event.trigger('solidityLocalsUpdating')
    const decodeTimeout = setTimeout(() => {
      if (this._decodeTimeout === decodeTimeout) this._decodeTimeout = null
      if (!this._isCurrentDecode(generation, stepIndex)) return
      this.decode(sourceLocation, undefined, stepIndex, generation)
    }, 500)
    this._decodeTimeout = decodeTimeout
  }

  decode (sourceLocation, cursor?, stepIndex = this.stepManager.currentStepIndex, generation = this._decodeGeneration) {
    if (!this._isCurrentDecode(generation, stepIndex)) return
    const self = this
    this.event.trigger('solidityLocalsMessage', [''])
    this.traceManager.waterfall([
      function getStackAt (stepIndex, callback) {
        try {
          const result = self.traceManager.getStackAt(stepIndex)
          callback(null, result)
        } catch (error) {
          callback(error)
        }
      },
      function getMemoryAt (stepIndex, callback) {
        try {
          const result = self.traceManager.getMemoryAt(stepIndex)
          callback(null, result)
        } catch (error) {
          callback(error)
        }
      },
      function getCurrentCalledAddressAt (stepIndex, next) {
        try {
          const address = self.traceManager.getCurrentCalledAddressAt(stepIndex)
          next(null, address)
        } catch (error) {
          next(error)
        }
      },
      function getCallDataAt (stepIndex, next) {
        try {
          const calldata = self.traceManager.getCallDataAt(stepIndex)
          next(null, calldata)
        } catch (error) {
          next(error)
        }
      }],
    stepIndex,
    (error, result) => {
      if (!this._isCurrentDecode(generation, stepIndex)) return
      if (error) return this.event.trigger('solidityLocalsMessage', [error.message || error])
      var stack = result[0].value
      var memory = result[1].value
      var calldata = result[3].value
      try {
        var storageViewer = new StorageViewer({ stepIndex, tx: this.tx, address: result[2].value }, this.storageResolver, this.traceManager)
        solidityLocals(stepIndex, this.internalTreeCall, stack, memory, storageViewer, calldata, sourceLocation, cursor).then((locals) => {
          if (!this._isCurrentDecode(generation, stepIndex)) return
          if (!cursor) {
            if (!locals['error']) {
              this.event.trigger('solidityLocals', [locals])
            }
            if (!Object.keys(locals).length) {
              this.event.trigger('solidityLocalsMessage', ['no locals'])
            }
          } else {
            if (!locals['error']) {
              this.event.trigger('solidityLocalsLoadMoreCompleted', [locals])
            }
          }
        }).catch((error) => {
          if (this._isCurrentDecode(generation, stepIndex)) {
            this.event.trigger('solidityLocalsMessage', [error.message || error])
          }
        })
      } catch (e) {
        if (this._isCurrentDecode(generation, stepIndex)) {
          this.event.trigger('solidityLocalsMessage', [e.message])
        }
      }
    })
  }

  decodeMore (cursor) {
    const generation = ++this._decodeGeneration
    const stepIndex = this.stepManager.currentStepIndex
    const sourceLocation = this._sourceLocation
    this._clearDecodeTimeout()
    if (!this.storageResolver) return this.event.trigger('solidityLocalsMessage', ['storage not ready'])
    const decodeTimeout = setTimeout(() => {
      if (this._decodeTimeout === decodeTimeout) this._decodeTimeout = null
      if (!this._isCurrentDecode(generation, stepIndex)) return
      this.decode(sourceLocation, cursor, stepIndex, generation)
    }, 500)
    this._decodeTimeout = decodeTimeout
  }

  _clearDecodeTimeout () {
    if (this._decodeTimeout !== null) {
      clearTimeout(this._decodeTimeout)
      this._decodeTimeout = null
    }
  }

  dispose () {
    this._decodeGeneration++
    this._clearDecodeTimeout()
  }

  _isCurrentDecode (generation, stepIndex) {
    return generation === this._decodeGeneration &&
      stepIndex === this.stepManager.currentStepIndex
  }
}
