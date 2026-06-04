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

import Web3 from 'web3'
import { toChecksumAddress, BN } from 'ethereumjs-util'
import { Buffer } from 'buffer'
import * as tvmjsUtil from '@tvmjs/util'
import { processTx } from './txProcess'
import { execution } from '@remix-project/remix-lib'

const createAddress = (tvmjsUtil as any).createAddressFromString
const TxRunnerVM = execution.TxRunnerVM
const TxRunner = execution.TxRunner

function toHex (value) {
  if (value === null || value === undefined) return '0x0'
  if (typeof value === 'bigint') {
    return '0x' + value.toString(16)
  }
  if (typeof value === 'number') {
    return '0x' + value.toString(16)
  }
  if (typeof value === 'string') {
    return value.startsWith('0x') ? value : '0x' + value
  }
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
    const hex = Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('')
    return hex === '0000000000000000' ? '0x0' : (hex === '' ? '0x0' : '0x' + hex)
  }
  try {
    const v = Buffer.from(value).toString('hex')
    if (v === '0000000000000000') return '0x0'
    return ((v === '0x' || v === '') ? '0x0' : ('0x' + v))
  } catch (e) {
    const v = value.toString('hex')
    if (v === '0000000000000000') return '0x0'
    return ((v === '0x' || v === '') ? '0x0' : ('0x' + v))
  }
}

export class Transactions {
  vmContext
  accounts
  tags
  txRunnerVMInstance
  txRunnerInstance

  constructor (vmContext) {
    this.vmContext = vmContext
    this.tags = {}
  }

  init (accounts) {
    this.accounts = accounts
    const api = {
      logMessage: (msg) => {
      },
      logHtmlMessage: (msg) => {
      },
      config: {
        getUnpersistedProperty: (key) => {
          return true
        },
        get: () => {
          return true
        }
      },
      detectNetwork: (cb) => {
        cb()
      },
      personalMode: () => {
        return false
      }
    }

    this.txRunnerVMInstance = new TxRunnerVM(accounts, api, _ => this.vmContext.vmObject())
    this.txRunnerInstance = new TxRunner(this.txRunnerVMInstance, { runAsync: false })
    this.txRunnerInstance.vmaccounts = accounts
  }

  methods () {
    return {
      eth_sendTransaction: this.eth_sendTransaction.bind(this),
      eth_getTransactionReceipt: this.eth_getTransactionReceipt.bind(this),
      eth_getCode: this.eth_getCode.bind(this),
      eth_call: this.eth_call.bind(this),
      eth_estimateGas: this.eth_estimateGas.bind(this),
      eth_getTransactionCount: this.eth_getTransactionCount.bind(this),
      eth_getTransactionByHash: this.eth_getTransactionByHash.bind(this),
      eth_getTransactionByBlockHashAndIndex: this.eth_getTransactionByBlockHashAndIndex.bind(this),
      eth_getTransactionByBlockNumberAndIndex: this.eth_getTransactionByBlockNumberAndIndex.bind(this),
      eth_getExecutionResultFromSimulator: this.eth_getExecutionResultFromSimulator.bind(this),
      eth_getHashFromTagBySimulator: this.eth_getHashFromTagBySimulator.bind(this)
    }
  }

  eth_sendTransaction (payload, cb) {
    // from might be lowercased address (web3)
    if (payload.params && payload.params.length > 0 && payload.params[0].from) {
      payload.params[0].from = toChecksumAddress(payload.params[0].from)
    }
    processTx(this.txRunnerInstance, payload, false, (error, result) => {
      if (!error && result) {
        this.vmContext.addBlock(result.block)
        const hash = toHex(result.tx.hash())
        this.vmContext.trackTx(hash, result.block)
        this.vmContext.trackExecResult(hash, result.result.execResult)
        return cb(null, result.transactionHash)
      }
      cb(error)
    })
  }

  eth_getExecutionResultFromSimulator (payload, cb) {
    const txHash = payload.params[0]
    cb(null, this.vmContext.exeResults[txHash])
  }

  eth_getTransactionReceipt (payload, cb) {
    this.vmContext.web3().eth.getTransactionReceipt(payload.params[0], (error, receipt) => {
      if (error) {
        return cb(error)
      }
      if (!receipt) {
        return cb(null, null)
      }

      const txBlock = this.vmContext.txs[receipt.transactionHash || receipt.hash]
      if (!txBlock) {
        return cb(new Error('transaction block not found: ' + (receipt.transactionHash || receipt.hash || payload.params[0])))
      }

      const safeGas = receipt.gas || receipt.gasLimit || '0x2dc6c0'
      const r: Record <string, unknown> = {
        transactionHash: receipt.transactionHash || receipt.hash,
        transactionIndex: '0x00',
        blockHash: toHex(txBlock.hash()),
        blockNumber: toHex(txBlock.header.number),
        gasUsed: Web3.utils.toHex(safeGas),
        cumulativeGasUsed: Web3.utils.toHex(safeGas),
        contractAddress: receipt.contractAddress,
        logs: receipt.logs,
        status: receipt.status,
        to: receipt.to
      }

      if (r.blockNumber === '0x') {
        r.blockNumber = '0x0'
      }

      cb(null, r)
    })
  }

  eth_estimateGas (payload, cb) {
    cb(null, 10000000 * 8)
  }

  eth_getCode (payload, cb) {
    const address = payload.params[0]

    this.vmContext.web3().eth.getCode(address, (error, result) => {
      cb(error, result)
    })
  }

  eth_call (payload, cb) {
    // from might be lowercased address (web3)
    if (payload.params && payload.params.length > 0 && payload.params[0].from) {
      payload.params[0].from = toChecksumAddress(payload.params[0].from)
    }
    if (payload.params && payload.params.length > 0 && payload.params[0].to) {
      payload.params[0].to = toChecksumAddress(payload.params[0].to)
    }

    payload.params[0].value = undefined

    const tag = payload.params[0].timestamp // e2e reference

    processTx(this.txRunnerInstance, payload, true, (error, result) => {
      if (!error && result) {
        this.vmContext.addBlock(result.block)
        const hash = toHex(result.tx.hash())
        this.vmContext.trackTx(hash, result.block)
        this.vmContext.trackExecResult(hash, result.result.execResult)
        this.tags[tag] = result.transactionHash
        // calls are not supposed to return a transaction hash. we do this for keeping track of it and allowing debugging calls.
        const returnValue = toHex(result.result.execResult.returnValue)
        return cb(null, returnValue)
      }
      cb(error)
    })
  }

  eth_getHashFromTagBySimulator (payload, cb) {
    return cb(null, this.tags[payload.params[0]])
  }

  eth_getTransactionCount (payload, cb) {
    const address = payload.params[0]

    this.vmContext.vm().stateManager.getAccount(createAddress(address)).then((account) => {
      const nonce = new BN(account ? account.nonce.toString() : '0').toString(10)
      cb(null, nonce)
    }).catch((error) => {
      cb(error)
    })
  }

  eth_getTransactionByHash (payload, cb) {
    const address = payload.params[0]

    this.vmContext.web3().eth.getTransactionReceipt(address, (error, receipt) => {
      if (error) {
        return cb(null, null)
      }
      if (!receipt) {
        return cb(null, null)
      }

      const txBlock = this.vmContext.txs[receipt.transactionHash]
      if (!txBlock) {
        return cb(null, null)
      }

      const safeGas = receipt.gas || receipt.gasLimit || '0x2dc6c0'
      // TODO: params to add later
      const r: Record<string, unknown> = {
        blockHash: toHex(txBlock.hash()),
        blockNumber: toHex(txBlock.header.number),
        from: receipt.from,
        gas: Web3.utils.toHex(safeGas),
        // 'gasPrice': '2000000000000', // 0x123
        gasPrice: '0x4a817c800', // 20000000000
        hash: receipt.transactionHash,
        input: receipt.input,
        nonce: 2, // 0x15 // the nonce should be updated
        // "transactionIndex": 0,
        value: receipt.value ? Web3.utils.toHex(receipt.value) : '0x0',
        tokenId: receipt.tokenId ? Web3.utils.toHex(receipt.tokenId) : '0x0',
        tokenValue: receipt.tokenValue ? Web3.utils.toHex(receipt.tokenValue) : '0x0'
        // "value":"0xf3dbb76162000" // 4290000000000000
        // "v": "0x25", // 37
        // "r": "0x1b5e176d927f8e9ab405058b2d2457392da3e20f328b16ddabcebc33eaac5fea",
        // "s": "0x4ba69724e8f69de52f0125ad8b3c5c2cef33019bac3249e2c0a2192766d1721c"
      }

      if (receipt.to) {
        r['to'] = receipt.to
      }

      if (r.value === '0x') {
        r.value = '0x0'
      }

      if (r.blockNumber === '0x') {
        r.blockNumber = '0x0'
      }

      cb(null, r)
    })
  }

  eth_getTransactionByBlockHashAndIndex (payload, cb) {
    const txIndex = payload.params[1]

    const txBlock = this.vmContext.blocks[payload.params[0]]
    if (!txBlock) return cb(null, null)
    const tx = txBlock.transactions[Web3.utils.toDecimal(txIndex)]
    if (!tx) return cb(null, null)
    const txHash = toHex(tx.hash())

    this.vmContext.web3().eth.getTransactionReceipt(txHash, (error, receipt) => {
      if (error) {
        return cb(null, null)
      }
      if (!receipt) {
        return cb(null, null)
      }

      const safeGas = receipt.gas || receipt.gasLimit || '0x2dc6c0'
      // TODO: params to add later
      const r: Record<string, unknown> = {
        blockHash: toHex(txBlock.hash()),
        blockNumber: toHex(txBlock.header.number),
        from: receipt.from,
        gas: Web3.utils.toHex(safeGas),
        // 'gasPrice': '2000000000000', // 0x123
        gasPrice: '0x4a817c800', // 20000000000
        hash: receipt.transactionHash,
        input: receipt.input,
        nonce: 2, // 0x15 // the nonce should be updated
        // "transactionIndex": 0,
        value: receipt.value ? Web3.utils.toHex(receipt.value) : '0x0'
        // "value":"0xf3dbb76162000" // 4290000000000000
        // "v": "0x25", // 37
        // "r": "0x1b5e176d927f8e9ab405058b2d2457392da3e20f328b16ddabcebc33eaac5fea",
        // "s": "0x4ba69724e8f69de52f0125ad8b3c5c2cef33019bac3249e2c0a2192766d1721c"
      }

      if (receipt.to) {
        r['to'] = receipt.to
      }

      if (r.value === '0x') {
        r.value = '0x0'
      }

      cb(null, r)
    })
  }

  eth_getTransactionByBlockNumberAndIndex (payload, cb) {
    const txIndex = payload.params[1]

    const txBlock = this.vmContext.blocks[payload.params[0]]
    if (!txBlock) return cb(null, null)
    const tx = txBlock.transactions[Web3.utils.toDecimal(txIndex)]
    if (!tx) return cb(null, null)
    const txHash = toHex(tx.hash())

    this.vmContext.web3().eth.getTransactionReceipt(txHash, (error, receipt) => {
      if (error) {
        return cb(null, null)
      }
      if (!receipt) {
        return cb(null, null)
      }

      const safeGas = receipt.gas || receipt.gasLimit || '0x2dc6c0'
      // TODO: params to add later
      const r: Record<string, unknown> = {
        blockHash: toHex(txBlock.hash()),
        blockNumber: toHex(txBlock.header.number),
        from: receipt.from,
        gas: Web3.utils.toHex(safeGas),
        // 'gasPrice': '2000000000000', // 0x123
        gasPrice: '0x4a817c800', // 20000000000
        hash: receipt.transactionHash,
        input: receipt.input,
        nonce: 2, // 0x15 // the nonce should be updated
        // "transactionIndex": 0,
        value: receipt.value ? Web3.utils.toHex(receipt.value) : '0x0'
        // "value":"0xf3dbb76162000" // 4290000000000000
        // "v": "0x25", // 37
        // "r": "0x1b5e176d927f8e9ab405058b2d2457392da3e20f328b16ddabcebc33eaac5fea",
        // "s": "0x4ba69724e8f69de52f0125ad8b3c5c2cef33019bac3249e2c0a2192766d1721c"
      }

      if (receipt.to) {
        r['to'] = receipt.to
      }

      if (r.value === '0x') {
        r.value = '0x0'
      }

      cb(null, r)
    })
  }
}
