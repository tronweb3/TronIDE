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
import { Ethdebugger } from '../Ethdebugger'
import { EventManager } from '../eventManager'
import { contractCreationToken } from '../trace/traceHelper'
import { BreakpointManager } from '../code/breakpointManager'
import { DebuggerStepManager } from './stepManager'
import { VmDebuggerLogic } from './VmDebugger'

export class Debugger {
  event
  offsetToLineColumnConverter
  compilationResult
  debugger
  breakPointManager
  step_manager // eslint-disable-line camelcase
  vmDebuggerLogic
  _sessionGeneration
  _codeManagerForSession
  _codeChangedHandler
  _stepManagerForSession
  _stepChangedHandler
  _unloading

  constructor (options) {
    this.event = new EventManager()
    this._sessionGeneration = 0
    this._unloading = false
    this.offsetToLineColumnConverter = options.offsetToLineColumnConverter
    /*
      Returns a compilation result for a given address or the last one available if none are found
    */
    this.compilationResult = options.compilationResult || function (contractAddress) { return null }

    this.debugger = new Ethdebugger({
      web3: options.web3,
      debugWithGeneratedSources: options.debugWithGeneratedSources,
      compilationResult: this.compilationResult
    })

    const { traceManager, callTree, solidityProxy } = this.debugger
    this.breakPointManager = new BreakpointManager({
      traceManager,
      callTree,
      solidityProxy,
      locationToRowConverter: async (sourceLocation) => {
        const compilationResult = await this.compilationResult()
        if (!compilationResult) return { start: null, end: null }
        return await this.offsetToLineColumnConverter.offsetToLineColumn(sourceLocation, sourceLocation.file, compilationResult.source.sources, compilationResult.data.sources)
      }
    })

    this.breakPointManager.event.register('managersChanged', () => {
      const { traceManager, callTree, solidityProxy } = this.debugger
      this.breakPointManager.setManagers({ traceManager, callTree, solidityProxy })
    })

    this.breakPointManager.event.register('breakpointStep', (step) => {
      if (this.step_manager) this.step_manager.jumpTo(step)
    })

    this.debugger.setBreakpointManager(this.breakPointManager)

    this.debugger.event.register('newTraceLoaded', this, () => {
      this.event.trigger('debuggerStatus', [true])
    })

    this.debugger.event.register('traceUnloaded', this, () => {
      this.event.trigger('debuggerStatus', [false])
    })
  }

  async registerAndHighlightCodeItem (index) {
    // register selected code item, highlight the corresponding source location
    // this.debugger.traceManager.getCurrentCalledAddressAt(index, async (error, address) => {

    try {
      const address = this.debugger.traceManager.getCurrentCalledAddressAt(index)
      const compilationResultForAddress = await this.compilationResult(address)
      if (!compilationResultForAddress) return

      const rawLocation = await this.debugger.callTree.sourceLocationTracker.getValidSourceLocationFromVMTraceIndex(address, index, compilationResultForAddress.data.contracts, compilationResultForAddress.data.sources)
      if (!rawLocation || rawLocation.file === -1) {
        return this.event.trigger('newSourceLocation', [null])
      }
      if (compilationResultForAddress && compilationResultForAddress.data) {
        const generatedSources = this.debugger.callTree.sourceLocationTracker.getGeneratedSourcesFromAddress(address) || []
        const astSources = Object.assign({}, compilationResultForAddress.data.sources)
        const sources = Object.assign({}, compilationResultForAddress.source.sources)
        for (const genSource of generatedSources) {
          astSources[genSource.name] = { id: genSource.id, ast: genSource.ast }
          sources[genSource.name] = { content: genSource.contents }
        }
        const lineColumnPos = await this.offsetToLineColumnConverter.offsetToLineColumn(rawLocation, rawLocation.file, sources, astSources)
        this.event.trigger('newSourceLocation', [lineColumnPos, rawLocation, generatedSources, address])
      } else {
        this.event.trigger('newSourceLocation', [null])
      }
    } catch (error) {
      this.event.trigger('newSourceLocation', [null])
    }
  }

  updateWeb3 (web3) {
    this.debugger.web3 = web3
  }

  async debug (blockNumber, txNumber, tx, loadingCb) {
    const web3 = this.debugger.web3

    if (this.debugger.traceManager.isLoading) {
      throw new Error('Trace is already loading')
    }

    if (tx) return this.debugTx({ ...tx, to: tx.to || contractCreationToken('0') }, loadingCb)

    if (!web3 || !web3.eth) throw new Error('web3 not loaded')
    if (typeof txNumber !== 'string') throw new Error('transaction identifier is required')

    const transaction = await new Promise((resolve, reject) => {
      try {
        const callback = (_error, resolvedTx) => {
          if (_error) return reject(_error)
          if (!resolvedTx) return reject(new Error('cannot find transaction ' + (txNumber.indexOf('0x') !== -1 ? txNumber : blockNumber + ' ' + txNumber)))
          resolve(resolvedTx)
        }
        if (txNumber.indexOf('0x') !== -1) {
          web3.eth.getTransaction(txNumber, callback)
        } else {
          web3.eth.getTransactionFromBlock(blockNumber, txNumber, callback)
        }
      } catch (error) {
        reject(error)
      }
    })
    return this.debugTx(transaction, loadingCb)
  }

  async debugTx (tx, loadingCb) {
    this._clearSessionListeners()
    const generation = ++this._sessionGeneration
    this.step_manager = new DebuggerStepManager(this.debugger, this.debugger.traceManager)
    this._stepManagerForSession = this.step_manager

    this._codeManagerForSession = this.debugger.codeManager
    this._codeChangedHandler = (code, address, instIndex) => {
      if (generation !== this._sessionGeneration || !this.step_manager || !this.vmDebuggerLogic) return
      if (!this.debugger.solidityProxy.contracts) return
      this.debugger.callTree.sourceLocationTracker.getValidSourceLocationFromVMTraceIndex(address, this.step_manager.currentStepIndex, this.debugger.solidityProxy.contracts, this.debugger.solidityProxy.sources).then((sourceLocation) => {
        if (generation !== this._sessionGeneration || !this.vmDebuggerLogic) return
        this.vmDebuggerLogic.event.trigger('sourceLocationChanged', [sourceLocation])
      }).catch(() => {
        // Code resolution can fail for an unknown or precompiled address.
      })
    }
    this._codeManagerForSession.event.register('changed', this, this._codeChangedHandler)

    this.vmDebuggerLogic = new VmDebuggerLogic(this.debugger, tx, this.step_manager, this.debugger.traceManager, this.debugger.codeManager, this.debugger.solidityProxy, this.debugger.callTree)
    this.vmDebuggerLogic.start()

    this._stepChangedHandler = (stepIndex) => {
      if (generation !== this._sessionGeneration || !this.step_manager) return
      if (typeof stepIndex !== 'number' || stepIndex < 0 || stepIndex >= this.step_manager.traceLength) {
        return this.event.trigger('endDebug')
      }

      this.debugger.codeManager.resolveStep(stepIndex, tx)
      this.step_manager.event.trigger('indexChanged', [stepIndex])
      this.vmDebuggerLogic.event.trigger('indexChanged', [stepIndex])
      this.vmDebuggerLogic.debugger.event.trigger('indexChanged', [stepIndex])
      this.registerAndHighlightCodeItem(stepIndex)
    }
    this._stepManagerForSession.event.register('stepChanged', this, this._stepChangedHandler)

    if (loadingCb) loadingCb()
    try {
      return await this.debugger.debug(tx)
    } catch (error) {
      if (generation === this._sessionGeneration) this._clearSessionListeners()
      throw error
    }
  }

  _clearSessionListeners () {
    if (this._codeManagerForSession && this._codeChangedHandler) {
      this._codeManagerForSession.event.unregister('changed', this, this._codeChangedHandler)
    }
    if (this._stepManagerForSession && this._stepChangedHandler) {
      this._stepManagerForSession.event.unregister('stepChanged', this, this._stepChangedHandler)
    }
    if (this.vmDebuggerLogic) this.vmDebuggerLogic.dispose()
    if (this._stepManagerForSession) this._stepManagerForSession.dispose()
    this._codeManagerForSession = null
    this._codeChangedHandler = null
    this._stepManagerForSession = null
    this._stepChangedHandler = null
    this.vmDebuggerLogic = null
  }

  unload () {
    if (this._unloading) return
    this._unloading = true
    ++this._sessionGeneration
    this._clearSessionListeners()
    this.debugger.unLoad()
    this.event.trigger('debuggerUnloaded')
    this._unloading = false
  }
}
