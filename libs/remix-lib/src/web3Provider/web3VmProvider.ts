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

import { hexListFromBNs, formatMemory } from '../util'
import { normalizeHexAddress } from '../helpers/uiHelper'
import { toChecksumAddress, BN, bufferToHex } from 'ethereumjs-util'
import { Buffer } from 'buffer'
import * as tvmjsUtil from '@tvmjs/util'
import Web3 from 'web3'
const createAddressFromString = (tvmjsUtil as any).createAddressFromString

function toQuantityHex (value) {
  if (value === undefined || value === null) return '0x0'
  if (typeof value === 'bigint') return `0x${value.toString(16)}`
  if (typeof value === 'number') return `0x${value.toString(16)}`
  if (BN.isBN && BN.isBN(value)) return `0x${value.toString(16)}`
  if (typeof value === 'string') {
    if (/^0x/i.test(value)) return value
    return `0x${new BN(value || '0', 10).toString(16)}`
  }
  if (typeof value.toString === 'function') {
    const stringValue = value.toString(10)
    if (/^0x/i.test(stringValue)) return stringValue
    return `0x${new BN(stringValue || '0', 10).toString(16)}`
  }
  return '0x0'
}

// The current @tvmjs generation passes byte payloads (calldata, return data,
// code, logs, memory) as Uint8Array. Normalise plain typed arrays to Buffer so
// VM receipts, event logs, and debugger locals always receive canonical hex
// instead of comma-joined decimal strings.
function toBytesHex (value) {
  if (value === undefined || value === null) return '0x'
  if (Buffer.isBuffer(value)) return bufferToHex(value)
  return bufferToHex(Buffer.from(value))
}

function toVmLogHex (value) {
  if (!value || value.length === 0) return '0x'
  return toBytesHex(value)
}

export class Web3VmProvider {
  web3
  vm
  vmTraces
  txs
  txsReceipt
  processingHash
  processingAddress
  processingIndex
  previousDepth
  incr
  eth
  debug
  providers
  currentProvider
  storageCache
  lastProcessedStorageTxHash
  sha3Preimages
  sha3
  toHex
  toAscii
  fromAscii
  fromDecimal
  fromWei
  toWei
  toBigNumber
  isAddress
  utils
  txsMapBlock
  blocks
  latestBlockNumber
  _stepAttached

  constructor () {
    this.web3 = new Web3()
    this.vm = null
    this.vmTraces = {}
    this.txs = {}
    this.txsReceipt = {}
    this.processingHash = null
    this.processingAddress = null
    this.processingIndex = null
    this.previousDepth = 0
    this.incr = 0
    this.eth = {}
    this.debug = {}
    this.eth.getCode = (address, cb) => this.getCode(address, cb)
    this.eth.getTransaction = (txHash, cb) => this.getTransaction(txHash, cb)
    this.eth.getTransactionReceipt = (txHash, cb) => this.getTransactionReceipt(txHash, cb)
    this.eth.getTransactionFromBlock = (blockNumber, txIndex, cb) => this.getTransactionFromBlock(blockNumber, txIndex, cb)
    this.eth.getBlockNumber = (cb) => this.getBlockNumber(cb)
    this.eth.net = {
      getId: (cb) => {
        if (cb) {
          cb(null, 1)
        }
        return Promise.resolve(1)
      }
    }
    this.debug.traceTransaction = (txHash, options, cb) => this.traceTransaction(txHash, options, cb)
    this.debug.storageRangeAt = (blockNumber, txIndex, address, start, maxLength, cb) => this.storageRangeAt(blockNumber, txIndex, address, start, maxLength, cb)
    this.debug.preimage = (hashedKey, cb) => this.preimage(hashedKey, cb)
    this.providers = { HttpProvider: function (url) {} }
    this.currentProvider = { host: 'vm provider' }
    this.storageCache = {}
    this.lastProcessedStorageTxHash = {}
    this.sha3Preimages = {}
    // util
    this.sha3 = (...args) => this.web3.utils.sha3(...args)
    this.toHex = (...args) => this.web3.utils.toHex(...args)
    this.toAscii = (...args) => this.web3.utils.hexToAscii(...args)
    this.fromAscii = (...args) => this.web3.utils.asciiToHex(...args)
    this.fromDecimal = (...args) => this.web3.utils.numberToHex(...args)
    this.fromWei = (...args) => this.web3.utils.fromWei(...args)
    this.toWei = (...args) => this.web3.utils.toWei(...args)
    this.toBigNumber = (...args) => this.web3.utils.toBN(...args)
    this.isAddress = (...args) => this.web3.utils.isAddress(...args)
    this.utils = Web3.utils || []
    this.txsMapBlock = {}
    this.blocks = {}
    this.latestBlockNumber = 0
  }

  setVM (vm) {
    if (this.vm === vm) return
    this.vm = vm
    this._stepAttached = false
    const emitter = this.vm.events || this.vm
    emitter.on('afterTx', async (data, next) => {
      await this.txProcessed(data)
      next()
    })
    emitter.on('beforeTx', async (data, next) => {
      await this.txWillProcess(data)
      next()
    })
    // `step` is emitted on the TVM instance emitter (vm.tvm.events) in the
    // current @tvmjs generation; vm.tvm is created asynchronously, so vm-context
    // re-invokes attachStepListener() once it exists.
    this.attachStepListener()
  }

  attachStepListener () {
    if (this._stepAttached || !this.vm) return
    // Only bind once vm.tvm exists (no fallback to vm.events, which never emits
    // step). Until then, do nothing and leave the flag unset so vm-context can
    // re-invoke after init.
    const stepEmitter = this.vm.tvm && this.vm.tvm.events
    if (!stepEmitter) return
    this._stepAttached = true
    stepEmitter.on('step', async (data, next) => {
      // Never let a per-step trace error stall the VM: always release next().
      try {
        await this.pushTrace(data)
      } catch (e) {
        console.error('pushTrace failed for a VM step:', e && e.message)
      } finally {
        next()
      }
    })
  }

  releaseCurrentHash () {
    const ret = this.processingHash
    this.processingHash = undefined
    return ret
  }

  async txWillProcess (data) {
    this.incr++
    const tx = data.transaction || data
    this.processingHash = bufferToHex(Buffer.from(tx.hash()))
    this.vmTraces[this.processingHash] = {
      gas: '0x0',
      return: '0x0',
      structLogs: []
    }
    const txData = {}
    txData['hash'] = this.processingHash
    txData['from'] = toChecksumAddress(tx.getSenderAddress().toString())
    if (tx.to) {
      txData['to'] = toChecksumAddress(tx.to.toString())
    }
    this.processingAddress = txData['to']
    txData['input'] = toBytesHex(tx.data)
    txData['gas'] = tx.gasLimit ? tx.gasLimit.toString(10) : '3000000'
    txData['gasLimit'] = txData['gas']
    txData['gasUsed'] = txData['gas']
    txData['value'] = tx.value ? tx.value.toString(10) : '0'
    txData['tokenId'] = tx.tokenId ? tx.tokenId.toString(10) : '0'
    txData['tokenValue'] = tx.tokenValue ? tx.tokenValue.toString(10) : '0'
    this.txs[this.processingHash] = txData
    this.txsReceipt[this.processingHash] = txData
    this.storageCache[this.processingHash] = {}
    if (tx.to) {
      try {
        const storage = await this.vm.stateManager.dumpStorage(tx.to)
        this.storageCache[this.processingHash][txData['to']] = storage
        this.lastProcessedStorageTxHash[txData['to']] = this.processingHash
      } catch (e) {
        console.log(e)
      }
    }
    this.processingIndex = 0
  }

  async txProcessed (data) {
    const tx = data.transaction || data
    const execResult = data.execResult || tx.execResult || {}
    const gasUsed = data.gasUsed ?? data.totalGasSpent ?? data.blockGasSpent ?? tx.gasUsed ?? tx.totalGasSpent ?? execResult.executionGasUsed ?? 0
    const createdAddress = data.createdAddress || tx.createdAddress

    const lastOp = this.vmTraces[this.processingHash].structLogs[this.processingIndex - 1]
    if (lastOp) {
      lastOp.error = lastOp.op !== 'RETURN' && lastOp.op !== 'STOP' && lastOp.op !== 'DESTRUCT'
    }
    this.vmTraces[this.processingHash].gas = toQuantityHex(gasUsed)

    const logs = []
    if (execResult.logs) {
      for (const l in execResult.logs) {
        const log = execResult.logs[l]
        const topics = []
        if (log[1] && log[1].length > 0) {
          for (var k in log[1]) {
            topics.push(toVmLogHex(log[1][k]))
          }
        } else {
          topics.push('0x')
        }
        logs.push({
          address: toVmLogHex(log[0]),
          data: toVmLogHex(log[2]),
          topics: topics,
          rawVMResponse: log
        })
      }
    }
    this.txsReceipt[this.processingHash].logs = logs
    this.txsReceipt[this.processingHash].transactionHash = this.processingHash
    this.txsReceipt[this.processingHash].gasUsed = gasUsed ? gasUsed.toString(10) : '0'
    this.txsReceipt[this.processingHash].gas = this.txsReceipt[this.processingHash].gas || '3000000'
    const status = execResult.exceptionError ? 0 : 1
    this.txsReceipt[this.processingHash].status = `0x${status}`

    if (createdAddress) {
      const address = createdAddress.toString()
      this.vmTraces[this.processingHash].return = toChecksumAddress(address)
      this.txsReceipt[this.processingHash].contractAddress = toChecksumAddress(address)
    } else if (execResult.returnValue) {
      this.vmTraces[this.processingHash].return = toBytesHex(execResult.returnValue)
    } else {
      this.vmTraces[this.processingHash].return = '0x'
    }
    this.processingIndex = null
    this.processingAddress = null
    this.previousDepth = 0
  }

  async pushTrace (data) {
    const depth = data.depth + 1 // geth starts the depth from 1
    if (!this.processingHash) {
      console.log('no tx processing')
      return
    }
    let previousopcode
    if (this.vmTraces[this.processingHash] && this.vmTraces[this.processingHash].structLogs[this.processingIndex - 1]) {
      previousopcode = this.vmTraces[this.processingHash].structLogs[this.processingIndex - 1]
    }

    if (this.previousDepth > depth && previousopcode) {
      // returning from context, set error it is not STOP, RETURN
      previousopcode.invalidDepthChange = previousopcode.op !== 'RETURN' && previousopcode.op !== 'STOP'
    }
    const step = {
      stack: hexListFromBNs(data.stack),
      memory: formatMemory(data.memory),
      storage: data.storage,
      op: data.opcode.name,
      pc: data.pc,
      gasCost: data.opcode.fee?.toString() ?? '0',
      gas: data.gasLeft.toString(),
      depth: depth,
      error: data.error === false ? undefined : data.error
    }
    this.vmTraces[this.processingHash].structLogs.push(step)
    if (step.op === 'CREATE' || step.op === 'CALL') {
      if (step.op === 'CREATE') {
        this.processingAddress = '(Contract Creation - Step ' + this.processingIndex + ')'
        this.storageCache[this.processingHash][this.processingAddress] = {}
        this.lastProcessedStorageTxHash[this.processingAddress] = this.processingHash
      } else {
        this.processingAddress = normalizeHexAddress(step.stack[step.stack.length - 2])
        this.processingAddress = toChecksumAddress(this.processingAddress)
        if (!this.storageCache[this.processingHash][this.processingAddress]) {
          const account = createAddressFromString(this.processingAddress)
          try {
            const storage = await this.vm.stateManager.dumpStorage(account)
            this.storageCache[this.processingHash][this.processingAddress] = storage
            this.lastProcessedStorageTxHash[this.processingAddress] = this.processingHash
          } catch (e) {
            console.log(e)
          }
        }
      }
    }
    if (previousopcode && previousopcode.op === 'SHA3') {
      const preimage = this.getSha3Input(previousopcode.stack, previousopcode.memory)
      const imageHash = step.stack[step.stack.length - 1].replace('0x', '')
      this.sha3Preimages[imageHash] = {
        preimage: preimage
      }
    }

    this.processingIndex++
    this.previousDepth = depth
  }

  getCode (address, cb) {
    address = toChecksumAddress(address)
    this.vm.stateManager.getCode(createAddressFromString(address)).then((result) => {
      let hex
      try {
        hex = toBytesHex(result)
      } catch (err) {
        return cb(err)
      }
      cb(null, hex)
    }, (error) => cb(error))
  }

  setProvider (provider) {}

  traceTransaction (txHash, options, cb) {
    if (this.vmTraces[txHash]) {
      if (cb) {
        cb(null, this.vmTraces[txHash])
      }
      return this.vmTraces[txHash]
    }
    if (cb) {
      cb('unable to retrieve traces ' + txHash, null)
    }
  }

  storageRangeAt (blockNumber, txIndex, address, start, maxLength, cb) { // txIndex is the hash in the case of the VM
    // we don't use the range params here
    address = toChecksumAddress(address)

    if (txIndex === 'latest') {
      txIndex = this.lastProcessedStorageTxHash[address]
    }

    if (this.storageCache[txIndex] && this.storageCache[txIndex][address]) {
      const storage = this.storageCache[txIndex][address]
      return cb(null, {
        storage: JSON.parse(JSON.stringify(storage)),
        nextKey: null
      })
    }
    cb('unable to retrieve storage ' + txIndex + ' ' + address)
  }

  getBlockNumber (cb) { cb(null, 'vm provider') }

  getTransaction (txHash, cb) {
    if (this.txs[txHash]) {
      if (cb) {
        cb(null, this.txs[txHash])
      }
      return this.txs[txHash]
    }
    if (cb) {
      cb('unable to retrieve tx ' + txHash, null)
    }
  }

  getTransactionReceipt (txHash, cb) {
    // same as getTransaction but return the created address also
    if (this.txsReceipt[txHash]) {
      if (cb) {
        cb(null, this.txsReceipt[txHash])
      }
      return this.txsReceipt[txHash]
    }
    if (cb) {
      cb('unable to retrieve txReceipt ' + txHash, null)
    }
  }

  getTransactionFromBlock (blockNumber, txIndex, cb) {
    const mes = 'not supposed to be needed by remix in vmmode'
    console.log(mes)
    if (cb) {
      cb(mes, null)
    }
  }

  preimage (hashedKey, cb) {
    hashedKey = hashedKey.replace('0x', '')
    cb(null, this.sha3Preimages[hashedKey] !== undefined ? this.sha3Preimages[hashedKey].preimage : null)
  }

  getSha3Input (stack, memory) {
    let memoryStart = stack[stack.length - 1]
    let memoryLength = stack[stack.length - 2]
    const memStartDec = (new BN(memoryStart.replace('0x', ''), 16)).toString(10)
    memoryStart = parseInt(memStartDec) * 2
    const memLengthDec = (new BN(memoryLength.replace('0x', ''), 16).toString(10))
    memoryLength = parseInt(memLengthDec) * 2

    let i = Math.floor(memoryStart / 32)
    const maxIndex = Math.floor(memoryLength / 32) + i
    if (!memory[i]) {
      return this.emptyFill(memoryLength)
    }
    let sha3Input = memory[i].slice(memoryStart - 32 * i)
    i++
    while (i < maxIndex) {
      sha3Input += memory[i] ? memory[i] : this.emptyFill(32)
      i++
    }
    if (sha3Input.length < memoryLength) {
      const leftSize = memoryLength - sha3Input.length
      sha3Input += memory[i] ? memory[i].slice(0, leftSize) : this.emptyFill(leftSize)
    }
    return sha3Input
  }

  emptyFill (size) {
    return (new Array(size)).join('0')
  }
}
