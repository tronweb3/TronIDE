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

class addAtAddressInstance extends EventEmitter {
  command (this: NightwatchBrowser, address: string, isValidFormat: boolean, isValidChecksum: boolean): NightwatchBrowser {
    this.api.perform((done: VoidFunction) => {
      addInstance(this.api, address, isValidFormat, isValidChecksum, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function addInstance (browser: NightwatchBrowser, address: string, isValidFormat: boolean, isValidChecksum: boolean, callback: VoidFunction) {
  browser.clickLaunchIcon('udapp').clearValue('.ataddressinput').setValue('.ataddressinput', address, function () {
    if (!isValidFormat || !isValidChecksum) browser.assert.elementPresent('button[id^="runAndDeployAtAdressButton"]:disabled')
    else {
      browser.click('button[id^="runAndDeployAtAdressButton"]')
        .execute(function () {
          const modal = document.querySelector('#modal-footer-ok') as HTMLElement
          modal.click()
        })
    }
    callback()
  })
}

module.exports = addAtAddressInstance
