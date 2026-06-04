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

import { Plugin } from '@remixproject/engine'

import * as packageJson from '../../../../../../package.json'
var yo = require('yo-yo')
var remixLib = require('@remix-project/remix-lib')
var EventManager = remixLib.EventManager
var csjs = require('csjs-inject')
var css = require('../styles/run-tab-styles')

var modalDialogCustom = require('../../ui/modal-dialog-custom')
var modalDialog = require('../../ui/modaldialog')
var confirmDialog = require('../../ui/confirmDialog')

var helper = require('../../../lib/helper.js')

const profile = {
  name: 'recorder',
  methods: ['runScenario'],
  version: packageJson.version
}

class RecorderUI extends Plugin {
  constructor (blockchain, fileManager, recorder, logCallBack, config) {
    super(profile)
    this.fileManager = fileManager
    this.blockchain = blockchain
    this.recorder = recorder
    this.logCallBack = logCallBack
    this.config = config
    this.event = new EventManager()
  }

  render () {
    var css2 = csjs`
      .container {}
      .runTxs {}
      .recorder {}
    `

    this.runButton = yo`<i class="fas fa-play runtransaction ${css2.runTxs} ${css.icon}"  title="Run Transactions" aria-hidden="true"></i>`
    this.recordButton = yo`
      <i class="fas fa-save savetransaction ${css2.recorder} ${css.icon}"
        onclick=${this.triggerRecordButton.bind(this)} title="Save Transactions" aria-hidden="true">
      </i>`

    this.runButton.onclick = () => {
      const file = this.config.get('currentFile')
      if (!file) return modalDialogCustom.alert('A scenario file has to be selected')
      this.runScenario(file)
    }
  }

  runScenario (file) {
    if (!file) return modalDialogCustom.alert('Unable to run scenerio, no specified scenario file')
    var continueCb = (error, continueTxExecution, cancelCb) => {
      if (error) {
        var msg = typeof error !== 'string' ? error.message : error
        modalDialog('Gas estimation failed', yo`<div>Gas estimation errored with the following message (see below).
        The transaction execution will likely fail. Do you want to force sending? <br>
        ${msg}
        </div>`,
        {
          label: 'Send Transaction',
          fn: () => {
            continueTxExecution()
          }
        }, {
          label: 'Cancel Transaction',
          fn: () => {
            cancelCb()
          }
        })
      } else {
        continueTxExecution()
      }
    }

    var promptCb = (okCb, cancelCb) => {
      modalDialogCustom.promptPassphrase('Passphrase requested', 'Personal mode is enabled. Please provide passphrase of account', '', okCb, cancelCb)
    }

    var alertCb = (msg) => {
      modalDialogCustom.alert(msg)
    }

    const confirmationCb = this.getConfirmationCb(modalDialog, confirmDialog)

    this.fileManager.readFile(file).then((json) => {
      // TODO: there is still a UI dependency to remove here, it's still too coupled at this point to remove easily
      this.recorder.runScenario(json, continueCb, promptCb, alertCb, confirmationCb, this.logCallBack, (error, abi, address, contractName) => {
        if (error) {
          modalDialogCustom.alert(error)
          return
        }

        this.event.trigger('newScenario', [abi, address, contractName])
      })
    }).catch((error) => {
      console.log('Error reading scenario file:', error)
      modalDialogCustom.alert(error + ' Transactions created in Injected TronWeb cannot be replayed in JavaScript VM (Tron) yet.')
    })
  }

  getConfirmationCb (modalDialog, confirmDialog) {
    // this code is the same as in contractDropdown.js. TODO need to be refactored out
    const confirmationCb = (network, tx, gasEstimation, continueTxExecution, cancelCb) => {
      if (network.name !== 'Main') {
        return continueTxExecution(null)
      }
      const amount = this.blockchain.fromWei(tx.value, true, 'ether')
      const content = confirmDialog(tx, network, amount, gasEstimation, this.blockchain.determineGasFees(tx), this.blockchain.determineGasPrice.bind(this.blockchain))

      modalDialog('Confirm transaction', content,
        {
          label: 'Confirm',
          fn: () => {
            this.config.setUnpersistedProperty('doNotShowTransactionConfirmationAgain', content.querySelector('input#confirmsetting').checked)
            // TODO: check if this is check is still valid given the refactor
            if (!content.gasPriceStatus) {
              cancelCb('Given transaction fee is not correct')
            } else {
              continueTxExecution(content.txFee)
            }
          }
        }, {
          label: 'Cancel',
          fn: () => {
            return cancelCb('Transaction canceled by user.')
          }
        }
      )
    }

    return confirmationCb
  }

  triggerRecordButton () {
    this.saveScenario(
      (path, cb) => {
        modalDialogCustom.prompt('Save transactions as scenario', 'Transactions will be saved in a file under ' + path, 'scenario.json', cb)
      },
      (error) => {
        if (error) return modalDialogCustom.alert(error)
      }
    )
  }

  saveScenario (promptCb, cb) {
    var txJSON = JSON.stringify(this.recorder.getAll(), null, 2)
    var path = this.fileManager.currentPath()
    promptCb(path, input => {
      var fileProvider = this.fileManager.fileProviderOf(path)
      if (!fileProvider) return
      var newFile = path + '/' + input
      // helper.createNonClashingName(newFile, fileProvider, (error, newFile) => {
      //   if (error) return cb('Failed to create file. ' + newFile + ' ' + error)
      //   if (!fileProvider.set(newFile, txJSON)) return cb('Failed to create file ' + newFile)
      //   this.fileManager.open(newFile)
      // })

      helper.createNonClashingName(newFile, fileProvider, (error, finalNewFile) => { // 重命名回调参数以区分
        if (error) {
          console.error('Error from createNonClashingName:', error, 'Proposed file was:', newFile)
          return cb('Failed to create file. ' + newFile + ' ' + error)
        }

        // console.log('[SAVE SCENARIO] Attempting to save. Original path:', path)
        // console.log('[SAVE SCENARIO] User input for filename (from promptCb scope):', input) // 确保 input 在此作用域可见
        // console.log('[SAVE SCENARIO] File provider type:', fileProvider.constructor.name) // 或其他能识别类型的方式
        // console.log('[SAVE SCENARIO] Path returned by createNonClashingName:', finalNewFile)
        // console.log('[SAVE SCENARIO] JSON content length:', txJSON.length)

        const setResult = fileProvider.set(finalNewFile, txJSON)
        // console.log('[SAVE SCENARIO] Result of fileProvider.set():', setResult)

        if (!setResult) {
          // 如果 fileProvider 实例上有错误信息，尝试打印
          if (fileProvider.lastError) {
            console.error('[SAVE SCENARIO] fileProvider lastError:', fileProvider.lastError)
          }
          return cb('Failed to create file ' + finalNewFile)
        }
        this.fileManager.open(finalNewFile)
        cb() // 如果成功也需要回调，确保调用
      })
    })
  }
}

module.exports = RecorderUI
