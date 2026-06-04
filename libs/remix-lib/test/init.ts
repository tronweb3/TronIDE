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

var init = {
  overrideWeb3: function (web3, web3Override) {
    web3.eth.getCode = web3Override.getCode
    web3.debug.traceTransaction = web3Override.traceTransaction
    web3.debug.storageRangeAt = web3Override.storageRangeAt
    web3.eth.getTransaction = web3Override.getTransaction
    web3.eth.getTransactionFromBlock = web3Override.getTransactionFromBlock
    web3.eth.getBlockNumber = web3Override.getBlockNumber
  },

  readFile: function (filename, callback) {
    const fs = require('fs')
    try {
      console.log('reading ' + filename)
      if (callback) {
        fs.readFile(filename, 'utf8', callback)
      } else {
        return fs.readFileSync(filename, 'utf8')
      }
    } catch (e) {
      console.log(e)
      if (callback) {
        callback(e)
      } else {
        return e
      }
    }
  }
}

module.exports = init
