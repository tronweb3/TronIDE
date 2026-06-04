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

import { NightwatchBrowser, NightwatchTestFunctionExpectedInput } from 'nightwatch'
import EventEmitter from 'events'

const deepequal = require('deep-equal')

const getElementId = (element: Record<string, string>): string => element.ELEMENT || element[Object.keys(element)[0]]

class TestFunction extends EventEmitter {
  command (this: NightwatchBrowser, txHash: string, expectedValue: NightwatchTestFunctionExpectedInput): NightwatchBrowser {
    const browser = this.api
    const logs = {}
    const setLog = (index: number, value: string) => {
      logs[Object.keys(logs)[index]] = typeof value === 'string' ? value.indexOf('Copy value to clipboard') ? value.split('\n').shift().trim() : value.trim() : value
    }

    browser
      .perform((done) => {
        browser.getLastTransactionHash((hash) => {
          if (txHash === 'last') {
            console.log(hash)
            txHash = hash
          }
          done()
        })
      })
      .perform((done) => {
        browser.waitForElementVisible(`[data-id="block_tx${txHash}"]`, 60000)
          .execute(function () {
            document.querySelector('#webpack-dev-server-client-overlay')?.remove()
          })
          .click(`[data-id="block_tx${txHash}"]`)
          .waitForElementVisible(`*[data-id="txLoggerTable${txHash}"]`, 60000)
          .pause(10000)
        // fetch and format transaction logs as key => pair object
          .elements('css selector', `*[data-shared="key_${txHash}"]`, (res) => {
            Array.isArray(res.value) && res.value.forEach(function (jsonWebElement) {
              const jsonWebElementId: string = getElementId(jsonWebElement as unknown as Record<string, string>)

              browser.elementIdText(jsonWebElementId, (jsonElement) => {
                const key = typeof jsonElement.value === 'string' ? jsonElement.value.trim() : null

                logs[key] = null
              })
            })
          })
          .elements('css selector', `*[data-shared="pair_${txHash}"]`, (res) => {
            Array.isArray(res.value) && res.value.forEach(function (jsonWebElement, index) {
              const jsonWebElementId = getElementId(jsonWebElement as unknown as Record<string, string>)

              browser.elementIdText(jsonWebElementId, (jsonElement) => {
                let value = jsonElement.value

                try {
                  value = JSON.parse(<string>jsonElement.value)
                  setLog(index, <string>value)
                } catch (e) {
                  setLog(index, <string>value)
                }
              })
            })
          }).perform(() => done())
      })
      .perform(() => {
        Object.keys(expectedValue).forEach(key => {
          let equal = false

          try {
            const receivedValue = JSON.parse(logs[key])

            equal = deepequal(receivedValue, expectedValue[key])
          } catch (err) {
            equal = deepequal(logs[key], expectedValue[key])
          }

          if (!equal) {
            browser.assert.fail(`Expected ${JSON.stringify(expectedValue[key])} but got ${JSON.stringify(logs[key])}`)
          } else {
            browser.assert.ok(true, `Expected value matched returned value ${JSON.stringify(expectedValue[key])}`)
          }
        })
        this.emit('complete')
      })
    return this
  }
}

module.exports = TestFunction
