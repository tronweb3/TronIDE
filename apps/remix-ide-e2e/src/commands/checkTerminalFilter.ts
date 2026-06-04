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

import EventEmitter from 'events'
import { NightwatchBrowser } from 'nightwatch'

class CheckTerminalFilter extends EventEmitter {
  command (this: NightwatchBrowser, filter: string, test: string): NightwatchBrowser {
    this.api.perform((done) => {
      checkFilter(this.api, filter, test, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function checkFilter (browser: NightwatchBrowser, filter: string, test: string, done: VoidFunction) {
  if (browser.options.desiredCapabilities.browserName === 'chrome') { // nightwatch deos not handle well that part.... works locally
    done()
    return
  }
  const filterClass = '[data-id="terminalInputSearch"]'
  browser.setValue(filterClass, filter, function () {
    browser.execute(function () {
      return document.querySelector('[data-id="terminalJournal"]').innerHTML === test
    }, [], function (result) {
      browser.clearValue(filterClass).setValue(filterClass, '', function () {
        if (!result.value) {
          browser.assert.fail('useFilter on ' + filter + ' ' + test, 'info about error', '')
        }
        done()
      })
    })
  })
}

module.exports = CheckTerminalFilter
