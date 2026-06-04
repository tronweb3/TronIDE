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

const getElementId = (element: Record<string, string>): string => element.ELEMENT || element[Object.keys(element)[0]]

/*
  Checks if any child elements of journal (console) contains a matching value.
*/
class JournalChildIncludes extends EventEmitter {
  command (this: NightwatchBrowser, val: string): NightwatchBrowser {
    let isTextFound = false
    const browser = this.api

    this.api.elements('css selector', '*[data-id="terminalJournal"]', (res) => {
      Array.isArray(res.value) && res.value.forEach(function (jsonWebElement) {
        const jsonWebElementId = getElementId(jsonWebElement as unknown as Record<string, string>)

        browser.elementIdText(jsonWebElementId, (jsonElement) => {
          const text = jsonElement.value

          if (typeof text === 'string' && text.indexOf(val) !== -1) isTextFound = true
        })
      })
    })
    browser.perform(() => {
      browser.assert.ok(isTextFound, isTextFound ? `<*[data-id="terminalJournal"]> contains ${val}.` : `${val} not found in <*[data-id="terminalJournal"]> div:last-child>`)
      this.emit('complete')
    })
    return this
  }
}

module.exports = JournalChildIncludes
