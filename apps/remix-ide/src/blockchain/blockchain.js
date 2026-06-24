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
import { toBuffer, addHexPrefix, BN } from 'ethereumjs-util'
import { waterfall } from 'async'
import { EventEmitter } from 'events'
import { ExecutionContext } from './execution-context'
import VMProvider from './providers/vm.js'
import InjectedProvider from './providers/injected.js'
import NodeProvider from './providers/node.js'
import { util, execution, EventManager, helpers } from '@remix-project/remix-lib'
const { txFormat, txExecution, typeConversion, txListener: Txlistener, TxRunner, TxRunnerWeb3, txHelper } = execution
const { txResultHelper: resultToRemixTx } = helpers
const { createRuntimeFacade } = execution.runtimeFacade

const ZERO_BN = new BN('0', 10)
const NETWORK_STATUS_POLL_INTERVAL = 30000

class Blockchain {
  // NOTE: the config object will need to be refactored out in remix-lib
  constructor (config) {
    this.event = new EventManager()
    this.executionContext = new ExecutionContext()

    this.events = new EventEmitter()
    this.config = config
    const web3Runner = new TxRunnerWeb3({
      config: this.config,
      detectNetwork: (cb) => {
        this.executionContext.detectNetwork(cb)
      },
      isVM: () => { return this.executionContext.isVM() },
      personalMode: () => {
        return this.getProvider() === 'web3' ? this.config.get('settings/personal-mode') : false
      }
    }, _ => this.executionContext.web3(), _ => this.executionContext.currentblockGasLimit())
    this.txRunner = new TxRunner(web3Runner, { runAsync: true })

    this.executionContext.event.register('contextChanged', this.resetEnvironment.bind(this))

    this.networkcallid = 0
    this.networkStatus = { name: ' - ', id: ' - ' }
    this.setupEvents()
    this.setupProviders()
  }

  setupEvents () {
    this.executionContext.event.register('contextChanged', (context, silent) => {
      // Refresh the network status when the execution context changes. Cache invalidation is
      // delegated to executionContext, which preserves the rate-limit backoff so context
      // switching cannot be used to bypass throttling against a slow/offline/throttled endpoint.
      this.executionContext.invalidateNetworkDetectionCache()
      this.detectNetwork((error, network) => {
        this.networkStatus = { network, error }
        this.event.trigger('networkStatus', [this.networkStatus])
      })
      this.event.trigger('contextChanged', [context, silent])
    })

    this.executionContext.event.register('addProvider', (network) => {
      this.event.trigger('addProvider', [network])
    })

    this.executionContext.event.register('removeProvider', (name) => {
      this.event.trigger('removeProvider', [name])
    })

    if (this.networkStatusInterval) clearInterval(this.networkStatusInterval)
    this.networkStatusInterval = setInterval(() => {
      this._refreshNetworkStatus()
    }, NETWORK_STATUS_POLL_INTERVAL)

    this._refreshNetworkStatus()

    // WAL-NET-1: TronLink 4.9 gives no in-page event when the user switches
    // network in the wallet — but it does swap the provider's fullNode host.
    // Watch that synchronous string every second (no RPC) and refresh the
    // network status on change, instead of leaving the indicator and the
    // pending-tx snapshot stale for up to the 30s poll.
    if (typeof window !== 'undefined' && !this._injectedHostWatchInterval) {
      this._injectedHostWatchInterval = setInterval(() => {
        if (this.getProvider() !== 'injected') {
          this._lastInjectedHost = undefined
          return
        }
        const tronWeb = window.tronWeb || this.executionContext.web3()
        const host = (tronWeb && tronWeb.fullNode && tronWeb.fullNode.host) || ''
        if (!host) return
        if (this._lastInjectedHost === undefined) {
          this._lastInjectedHost = host
          return
        }
        if (host === this._lastInjectedHost) return
        this._lastInjectedHost = host
        this.executionContext.invalidateNetworkDetectionCache()
        this._refreshNetworkStatus()
      }, 1000)
    }
  }

  // detectNetwork is async; these callers are fire-and-forget on 1s/30s polls.
  // A throwing networkStatus listener (or a wallet that's locked/mid-update)
  // would otherwise reject the unawaited promise and surface in the runtime
  // error overlay as a phantom IDE P0. Swallow + log instead — a failed
  // background network refresh is benign.
  _refreshNetworkStatus () {
    try {
      const ret = this.detectNetwork((error, network) => {
        this.networkStatus = { network, error }
        this.event.trigger('networkStatus', [this.networkStatus])
      })
      if (ret && typeof ret.catch === 'function') {
        ret.catch((e) => console.warn('[blockchain] network status refresh failed:', e))
      }
    } catch (e) {
      console.warn('[blockchain] network status refresh failed:', e)
    }
  }

  getCurrentNetworkStatus () {
    return this.networkStatus
  }

  setupProviders () {
    this.providers = {}
    this.providers.vm = new VMProvider(this.executionContext)
    this.providers.injected = new InjectedProvider(this.executionContext)
    this.providers.web3 = new NodeProvider(this.executionContext, this.config)
  }

  getCurrentProvider () {
    const provider = this.getProvider()
    if (this.providers[provider]) return this.providers[provider]
    return this.providers.web3 // default to the common type of provider
  }

  /** Return the list of accounts */
  // note: the dual promise/callback is kept for now as it was before
  getAccounts (cb) {
    return new Promise((resolve, reject) => {
      this.getCurrentProvider().getAccounts((error, accounts) => {
        if (cb) {
          return cb(error, accounts)
        }
        if (error) {
          reject(error)
        }
        resolve(accounts)
      })
    })
  }

  deployContractAndLibraries (selectedContract, args, contractMetadata, compilerContracts, callbacks, confirmationCb) {
    const { continueCb, promptCb, statusCb, finalCb } = callbacks
    const constructor = selectedContract.getConstructorInterface()
    txFormat.buildData(selectedContract.name, selectedContract.object, compilerContracts, true, constructor, args, (error, data) => {
      if (error) return statusCb(`creation of ${selectedContract.name} errored: ` + error)

      statusCb(`creation of ${selectedContract.name} pending...`)
      this.createContract(selectedContract, data, continueCb, promptCb, confirmationCb, finalCb)
    }, statusCb, (data, runTxCallback) => {
      // called for libraries deployment
      this.runTx(data, confirmationCb, continueCb, promptCb, runTxCallback)
    })
  }

  deployContractWithLibrary (selectedContract, args, contractMetadata, compilerContracts, callbacks, confirmationCb) {
    const { continueCb, promptCb, statusCb, finalCb } = callbacks
    const constructor = selectedContract.getConstructorInterface()
    txFormat.encodeConstructorCallAndLinkLibraries(selectedContract.object, args, constructor, contractMetadata.linkReferences, selectedContract.bytecodeLinkReferences, (error, data) => {
      if (error) return statusCb(`creation of ${selectedContract.name} errored: ` + (error.message ? error.message : error))

      statusCb(`creation of ${selectedContract.name} pending...`)
      this.createContract(selectedContract, data, continueCb, promptCb, confirmationCb, finalCb)
    })
  }

  createContract (selectedContract, data, continueCb, promptCb, confirmationCb, finalCb) {
    if (data) {
      data.contractName = selectedContract.name
      data.linkReferences = selectedContract.bytecodeLinkReferences
      data.contractABI = selectedContract.abi
    }

    this.runTx({ data: data, useCall: false }, confirmationCb, continueCb, promptCb,
      (error, txResult, address) => {
        if (error) {
          return finalCb(`creation of ${selectedContract.name} errored: ${(error.message ? error.message : error)}`)
        }
        if (txResult.receipt.status === false || txResult.receipt.status === '0x0') {
          return finalCb(`creation of ${selectedContract.name} errored: transaction execution failed`)
        }
        finalCb(null, selectedContract, address)
      }
    )
  }

  determineGasPrice (cb) {
    this.getCurrentProvider().getGasPrice((error, gasPrice) => {
      const warnMessage = ' Please fix this issue before sending any transaction. '
      if (error) {
        return cb('Unable to retrieve the current network gas price.' + warnMessage + error)
      }
      try {
        const gasPriceValue = gasPrice
        cb(null, gasPriceValue)
      } catch (e) {
        cb(warnMessage + e.message, null, false)
      }
    })
  }

  getInputs (funABI) {
    if (!funABI.inputs) {
      return ''
    }
    return txHelper.inputParametersDeclarationToString(funABI.inputs)
  }

  fromWei (value, doTypeConversion, unit) {
    if (doTypeConversion) {
      return Web3.utils.fromWei(typeConversion.toInt(value), unit || 'mwei')
    }
    return Web3.utils.fromWei(value.toString(10), unit || 'mwei')
  }

  toWei (value, unit) {
    return Web3.utils.toWei(value, unit || 'mwei')
  }

  calculateFee (gas, gasPrice, unit) {
    return Web3.utils.toBN(gas).mul(Web3.utils.toBN(Web3.utils.toWei(gasPrice.toString(10), unit || 'gwei')))
  }

  determineGasFees (tx) {
    const determineGasFeesCb = (gasPrice, cb) => {
      let txFeeText, priceStatus
      // TODO: this try catch feels like an anti pattern, can/should be
      // removed, but for now keeping the original logic
      try {
        const fee = this.calculateFee(tx.gas, gasPrice)
        txFeeText = ' ' + this.fromWei(fee, false, 'mwei') + ' Trx'
        priceStatus = true
      } catch (e) {
        txFeeText = ' Please fix this issue before sending any transaction. ' + e.message
        priceStatus = false
      }
      cb(txFeeText, priceStatus)
    }

    return determineGasFeesCb
  }

  changeExecutionContext (context, confirmCb, infoCb, cb) {
    return this.executionContext.executionContextChange(context, null, confirmCb, infoCb, cb)
  }

  setProviderFromEndpoint (target, context, cb) {
    return this.executionContext.setProviderFromEndpoint(target, context, cb)
  }

  detectNetwork (cb) {
    return this.executionContext.detectNetwork(cb)
  }

  getProvider () {
    return this.executionContext.getProvider()
  }

  /**
   * return the fork name applied to the current envionment
   * @return {String} - fork name
   */
  getCurrentFork () {
    return this.executionContext.getCurrentFork()
  }

  isWeb3Provider () {
    const isVM = this.getProvider() === 'vm'
    const isInjected = this.getProvider() === 'injected'
    return (!isVM && !isInjected)
  }

  isInjectedWeb3 () {
    return this.getProvider() === 'injected'
  }

  signMessage (message, account, passphrase, cb) {
    this.getCurrentProvider().signMessage(message, account, passphrase, cb)
  }

  web3 () {
    // @todo(https://github.com/ethereum/remix-project/issues/431)
    const isVM = this.getProvider() === 'vm'
    if (isVM) {
      return this.providers.vm.web3
    }
    return this.executionContext.web3()
  }

  getTxListener (opts) {
    opts.event = {
      // udapp: this.udapp.event
      udapp: this.event
    }
    const txlistener = new Txlistener(opts, this.executionContext)
    return txlistener
  }

  async getTokenBalance (address, tokenId) {
    if (!tokenId || String(tokenId) === '0') return ZERO_BN

    if (this.getProvider() === 'vm') {
      return await new Promise((resolve, reject) => {
        this.getCurrentProvider().getAccount(address, (error, account) => {
          if (error) return reject(error)
          resolve(execution.txIntegerUtils.extractTrc10Balance(account, tokenId))
        })
      })
    }

    const tronWeb = this.executionContext.web3()
    if (!tronWeb?.trx?.getAccount) {
      throw new Error('Current provider does not support TRC10 balance lookup')
    }

    const normalizedAddress = String(address).startsWith('0x') ? util.addressToBase58(address) : address
    // Bound the lookup so a dead/zombie injected bridge can't hang the TRC10
    // balance read forever; on timeout this throws a clear error to the caller.
    const account = await execution.walletProviderAdapter.withWalletTimeout(
      tronWeb.trx.getAccount(normalizedAddress),
      execution.walletProviderAdapter.WALLET_NODE_TIMEOUT_MS,
      execution.walletProviderAdapter.WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT
    )
    return execution.txIntegerUtils.extractTrc10Balance(account, tokenId)
  }

  runOrCallContractMethod (contractName, contractAbi, funABI, contract, value, address, callType, lookupOnly, logMsg, logCallback, outputCb, confirmationCb, continueCb, promptCb) {
    // contractsDetails is used to resolve libraries
    txFormat.buildData(contractName, contractAbi, {}, false, funABI, callType, (error, data) => {
      if (error) {
        return logCallback(`${logMsg} errored: ${error} `)
      }
      if (!lookupOnly) {
        logCallback(`${logMsg} pending ... `)
      } else {
        logCallback(`${logMsg}`)
      }
      if (funABI.type === 'fallback') data.dataHex = value

      if (data) {
        data.contractName = contractName
        data.contractABI = contractAbi
        data.contract = contract
      }
      const useCall = funABI.stateMutability === 'view' || funABI.stateMutability === 'pure'
      this.runTx({ to: address, data, useCall }, confirmationCb, continueCb, promptCb, (error, txResult, _address, returnValue) => {
        if (error) {
          return logCallback(`${logMsg} errored: ${error} `)
        }
        if (lookupOnly) {
          outputCb(returnValue)
        }
      })
    },
    (msg) => {
      logCallback(msg)
    },
    (data, runTxCallback) => {
      // called for libraries deployment
      this.runTx(data, confirmationCb, runTxCallback, promptCb, () => {})
    })
  }

  context () {
    return (this.executionContext.isVM() ? 'memory' : 'blockchain')
  }

  // NOTE: the config is only needed because exectuionContext.init does
  // if config.get('settings/always-use-vm'), we can simplify this later
  resetAndInit (config, transactionContextAPI) {
    this.transactionContextAPI = transactionContextAPI
    this.executionContext.init(config)
    this.executionContext.stopListenOnLastBlock()
    this.executionContext.listenOnLastBlock()
    this.resetEnvironment()
  }

  addProvider (provider) {
    this.executionContext.addProvider(provider)
  }

  removeProvider (name) {
    this.executionContext.removeProvider(name)
  }

  // TODO : event should be triggered by Udapp instead of TxListener
  /** Listen on New Transaction. (Cannot be done inside constructor because txlistener doesn't exist yet) */
  startListening (txlistener) {
    txlistener.event.register('newTransaction', (tx) => {
      this.events.emit('newTransaction', tx)
    })
  }

  resetEnvironment () {
    this.getCurrentProvider().resetEnvironment()
    // TODO: most params here can be refactored away in txRunner
    const web3Runner = new TxRunnerWeb3({
      config: this.config,
      detectNetwork: (cb) => {
        this.executionContext.detectNetwork(cb)
      },
      isVM: () => { return this.executionContext.isVM() },
      personalMode: () => {
        return this.getProvider() === 'web3' ? this.config.get('settings/personal-mode') : false
      }
    }, _ => this.executionContext.web3(), _ => this.executionContext.currentblockGasLimit())

    this.txRunner = new TxRunner(web3Runner, { runAsync: true })
    this.txRunner.event.register('transactionBroadcasted', (txhash) => {
      this.executionContext.detectNetwork((error, network) => {
        if (error || !network) return
        if (network.name === 'TRON') {
          return this.event.trigger('transactionBroadcasted', [txhash, network.id])
        }
        this.event.trigger('transactionBroadcasted', [txhash, network.name])
      })
    })
  }

  /**
   * Create a VM Account
   * @param {{privateKey: string, balance: string}} newAccount The new account to create
   */
  createVMAccount (newAccount) {
    if (this.getProvider() !== 'vm') {
      throw new Error('plugin API does not allow creating a new account through web3 connection. Only vm mode is allowed')
    }
    return this.providers.vm.createVMAccount(newAccount)
  }

  newAccount (_password, passwordPromptCb, cb) {
    return this.getCurrentProvider().newAccount(passwordPromptCb, cb)
  }

  /** Get the balance of an address, and convert wei to ether */
  getBalanceInEther (address, cb) {
    if (this.getProvider() === 'vm') {
      return this.getCurrentProvider().getBalanceInEther(util.addressToHex(address), cb)
    }

    this.getCurrentProvider().getBalanceInEther(address, cb)
  }

  pendingTransactionsCount () {
    if (!this.txRunner || !this.txRunner.pendingTxs) return 0
    return Object.keys(this.txRunner.pendingTxs).length
  }

  /**
   * This function send a tx only to javascript VM or testnet, will return an error for the mainnet
   * SHOULD BE TAKEN CAREFULLY!
   *
   * @param {Object} tx    - transaction.
   */
  sendTransaction (tx) {
    return new Promise((resolve, reject) => {
      this.executionContext.detectNetwork((error, network) => {
        if (error) return reject(error)
        if (network.name === 'Main' && network.id === '1') {
          return reject(new Error('It is not allowed to make this action against mainnet'))
        }

        this.txRunner.rawRun(
          tx,
          (network, tx, gasEstimation, continueTxExecution, cancelCb) => { continueTxExecution() },
          (error, continueTxExecution, cancelCb) => { if (error) { reject(error) } else { continueTxExecution() } },
          (okCb, cancelCb) => { okCb() },
          async (error, result) => {
            if (error) return reject(error)
            try {
              const execResult = await this.web3().eth.getExecutionResultFromSimulator(result.transactionHash)
              resolve(resultToRemixTx(result, execResult))
            } catch (e) {
              reject(e)
            }
          }
        )
      })
    })
  }

  runTx (args, confirmationCb, continueCb, promptCb, cb) {
    const self = this
    waterfall([
      function getGasLimit (next) {
        if (self.transactionContextAPI.getGasLimit) {
          return self.transactionContextAPI.getGasLimit((err, gasLimit) => {
            next(err, gasLimit)
          })
        }
        next(null, 400000000)
      },
      function queryValue (gasLimit, next) {
        if (args.value) {
          return next(null, args.value, gasLimit)
        }
        if (args.useCall || !self.transactionContextAPI.getValue) {
          return next(null, 0, gasLimit)
        }
        self.transactionContextAPI.getValue(function (err, value) {
          next(err, value, gasLimit)
        })
      },
      function getAccount (value, gasLimit, next) {
        if (args.from) {
          return next(null, args.from, value, gasLimit)
        }
        if (self.transactionContextAPI.getAddress) {
          return self.transactionContextAPI.getAddress(function (err, address) {
            next(err, address, value, gasLimit)
          })
        }
        self.getAccounts(function (err, accounts) {
          if (err) return next(err)
          const address = accounts[0]
          if (!address) return next('No accounts available')
          if (self.executionContext.isVM() && !self.providers.vm.RemixSimulatorProvider.Accounts.accounts[address]) {
            return next('Invalid account selected')
          }
          next(null, address, value, gasLimit)
        })
      },
      function getExtendValue (address, value, gasLimit, next) {
        if (self.transactionContextAPI.getExtendValue) {
          return self.transactionContextAPI.getExtendValue((err, res) => {
            next(err, address, value, gasLimit, res)
          })
        }
        next(null, address, value, gasLimit, {})
      },
      function runTransaction (fromAddress, value, gasLimit, extend, next) {
        const tx = { to: args.to, data: args.data.dataHex, useCall: args.useCall, from: fromAddress, value: value, gasLimit: gasLimit, timestamp: args.data.timestamp }
        const payLoad = { funAbi: args.data.funAbi, funArgs: args.data.funArgs, contractBytecode: args.data.contractBytecode, contractName: args.data.contractName, contractABI: args.data.contractABI, linkReferences: args.data.linkReferences }
        if (!tx.timestamp) tx.timestamp = Date.now()

        Object.assign(tx, extend)
        Object.assign(payLoad, extend)
        const runtimeFacade = createRuntimeFacade({
          kind: 'tvm',
          environment: self.executionContext.isVM() ? 'vm' : 'injected',
          account: fromAddress,
          provider: self.executionContext.web3()
        })
        const runtimeValidation = runtimeFacade.validateTransaction({
          tokenId: tx.tokenId,
          tokenValue: tx.tokenValue,
          feeLimit: tx.feeLimit,
          callValue: tx.callValue || tx.value,
          from: tx.from,
          to: tx.to,
          data: tx.data
        })
        if (!runtimeValidation.ok) return next(runtimeValidation.errors[0])
        const networkName = self.networkStatus?.network?.name || self.networkStatus?.name || self.executionContext.getProvider()
        // The snapshot label must discriminate TRON networks: name is 'TRON' for
        // nile/shasta/main alike, only the id differs (WAL-NET-1). It captures
        // what the UI displayed when the tx was initiated; txRunner compares it
        // against the wallet's live network before building and broadcasting.
        const snapshotNetworkLabel = self.networkStatus?.network
          ? [self.networkStatus.network.name, self.networkStatus.network.id].filter(Boolean).join('/')
          : networkName
        tx.runtimeSummary = runtimeFacade.createTransactionSummary({
          tokenId: tx.tokenId,
          tokenValue: tx.tokenValue,
          feeLimit: tx.feeLimit || tx.gasLimit,
          callValue: tx.callValue || tx.value,
          from: tx.from,
          to: tx.to,
          data: tx.data,
          network: networkName
        })
        tx.pendingTransactionSnapshot = runtimeFacade.createTransactionSnapshot({
          from: tx.from,
          network: snapshotNetworkLabel
        })
        tx.funAbi = args.data.funAbi
        tx.contractName = args.data.contractName
        tx.contractABI = args.data.contractABI

        const timestamp = tx.timestamp
        self.event.trigger('initiatingTransaction', [timestamp, tx, payLoad])
        self.txRunner.rawRun(tx, confirmationCb, continueCb, promptCb,
          async (error, result) => {
            if (error) return next(error)

            const isVM = self.executionContext.isVM()
            if (isVM && tx.useCall) {
              try {
                result.transactionHash = await self.web3().eth.getHashFromTagBySimulator(timestamp)
              } catch (e) {
                console.log('unable to retrieve back the "call" hash', e)
              }
            }
            if (result) {
              result.runtime = runtimeFacade.normalizeReceipt(result.receipt ? result.receipt : result)
            }
            const eventName = (tx.useCall ? 'callExecuted' : 'transactionExecuted')
            self.event.trigger(eventName, [error, tx.from, tx.to, tx.data, tx.useCall, result, timestamp, payLoad])

            if (error && (typeof (error) !== 'string')) {
              if (error.message) error = error.message
              else {
                try { error = 'error: ' + JSON.stringify(error) } catch (e) { error = 'error: [unserializable]' }
              }
            }
            next(error, result, tx)
          }
        )
      }
    ],
    async (error, txResult, tx) => {
      if (error) {
        return cb(error)
      }

      /*
      value of txResult is inconsistent:
          - transact to contract:
            {"receipt": { ... }, "tx":{ ... }, "transactionHash":"0x7ba4c05075210fdbcf4e6660258379db5cc559e15703f9ac6f970a320c2dee09"}
          - call to contract:
            {"result":"0x0000000000000000000000000000000000000000000000000000000000000000","transactionHash":"0x5236a76152054a8aad0c7135bcc151f03bccb773be88fbf4823184e47fc76247"}
      */

      const isVM = this.executionContext.isVM()
      let execResult
      let returnValue = null
      if (isVM) {
        execResult = await this.web3().eth.getExecutionResultFromSimulator(txResult.transactionHash)
        if (execResult) {
          // if it's not the VM, we don't have return value. We only have the transaction, and it does not contain the return value.
          returnValue = execResult ? execResult.returnValue : toBuffer(addHexPrefix(txResult.result) || '0x0000000000000000000000000000000000000000000000000000000000000000')
          const vmError = txExecution.checkVMError(execResult, args.data.contractABI, args.data.contract)
          if (vmError.error) {
            return cb(vmError.message)
          }
        }
      }

      if (!isVM && tx && tx.useCall) {
        returnValue = toBuffer(addHexPrefix(txResult.result))
      }

      let address = null
      if (txResult && txResult.receipt) {
        address = txResult.receipt.contractAddress
      }

      cb(error, txResult, address, returnValue)
    })
  }
}

module.exports = Blockchain
