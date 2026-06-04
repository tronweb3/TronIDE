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

import { execution } from '@remix-project/remix-lib'
const TxExecution = execution.txExecution

function runCall (payload, from, to, data, value, tokenId, tokenValue, gasLimit, txRunner, callbacks, callback) {
  const finalCallback = function (err, result) {
    if (err) {
      return callback(err)
    }
    return callback(null, result)
  }

  TxExecution.callFunction(from, to, data, value, tokenId, tokenValue, gasLimit, { constant: true }, txRunner, callbacks, finalCallback)
}

function runTx (payload, from, to, data, value, tokenId, tokenValue, gasLimit, txRunner, callbacks, callback) {
  const finalCallback = function (err, result) {
    if (err) {
      return callback(err)
    }
    callback(null, result)
  }

  TxExecution.callFunction(from, to, data, value, tokenId, tokenValue, gasLimit, { constant: false }, txRunner, callbacks, finalCallback)
}

function createContract (payload, from, data, value, tokenId, tokenValue, gasLimit, txRunner, callbacks, callback) {
  const finalCallback = function (err, result) {
    if (err) {
      return callback(err)
    }
    callback(null, result)
  }

  TxExecution.createContract(from, data, value, tokenId, tokenValue, gasLimit, txRunner, callbacks, finalCallback)
}

export function processTx (txRunnerInstance, payload, isCall, callback) {
  let { from, to, data, value, tokenId, tokenValue, gas } = payload.params[0]
  gas = gas || 3000000

  const callbacks = {
    confirmationCb: (network, tx, gasEstimation, continueTxExecution, cancelCb) => {
      continueTxExecution(null)
    },
    gasEstimationForceSend: (error, continueTxExecution, cancelCb) => {
      if (error) {
        continueTxExecution(error)
      }
      continueTxExecution()
    },
    promptCb: (okCb, cancelCb) => {
      okCb()
    }
  }

  if (isCall) {
    runCall(payload, from, to, data, value, tokenId, tokenValue, gas, txRunnerInstance, callbacks, callback)
  } else if (to) {
    runTx(payload, from, to, data, value, tokenId, tokenValue, gas, txRunnerInstance, callbacks, callback)
  } else {
    createContract(payload, from, data, value, tokenId, tokenValue, gas, txRunnerInstance, callbacks, callback)
  }
}
