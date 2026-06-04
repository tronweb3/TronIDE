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
import Web3 from 'web3'
import EventManager from '../lib/events'
import { execution } from '@remix-project/remix-lib'

let web3
let tronWebInstance, injectedProvider
const JS_VM_TRON = 'JavaScript VM (Tron)'
const walletProviderAdapter = execution.walletProviderAdapter
const NETWORK_DETECTION_RATE_LIMIT_BACKOFF = 60000
const NETWORK_DETECTION_ERROR_BACKOFF = 30000

function applyPublicTronGridApiKey (instance) {
  if (!instance) return
  const publicTronGridApiKey = process.env.TRON_PUBLIC_TRONGRID_API_KEY || ''
  if (
    publicTronGridApiKey &&
    instance.setHeader &&
    instance.fullNode &&
    instance.fullNode.host === 'https://api.trongrid.io' &&
    !instance.fullNode.headers['TRON-PRO-API-KEY']
  ) {
    try {
      instance.setHeader({ 'TRON-PRO-API-KEY': publicTronGridApiKey })
    } catch (e) {
      console.warn('[execution-context] setHeader failed; falling back to anonymous TronGrid limits', e)
    }
  }
}

// Late-bind TronLink/TronWeb. At module-load TronLink may not have injected yet
// (extension reload, slow startup); re-checking each time the IDE asks lets us
// pick up a provider that arrives after this script ran.
function detectInjectedProvider () {
  if (injectedProvider && tronWebInstance) return true
  if (typeof window === 'undefined') return false
  const provider = walletProviderAdapter.getInjectedWalletProvider(window)
  if (!provider.tronWeb || !provider.tronLink) return false
  injectedProvider = provider.tronLink
  tronWebInstance = provider.tronWeb
  applyPublicTronGridApiKey(tronWebInstance)
  return true
}

if (!detectInjectedProvider()) {
  web3 = new Web3(new Web3.providers.HttpProvider('http://localhost:8545'))
}

/*
  trigger contextChanged, web3EndpointChanged
*/
export class ExecutionContext {
  constructor () {
    this.event = new EventManager()
    this.executionContext = null
    this.lastBlock = null
    this.blockGasLimitDefault = 4300000
    this.blockGasLimit = this.blockGasLimitDefault
    this.currentFork = 'tron'
    this.mainNetGenesisHash = '0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3'
    this.customNetWorks = {}
    this.blocks = {}
    this.latestBlockNumber = 0
    this.txs = {}
    this.customWeb3 = {} // mapping between a context name and a web3.js instance
    this._networkDetectionCache = null
    this._networkDetectionCacheKey = null
    this._networkDetectionBackoffUntil = 0
    this._lastNetworkStatus = null
  }

  init (config) {
    if (config.get('settings/always-use-vm')) {
      this.executionContext = 'vm'
      return
    }
    detectInjectedProvider()
    if (injectedProvider && injectedProvider.ready) {
      this.executionContext = 'injected'
      this.askPermission().catch((error) => console.warn('[execution-context] init askPermission failed', error))
    } else {
      this.executionContext = 'vm'
    }
  }

  async askPermission () {
    detectInjectedProvider()
    try {
      await walletProviderAdapter.requestInjectedWalletAccounts(window)
      detectInjectedProvider()
      return true
    } catch (error) {
      const normalized = walletProviderAdapter.normalizeWalletError(error)
      console.warn(normalized.code, error)
      throw walletProviderAdapter.createWalletError(normalized.code, error)
    }
  }

  injectedWalletStatus () {
    return walletProviderAdapter.getInjectedWalletStatus(window)
  }

  getProvider () {
    return this.executionContext
  }

  getCurrentFork () {
    return this.currentFork
  }

  isVM () {
    return this.executionContext === 'vm'
  }

  setWeb3 (context, web3) {
    this.customWeb3[context] = web3
  }

  web3 () {
    if (this.customWeb3[this.executionContext]) return this.customWeb3[this.executionContext]
    if (this.isVM()) {
      return web3
    } else {
      return tronWebInstance
    }
  }

  _isRateLimitError (error) {
    if (!error) return false
    const status = error.status || error.statusCode || error.code
    const message = String(error.message || error.toString ? error.toString() : error).toLowerCase()
    return status === 429 || message.includes('429') || message.includes('too many requests') || message.includes('rate limit')
  }

  _getCachedNetworkStatus () {
    if (this._lastNetworkStatus) {
      return Object.assign({}, this._lastNetworkStatus, { stale: true })
    }
    if (this._networkDetectionCache) {
      return Object.assign({}, this._networkDetectionCache, { stale: true })
    }
    return null
  }

  _getNetworkDetectionCacheKey () {
    if (this.isVM()) return JS_VM_TRON
    if (!tronWebInstance || !tronWebInstance.fullNode) return ''
    return tronWebInstance.fullNode.host || ''
  }

  _recordNetworkDetectionFailure (err) {
    const backoff = this._isRateLimitError(err) ? NETWORK_DETECTION_RATE_LIMIT_BACKOFF : NETWORK_DETECTION_ERROR_BACKOFF
    this._networkDetectionBackoffUntil = Date.now() + backoff
  }

  // Drop the cached network identity so the next detectNetwork() re-queries the provider.
  // While a rate-limit/error backoff is active we keep the cache (and do NOT clear the backoff),
  // so repeated context switches cannot be used to bypass the throttle and hammer the endpoint.
  // Returns true when the cache was actually invalidated.
  invalidateNetworkDetectionCache () {
    if (Date.now() < this._networkDetectionBackoffUntil) return false
    this._networkDetectionCache = null
    this._networkDetectionCacheKey = null
    this._lastNetworkStatus = null
    return true
  }

  _networkFromGenesisBlock (block) {
    let name = 'TRON'
    let id = 'Unknown'

    if (block.blockID === '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc') id = 'main'
    else if (block.blockID === '0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e') id = 'shasta'
    else if (block.blockID === '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc') id = 'nile'
    else name = 'Custom'

    return { id, name, lastBlock: this.lastBlock, currentFork: this.currentFork }
  }

  async detectNetwork (callback) {
    if (this.isVM()) {
      callback(null, { id: '-', name: JS_VM_TRON })
    } else if (tronWebInstance) {
      const currentCacheKey = this._getNetworkDetectionCacheKey()
      if (this._networkDetectionCache && this._networkDetectionCacheKey !== currentCacheKey && Date.now() >= this._networkDetectionBackoffUntil) {
        this._networkDetectionCache = null
        this._lastNetworkStatus = null
      }
      const cachedNetwork = this._getCachedNetworkStatus()
      if (Date.now() < this._networkDetectionBackoffUntil && cachedNetwork) {
        callback(null, cachedNetwork)
        return
      }
      if (this._networkDetectionCache) {
        this._lastNetworkStatus = Object.assign({}, this._networkDetectionCache, { lastBlock: this.lastBlock, currentFork: this.currentFork })
        callback(null, this._lastNetworkStatus)
        return
      }
      if (tronWebInstance.trx?.getBlock) {
        try {
          const res = await tronWebInstance.trx.getBlock(0)
          if (res) {
            this._networkDetectionCache = this._networkFromGenesisBlock(res)
            this._networkDetectionCacheKey = currentCacheKey
            this._lastNetworkStatus = Object.assign({}, this._networkDetectionCache)
            this._networkDetectionBackoffUntil = 0
            callback(null, this._lastNetworkStatus)
          }
        } catch (err) {
          this._recordNetworkDetectionFailure(err)
          const cachedNetwork = this._getCachedNetworkStatus()
          if (cachedNetwork) {
            callback(null, cachedNetwork)
            return
          }
          const name = 'Unknown'
          const id = 'Unknown'
          callback(err, { id, name, lastBlock: this.lastBlock, currentFork: this.currentFork })
        }
      } else {
        callback(null, { id: '-', name: 'TRON' })
      }
    } else {
      callback(null, { id: '-', name: 'TRON' })
    }
  }

  removeProvider (name) {
    if (name && this.customNetWorks[name]) {
      if (this.executionContext === name) this.setContext('vm', null, null, null)
      delete this.customNetWorks[name]
      this.event.trigger('removeProvider', [name])
    }
  }

  addProvider (network) {
    if (network && network.name && !this.customNetWorks[network.name]) {
      this.customNetWorks[network.name] = network
      this.event.trigger('addProvider', [network])
    }
  }

  internalWeb3 () {
    return web3
  }

  blankWeb3 () {
    return new Web3()
  }

  setContext (context, endPointUrl, confirmCb, infoCb) {
    this.executionContext = context
    this.executionContextChange(context, endPointUrl, confirmCb, infoCb, null)
  }

  async executionContextChange (value, endPointUrl, confirmCb, infoCb, cb) {
    const context = value.context
    if (!cb) cb = () => {}
    if (!confirmCb) confirmCb = () => {}
    if (!infoCb) infoCb = () => {}
    if (context === 'vm') {
      this.executionContext = context
      this.currentFork = value.fork
      this.event.trigger('contextChanged', ['vm'])
      return cb()
    }

    if (context === 'injected') {
      detectInjectedProvider()
      if (!injectedProvider) {
        infoCb(walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_UNAVAILABLE)
        return cb()
      } else {
        try {
          await this.askPermission()
        } catch (error) {
          const normalized = walletProviderAdapter.normalizeWalletError(error)
          infoCb(normalized.message)
          return cb()
        }
        this.executionContext = context
        await this._updateChainContext()
        this.event.trigger('contextChanged', ['injected'])
        return cb()
      }
    }

    if (context === 'web3') {
      confirmCb(cb)
    }
    if (this.customNetWorks[context]) {
      var network = this.customNetWorks[context]
      this.setProviderFromEndpoint(network.provider, { context: network.name }, (error) => {
        if (error) infoCb(error)
        cb()
      })
    }
  }

  currentblockGasLimit () {
    return this.blockGasLimit
  }

  stopListenOnLastBlock () {
    if (this.listenOnLastBlockId) clearInterval(this.listenOnLastBlockId)
    this.listenOnLastBlockId = null
  }

  async _updateChainContext () {
    if (this.getProvider() !== 'vm') {
      try {
        this.lastBlock = await tronWebInstance.trx.getCurrentBlock()
      } catch (e) {
        console.error(e)
        this.blockGasLimit = this.blockGasLimitDefault
      }
    }
  }

  listenOnLastBlock () {
    if (this.listenOnLastBlockId) clearInterval(this.listenOnLastBlockId)
    this.listenOnLastBlockId = setInterval(() => {
      this._updateChainContext()
    }, 15000)
  }

  // TODO: remove this when this function is moved

  setProviderFromEndpoint (endpoint, value, cb) {
    const oldProvider = web3.currentProvider
    const context = value.context

    web3.setProvider(endpoint)
    web3.eth.net.isListening((err, isConnected) => {
      if (!err && isConnected === true) {
        this.executionContext = context
        this._updateChainContext()
        this.event.trigger('contextChanged', [context])
        this.event.trigger('web3EndpointChanged')
        cb()
      } else if (isConnected === 'canceled') {
        web3.setProvider(oldProvider)
        cb()
      } else {
        web3.setProvider(oldProvider)
        cb('Not possible to connect to the Web3 provider. Make sure the provider is running, a connection is open (via IPC or RPC) or that the provider plugin is properly configured.')
      }
    })
  }

  txDetailsLink (network, hash) {
    const transactionDetailsLinks = {
      Main: 'https://www.etherscan.io/tx/',
      Rinkeby: 'https://rinkeby.etherscan.io/tx/',
      Ropsten: 'https://ropsten.etherscan.io/tx/',
      Kovan: 'https://kovan.etherscan.io/tx/',
      Goerli: 'https://goerli.etherscan.io/tx/'
    }

    if (transactionDetailsLinks[network]) {
      return transactionDetailsLinks[network] + hash
    }
  }
}
