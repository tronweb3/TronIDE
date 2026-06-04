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
import { init } from '../init'
var web3Override: Record<string, Record<string, unknown>> = {}
web3Override.eth = {}
web3Override.debug = {}
var data = init.readFile(require('path').resolve(__dirname, 'testWeb3.json'), null)
data = JSON.parse(data)

var traceWithABIEncoder = init.readFile(require('path').resolve(__dirname, 'traceWithABIEncoder.json'), null)
traceWithABIEncoder =

data.testTraces['0x20ef65b8b186ca942fcccd634f37074dde49b541c27994fc7596740ef44cfd53'] = JSON.parse(traceWithABIEncoder)
web3Override.eth.getCode = function (address, callback) {
  if (callback) {
    callback(null, data.testCodes[address])
  } else {
    return data.testCodes[address]
  }
}

web3Override.debug.traceTransaction = function (txHash, options, callback) {
  callback(null, data.testTraces[txHash])
}

web3Override.debug.storageRangeAt = function (blockNumber, txIndex, address, start, maxSize, callback) {
  callback(null, { storage: {}, complete: true })
}

web3Override.eth.getTransaction = function (txHash, callback) {
  if (callback) {
    callback(null, data.testTxs[txHash])
  } else {
    return data.testTxs[txHash]
  }
}

web3Override.eth.getTransactionFromBlock = function (blockNumber, txIndex, callback) {
  if (callback) {
    callback(null, data.testTxsByBlock[blockNumber + '-' + txIndex])
  } else {
    return data.testTxsByBlock[blockNumber + '-' + txIndex]
  }
}

web3Override.eth.getBlockNumber = function (callback) { callback('web3 modified testing purposes :)') }

web3Override.eth.setProvider = function (provider) {}

web3Override.eth.providers = { HttpProvider: function (url) {} }

web3Override.eth.currentProvider = { host: 'test provider' }

if (typeof (module) !== 'undefined' && typeof (module.exports) !== 'undefined') {
  module.exports = web3Override
}
