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

import { NightwatchBrowser, NightwatchTestConstantFunctionExpectedInput } from 'nightwatch'
import EventEmitter from 'events'

class TestConstantFunction extends EventEmitter {
  command (this: NightwatchBrowser, address: string, fnFullName: string, expectedInput: NightwatchTestConstantFunctionExpectedInput | null, expectedOutput: string): NightwatchBrowser {
    console.log('TestConstantFunction ' + address + ' fnFullName')
    this.api.perform((done) => {
      testConstantFunction(this.api, address, fnFullName, expectedInput, expectedOutput, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function testConstantFunction (browser: NightwatchBrowser, address: string, fnFullName: string, expectedInput: NightwatchTestConstantFunctionExpectedInput, expectedOutput: string, cb: VoidFunction) {
  browser.waitForElementPresent('.instance button[title="' + fnFullName + '"]').perform(function (client, done) {
    client.execute(function () {
      document.querySelector('#runTabView').scrollTop = document.querySelector('#runTabView').scrollHeight
    }, [], function () {
      if (expectedInput) {
        client.setValue('#runTabView input[title="' + expectedInput.types + '"]', expectedInput.values)
      }
      done()
    })
  })
    .click('.instance button[title="' + fnFullName + '"]')
    .pause(1000)
    .waitForElementPresent('#instance' + address + ' div[class^="contractActionsContainer"] div[class^="value"]')
    .scrollInto('#instance' + address + ' div[class^="contractActionsContainer"] div[class^="value"]')
    .assert.containsText('#instance' + address + ' div[class^="contractActionsContainer"] div[class^="value"]', expectedOutput).perform(() => {
      cb()
    })
}

module.exports = TestConstantFunction
