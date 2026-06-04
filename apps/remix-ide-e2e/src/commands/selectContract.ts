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

const selector = '#runTabView select[class^="contractNames"]'

class SelectContract extends EventEmitter {
  command (this: NightwatchBrowser, contractName: string): NightwatchBrowser {
    this.api.waitForElementVisible(selector).perform((done) => {
      selectContract(this.api, contractName, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function selectContract (browser: NightwatchBrowser, contractName: string, callback: VoidFunction) {
  browser.click(`${selector} option[value="${contractName}"]`).perform(() => callback())
}

module.exports = SelectContract
