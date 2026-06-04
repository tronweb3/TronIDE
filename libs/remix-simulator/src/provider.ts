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

import { Blocks } from './methods/blocks'

import { info } from './utils/logs'
import lodash from 'lodash'

import { Accounts } from './methods/accounts'
import { Filters } from './methods/filters'
import { methods as miscMethods } from './methods/misc'
import { methods as netMethods } from './methods/net'
import { Transactions } from './methods/transactions'
import { Debug } from './methods/debug'
import { generateBlock } from './genesis'
import { VMContext } from './vm-context'

export class Provider {
  options: Record<string, unknown>
  vmContext
  Accounts
  Transactions
  methods
  connected: boolean
  initPromise: Promise<void> | null

  constructor (options: Record<string, unknown> = {}) {
    this.options = options
    this.connected = true
    this.initPromise = null
    this.vmContext = new VMContext(options['fork'])

    this.Accounts = new Accounts(this.vmContext)
    this.Transactions = new Transactions(this.vmContext)

    this.methods = {}
    this.methods = lodash.merge(this.methods, this.Accounts.methods())
    this.methods = lodash.merge(this.methods, (new Blocks(this.vmContext, options)).methods())
    this.methods = lodash.merge(this.methods, miscMethods())
    this.methods = lodash.merge(this.methods, (new Filters(this.vmContext)).methods())
    this.methods = lodash.merge(this.methods, netMethods())
    this.methods = lodash.merge(this.methods, this.Transactions.methods())
    this.methods = lodash.merge(this.methods, (new Debug(this.vmContext)).methods())
  }

  async init () {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        if (this.vmContext.vm().initPromise) {
          await this.vmContext.vm().initPromise
        }
        await generateBlock(this.vmContext)
        await this.Accounts.resetAccounts()
        this.Transactions.init(this.Accounts.accounts)
      })()
    }
    return this.initPromise
  }

  sendAsync (payload, callback) {
    // log.info('payload method is ', payload.method) // commented because, this floods the IDE console
    let called = false
    const cbOnce = (err, res?) => {
      if (called) return
      called = true
      callback(err, res)
    }

    if (!this.initPromise) {
      this.initPromise = this.init()
    }

    this.initPromise.then(() => {
      const method = this.methods[payload.method]
      if (this.options.logDetails) {
        info(payload)
      }
      if (method) {
        return method.call(method, payload, (err, result) => {
          if (this.options.logDetails) {
            info(err)
            info(result)
          }
          setTimeout(() => {
            if (err) {
              return cbOnce(err)
            }
            const response = { id: payload.id, jsonrpc: '2.0', result: result }
            cbOnce(null, response)
          }, 0)
        })
      }
      setTimeout(() => {
        cbOnce(new Error('unknown method ' + payload.method))
      }, 0)
    }).catch((err) => {
      cbOnce(err)
    })
  }

  send (payload, callback) {
    this.sendAsync(payload, callback || function () {})
  }

  isConnected () {
    return true
  }

  disconnect () {
    return false
  };

  supportsSubscriptions () {
    return true
  };

  on (type, cb) {
    this.vmContext.logsManager.addListener(type, cb)
  }
}

export function extend (web3) {
  if (!web3.extend) {
    return
  }
  // DEBUG
  const methods = []
  if (!(web3.eth && web3.eth.getExecutionResultFromSimulator)) {
    methods.push(new web3.extend.Method({
      name: 'getExecutionResultFromSimulator',
      call: 'eth_getExecutionResultFromSimulator',
      inputFormatter: [null],
      params: 1
    }))
  }

  if (!(web3.eth && web3.eth.getHashFromTagBySimulator)) {
    methods.push(new web3.extend.Method({
      name: 'getHashFromTagBySimulator',
      call: 'eth_getHashFromTagBySimulator',
      inputFormatter: [null],
      params: 1
    }))
  }

  if (methods.length > 0) {
    web3.extend({
      property: 'eth',
      methods: methods,
      properties: []
    })
  }
}
