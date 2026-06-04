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

import { NightwatchBrowser, NightwatchClickFunctionExpectedInput } from 'nightwatch'
import EventEmitter from 'events'

class ClickFunction extends EventEmitter {
  command (this: NightwatchBrowser, fnFullName: string, expectedInput?: NightwatchClickFunctionExpectedInput): NightwatchBrowser {
    this.api.waitForElementPresent('.instance button[title="' + fnFullName + '"]')
      .perform(function (client, done) {
        client.execute(function () {
          document.querySelector('#runTabView').scrollTop = document.querySelector('#runTabView').scrollHeight
        }, [], function () {
          if (expectedInput) {
            client.setValue('#runTabView input[title="' + expectedInput.types + '"]', expectedInput.values, _ => _)
          }
          done()
        })
      })
      .scrollAndClick('.instance button[title="' + fnFullName + '"]')
      .pause(2000)
      .perform(() => {
        this.emit('complete')
      })
    return this
  }
}

module.exports = ClickFunction
