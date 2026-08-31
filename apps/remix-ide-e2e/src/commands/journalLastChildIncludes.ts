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

/*
  Check if the last log in the console contains a specific text
*/
class JournalLastChildIncludes extends EventEmitter {
  command (this: NightwatchBrowser, val: string): NightwatchBrowser {
    const api = this.api
    this.api
      .waitForElementVisible('*[data-id="terminalJournal"] > div:last-child', 10000)
      .waitUntil(function () {
        return new Promise((resolve) => {
          api.getText('*[data-id="terminalJournal"] > div:last-child', (result) => {
            const text = typeof result.value === 'string' ? result.value : ''
            console.log('JournalLastChildIncludes', text)
            resolve(text.indexOf(val) !== -1)
          })
        })
      }, 60000, 250)
      .perform(() => {
        api.assert.ok(true, `<*[data-id="terminalJournal"] > div:last-child> contains ${val}.`)
        this.emit('complete')
      })
    return this
  }
}

module.exports = JournalLastChildIncludes
