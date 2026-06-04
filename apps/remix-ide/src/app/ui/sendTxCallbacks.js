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

const yo = require('yo-yo')
const remixLib = require('@remix-project/remix-lib')
const confirmDialog = require('./confirmDialog')
const modalCustom = require('./modal-dialog-custom')
const modalDialog = require('./modaldialog')
const typeConversion = remixLib.execution.typeConversion
const Web3 = require('web3')

module.exports = {
  getCallBacksWithContext: (udappUI, blockchain) => {
    const callbacks = {}
    callbacks.confirmationCb = confirmationCb
    callbacks.continueCb = continueCb
    callbacks.promptCb = promptCb
    callbacks.udappUI = udappUI
    callbacks.blockchain = blockchain
    return callbacks
  }
}

const continueCb = function (error, continueTxExecution, cancelCb) {
  if (error) {
    const msg = typeof error !== 'string' ? error.message : error
    modalDialog(
      'Gas estimation failed',
      yo`
        <div>Gas estimation errored with the following message (see below).
        The transaction execution will likely fail. Do you want to force sending? <br>${msg}</div>
      `,
      {
        label: 'Send Transaction',
        fn: () => continueTxExecution()
      },
      {
        label: 'Cancel Transaction',
        fn: () => cancelCb()
      }
    )
  } else {
    continueTxExecution()
  }
}

const promptCb = function (okCb, cancelCb) {
  modalCustom.promptPassphrase('Passphrase requested', 'Personal mode is enabled. Please provide passphrase of account', '', okCb, cancelCb)
}

const confirmationCb = function (network, tx, gasEstimation, continueTxExecution, cancelCb) {
  const self = this
  if (network.name !== 'Main') {
    return continueTxExecution(null)
  }
  var amount = Web3.utils.fromWei(typeConversion.toInt(tx.value), 'ether')
  var content = confirmDialog(tx, network, amount, gasEstimation,
    (gasPrice, cb) => {
      let txFeeText, priceStatus
      // TODO: this try catch feels like an anti pattern, can/should be
      // removed, but for now keeping the original logic
      try {
        var fee = Web3.utils.toBN(tx.gas).mul(Web3.utils.toBN(Web3.utils.toWei(gasPrice.toString(10), 'gwei')))
        txFeeText = ' ' + Web3.utils.fromWei(fee.toString(10), 'ether') + ' Ether'
        priceStatus = true
      } catch (e) {
        txFeeText = ' Please fix this issue before sending any transaction. ' + e.message
        priceStatus = false
      }
      cb(txFeeText, priceStatus)
    },
    (cb) => {
      self.blockchain.web3().eth.getGasPrice((error, gasPrice) => {
        const warnMessage = ' Please fix this issue before sending any transaction. '
        if (error) {
          return cb('Unable to retrieve the current network gas price.' + warnMessage + error)
        }
        try {
          var gasPriceValue = Web3.utils.fromWei(gasPrice.toString(10), 'gwei')
          cb(null, gasPriceValue)
        } catch (e) {
          cb(warnMessage + e.message, null, false)
        }
      })
    }
  )
  modalDialog(
    'Confirm transaction',
    content,
    {
      label: 'Confirm',
      fn: () => {
        self.blockchain.config.setUnpersistedProperty(
          'doNotShowTransactionConfirmationAgain',
          content.querySelector('input#confirmsetting').checked
        )
        // TODO: check if this is check is still valid given the refactor
        if (!content.gasPriceStatus) {
          cancelCb('Given transaction fee is not correct')
        } else {
          continueTxExecution(content.txFee)
        }
      }
    },
    {
      label: 'Cancel',
      fn: () => {
        return cancelCb('Transaction canceled by user.')
      }
    }
  )
}
