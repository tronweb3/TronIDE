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

class OpenFile extends EventEmitter {
  command (this: NightwatchBrowser, name: string) {
    this.api.perform((done) => {
      openFile(this.api, name, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

// click on fileExplorer can toggle it. We go through settings to be sure FE is open
function openFile (browser: NightwatchBrowser, name: string, done: VoidFunction) {
  const itemSelector = 'li[data-id="treeViewLitreeViewItem' + name + '"]'

  browser.clickLaunchIcon('settings').clickLaunchIcon('filePanel')
    .waitForElementVisible(itemSelector, 60000)
    .execute(function (selector) {
      (document.querySelector(selector) as HTMLElement).click()
    }, [itemSelector])
    .waitForElementPresent('remix-tabs remix-tab.active', 60000)
    .pause(2000)
    .perform(() => {
      done()
    })
}

module.exports = OpenFile
