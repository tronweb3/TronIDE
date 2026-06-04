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
const { hashPersonalMessage } = require('../../lib/helper')
const { execution } = require('@remix-project/remix-lib')
const walletProviderAdapter = execution.walletProviderAdapter

class InjectedProvider {
  constructor (executionContext) {
    this.executionContext = executionContext
  }

  getAccounts (cb) {
    const tronWeb = this.executionContext.web3()
    const address = tronWeb && tronWeb.defaultAddress && tronWeb.defaultAddress.base58
    if (!address) return cb(new Error(walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED))
    return cb(null, [address])
  }

  newAccount (passwordPromptCb, cb) {
    passwordPromptCb((passphrase) => {
      this.executionContext.web3().personal.newAccount(passphrase, cb)
    })
  }

  resetEnvironment () {
  }

  async getBalanceInEther (address, cb) {
    if (!address) {
      return cb(new Error('No address provided'))
    }
    if (this.executionContext.web3().trx?.getBalance) {
      try {
        const res = await this.executionContext.web3().trx.getBalance(address)
        cb(null, Web3.utils.fromWei(res.toString(10), 'picoether'))
      } catch (error) {
        const normalized = walletProviderAdapter.normalizeWalletError(error)
        cb(new Error(normalized.message))
      }
    } else {
      return cb(new Error('TronWeb provider not found'))
    }
  }

  getGasPrice (cb) {
    cb(null, 1)
  }

  async signMessage (message, account, _passphrase, cb) {
    try {
      const signedData = await this.executionContext.web3().trx.signMessageV2(message)
      const messageHash = '0x' + hashPersonalMessage(Buffer.from(message)).toString('hex')
      cb(null, messageHash, signedData)
    } catch (error) {
      const normalized = walletProviderAdapter.normalizeWalletError(error)
      cb(new Error(normalized.message))
    }
  }

  getProvider () {
    return 'injected'
  }
}

module.exports = InjectedProvider
