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
import { EventManager } from '../eventManager'
import { addressToBase58 } from '../util'
import Web3 from 'web3'
import { parseSafeInteger, TX_FIELD_LABELS, validateTrc10Inputs } from './txIntegerUtils'
import { normalizeWalletError, WALLET_ERROR_CODES, withWalletTimeout, WALLET_SIGN_TIMEOUT_MS, WALLET_NODE_TIMEOUT_MS } from './walletProviderAdapter'
import { createRuntimeFacade } from './runtimeFacade'

// Wall-clock polling budget (default 120s) and linear backoff. Bounded to prevent infinite
// RPC floods, while giving Tron mainnet / Nile enough headroom to land a tx through normal
// congestion. Backoff trims warn volume on extended retries without losing the per-attempt
// signal callers expect.
const TX_LOOKUP_BUDGET_MS = 120_000
const PAUSE_MIN_MS = 500
const PAUSE_MAX_MS = 2_000
const PAUSE_RAMP_MS = 25 // each attempt adds 25ms to the previous pause until PAUSE_MAX_MS

// withWalletTimeout / WALLET_*_TIMEOUT_MS live in walletProviderAdapter (shared with
// the injected provider). They bound each injected sign/build/broadcast so a dead
// bridge can't leave the tx stuck at "pending…" — TX_LOOKUP_BUDGET_MS only bounds
// the receipt-polling loops below, not the sign/broadcast themselves.

function decodeTronErrorMessage (rawMessage: unknown): string {
  if (rawMessage === undefined || rawMessage === null) return ''

  const normalizedMessage = String(rawMessage).trim()
  if (!normalizedMessage) return ''

  const hexPayload = normalizedMessage.replace(/^0x/i, '')
  if (/^[0-9a-fA-F]+$/.test(hexPayload) && hexPayload.length % 2 === 0) {
    try {
      const decodedMessage = Web3.utils
        .hexToUtf8(`0x${hexPayload}`)
        .replace(/\0/g, '')
        .trim()
      if (decodedMessage) return decodedMessage
    } catch (e) {
      // hexToUtf8 can throw on non-utf8 hex; fall through to raw message
      console.debug('[txRunnerWeb3] hexToUtf8 decode failed, returning raw message', e)
    }
  }

  return normalizedMessage
}

function extractTronErrorMessage (errorLike: any): string {
  if (!errorLike) return ''
  if (typeof errorLike === 'string') return decodeTronErrorMessage(errorLike)

  if (errorLike.message) {
    const message = decodeTronErrorMessage(errorLike.message)
    if (message) return message
  }

  if (errorLike.result?.message) {
    const message = decodeTronErrorMessage(errorLike.result.message)
    if (message) return message
  }

  if (errorLike.code) {
    const message = decodeTronErrorMessage(errorLike.code)
    if (message) return message
  }

  if (errorLike.result?.code) {
    const message = decodeTronErrorMessage(errorLike.result.code)
    if (message) return message
  }

  return ''
}

class MinedTransactionError extends Error {
  transactionError: any
  txData: any

  constructor (transactionError, txData) {
    super(transactionError && transactionError.message ? transactionError.message : String(transactionError))
    this.name = 'MinedTransactionError'
    this.transactionError = transactionError
    this.txData = txData
  }
}

type Web3WithPersonal = Web3 & {
  personal?: {
    sendTransaction: (...args: unknown[]) => unknown
  }
}

type Web3UtilsWithJsonInterface = typeof Web3.utils & {
  _jsonInterfaceMethodToString?: (abi: unknown) => string
}

function normalizeTrc10ValidationMessage (errorLike: any, tokenId: number, tokenValue: number): string | null {
  const validationError = validateTrc10Inputs(tokenId, tokenValue)
  if (validationError) return validationError
  if (tokenId <= 0 && tokenValue <= 0) return null

  const detailedMessage = extractTronErrorMessage(errorLike)
  const lowerCaseMessage = detailedMessage.toLowerCase()

  if (lowerCaseMessage.includes('invalid argument')) {
    return 'invalid argument'
  }

  if (
    lowerCaseMessage.includes('no asset') ||
    lowerCaseMessage.includes('assetbalance must be greater than 0') ||
    lowerCaseMessage.includes('asset balance is not sufficient') ||
    lowerCaseMessage.includes('token balance is not sufficient')
  ) {
    return 'No asset'
  }

  return null
}

function createWalletRuntimeError (errorLike: any): Error {
  const walletError = normalizeWalletError(errorLike)
  const detailedMessage = walletError.code !== WALLET_ERROR_CODES.WALLET_UNKNOWN_ERROR
    ? walletError.message
    : extractTronErrorMessage(errorLike)
  return new Error(detailedMessage || walletError.message)
}

function getTronNetworkLabel (tronWebIns: any): string | undefined {
  return tronWebIns?.fullNode?.host || tronWebIns?.solidityNode?.host || undefined
}

const VERIFIED_TRON_NETWORK_IDS = new Set(['main', 'nile', 'shasta'])
const WALLET_NETWORK_VERIFICATION_ERROR = 'Wallet network could not be verified. Refresh the wallet connection, confirm the selected network, and try again.'
const WALLET_PROVIDER_CHANGED_ERROR = 'Wallet provider changed. Reconnect your wallet, confirm the selected network, and try again.'
const TRANSACTION_CANCELLED_ERROR = 'Transaction stopped before signing or broadcast.'
const NETWORK_SNAPSHOT_TIMEOUT_MS = 12_000

async function getCurrentInjectedSnapshot (tronWebIns: any, api: any) {
  const accountAtProbeStart = tronWebIns?.defaultAddress?.base58
  const endpoint = getTronNetworkLabel(tronWebIns)
  if (!api?.detectNetwork) {
    return {
      account: accountAtProbeStart,
      accountAtProbeStart,
      accountChangedDuringProbe: false,
      network: endpoint,
      networkVerificationError: new Error('Network detection is unavailable.')
    }
  }

  const probePromise = new Promise<any>((resolve) => {
    let settled = false
    const finish = (error?, result?) => {
      if (settled) return
      settled = true
      resolve({ error, result })
    }
    try {
      const returned = api.detectNetwork((error, result) => finish(error, result))
      // detectNetwork is callback-based today, but also async. Preserve an
      // outer rejection rather than silently falling back to the node host.
      if (returned && typeof returned.catch === 'function') returned.catch((error) => finish(error))
    } catch (error) {
      finish(error)
    }
  })
  const probe = await withWalletTimeout(
    probePromise,
    NETWORK_SNAPSHOT_TIMEOUT_MS,
    WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT
  ).catch((error) => ({ error }))

  const detected = probe.result
  // All TRON networks share name 'TRON'; only the genesis-derived id
  // ('nile'/'shasta'/'main') discriminates them. Host names are diagnostic
  // only and must never turn a failed/stale genesis probe into authorization.
  const networkName = detected?.name == null ? '' : String(detected.name)
  const networkId = detected?.id == null ? '' : String(detected.id).toLowerCase()
  const detectedLabel = [networkName, networkId].filter(Boolean).join('/') || undefined
  // A fresh custom genesis result cannot receive a canonical TRON id, but the
  // live full-node endpoint still gives normal UI transactions a stable
  // fingerprint. External plugins never reach here on custom networks: their
  // commit-time allowlist rejects them before rawRun.
  const isFreshCustomNetwork = networkName === 'Custom' && Boolean(endpoint)
  const network = isFreshCustomNetwork ? `${detectedLabel || 'Custom'}@${endpoint}` : detectedLabel
  let networkVerificationError
  if (probe.error) {
    networkVerificationError = probe.error
  } else if (detected?.stale === true) {
    networkVerificationError = new Error('Network detection returned a stale cached result.')
  } else if (!isFreshCustomNetwork && (networkName !== 'TRON' || !VERIFIED_TRON_NETWORK_IDS.has(networkId))) {
    networkVerificationError = new Error('Network detection returned an unknown network.')
  }

  const account = tronWebIns?.defaultAddress?.base58
  return {
    account,
    accountAtProbeStart,
    accountChangedDuringProbe: accountAtProbeStart !== account,
    network,
    networkVerificationError
  }
}

export class TxRunnerWeb3 {
  event
  _api
  getWeb3: () => Web3
  getTronWeb: () => any
  currentblockGasLimit: () => number

  constructor (api, getWeb3, currentblockGasLimit) {
    this.event = new EventManager()
    this.getWeb3 = getWeb3
    this.getTronWeb = getWeb3
    this.currentblockGasLimit = currentblockGasLimit
    this._api = api
  }

  _executeTx (tx, network, txFee, api, promptCb, callback) {
    if (network && network.lastBlock && network.lastBlock.baseFeePerGas) {
      // the sending stack (web3.js / metamask need to have the type defined)
      // this is to avoid the following issue: https://github.com/MetaMask/metamask-extension/issues/11824
      tx.type = '0x2'
    }
    if (txFee) {
      if (txFee.baseFeePerGas) {
        tx.maxPriorityFeePerGas = this.getWeb3().utils.toHex(
          this.getWeb3().utils.toWei(txFee.maxPriorityFee, 'gwei')
        )
        tx.maxFeePerGas = this.getWeb3().utils.toHex(
          this.getWeb3().utils.toWei(txFee.maxFee, 'gwei')
        )
        tx.type = '0x2'
      } else {
        tx.gasPrice = this.getWeb3().utils.toHex(
          this.getWeb3().utils.toWei(txFee.gasPrice, 'gwei')
        )
        tx.type = '0x1'
      }
    }

    if (api.personalMode()) {
      const personal = (this.getWeb3() as Web3WithPersonal).personal
      if (!personal || typeof personal.sendTransaction !== 'function') return callback('Personal mode is not available on this provider.')
      promptCb(
        value => {
          this._sendTransaction(
            personal?.sendTransaction,
            tx,
            value,
            callback
          )
        },
        () => {
          return callback('Canceled by user.')
        }
      )
    } else {
      this._sendTransaction(
        this.getWeb3().eth.sendTransaction,
        tx,
        null,
        callback
      )
    }
  }

  _sendTransaction (sendTx, tx, pass, callback) {
    const cb = (err, resp) => {
      if (err) {
        return callback(err, resp)
      }
      this.event.trigger('transactionBroadcasted', [resp])
      var listenOnResponse = () => {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
          try {
            const receipt = await tryTillReceiptAvailable(resp, this.getWeb3())
            tx = await tryTillTxAvailable(resp, this.getWeb3())
            resolve({
              receipt,
              tx,
              transactionHash: receipt ? receipt['transactionHash'] : null
            })
          } catch (e) {
            reject(e)
          }
        })
      }
      listenOnResponse()
        .then(txData => {
          try {
            callback(null, txData)
          } catch (err) {
            console.error(err)
          }
        }, error => {
          try {
            callback(error)
          } catch (err) {
            console.error(err)
          }
        })
    }
    const args = pass !== null ? [tx, pass, cb] : [tx, cb]
    try {
      const sent = sendTx.apply({}, args)
      // web3's sendTransaction returns a PromiEvent that ALSO rejects when the
      // receipt comes back reverted. The `cb` above already carries that
      // outcome through the normal flow, so the returned promise's rejection is
      // a duplicate — swallow it, otherwise every reverting VM write surfaces
      // an uncaught "Transaction has been reverted by the EVM" page error.
      if (sent && typeof sent.catch === 'function') sent.catch(() => {})
    } catch (e) {
      return callback(
        `Send transaction failed: ${e.message} . if you use an injected provider, please check it is properly unlocked. `
      )
    }
  }

  execute (args, confirmationCb, gasEstimationForceSend, promptCb, callback) {
    let data = args.data
    if (data.slice(0, 2) !== '0x') {
      data = '0x' + data
    }

    if (this._api && this._api.isVM()) {
      return this.runInNode(
        args.from,
        args.to,
        data,
        args.value,
        args.tokenId,
        args.tokenValue,
        args.gasLimit,
        args.useCall,
        args.timestamp,
        args.cancelState,
        confirmationCb,
        gasEstimationForceSend,
        promptCb,
        callback
      )
    } else {
      return this.runInTron(
        args,
        confirmationCb,
        gasEstimationForceSend,
        promptCb,
        callback
      )
    }
  }

  runInNode (
    from,
    to,
    data,
    value,
    tokenId,
    tokenValue,
    gasLimit,
    useCall,
    timestamp,
    cancelState,
    confirmCb,
    gasEstimationForceSend,
    promptCb,
    callback
  ) {
    let called = false
    const cbOnce = (err, res?) => {
      if (called) return
      called = true
      callback(err, res)
    }
    const isCancelled = () => Boolean(cancelState && typeof cancelState.isCancelled === 'function' && cancelState.isCancelled())
    const cancellationError = () => new Error(TRANSACTION_CANCELLED_ERROR)
    if (isCancelled()) return cbOnce(cancellationError())

    const tx = {
      from: from,
      to: to,
      data: data,
      value: value,
      tokenId: tokenId,
      tokenValue: tokenValue
    }

    if (useCall) {
      tx['gas'] = gasLimit
      if (this._api && this._api.isVM()) tx['timestamp'] = timestamp
      return this.getWeb3().eth.call(tx, function (error, result: any) {
        if (error) return cbOnce(error)
        if (isCancelled()) return cbOnce(cancellationError())
        cbOnce(null, {
          result: result
        })
      })
    }
    this.getWeb3().eth.estimateGas(tx, (err, gasEstimation) => {
      if (isCancelled()) return cbOnce(cancellationError())
      if (err && err.message.indexOf('Invalid JSON RPC response') !== -1) {
        // // @todo(#378) this should be removed when https://github.com/WalletConnect/walletconnect-monorepo/issues/334 is fixed
        return cbOnce(
          new Error(
            'Gas estimation failed because of an unknown internal error. This may indicated that the transaction will fail.'
          )
        )
      }
      gasEstimationForceSend(
        err,
        () => {
          if (isCancelled()) return cbOnce(cancellationError())
          // callback is called whenever no error
          tx['gas'] = !gasEstimation ? gasLimit : gasEstimation

          this._api.detectNetwork((err, network) => {
            if (err) {
              console.log(err)
              return
            }
            if (isCancelled()) return cbOnce(cancellationError())

            if (
              this._api.config.getUnpersistedProperty(
                'doNotShowTransactionConfirmationAgain'
              )
            ) {
              return this._executeTx(
                tx,
                network,
                null,
                this._api,
                promptCb,
                cbOnce
              )
            }

            confirmCb(
              network,
              tx,
              tx['gas'],
              txFee => {
                if (isCancelled()) return cbOnce(cancellationError())
                return this._executeTx(
                  tx,
                  network,
                  txFee,
                  this._api,
                  promptCb,
                  cbOnce
                )
              },
              error => {
                cbOnce(error)
              }
            )
          })
        },
        () => {
          const blockGasLimit = this.currentblockGasLimit()
          // NOTE: estimateGas very likely will return a large limit if execution of the code failed
          //       we want to be able to run the code in order to debug and find the cause for the failure
          if (err) return cbOnce(err)

          let warnEstimation =
            " An important gas estimation might also be the sign of a problem in the contract code. Please check loops and be sure you did not sent value to a non payable function (that's also the reason of strong gas estimation). "
          warnEstimation += ' ' + err

          if (gasEstimation > gasLimit) {
            return cbOnce(
              'Gas required exceeds limit: ' + gasLimit + '. ' + warnEstimation
            )
          }
          if (gasEstimation > blockGasLimit) {
            return cbOnce(
              'Gas required exceeds block gas limit: ' +
              gasLimit +
              '. ' +
              warnEstimation
            )
          }
        }
      )
    })
  }

  async runInTron (args, confirmCb, gasEstimationForceSend, promptCb, callback) {
    // console.log('args from runInTron: ', args)
    const {
      from,
      to,
      funAbi,
      data,
      value,
      tokenId: tokenIdHex,
      tokenValue: tokenValueHex,
      gasLimit,
      contractName: name = '',
      contractABI = [],
      userFeePercentage,
      originEnergyLimit,
      useCall,
      cancelState
    } = args

    let callValue
    let tokenId
    let tokenValue
    let feeLimit

    try {
      if (cancelState && typeof cancelState.isCancelled === 'function' && cancelState.isCancelled()) {
        throw new Error(TRANSACTION_CANCELLED_ERROR)
      }
      // TronWeb 6.1.0 still converts callValue through parseInt inside both
      // transaction builders. Keep injected transactions fail-closed until
      // the provider can serialize values above JavaScript's safe range
      // without changing the amount the user approved.
      callValue = parseSafeInteger(value, 10, TX_FIELD_LABELS.transactionValue)
      tokenId = parseSafeInteger(tokenIdHex, 16, TX_FIELD_LABELS.tokenId)
      tokenValue = parseSafeInteger(tokenValueHex, 16, TX_FIELD_LABELS.tokenValue)
      feeLimit = parseSafeInteger(gasLimit, 16, TX_FIELD_LABELS.feeLimit)
    } catch (error) {
      return callback(error)
    }

    const runtimeValidation = createRuntimeFacade({ kind: 'tvm', environment: 'injected', account: from }).validateTransaction({
      tokenId,
      tokenValue,
      feeLimit,
      callValue,
      from,
      to,
      data
    })
    if (!runtimeValidation.ok) return callback(runtimeValidation.errors[0])

    const contractAddr = addressToBase58(to)
    const rawParameter = data ? data.replace(/^(0x)/, '').slice(8) : ''
    let functionSelector = ''
    if (funAbi) {
      // java-tron trick
      if (funAbi.type === 'fallback') {
        funAbi.name = 'fallback'
        funAbi.inputs = []
      }

      if (funAbi.type !== 'receive' && funAbi.type !== 'constructor') {
        const web3Utils = Web3.utils as Web3UtilsWithJsonInterface
        functionSelector = web3Utils._jsonInterfaceMethodToString ? web3Utils._jsonInterfaceMethodToString(funAbi) : ''
      }
    }

    const tronWebIns = this.getTronWeb()

    if (useCall) {
      try {
        const result = await withWalletTimeout(tronWebIns.transactionBuilder.triggerSmartContract(
          contractAddr,
          functionSelector,
          { _isConstant: true, rawParameter }
        ), WALLET_NODE_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT)
        const res = result && result.result ? result.constant_result : ['']
        return callback(null, { result: res[0] })
      } catch (error) {
        if (error) return callback(error)
      }
    }

    if (!tronWebIns?.defaultAddress?.base58) {
      return callback(new Error(normalizeWalletError(WALLET_ERROR_CODES.WALLET_DISCONNECTED).message))
    }

    let pendingSnapshot = args.pendingTransactionSnapshot
    const injectedRuntimeFacade = createRuntimeFacade({ kind: 'tvm', environment: 'injected', account: from })

    gasEstimationForceSend(
      null,
      async () => {
        const assertNotCancelled = () => {
          if (cancelState && typeof cancelState.isCancelled === 'function' && cancelState.isCancelled()) {
            throw new Error(TRANSACTION_CANCELLED_ERROR)
          }
        }
        try {
          assertNotCancelled()
        } catch (error) {
          return callback(error)
        }
        const validatePendingSnapshot = async () => {
          assertNotCancelled()
          const currentTronWebIns = this.getTronWeb()
          // TronLink can replace window.tronWeb on unlock/network switch. A
          // transaction built with the captured instance must never continue
          // signing or broadcasting through a newly rebound provider.
          if (!currentTronWebIns || currentTronWebIns !== tronWebIns) {
            throw new Error(WALLET_PROVIDER_CHANGED_ERROR)
          }
          const currentSnapshot = await getCurrentInjectedSnapshot(currentTronWebIns, this._api)
          if (currentSnapshot.networkVerificationError) {
            // Provider errors can contain credential-bearing endpoint URLs. Do
            // not echo the raw object; callers receive a fixed actionable error.
            console.warn('[txRunnerWeb3] injected network verification failed')
            throw new Error(WALLET_NETWORK_VERIFICATION_ERROR)
          }
          // Snapshot-less callers get their network baseline from the first
          // validation: later checks still catch mid-flight account/network
          // switches, without comparing a host URL against a name/id label.
          if (!pendingSnapshot) pendingSnapshot = { account: from, network: currentSnapshot.network }
          else if (
            !pendingSnapshot.network ||
            (currentSnapshot.network && currentSnapshot.network.toLowerCase().startsWith(`${pendingSnapshot.network.toLowerCase()}@`))
          ) pendingSnapshot = { ...pendingSnapshot, network: currentSnapshot.network }
          const pendingValidation = injectedRuntimeFacade.validatePendingTransaction(pendingSnapshot, currentSnapshot)
          if (!pendingValidation.ok) throw createWalletRuntimeError(pendingValidation.errors[0])
        }

        const tryTillTxAvailableTron = async (txhash, needsContractAddress = false) => {
          const start = Date.now()
          let attempt = 0
          while (Date.now() - start < TX_LOOKUP_BUDGET_MS) {
            try {
              const receipt = await tronWebIns.trx.getUnconfirmedTransactionInfo(
                txhash
              )
              if (receipt && receipt.id && receipt.blockNumber != null && (!needsContractAddress || receipt.contract_address)) return receipt
            } catch (e) {
              console.warn('[txRunnerWeb3] getUnconfirmedTransactionInfo failed, will retry', e)
            }
            await pause(attempt++)
          }
          throw new Error(`Transaction ${txhash} not visible after ${attempt} attempts (~${Math.round(TX_LOOKUP_BUDGET_MS / 1000)}s)`)
        }

        const cb = (err, resp) => {
          if (err) {
            return callback(err, resp)
          }
          this.event.trigger('transactionBroadcasted', [resp])
          var listenOnResponse = () => {
            // eslint-disable-next-line no-async-promise-executor
            return new Promise(async (resolve, reject) => {
              const txn = await tryTillTxAvailableTron(resp, !contractAddr)
              // TransactionInfo stores the canonical execution outcome under
              // receipt.result (SUCCESS/FAILED). Some providers also expose a
              // top-level result, so normalize both shapes before deciding
              // whether the broadcast actually succeeded on-chain.
              const normalizedReceipt = injectedRuntimeFacade.normalizeReceipt(txn)
              const transactionHash = `0x${resp}`
              const { blockNumber, fee } = txn
              const contractAddress = txn.contract_address
                ? txn.contract_address.replace(/^(41)/, '0x')
                : null
              const txData = {
                receipt: {
                  blockNumber,
                  contractAddress,
                  gasUsed: fee,
                  logs: [],
                  status: normalizedReceipt.status !== 'failure',
                  transactionHash
                },
                tx: {
                  blockNumber,
                  from,
                  to: contractAddr,
                  gas: fee,
                  gasPrice: '',
                  hash: transactionHash,
                  input: data.slice(0, 2) !== '0x' ? '0x' + data : data,
                  value,
                  tokenId,
                  tokenValue
                },
                transactionHash
              }
              if (normalizedReceipt.status === 'failure') {
                let msg = txn.receipt?.result || txn.result || 'Unknown'
                if (msg !== 'REVERT') return reject(new MinedTransactionError(msg, txData))

                try {
                  const contractResult = txn.contractResult
                    ? txn.contractResult[0]
                    : ''
                  const hexStr = contractResult.substr(8)
                  const strIndex = Web3.utils.hexToNumber(
                    `0x${hexStr.substr(0, 64)}`
                  ) as number
                  const strLength = Web3.utils.hexToNumber(
                    `0x${hexStr.substr(strIndex * 2, 64)}`
                  ) as number
                  if (strLength) {
                    msg = Web3.utils.hexToUtf8(
                      `0x${hexStr.substr(strIndex * 2 + 64, strLength * 2)}`
                    )
                  }
                  reject(new MinedTransactionError(msg, txData))
                } catch (error) {
                  reject(new MinedTransactionError(error, txData))
                }
              } else {
                resolve(txData)
              }
            })
          }
          listenOnResponse()
            .then(txData => {
              callback(null, txData)
            })
            .catch(failure => {
              if (failure instanceof MinedTransactionError) return callback(failure.transactionError, failure.txData)
              callback(failure)
            })
        }

        try {
          if (contractAddr) {
            await validatePendingSnapshot()
            const tTransaction = await withWalletTimeout(tronWebIns.transactionBuilder.triggerSmartContract(
              contractAddr,
              functionSelector,
              { callValue, tokenId, tokenValue, feeLimit, rawParameter },
              []
            ), WALLET_NODE_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT)

            if (!tTransaction.result) {
              throw new Error('Unknown')
            }

            if (!tTransaction.result.result) {
              const detailedMessage =
                normalizeTrc10ValidationMessage(
                  tTransaction.result,
                  tokenId,
                  tokenValue
                ) || extractTronErrorMessage(tTransaction.result)
              throw new Error(detailedMessage || 'Unknown')
            }

            // The builder is an asynchronous node call. TronLink can switch
            // accounts/networks while it is pending, so validate again before
            // opening a signature request for the now-stale transaction.
            await validatePendingSnapshot()
            assertNotCancelled()
            let tSignedTransaction
            try {
              tSignedTransaction = await withWalletTimeout(tronWebIns.trx.sign(
                tTransaction.transaction
              ), WALLET_SIGN_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT)
            } catch (error) {
              throw createWalletRuntimeError(error)
            }

            assertNotCancelled()
            await validatePendingSnapshot()
            assertNotCancelled()

            let tResult
            try {
              tResult = await withWalletTimeout(tronWebIns.trx.sendRawTransaction(
                tSignedTransaction
              ), WALLET_NODE_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_BROADCAST_FAILED)
            } catch (error) {
              throw createWalletRuntimeError(error)
            }
            const tResp =
              tResult && tResult.result
                ? { txhash: tResult.transaction.txID }
                : {}
            if (tResp.txhash) {
              cb(null, tResp.txhash)
            } else {
              throw createWalletRuntimeError('Broadcast failed')
            }
          } else {
            await validatePendingSnapshot()
            const dTransaction = await withWalletTimeout(tronWebIns.transactionBuilder.createSmartContract(
              {
                abi: contractABI,
                bytecode: data,
                rawParameter: '0x',
                name,
                callValue,
                tokenId,
                tokenValue,
                feeLimit,
                userFeePercentage,
                originEnergyLimit
              }
            ), WALLET_NODE_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT)

            const creationValidationMessage =
              normalizeTrc10ValidationMessage(dTransaction, tokenId, tokenValue) ||
              extractTronErrorMessage(dTransaction)

            if (dTransaction?.result === false || dTransaction?.result?.result === false) {
              throw new Error(creationValidationMessage || 'Unknown')
            }

            // createSmartContract can also outlive a wallet account/network
            // switch. Do not prompt to sign a transaction built for the old
            // snapshot.
            await validatePendingSnapshot()
            assertNotCancelled()
            let dSignedTransaction
            try {
              dSignedTransaction = await withWalletTimeout(tronWebIns.trx.sign(dTransaction), WALLET_SIGN_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT)
            } catch (error) {
              throw createWalletRuntimeError(error)
            }

            assertNotCancelled()
            await validatePendingSnapshot()
            assertNotCancelled()

            let dResult
            try {
              dResult = await withWalletTimeout(tronWebIns.trx.sendRawTransaction(
                dSignedTransaction
              ), WALLET_NODE_TIMEOUT_MS, WALLET_ERROR_CODES.WALLET_BROADCAST_FAILED)
            } catch (error) {
              throw createWalletRuntimeError(error)
            }

            if (!dResult?.result) {
              const broadcastValidationMessage =
                normalizeTrc10ValidationMessage(dResult, tokenId, tokenValue) ||
                extractTronErrorMessage(dResult)
              throw createWalletRuntimeError(broadcastValidationMessage || 'Broadcast failed')
            }

            const dResp =
              dResult && dResult.result
                ? {
                  address: dResult.transaction.contract_address,
                  txhash: dResult.transaction.txID
                }
                : {}
            if (dResp.txhash) {
              cb(null, dResp.txhash)
            } else {
              throw createWalletRuntimeError('Broadcast failed')
            }
          }
        } catch (e) {
          if (e && e.message === TRANSACTION_CANCELLED_ERROR) {
            return callback(`Send transaction failed: ${TRANSACTION_CANCELLED_ERROR} . if you use an injected provider, please check it is properly unlocked. `)
          }
          const normalizedTrc10Message = normalizeTrc10ValidationMessage(
            e,
            tokenId,
            tokenValue
          )
          if (normalizedTrc10Message) {
            return callback(normalizedTrc10Message)
          }

          const walletError = normalizeWalletError(e)
          const detailedMessage = walletError.code !== WALLET_ERROR_CODES.WALLET_UNKNOWN_ERROR ? walletError.message : extractTronErrorMessage(e)
          return callback(
            `Send transaction failed: ${detailedMessage || (e.message ? e.message : e)
            } . if you use an injected provider, please check it is properly unlocked. `
          )
        }
      },
      () => { }
    )
  }
}

async function tryTillReceiptAvailable (txhash, web3) {
  const start = Date.now()
  let attempt = 0
  while (Date.now() - start < TX_LOOKUP_BUDGET_MS) {
    try {
      const receipt = await web3.eth.getTransactionReceipt(txhash)
      if (receipt) return receipt
    } catch (e) {
      console.warn('[txRunnerWeb3] getTransactionReceipt failed, will retry', e)
    }
    await pause(attempt++)
  }
  throw new Error(`Receipt for ${txhash} not available after ${attempt} attempts (~${Math.round(TX_LOOKUP_BUDGET_MS / 1000)}s)`)
}

async function tryTillTxAvailable (txhash, web3) {
  const start = Date.now()
  let attempt = 0
  while (Date.now() - start < TX_LOOKUP_BUDGET_MS) {
    try {
      const tx = await web3.eth.getTransaction(txhash)
      if (tx) return tx
    } catch (e) {
      console.warn('[txRunnerWeb3] getTransaction failed, will retry', e)
    }
    await pause(attempt++)
  }
  throw new Error(`Transaction ${txhash} not available after ${attempt} attempts (~${Math.round(TX_LOOKUP_BUDGET_MS / 1000)}s)`)
}

async function pause (attempt = 0) {
  const ms = Math.min(PAUSE_MIN_MS + attempt * PAUSE_RAMP_MS, PAUSE_MAX_MS)
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
