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

var async = require('async')
var ethutil = require('ethereumjs-util')
var remixLib = require('@remix-project/remix-lib')
var EventManager = remixLib.EventManager
var format = remixLib.execution.txFormat
var txHelper = remixLib.execution.txHelper
const { inheritExternalPluginTransaction } = require('../../../../blockchain/transaction-network-security')
const helper = require('../../../../lib/helper')

// Preserve the transaction settings that are otherwise read from the current
// RunTab UI during replay. This is especially important for TRC10 and fee
// extension fields: replaying must not silently borrow today's settings.
const RECORDED_TRANSACTION_FIELDS = [
  'gasLimit',
  'feeLimit',
  'callValue',
  'tokenId',
  'tokenValue',
  'userFeePercentage',
  'originEnergyLimit',
  'permissionId',
  'cancelState'
]

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]'

/**
  * Record transaction as long as the user create them.
  */
class Recorder {
  constructor (blockchain) {
    var self = this
    self.event = new EventManager()
    self.blockchain = blockchain
    self.data = { _listen: true, _replay: false, journal: [], _createdContracts: {}, _createdContractsReverse: {}, _usedAccounts: {}, _abis: {}, _contractABIReferences: {}, _linkReferences: {}, _contextGeneration: 0, _journalGeneration: 0 }
    // Address book of contracts created by recorded/replayed transactions
    // (contract name -> deployed address). Kept outside clearAll() on purpose:
    // run() clears the journal when a replay completes, but the addresses it
    // just deployed are exactly what the user needs afterwards.
    self.data._addressBook = []

    this.blockchain.event.register('initiatingTransaction', (timestamp, tx, payLoad) => {
      if (!tx || tx.useCall || !payLoad) return
      var { from, to, value } = tx

      // convert to and from to tokens
      if (this.data._listen) {
        const journalGeneration = this.data._journalGeneration
        const contextGeneration = this.data._contextGeneration
        var record = { value, parameters: this._tokenizeCreatedAddresses(payLoad.funArgs || []) }
        for (const field of RECORDED_TRANSACTION_FIELDS) {
          if (hasOwn(tx, field) && tx[field] !== undefined) record[field] = tx[field]
        }
        if (!to) {
          var abi = payLoad.contractABI
          var keccak = ethutil.bufferToHex(ethutil.keccakFromString(JSON.stringify(abi)))
          record.abi = keccak
          record.contractName = payLoad.contractName
          record.bytecode = payLoad.contractBytecode
          record.linkReferences = payLoad.linkReferences
          if (record.linkReferences && Object.keys(record.linkReferences).length) {
            for (var file in record.linkReferences) {
              for (var lib in record.linkReferences[file]) {
                self.data._linkReferences[lib] = '<address>'
              }
            }
          }
          self.data._abis[keccak] = abi

          this.data._contractABIReferences[timestamp] = keccak
        } else {
          var creationTimestamp = this.data._createdContracts[to]
          if (creationTimestamp !== undefined && creationTimestamp !== null) {
            record.to = `created{${creationTimestamp}}`
            record.abi = this.data._contractABIReferences[creationTimestamp]
          } else {
            // Calls to a contract deployed before recording started still have
            // a stable target. Do not manufacture `created{undefined}`.
            var targetAbi = payLoad.contractABI
            var targetKeccak = ethutil.bufferToHex(ethutil.keccakFromString(JSON.stringify(targetAbi)))
            record.to = to
            record.abi = targetKeccak
            self.data._abis[targetKeccak] = targetAbi
          }
        }
        record.name = payLoad.funAbi.name
        record.inputs = txHelper.serializeInputs(payLoad.funAbi)
        record.type = payLoad.funAbi.type
        this.blockchain.getAccounts((error, accounts) => {
          if (error) return console.log(error)
          // getAccounts is asynchronous. A clear/context switch may have
          // happened while it was in flight; never append that old tx to the
          // new journal or recreate its account mapping.
          if (!self.data._listen || self.data._journalGeneration !== journalGeneration || self.data._contextGeneration !== contextGeneration) return
          if (!Array.isArray(accounts) || !from || accounts.indexOf(from) < 0) {
            return console.log('Recorder refused to save a transaction whose sender is not in the active account list')
          }
          record.from = `account{${accounts.indexOf(from)}}`
          self.data._usedAccounts[record.from] = from
          self.append(timestamp, record)
        })
      }
    })

    this.blockchain.event.register('transactionExecuted', (error, from, to, data, call, txResult, timestamp) => {
      // Stamp the outcome on the recorded entry (records and this event share
      // the timestamp key). Without it a REVERTED call is indistinguishable
      // from a successful one downstream — the TronBox export used to emit
      // reverted calls as live migration steps.
      if (call) return
      // EVM-style receipts carry the outcome in `status` (0/'0x0'/false), TRON
      // ones in `result` ('FAILED'/'REVERT'); the injected runner usually
      // rejects with an error instead of a receipt (blockchain.js forwards
      // that error here). Same revert detection as run-tab's aiCallMethod.
      const receipt = txResult && (txResult.receipt || txResult)
      const status = receipt && (receipt.status !== undefined ? receipt.status : receipt.result)
      const failed = !!error || status === 0 || status === '0x0' || status === false ||
        String(status).toUpperCase() === 'FAILED' || String(status).toUpperCase() === 'REVERT'
      if (!failed) return
      const entry = this.data.journal.find((item) => item.timestamp === timestamp)
      if (entry && entry.record && !entry.record.failed) {
        entry.record.failed = true
        this.data._journalGeneration++
      }
    })
    this.blockchain.event.register('transactionExecuted', (error, from, to, data, call, txResult, timestamp, _payload) => {
      if (error) return console.log(error)
      if (call) return
      // A rejected transaction (or a provider that omits a receipt) is still
      // a valid event. Do not dereference a missing receipt while handling it.
      const rawAddress = txResult && txResult.receipt && txResult.receipt.contractAddress
      if (!rawAddress) return // not a contract creation
      // Ignore a late result from a replay that crossed a provider/context
      // switch. Its address belongs to the old chain and must not repopulate
      // the new context's address book.
      if (_payload && _payload.recorderContextGeneration !== undefined && _payload.recorderContextGeneration !== this.data._contextGeneration) return
      const address = helper.addressToString(rawAddress)
      // save back created addresses for the convertion from tokens to real adresses
      this.data._createdContracts[address] = timestamp
      this.data._createdContractsReverse[timestamp] = address
      // the same payload reaches here for live recording and for replay
      // (blockchain.runTx builds it from args.data in both paths)
      this.data._addressBook.push({ name: (_payload && _payload.contractName) || '(unknown)', address, timestamp })
      this.event.trigger('addressBookUpdated', [this.getAddressBook()])
    })
    this.blockchain.event.register('contextChanged', () => {
      const wasReplaying = this.data._replay
      this.data._contextGeneration++
      if (wasReplaying) this.data._abortReplay = 'Replay aborted: execution context changed.'
      this.clearAll()
      // addresses belong to the previous provider/chain once the context changes
      this.clearAddressBook()
    })
    this.event.register('newTxRecorded', (count) => {
      this.event.trigger('recorderCountChange', [count])
    })
    this.event.register('cleared', () => {
      this.event.trigger('recorderCountChange', [0])
    })
  }

  /**
    * stop/start saving txs. If not listenning, is basically in replay mode
    *
    * @param {Bool} listen
    */
  setListen (listen) {
    this.data._listen = listen
    this.data._replay = !listen
  }

  /**
    * Ask the running replay batch to stop BEFORE its next transaction (the one
    * already in flight cannot be recalled). No-op when nothing is replaying.
    * The batch then ends through its normal final callback, so `replayEnded`
    * still fires (with the abort reason) and the recording state is restored.
    */
  abortReplay (reason) {
    if (this.data._replay) this.data._abortReplay = reason || 'Replay aborted'
  }

  extractTimestamp (value) {
    if (typeof value !== 'string') return null
    var stamp = /^created\{([^{}]+)\}$/.exec(value)
    if (stamp) {
      return stamp[1]
    }
    return null
  }

  /**
    * convert back from/to from tokens to real addresses
    *
    * @param {Object} record
    * @param {Object} accounts
    * @param {Object} options
    *
    */
  resolveAddress (record, accounts, options) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid transaction record')
    const resolved = { ...record }
    if (resolved.to) {
      var stamp = this.extractTimestamp(resolved.to)
      if (stamp) {
        const address = this.data._createdContractsReverse[stamp]
        if (!address) throw new Error('Cannot resolve recorded contract created{' + stamp + '}')
        resolved.to = address
      }
    }
    const accountToken = resolved.from
    const mapped = accounts && hasOwn(accounts, accountToken) ? accounts[accountToken] : undefined
    if (mapped !== undefined && mapped !== null && String(mapped).trim()) {
      resolved.from = mapped
    } else if (typeof accountToken === 'string' && accountToken.trim() && !/^account\{\d+\}$/.test(accountToken)) {
      // Explicit addresses from hand-authored legacy scenarios are allowed,
      // but an unresolved account{N} token must never fall back to the
      // currently selected account in Blockchain.runTx.
      resolved.from = accountToken.trim()
    } else {
      throw new Error('Cannot resolve recorded sender ' + String(accountToken || '(missing)'))
    }
    return resolved
  }

  _tokenizeCreatedAddresses (value) {
    if (typeof value === 'string') {
      const timestamp = this.data._createdContracts[value]
      return timestamp === undefined || timestamp === null ? value : `created{${timestamp}}`
    }
    if (Array.isArray(value)) return value.map((item) => this._tokenizeCreatedAddresses(item))
    if (isPlainObject(value)) {
      const result = {}
      for (const key of Object.keys(value)) result[key] = this._tokenizeCreatedAddresses(value[key])
      return result
    }
    return value
  }

  _resolveCreatedAddresses (value) {
    if (typeof value === 'string') {
      return value.replace(/created\{([^{}]+)\}/g, (match, timestamp) => {
        const address = this.data._createdContractsReverse[timestamp]
        if (!address) throw new Error('Cannot resolve recorded contract ' + match)
        return address
      })
    }
    if (Array.isArray(value)) return value.map((item) => this._resolveCreatedAddresses(item))
    if (isPlainObject(value)) {
      const result = {}
      for (const key of Object.keys(value)) result[key] = this._resolveCreatedAddresses(value[key])
      return result
    }
    return value
  }

  _validateReplayRecords (records) {
    if (!Array.isArray(records)) throw new Error('Invalid Scenario File: transactions must be an array')
    records.forEach((tx, index) => {
      if (!tx || typeof tx !== 'object' || Array.isArray(tx) || !tx.record || typeof tx.record !== 'object' || Array.isArray(tx.record)) {
        throw new Error('Invalid Scenario File: transaction ' + index + ' is malformed')
      }
      if (tx.timestamp === undefined || tx.timestamp === null || String(tx.timestamp) === '') throw new Error('Invalid Scenario File: transaction ' + index + ' has no timestamp')
      if (tx.record.parameters !== undefined && !Array.isArray(tx.record.parameters)) throw new Error('Invalid Scenario File: transaction ' + index + ' parameters must be an array')
      if (!tx.record.type) throw new Error('Invalid Scenario File: transaction ' + index + ' has no type')
    })
  }

  /**
    * save the given @arg record
    *
    * @param {Number/String} timestamp
    * @param {Object} record
    *
    */
  append (timestamp, record) {
    var self = this
    self.data.journal.push({ timestamp, record })
    self.data._journalGeneration++
    self.event.trigger('newTxRecorded', [self.data.journal.length])
  }

  /**
    * Monotonic version of the live journal. Consumers that approve a
    * destructive/exporting action can compare it after asynchronous work to
    * ensure the approved recording was not replaced or amended meanwhile.
    */
  getJournalGeneration () {
    return this.data._journalGeneration
  }

  /**
    * basically return the records + associate values (like abis / accounts)
    *
    */
  getAll () {
    var self = this
    var records = [].concat(self.data.journal)
    return {
      accounts: self.data._usedAccounts,
      linkReferences: self.data._linkReferences,
      transactions: records.sort((A, B) => {
        var stampA = A.timestamp
        var stampB = B.timestamp
        return stampA - stampB
      }),
      abis: self.data._abis
    }
  }

  /**
    * contracts created by recorded/replayed transactions, in creation order
    *
    */
  getAddressBook () {
    return this.data._addressBook.slice()
  }

  clearAddressBook () {
    this.data._addressBook = []
    this.event.trigger('addressBookUpdated', [[]])
  }

  /**
    * delete the seen transactions
    *
    */
  clearAll () {
    var self = this
    const wasReplaying = self.data._replay
    self.data._journalGeneration++
    self.data._listen = true
    self.data._replay = false
    if (!wasReplaying) self.data._abortReplay = null
    self.data.journal = []
    self.data._createdContracts = {}
    self.data._createdContractsReverse = {}
    self.data._usedAccounts = {}
    self.data._abis = {}
    self.data._contractABIReferences = {}
    self.data._linkReferences = {}
    self.event.trigger('cleared', [])
  }

  /**
    * run the list of records
    *
    * @param {Object} accounts
    * @param {Object} options
    * @param {Object} abis
    * @param {Function} newContractFn
    *
    */
  run (records, accounts, options, abis, linkReferences, confirmationCb, continueCb, promptCb, alertCb, logCallBack, newContractFn, securityContext) {
    var self = this
    const emitReplayEnded = (error) => {
      try { self.event.trigger('replayEnded', [error || null]) } catch (eventError) { console.error(eventError) }
    }
    try {
      self._validateReplayRecords(records)
    } catch (error) {
      const message = (error && error.message) || String(error)
      if (alertCb) alertCb(message)
      // AI callers register replayEnded before invoking runScenario; emitting
      // it for a preflight failure prevents a malformed file from wedging the
      // caller until its timeout while no batch was actually started.
      emitReplayEnded(message)
      return
    }
    const replayContextGeneration = self.data._contextGeneration
    self.setListen(false)
    self.data._abortReplay = null
    try {
      logCallBack(`Running ${records.length} transaction(s) ...`)
      self.event.trigger('replayStarted', [records.map((tx, index) => ({
        index,
        type: tx.record.type,
        contractName: tx.record.contractName,
        name: tx.record.name
      }))])
    } catch (error) {
      const message = (error && error.message) || String(error)
      self.setListen(true)
      self.clearAll()
      if (alertCb) alertCb(message)
      emitReplayEnded(message)
      return
    }
    const stepFailed = (index, error) => {
      const message = typeof error === 'string' ? error : (error && error.message) || String(error)
      self.event.trigger('replayStepUpdated', [index, 'failed', message])
    }
    async.eachOfSeries(records, function (tx, index, cb) {
      if (self.data._abortReplay) { stepFailed(index, self.data._abortReplay); return cb(self.data._abortReplay) }
      if (self.data._replay === false || (self.data._contextGeneration !== undefined && self.data._contextGeneration !== replayContextGeneration)) {
        const reason = self.data._abortReplay || 'Replay aborted: execution context changed.'
        stepFailed(index, reason)
        return cb(reason)
      }
      try {
        self.event.trigger('replayStepUpdated', [index, 'running'])
        // Work on a clone. The scenario file is the approved input and must
        // remain unchanged if replay fails halfway through.
        var record = self.resolveAddress({ ...tx.record, parameters: Array.isArray(tx.record.parameters) ? tx.record.parameters : [] }, accounts, options)
        var abi = abis[tx.record.abi]
        if (!abi) {
          alertCb('cannot find ABI for ' + tx.record.abi + '.  Execution stopped at ' + index)
          stepFailed(index, 'cannot find ABI')
          return cb('cannot find ABI for ' + tx.record.abi)
        }
        /* Resolve Library */
        if (record.linkReferences && Object.keys(record.linkReferences).length) {
          for (var k in linkReferences) {
            var link = linkReferences[k]
            var timestamp = self.extractTimestamp(link)
            if (timestamp) {
              if (!self.data._createdContractsReverse[timestamp]) throw new Error('Cannot resolve library reference ' + link)
              link = self.data._createdContractsReverse[timestamp]
            }
            if (typeof link !== 'string') throw new Error('Invalid library reference for ' + k)
            record.bytecode = format.linkLibraryStandardFromlinkReferences(k, link.replace('0x', ''), record.bytecode, record.linkReferences)
          }
        }
        /* Encode params */
        var fnABI
        if (record.type === 'constructor') {
          fnABI = txHelper.getConstructorInterface(abi)
        } else if (record.type === 'fallback') {
          fnABI = txHelper.getFallbackInterface(abi)
        } else if (record.type === 'receive') {
          fnABI = txHelper.getReceiveInterface(abi)
        } else {
          fnABI = txHelper.getFunction(abi, record.name + record.inputs)
        }
        if (!fnABI) {
          alertCb('cannot resolve abi of ' + JSON.stringify(record, null, '\t') + '. Execution stopped at ' + index)
          stepFailed(index, 'cannot resolve abi')
          return cb('cannot resolve abi')
        }
        const parameters = self._resolveCreatedAddresses(record.parameters || [])
        var data = format.encodeData(fnABI, parameters, record.bytecode)
        if (data.error) {
          alertCb(data.error + '. Record:' + JSON.stringify(record, null, '\t') + '. Execution stopped at ' + index)
          stepFailed(index, data.error)
          return cb(data.error)
        }
        logCallBack(`(${index}) ${JSON.stringify(record, null, '\t')}`)
        logCallBack(`(${index}) data: ${data.data}`)
        record.data = { dataHex: data.data, funArgs: parameters, funAbi: fnABI, contractBytecode: record.bytecode, contractName: record.contractName, contractABI: abi, linkReferences: record.linkReferences, timestamp: tx.timestamp, recorderContextGeneration: replayContextGeneration }
        if (securityContext) inheritExternalPluginTransaction(securityContext, record)

        self.blockchain.runTx(record, confirmationCb, continueCb, promptCb,
          function (err, txResult, rawAddress) {
            try {
              if ((self.data._contextGeneration !== undefined && self.data._contextGeneration !== replayContextGeneration) || self.data._replay === false) {
                const reason = self.data._abortReplay || 'Replay aborted: execution context changed.'
                stepFailed(index, reason)
                return cb(reason)
              }
              if (err) {
                console.error(err)
                logCallBack(err + '. Execution failed at ' + index)
                stepFailed(index, err)
                // stop at the failed step: cb(err) ends the series so the final
                // callback still restores the recording state
                return cb(err)
              }
              if (rawAddress) {
                const address = helper.addressToString(rawAddress)
                // save back created addresses for the convertion from tokens to real adresses
                self.data._createdContracts[address] = tx.timestamp
                self.data._createdContractsReverse[tx.timestamp] = address
                newContractFn(abi, address, record.contractName)
              }
              self.event.trigger('replayStepUpdated', [index, 'success'])
              cb(null)
            } catch (error) {
              const message = (error && error.message) || String(error)
              stepFailed(index, message)
              cb(message)
            }
          }
        )
      } catch (error) {
        const message = (error && error.message) || String(error)
        if (alertCb) alertCb(message + '. Execution stopped at ' + index)
        stepFailed(index, message)
        cb(message)
      }
    }, (error) => {
      // A provider/context switch can clear the recorder while a transaction
      // is still in flight. Do not clear a fresh journal created afterwards.
      const ownsReplay = self.data._replay && self.data._contextGeneration === replayContextGeneration
      if (ownsReplay) {
        self.setListen(true)
        self.clearAll()
      }
      emitReplayEnded(error)
    })
  }

  runScenario (json, continueCb, promptCb, alertCb, confirmationCb, logCallBack, cb, securityContext) {
    const rejectScenario = (message) => {
      try { if (cb) cb(message) } catch (callbackError) { console.error(callbackError) }
      // Keep the AI batch promise and the recorder UI on the same terminal
      // signal even when parsing/validation fails before run() starts.
      try { this.event.trigger('replayEnded', [message]) } catch (eventError) { console.error(eventError) }
    }
    if (!json) {
      return rejectScenario('a json content must be provided')
    }
    if (typeof json === 'string') {
      try {
        json = JSON.parse(json)
      } catch (e) {
        return rejectScenario('A scenario file is required. It must be json formatted')
      }
    }

    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return rejectScenario('Invalid Scenario File. Please try again')
    }

    try {
      var txArray = json.transactions
      var accounts = json.accounts || []
      var options = json.options || {}
      var abis = json.abis || {}
      var linkReferences = json.linkReferences || {}
    } catch (e) {
      return rejectScenario('Invalid Scenario File. Please try again')
    }

    if (!Array.isArray(txArray) || !txArray.length) {
      return rejectScenario('Invalid Scenario File. It must contain at least one transaction')
    }

    try {
      this._validateReplayRecords(txArray)
    } catch (error) {
      return rejectScenario((error && error.message) || String(error))
    }

    this.run(txArray, accounts, options, abis, linkReferences, confirmationCb, continueCb, promptCb, alertCb, logCallBack, (abi, address, contractName) => {
      cb(null, abi, address, contractName)
    }, securityContext)
  }
}

module.exports = Recorder
