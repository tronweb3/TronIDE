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
import { util } from '@remix-project/remix-lib'
// eslint-disable-next-line camelcase
const { sha3_256 } = util
const STORAGE_SNAPSHOT_INTERVAL = 64

export class TraceCache {
  returnValues
  stopIndexes
  outofgasIndexes
  currentCall
  callsTree
  callsData
  contractCreation
  steps
  addresses
  callDataChanges
  memoryChanges
  storageChanges
  storageChangesByAddress
  storageChangeSnapshotsByAddress
  sstore

  constructor () {
    this.init()
  }

  init () {
    // ...Changes contains index in the vmtrace of the corresponding changes

    this.returnValues = {}
    this.stopIndexes = []
    this.outofgasIndexes = []
    this.currentCall = null
    this.callsTree = null
    this.callsData = {}
    this.contractCreation = {}
    this.steps = {}
    this.addresses = []
    this.callDataChanges = []
    this.memoryChanges = []
    this.storageChanges = []
    this.storageChangesByAddress = {}
    this.storageChangeSnapshotsByAddress = {}
    this.sstore = {} // all sstore occurence in the trace
  }

  pushSteps (index, currentCallIndex) {
    this.steps[index] = currentCallIndex
  }

  pushCallDataChanges (value, calldata) {
    this.callDataChanges.push(value)
    this.callsData[value] = calldata
  }

  pushMemoryChanges (value) {
    this.memoryChanges.push(value)
  }

  // outOfGas has been removed because gas left logging is apparently made differently
  // in the vm/geth/eth. TODO add the error property (with about the error in all clients)
  pushCall (step, index, address, callStack, reverted) {
    const validReturnStep = step.op === 'RETURN' || step.op === 'STOP'
    if ((validReturnStep || reverted) && (this.currentCall)) {
      this.currentCall.call.return = index - 1
      if (!validReturnStep) {
        this.currentCall.call.reverted = reverted
      }
      var parent = this.currentCall.parent
      if (parent) this.currentCall = { call: parent.call, parent: parent.parent }
      return
    }
    const call = {
      op: step.op,
      address: address,
      callStack: callStack,
      calls: {},
      start: index
    }
    this.addresses.push(address)
    if (this.currentCall) {
      this.currentCall.call.calls[index] = call
    } else {
      this.callsTree = { call: call }
    }
    this.currentCall = { call: call, parent: this.currentCall }
  }

  pushOutOfGasIndex (index, address) {
    this.outofgasIndexes.push({ index, address })
  }

  pushStopIndex (index, address) {
    this.stopIndexes.push({ index, address })
  }

  pushReturnValue (step, value) {
    this.returnValues[step] = value
  }

  pushContractCreationFromMemory (index, token, trace, lastMemoryChange) {
    const memory = trace[lastMemoryChange].memory
    const stack = trace[index].stack
    const offset = 2 * parseInt(stack[stack.length - 2], 16)
    const size = 2 * parseInt(stack[stack.length - 3], 16)
    this.contractCreation[token] = '0x' + memory.join('').substr(offset, size)
  }

  pushContractCreation (token, code) {
    this.contractCreation[token] = code
  }

  resetStoreChanges (index, address, key, value) {
    this.sstore = {}
    this.storageChanges = []
    this.storageChangesByAddress = {}
    this.storageChangeSnapshotsByAddress = {}
  }

  pushStoreChanges (index, address, key, value) {
    const hashedKey = key && sha3_256(key)
    this.sstore[index] = {
      address: address,
      key: key,
      value: value,
      hashedKey
    }
    this.storageChanges.push(index)
    if (address && key) {
      if (!this.storageChangesByAddress[address]) this.storageChangesByAddress[address] = []
      const changes = this.storageChangesByAddress[address]
      changes.push({ index, key, value, hashedKey })
      if (changes.length % STORAGE_SNAPSHOT_INTERVAL === 0) {
        if (!this.storageChangeSnapshotsByAddress[address]) this.storageChangeSnapshotsByAddress[address] = []
        const snapshots = this.storageChangeSnapshotsByAddress[address]
        const previousSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
        const snapshot = Object.assign({}, previousSnapshot ? previousSnapshot.storage : {})
        const start = previousSnapshot ? previousSnapshot.changeCount : 0
        // Materialize every delta since the previous checkpoint. Recording
        // only the boundary SSTORE would make later lookups silently lose the
        // other 63 changes once they started from this snapshot.
        for (let i = start; i < changes.length; i++) {
          const change = changes[i]
          snapshot[change.hashedKey] = { key: change.key, value: change.value }
        }
        snapshots.push({ index, changeCount: changes.length, storage: snapshot })
      }
    }
  }

  accumulateStorageChanges (index, address, storage) {
    let ret = Object.assign({}, storage)
    const changes = this.storageChangesByAddress[address] || []
    // The per-address list is append-only in trace order. Find the first
    // change after the requested step instead of scanning every SSTORE from
    // every contract for every StorageViewer instance.
    let low = 0
    let high = changes.length
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (changes[middle].index <= index) low = middle + 1
      else high = middle
    }
    const snapshots = this.storageChangeSnapshotsByAddress[address] || []
    let snapshotLow = 0
    let snapshotHigh = snapshots.length
    while (snapshotLow < snapshotHigh) {
      const middle = snapshotLow + Math.floor((snapshotHigh - snapshotLow) / 2)
      if (snapshots[middle].index <= index) snapshotLow = middle + 1
      else snapshotHigh = middle
    }
    const snapshot = snapshotLow > 0 ? snapshots[snapshotLow - 1] : null
    const start = snapshot ? snapshot.changeCount : 0
    if (snapshot) ret = Object.assign(ret, snapshot.storage)
    for (let i = start; i < low; i++) {
      const sstore = changes[i]
      ret[sstore.hashedKey] = {
        key: sstore.key,
        value: sstore.value
      }
    }
    return ret
  }
}
