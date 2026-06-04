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

export class Filters {
  vmContext

  constructor (vmContext) {
    this.vmContext = vmContext
  }

  methods () {
    return {
      eth_getLogs: this.eth_getLogs.bind(this),
      eth_subscribe: this.eth_subscribe.bind(this),
      eth_unsubscribe: this.eth_unsubscribe.bind(this)
    }
  }

  eth_getLogs (payload, cb) {
    const results = this.vmContext.logsManager.getLogsFor(payload.params[0])
    cb(null, results)
  }

  eth_subscribe (payload, cb) {
    const subscriptionId = this.vmContext.logsManager.subscribe(payload.params)
    cb(null, subscriptionId)
  }

  eth_unsubscribe (payload, cb) {
    this.vmContext.logsManager.unsubscribe(payload.params[0])
    cb(null, true)
  }

  eth_newFilter (payload, cb) {
    const filterId = this.vmContext.logsManager.newFilter('filter', payload.params[0])
    cb(null, filterId)
  }

  eth_newBlockFilter (payload, cb) {
    const filterId = this.vmContext.logsManager.newFilter('block')
    cb(null, filterId)
  }

  eth_newPendingTransactionFilter (payload, cb) {
    const filterId = this.vmContext.logsManager.newFilter('pendingTransactions')
    cb(null, filterId)
  }

  eth_uninstallfilter (payload, cb) {
    const result = this.vmContext.logsManager.uninstallFilter(payload.params[0])
    cb(null, result)
  }

  eth_getFilterChanges (payload, cb) {
    const filterId = payload.params[0]
    const results = this.vmContext.logsManager.getLogsForFilter(filterId)
    cb(null, results)
  }

  eth_getFilterLogs (payload, cb) {
    const filterId = payload.params[0]
    const results = this.vmContext.logsManager.getLogsForFilter(filterId, true)
    cb(null, results)
  }
}
