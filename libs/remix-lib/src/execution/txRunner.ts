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
import { EventManager } from '../eventManager'

export class TxRunner {
  event
  runAsync
  pendingTxs
  queusTxs
  opt
  internalRunner
  constructor (internalRunner, opt) {
    this.opt = opt || {}
    this.internalRunner = internalRunner
    this.event = new EventManager()

    this.runAsync = this.opt.runAsync || true // We have to run like this cause the VM Event Manager does not support running multiple txs at the same time.

    this.pendingTxs = {}
    this.queusTxs = []
  }

  rawRun (args, confirmationCb, gasEstimationForceSend, promptCb, cb) {
    run(this, args, args.timestamp || Date.now(), confirmationCb, gasEstimationForceSend, promptCb, cb)
  }

  execute (args, confirmationCb, gasEstimationForceSend, promptCb, callback) {
    let data = args.data
    if (data.slice(0, 2) !== '0x') {
      data = '0x' + data
    }
    this.internalRunner.execute(args, confirmationCb, gasEstimationForceSend, promptCb, callback)
  }
}

function run (self, tx, stamp, confirmationCb, gasEstimationForceSend = null, promptCb = null, callback = null) {
  if (!self.runAsync && Object.keys(self.pendingTxs).length) {
    return self.queusTxs.push({ tx, stamp, callback })
  }
  self.pendingTxs[stamp] = tx
  self.execute(tx, confirmationCb, gasEstimationForceSend, promptCb, function (error, result) {
    delete self.pendingTxs[stamp]
    if (callback && typeof callback === 'function') callback(error, result)
    if (self.queusTxs.length) {
      const next = self.queusTxs.pop()
      run(self, next.tx, next.stamp, next.callback)
    }
  })
}
