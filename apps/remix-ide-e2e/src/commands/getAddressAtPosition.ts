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

class GetAddressAtPosition extends EventEmitter {
  command (this: NightwatchBrowser, index: number, cb: (pos: string) => void): NightwatchBrowser {
    this.api.perform((done) => {
      getAddressAtPosition(this.api, index, (pos) => {
        done()
        cb(pos)
        this.emit('complete')
      })
    })
    return this
  }
}

function getAddressAtPosition (browser: NightwatchBrowser, index: number, callback: (pos: string) => void) {
  browser.waitForElementPresent('*[data-shared="universalDappUiInstance"]')
    .execute(function (index) {
      const deployedContracts = document.querySelectorAll('*[data-shared="universalDappUiInstance"]')
      const id = deployedContracts[index].getAttribute('id')

      return id.replace('instance', '')
    }, [index], function (result) {
      const pos = typeof result.value === 'string' ? result.value : null

      callback(pos)
    })
}

module.exports = GetAddressAtPosition
