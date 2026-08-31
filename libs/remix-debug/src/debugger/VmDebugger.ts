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
import { StorageResolver } from '../storage/storageResolver'
import { StorageViewer } from '../storage/storageViewer'
import { helpers } from '@remix-project/remix-lib'
import { DebuggerSolidityState } from './solidityState'
import { DebuggerSolidityLocals } from './solidityLocals'
const { ui } = helpers

export class VmDebuggerLogic {
  event
  debugger
  stepManager
  _traceManager
  _codeManager
  _solidityProxy
  _callTree
  storageResolver
  tx
  debuggerSolidityState
  debuggerSolidityLocals
  address
  traceLength
  addresses
  _subscriptions
  _disposed
  storageUpdateGeneration

  constructor (_debugger, tx, _stepManager, _traceManager, _codeManager, _solidityProxy, _callTree) {
    this.event = new EventManager()
    this.debugger = _debugger
    this.stepManager = _stepManager
    this._traceManager = _traceManager
    this._codeManager = _codeManager
    this._solidityProxy = _solidityProxy
    this._callTree = _callTree
    this.storageResolver = null
    this.tx = tx

    this.debuggerSolidityState = new DebuggerSolidityState(tx, _stepManager, _traceManager, _codeManager, _solidityProxy)
    this.debuggerSolidityLocals = new DebuggerSolidityLocals(tx, _stepManager, _traceManager, _callTree)
    this._subscriptions = []
    this._disposed = false
    this.storageUpdateGeneration = 0
  }

  _register (eventManager, eventName, handler) {
    eventManager.register(eventName, this, handler)
    this._subscriptions.push({ eventManager, eventName, handler })
  }

  isCurrentStorageUpdate (index, generation) {
    return !this._disposed && generation === this.storageUpdateGeneration && this.stepManager.currentStepIndex === index
  }

  dispose () {
    this._disposed = true
    this.storageUpdateGeneration++
    for (const subscription of this._subscriptions) {
      subscription.eventManager.unregister(subscription.eventName, this, subscription.handler)
    }
    this._subscriptions = []
    this.debuggerSolidityState.reset()
    this.debuggerSolidityLocals.dispose()
  }

  start () {
    this._disposed = false
    this.listenToEvents()
    this.listenToCodeManagerEvents()
    this.listenToTraceManagerEvents()
    this.listenToFullStorageChanges()
    this.listenToNewChanges()

    this.listenToSolidityStateEvents()
    this.listenToSolidityLocalsEvents()
  }

  listenToEvents () {
    this._register(this.debugger.event, 'traceUnloaded', () => {
      this.event.trigger('traceUnloaded')
    })

    this._register(this.debugger.event, 'newTraceLoaded', () => {
      this.event.trigger('newTraceLoaded')
    })
  }

  listenToCodeManagerEvents () {
    this._register(this._codeManager.event, 'changed', (code, address, index, nextIndexes, returnInstructionIndexes, outOfGasInstructionIndexes) => {
      this.event.trigger('codeManagerChanged', [code, address, index, nextIndexes, returnInstructionIndexes, outOfGasInstructionIndexes])
    })
  }

  listenToTraceManagerEvents () {
    this._register(this.event, 'indexChanged', (index) => {
      if (index < 0) return
      if (this.stepManager.currentStepIndex !== index) return

      this.event.trigger('indexUpdate', [index])

      this.event.trigger('functionsStackUpdate', [this._callTree.retrieveFunctionsStack(index)])

      try {
        const calldata = this._traceManager.getCallDataAt(index)
        if (this.stepManager.currentStepIndex === index) {
          this.event.trigger('traceManagerCallDataUpdate', [calldata])
        }
      } catch (error) {
        this.event.trigger('traceManagerCallDataUpdate', [{}])
      }

      try {
        const memory = this._traceManager.getMemoryAt(index)
        if (this.stepManager.currentStepIndex === index) {
          this.event.trigger('traceManagerMemoryUpdate', [ui.formatMemory(memory, 16)])
        }
      } catch (error) {
        this.event.trigger('traceManagerMemoryUpdate', [{}])
      }

      try {
        const callstack = this._traceManager.getCallStackAt(index)
        if (this.stepManager.currentStepIndex === index) {
          this.event.trigger('traceManagerCallStackUpdate', [callstack])
        }
      } catch (error) {
        this.event.trigger('traceManagerCallStackUpdate', [{}])
      }

      try {
        const callstack = this._traceManager.getStackAt(index)
        if (this.stepManager.currentStepIndex === index) {
          this.event.trigger('traceManagerStackUpdate', [callstack])
        }
      } catch (error) {
        this.event.trigger('traceManagerStackUpdate', [{}])
      }

      try {
        const address = this._traceManager.getCurrentCalledAddressAt(index)
        if (!this.storageResolver) return

        var storageViewer = new StorageViewer({ stepIndex: this.stepManager.currentStepIndex, tx: this.tx, address: address }, this.storageResolver, this._traceManager)

        storageViewer.storageRange().then((storage) => {
          if (!this._disposed && this.stepManager.currentStepIndex === index) {
            var header = storageViewer.isComplete(address) ? '[Completely Loaded]' : '[Partially Loaded]'
            this.event.trigger('traceManagerStorageUpdate', [storage, header])
          }
        }).catch((_error) => {
          if (!this._disposed && this.stepManager.currentStepIndex === index) this.event.trigger('traceManagerStorageUpdate', [{}])
        })
      } catch (error) {
        this.event.trigger('traceManagerStorageUpdate', [{}])
      }

      try {
        const step = this._traceManager.getCurrentStep(index)
        this.event.trigger('traceCurrentStepUpdate', [null, step])
      } catch (error) {
        this.event.trigger('traceCurrentStepUpdate', [error])
      }

      try {
        const addmem = this._traceManager.getMemExpand(index)
        this.event.trigger('traceMemExpandUpdate', [null, addmem])
      } catch (error) {
        this.event.trigger('traceMemExpandUpdate', [error])
      }

      try {
        const gas = this._traceManager.getStepCost(index)
        this.event.trigger('traceStepCostUpdate', [null, gas])
      } catch (error) {
        this.event.trigger('traceStepCostUpdate', [error])
      }

      try {
        const address = this._traceManager.getCurrentCalledAddressAt(index)
        this.event.trigger('traceCurrentCalledAddressAtUpdate', [null, address])
      } catch (error) {
        this.event.trigger('traceCurrentCalledAddressAtUpdate', [error])
      }

      try {
        const remaining = this._traceManager.getRemainingGas(index)
        this.event.trigger('traceRemainingGasUpdate', [null, remaining])
      } catch (error) {
        this.event.trigger('traceRemainingGasUpdate', [error])
      }

      try {
        const returnValue = this._traceManager.getReturnValue(index)
        if (this.stepManager.currentStepIndex === index) {
          this.event.trigger('traceReturnValueUpdate', [[returnValue]])
        }
      } catch (error) {
        this.event.trigger('traceReturnValueUpdate', [[error]])
      }
    })
  }

  listenToFullStorageChanges () {
    this.address = []
    this.traceLength = 0

    this._register(this.debugger.event, 'newTraceLoaded', (length) => {
      this.storageUpdateGeneration++
      const addresses = this._traceManager.getAddresses()
      this.event.trigger('traceAddressesUpdate', [addresses])
      this.addresses = addresses

      this._traceManager.getLength((error, length) => {
        if (error) return
        this.event.trigger('traceLengthUpdate', [length])
        this.traceLength = length
      })
    })

    this._register(this.debugger.event, 'indexChanged', async (index) => {
      if (index < 0) return
      if (this.stepManager.currentStepIndex !== index) return
      if (!this.storageResolver) return
      const generation = ++this.storageUpdateGeneration
      // Clean up storage update
      if (index === this.traceLength - 1) {
        if (!this.isCurrentStorageUpdate(index, generation)) return
        return this.event.trigger('traceStorageUpdate', [{}])
      }
      var storageJSON = {}
      const addresses: string[] = Array.from(new Set<string>(this.addresses || []))
      let nextAddress = 0
      const readAddress = async () => {
        while (nextAddress < addresses.length) {
          if (!this.isCurrentStorageUpdate(index, generation)) return
          const address = addresses[nextAddress++]
          try {
            const storageViewer = new StorageViewer({ stepIndex: index, tx: this.tx, address }, this.storageResolver, this._traceManager)
            const storage = await storageViewer.storageRange()
            if (!this.isCurrentStorageUpdate(index, generation)) return
            storageJSON[address] = storage
          } catch (e) {
            if (this.isCurrentStorageUpdate(index, generation)) console.error(e)
          }
        }
      }
      const workerCount = Math.min(4, addresses.length)
      await Promise.all(Array.from({ length: workerCount }, () => readAddress()))
      if (!this.isCurrentStorageUpdate(index, generation)) return
      this.event.trigger('traceStorageUpdate', [storageJSON])
    })
  }

  listenToNewChanges () {
    this._register(this.debugger.event, 'newTraceLoaded', () => {
      this.storageResolver = new StorageResolver({ web3: this.debugger.web3 })
      this.debuggerSolidityState.storageResolver = this.storageResolver
      this.debuggerSolidityLocals.storageResolver = this.storageResolver
      this.event.trigger('newTrace', [])
    })

    this._register(this.debugger.callTree.event, 'callTreeReady', () => {
      if (this.debugger.callTree.reducedTrace.length) {
        return this.event.trigger('newCallTree', [])
      }
    })
  }

  listenToSolidityStateEvents () {
    this._register(this.event, 'indexChanged', this.debuggerSolidityState.init.bind(this.debuggerSolidityState))
    this._register(this.debuggerSolidityState.event, 'solidityState', (state) => {
      this.event.trigger('solidityState', [state])
    })
    this._register(this.debuggerSolidityState.event, 'solidityStateMessage', (message) => {
      this.event.trigger('solidityStateMessage', [message])
    })
    this._register(this.debuggerSolidityState.event, 'solidityStateUpdating', () => {
      this.event.trigger('solidityStateUpdating', [])
    })
    this._register(this.event, 'traceUnloaded', this.debuggerSolidityState.reset.bind(this.debuggerSolidityState))
    this._register(this.event, 'newTraceLoaded', this.debuggerSolidityState.reset.bind(this.debuggerSolidityState))
  }

  listenToSolidityLocalsEvents () {
    this._register(this.event, 'sourceLocationChanged', this.debuggerSolidityLocals.init.bind(this.debuggerSolidityLocals))
    this._register(this.event, 'solidityLocalsLoadMore', this.debuggerSolidityLocals.decodeMore.bind(this.debuggerSolidityLocals))
    this._register(this.debuggerSolidityLocals.event, 'solidityLocalsLoadMoreCompleted', (locals) => {
      this.event.trigger('solidityLocalsLoadMoreCompleted', [locals])
    })
    this._register(this.debuggerSolidityLocals.event, 'solidityLocals', (state) => {
      this.event.trigger('solidityLocals', [state])
    })
    this._register(this.debuggerSolidityLocals.event, 'solidityLocalsMessage', (message) => {
      this.event.trigger('solidityLocalsMessage', [message])
    })
    this._register(this.debuggerSolidityLocals.event, 'solidityLocalsUpdating', () => {
      this.event.trigger('solidityLocalsUpdating', [])
    })
    this._register(this.debuggerSolidityLocals.event, 'traceReturnValueUpdate', (data, header) => {
      this.event.trigger('traceReturnValueUpdate', [data, header])
    })
  }
}
