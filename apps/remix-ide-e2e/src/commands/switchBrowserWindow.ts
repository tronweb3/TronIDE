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

import { NightwatchBrowser, NightwatchCallbackResult } from 'nightwatch'

const EventEmitter = require('events')

class SwitchBrowserWindow extends EventEmitter {
  command (this: NightwatchBrowser, url: string, windowName: string, cb: (browser: NightwatchBrowser, window?: NightwatchCallbackResult<Window>) => void): NightwatchBrowser {
    this.api.perform((done) => {
      switchWindow(this.api, url, windowName, cb)
      done()
      this.emit('complete')
    })
    return this
  }
}

function switchWindow (browser: NightwatchBrowser, url: string, windowName: string, cb: (browser: NightwatchBrowser, window: NightwatchCallbackResult<Window>) => void) {
  browser.execute(function (windowName) {
    return window.open('', windowName, 'width=2560, height=1440')
  }, [windowName], (newWindow) => {
    browser.switchWindow(windowName)
      .url(url)
      .pause(5000)
      .assert.urlContains(url)
    if (cb) cb(browser, newWindow)
  })
}

module.exports = SwitchBrowserWindow
