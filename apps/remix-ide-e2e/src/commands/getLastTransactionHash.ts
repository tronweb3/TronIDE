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

import { NightwatchBrowser } from 'nightwatch'
import EventEmitter from 'events'

class GetLastTransactionHash extends EventEmitter {
  command (this: NightwatchBrowser, cb: (hash: string) => void): NightwatchBrowser {
    this.api.perform((done) => {
      getLastTransactionHash(this.api, (hash) => {
        cb(hash)
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function getLastTransactionHash (browser: NightwatchBrowser, callback: (hash: string) => void) {
  const transactionSelector = '*[data-id="terminalJournal"] > div[data-id^="block_tx0x"], *[data-id="terminalJournal"] > div[data-id^="block_txcall0x"]'

  browser.waitForElementPresent('*[data-shared="universalDappUiInstance"]')
    .waitForElementPresent(transactionSelector, 60000)
    .execute(findLastTransactionHash, [], function (result) {
      const hash = typeof result.value === 'string' ? result.value : null

      callback(hash)
    })
}

function findLastTransactionHash () {
  const deployedContracts = document.querySelectorAll('*[data-id="terminalJournal"] > div')
  for (let i = deployedContracts.length - 1; i >= 0; i--) {
    const current = deployedContracts[i]
    const attr = current.getAttribute('data-id')
    // For web3 provider, a contract call simulates a tx hash starting with 'block_txcall'
    if (attr?.startsWith('block_txcall0x')) return attr.slice('block_txcall'.length)
    if (attr?.startsWith('block_tx0x')) return attr.slice('block_tx'.length)
  }
  return ''
}

module.exports = GetLastTransactionHash
