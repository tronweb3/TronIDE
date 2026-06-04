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

const Web3 = require('web3')
const { privateToAddress } = require('@tvmjs/util')
const { BN } = require('ethereumjs-util')
const { Trx } = require('tronweb')
const { Provider, extend } = require('@remix-project/remix-simulator')
const { hashPersonalMessage } = require('../../lib/helper')

class VMProvider {
  constructor (executionContext) {
    this.executionContext = executionContext
  }

  getAccounts (cb) {
    this.web3.eth.getAccounts((err, accounts) => {
      if (err) {
        return cb('No accounts?')
      }
      return cb(null, accounts)
    })
  }

  resetEnvironment () {
    this.accounts = {}
    this.RemixSimulatorProvider = new Provider({ fork: this.executionContext.getCurrentFork() })
    this.RemixSimulatorProvider.init().catch(err => {
      console.error('Failed to initialize RemixSimulatorProvider:', err)
    })
    this.web3 = new Web3(this.RemixSimulatorProvider)
    extend(this.web3)
    this.accounts = {}
    this.executionContext.setWeb3('vm', this.web3)
  }

  // TODO: is still here because of the plugin API
  // can be removed later when we update the API
  createVMAccount (newAccount) {
    const { privateKey, balance } = newAccount
    this.RemixSimulatorProvider.Accounts._addAccount(privateKey, balance)
    const privKey = Buffer.from(privateKey, 'hex')
    return '0x' + privateToAddress(privKey).toString('hex')
  }

  newAccount (_passwordPromptCb, cb) {
    this.RemixSimulatorProvider.Accounts.newAccount(cb)
  }

  getAccount (address, cb) {
    this.RemixSimulatorProvider.Accounts.getAccount(address, cb)
  }

  setTRC10Balance (address, tokenId, tokenValue, cb) {
    this.RemixSimulatorProvider.Accounts.setTRC10Balance(address, tokenId, tokenValue, cb)
  }

  getBalanceInEther (address, cb) {
    this.web3.eth.getBalance(address, (err, res) => {
      if (err) {
        return cb(err)
      }
      cb(null, Web3.utils.fromWei(new BN(res).toString(10), 'mwei'))
    })
  }

  getGasPrice (cb) {
    this.web3.eth.getGasPrice(cb)
  }

  signMessage (message, account, _passphrase, cb) {
    const privateKey = this.RemixSimulatorProvider.Accounts.accountsKeys[account]
    if (!privateKey) {
      return cb(new Error('Account not found: ' + account))
    }

    try {
      const signature = Trx.signMessageV2(message, privateKey)
      const messageHash = '0x' + hashPersonalMessage(Buffer.from(message)).toString('hex')
      cb(null, messageHash, signature)
    } catch (error) {
      cb(error)
    }
  }

  getProvider () {
    return 'vm'
  }
}

module.exports = VMProvider
