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

import Web3 from 'web3'
import * as remixDebug from '@remix-project/remix-debug'
import { CompilationOutput, Sources } from '../idebugger-api'
import type { CompilationResult } from '@remix-project/remix-solidity-ts'
import { isMissingTxReceiptError, missingTxReceiptResponse } from './receipt-normalization'
const { TransactionDebugger: Debugger } = remixDebug

export const DebuggerApiMixin = (Base) =>
  class extends Base {
    initDebuggerApi () {
      this.debugHash = null

      const self = this
      this.web3Provider = {
        sendAsync (payload, callback) {
          self
            .call('web3Provider', 'sendAsync', payload)
            .then((result) => callback(null, result))
            .catch((e) => {
              if (isMissingTxReceiptError(payload, e)) {
                return callback(null, missingTxReceiptResponse(payload))
              }
              callback(e)
            })
        }
      }
      this._web3 = new Web3(this.web3Provider)

      this.offsetToLineColumnConverter = {
        async offsetToLineColumn (rawLocation, file, sources, asts) {
          return await self.call('offsetToLineColumnConverter', 'offsetToLineColumn', rawLocation, file, sources, asts)
        }
      }
    }

    // on()
    // call()
    // onDebugRequested()
    // onRemoveHighlights()

    web3 () {
      return this._web3
    }

    async discardHighlight () {
      await this.call('editor', 'discardHighlight')
    }

    async highlight (lineColumnPos, path) {
      await this.call('editor', 'highlight', lineColumnPos, path)
    }

    async getFile (path) {
      return await this.call('fileManager', 'getFile', path)
    }

    async setFile (path, content) {
      await this.call('fileManager', 'setFile', path, content)
    }

    onBreakpointCleared (listener) {
      this.onBreakpointClearedListener = listener
    }

    onBreakpointAdded (listener) {
      this.onBreakpointAddedListener = listener
    }

    onEditorContentChanged (listener) {
      this.onEditorContentChangedListener = listener
    }

    onDebugRequested (listener) {
      this.onDebugRequestedListener = listener
    }

    onRemoveHighlights (listener) {
      this.onRemoveHighlightsListener = listener
    }

    async fetchContractAndCompile (address, receipt) {
      const target = address && remixDebug.traceHelper.isContractCreation(address) ? receipt.contractAddress : address
      const targetAddress = target || receipt.contractAddress || receipt.to
      const codeAtAddress = await this._web3.eth.getCode(targetAddress)
      const output = await this.call('fetchAndCompile', 'resolve', targetAddress, codeAtAddress, 'browser/.debug')
      if (output) {
        return new CompilerAbstract(output.languageversion, output.data, output.source)
      }
      return null
    }

    async getDebugWeb3 () {
      let web3
      let network
      try {
        network = await this.call('network', 'detectNetwork')
      } catch (e) {
        web3 = this.web3()
      }
      if (!web3) {
        const webDebugNode = remixDebug.init.web3DebugNode(network.name)
        web3 = !webDebugNode ? this.web3() : webDebugNode
      }
      remixDebug.init.extendWeb3(web3)
      return web3
    }

    async getTrace (hash) {
      if (!hash) return
      const web3 = await this.getDebugWeb3()
      const currentReceipt = await web3.eth.getTransactionReceipt(hash)
      const debug = new Debugger({
        web3,
        offsetToLineColumnConverter: this.offsetToLineColumnConverter,
        compilationResult: async (address) => {
          try {
            return await this.fetchContractAndCompile(address, currentReceipt)
          } catch (e) {
            console.error(e)
          }
          return null
        },
        debugWithGeneratedSources: false
      })
      try {
        return await debug.debugger.traceManager.getTrace(hash)
      } catch (e) {
        return await this.getTraceFromDebugRpcFallback(web3, hash, e)
      }
    }

    async getTraceFromDebugRpcFallback (web3, hash, primaryTraceError) {
      const provider = web3 && web3.currentProvider
      const send = provider && (provider.sendAsync || provider.send)
      if (!send) throw primaryTraceError

      console.warn('TRON Debug RPC trace fallback used after primary trace provider failed', primaryTraceError)
      const response = await new Promise((resolve, reject) => {
        send.call(provider, {
          id: Date.now(),
          jsonrpc: '2.0',
          method: 'debug_traceTransaction',
          params: [hash, {}]
        }, (error, result) => {
          if (error) return reject(error)
          if (result && result.error) return reject(result.error)
          resolve(result && result.result)
        })
      })

      const trace = response && typeof response === 'object' ? response : { result: response }
      return {
        ...trace,
        runtimeTraceSource: 'debug-rpc-fallback',
        primaryTraceError: primaryTraceError && primaryTraceError.message ? primaryTraceError.message : String(primaryTraceError)
      }
    }

    debug (hash) {
      this.debugHash = hash
      this.onDebugRequestedListener(hash)
    }

    onActivation () {
      this.on('editor', 'breakpointCleared', (fileName, row) => this.onBreakpointClearedListener(fileName, row))
      this.on('editor', 'breakpointAdded', (fileName, row) => this.onBreakpointAddedListener(fileName, row))
      this.on('editor', 'contentChanged', () => this.onEditorContentChangedListener())
    }

    onDeactivation () {
      this.onRemoveHighlightsListener()
      this.off('editor', 'breakpointCleared')
      this.off('editor', 'breakpointAdded')
      this.off('editor', 'contentChanged')
    }

    showMessage (title: string, message: string) {}
  }

export class CompilerAbstract implements CompilationOutput {
  // this is a subset of /remix-ide/src/app/compiler/compiler-abstract.js
  languageversion
  data
  source

  constructor (languageversion: string, data: CompilationResult, source: { sources: Sources; target: string }) {
    this.languageversion = languageversion
    this.data = data
    this.source = source // source code
  }

  getSourceName (fileIndex) {
    if (this.data && this.data.sources) {
      return Object.keys(this.data.sources)[fileIndex]
    } else if (Object.keys(this.source.sources).length === 1) {
      // if we don't have ast, we return the only one filename present.
      const sourcesArray = Object.keys(this.source.sources)
      return sourcesArray[0]
    }
    return null
  }
}
