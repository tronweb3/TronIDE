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

class WaitForElementContainsText extends EventEmitter {
  command (this: NightwatchBrowser, id: string, value: string, timeout = 10000): NightwatchBrowser {
    let waitId // eslint-disable-line
    const runid = setInterval(() => {
      this.api.getText(id, (result) => {
        if (typeof result.value === 'string' && result.value.indexOf(value) !== -1) {
          clearInterval(runid)
          clearTimeout(waitId)
          this.api.assert.ok(true, `WaitForElementContainsText ${id} contains ${value}`)
          this.emit('complete')
        }
      })
    }, 200)

    waitId = setTimeout(() => {
      clearInterval(runid)
      this.api.assert.fail(`TimeoutError: An error occurred while running .waitForElementContainsText() command on ${id} after ${timeout} milliseconds`)
    }, timeout)
    return this
  }
}

module.exports = WaitForElementContainsText
