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

/* global ethereum */
'use strict'
import Web3 from 'web3'
import { rlp, keccak, bufferToHex } from 'ethereumjs-util'
import { Buffer } from 'buffer'
import { vm as remixLibVm, execution } from '@remix-project/remix-lib'
const { VM } = require('@tvmjs/vm')
const { Common, Mainnet } = require('@tvmjs/common')
const { MerkleStateManager } = require('@tvmjs/statemanager')
type StorageDump = Record<string, unknown>

/*
  extend vm state manager and instanciate VM
*/

class StateManagerCommonStorageDump extends MerkleStateManager {
  keyHashes: { [key: string]: string }
  constructor () {
    super()
    this.keyHashes = {}
  }

  putContractStorage (address, key, value) {
    const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key as any)
    this.keyHashes[keccak(keyBuf).toString('hex')] = bufferToHex(keyBuf)
    return super.putStorage(address, key, value)
  }

  putStorage (address, key, value) {
    const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key as any)
    this.keyHashes[keccak(keyBuf).toString('hex')] = bufferToHex(keyBuf)
    return super.putStorage(address, key, value)
  }

  async dumpStorage (address) {
    let trie
    try {
      trie = await this._getStorageTrie(address)
    } catch (e) {
      console.log(e)
      throw e
    }

    const storage = {}
    try {
      const valMap = await trie.getValueMap()
      const values = valMap.values || {}
      for (const [hashedKey, val] of Object.entries(values)) {
        const hashedKeyNoPrefix = hashedKey.replace('0x', '')
        const valBuf = Buffer.from((val as string).replace('0x', ''), 'hex')
        let decodedVal: string
        try {
          decodedVal = '0x' + rlp.decode(valBuf).toString('hex')
        } catch (e) {
          decodedVal = val as string
        }
        storage[hashedKey] = {
          key: this.keyHashes[hashedKeyNoPrefix],
          value: decodedVal
        }
      }
    } catch (e) {
      console.error(e)
    }
    return storage
  }

  async getStateRoot (force = false) {
    await super.flush()
    return this._trie.root()
  }

  /**
   * DEF-VM-1 fix. After a read-only call, the wrapper revert() in
   * txRunnerVM clears `_storageTries`. The next transaction's first
   * storage-trie access can land WITHOUT a resolved account (e.g. a
   * pre-state probe), so the upstream `_getStorageTrie` builds an
   * EMPTY-rooted trie and caches it by address. Every later access that
   * DOES carry the account then receives that stale empty trie instead of
   * one rooted at the account's real storageRoot — so the transaction
   * writes onto empty storage and silently drops all prior contract state.
   *
   * Fix: keep the cached storage trie coherent with the account. Whenever
   * the account is known and the cached trie's root disagrees with the
   * account's storageRoot, re-root it (the account is the source of truth
   * for committed storage; uncommitted writes live in the storage cache,
   * not the trie). No effect on the upstream package — this overrides only
   * the IDE's StateManager subclass.
   */
  _getStorageTrie (addressOrHash, rootAccount?) {
    const trie = super._getStorageTrie(addressOrHash, rootAccount)
    if (rootAccount && rootAccount.storageRoot) {
      const trieRoot = this._trie && trie.root ? Buffer.from(trie.root()) : null
      const acctRoot = Buffer.from(rootAccount.storageRoot)
      if (trieRoot && !trieRoot.equals(acctRoot)) {
        trie.root(rootAccount.storageRoot)
      }
    }
    return trie
  }

  async setStateRoot (stateRoot) {
    await super.flush()

    if (stateRoot === this._trie.EMPTY_TRIE_ROOT) {
      this._trie.root(stateRoot)
      this.clearCaches()
      this._storageTries = {}
      return
    }

    const hasRoot = await this._trie.checkRoot(stateRoot)
    if (!hasRoot) {
      throw new Error('State trie does not contain state root')
    }

    this._trie.root(stateRoot)
    this.clearCaches()
    this._storageTries = {}
  }
}

/*
  trigger contextChanged, web3EndpointChanged
*/
export class VMContext {
  currentFork: string
  blockGasLimitDefault: number
  blockGasLimit: number
  customNetWorks
  blocks
  latestBlockNumber
  txs
  currentVm
  web3vm
  logsManager
  exeResults

  constructor (fork?) {
    this.blockGasLimitDefault = 4300000
    this.blockGasLimit = this.blockGasLimitDefault
    this.currentFork = fork || 'tron'
    // this.currentFork = 'shanghai'
    this.currentVm = this.createVm(this.currentFork)
    this.blocks = {}
    this.latestBlockNumber = 0
    this.txs = {}
    this.exeResults = {}
    this.logsManager = new execution.LogsManager()
  }

  createVm (hardfork) {
    const stateManager = new StateManagerCommonStorageDump()
    const common = new Common({ chain: Mainnet, hardfork })
    const vm = new VM({
      common,
      activatePrecompiles: true,
      stateManager,
      allowUnlimitedContractSize: true
    })

    const web3vm = new remixLibVm.Web3VMProvider()
    web3vm.setVM(vm)

    // Asynchronously initialize TVM and attach it to the VM instance
    const { createVM } = require('@tvmjs/vm')
    vm.initPromise = createVM({
      common,
      stateManager,
      activatePrecompiles: true,
      allowUnlimitedContractSize: true
    }).then((initializedVm) => {
      vm.tvm = initializedVm.tvm
      vm.blockchain = initializedVm.blockchain
      vm._isInitialized = true
      // vm.tvm now exists — (re)bind the `step` listener to vm.tvm.events so the
      // debugger trace (structLogs) is captured under the current @tvmjs engine.
      web3vm.attachStepListener()
      return vm
    })

    return { vm, web3vm, stateManager, common }
  }

  getCurrentFork () {
    return this.currentFork
  }

  web3 () {
    return this.currentVm.web3vm
  }

  blankWeb3 () {
    return new Web3()
  }

  vm () {
    return this.currentVm.vm
  }

  vmObject () {
    return this.currentVm
  }

  addBlock (block) {
    let blockNumber = '0x' + (typeof block.header.number === 'bigint' ? block.header.number.toString(16) : block.header.number.toString('hex'))
    if (blockNumber === '0x') {
      blockNumber = '0x0'
    }

    this.blocks[bufferToHex(block.hash())] = block
    this.blocks[blockNumber] = block
    this.latestBlockNumber = blockNumber

    this.logsManager.checkBlock(blockNumber, block, this.web3())
  }

  trackTx (tx, block) {
    this.txs[tx] = block
  }

  trackExecResult (tx, execReult) {
    this.exeResults[tx] = execReult
  }
}
