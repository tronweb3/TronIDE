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

class RenamePath extends EventEmitter {
  command (this: NightwatchBrowser, path: string, newFileName: string, renamedPath: string) {
    this.api.perform((done) => {
      renamePath(this.api, path, newFileName, renamedPath, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function renamePath (browser: NightwatchBrowser, path: string, newFileName: string, renamedPath: string, done: VoidFunction) {
  browser
    .moveToElement('[data-path="' + path + '"]', 5, 5)
    .mouseButtonClick('right')
    .waitForElementVisible('#menuitemrename')
    .perform(() => {
      browser
        .click('#menuitemrename')
        .perform((client, doneSetValue) => {
          browser.execute(function (path, addvalue) {
            document.querySelector('[data-path="' + path + '"]').innerHTML = addvalue
          }, [path, newFileName], () => {
            doneSetValue()
          })
        })
        .pause(1000)
        .click('div[data-id="remixIdeMainPanel"]') // focus out to save
        .pause(2000)
        .waitForElementNotPresent('[data-path="' + path + '"]')
        .waitForElementPresent('[data-path="' + renamedPath + '"]')
        .perform(() => {
          done()
        })
    })
}

module.exports = RenamePath
