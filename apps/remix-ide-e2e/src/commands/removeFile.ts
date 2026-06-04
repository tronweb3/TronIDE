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

const EventEmitter = require('events')

class RemoveFile extends EventEmitter {
  command (this: NightwatchBrowser, path: string, workspace: string): NightwatchBrowser {
    this.api.perform((done) => {
      removeFile(this.api, path, workspace, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function removeFile (browser: NightwatchBrowser, path: string, workspace: string, done: VoidFunction) {
  browser.execute(function (path) {
    function contextMenuClick (element) {
      const evt = element.ownerDocument.createEvent('MouseEvents')
      const RIGHT_CLICK_BUTTON_CODE = 2 // the same for FF and IE

      evt.initMouseEvent('contextmenu', true, true,
        element.ownerDocument.defaultView, 1, 0, 0, 0, 0, false,
        false, false, false, RIGHT_CLICK_BUTTON_CODE, null)
      if (Object.prototype.hasOwnProperty.call(document, 'createEventObject')) {
        // dispatch for IE
        return element.fireEvent('onclick', evt)
      } else {
        // dispatch for firefox + others
        return !element.dispatchEvent(evt)
      }
    }
    contextMenuClick(document.querySelector('[data-path="' + path + '"]'))
  }, [path], function () {
    browser
      .waitForElementVisible('#menuitemdelete')
      .click('#menuitemdelete')
      .pause(2000)
      .perform(() => {
        console.log(path, 'to remove')
        browser.waitForElementVisible('*[data-id="' + workspace + 'ModalDialogContainer-react"] .modal-ok')
          .click('*[data-id="' + workspace + 'ModalDialogContainer-react"] .modal-ok')
          .waitForElementNotPresent('[data-path="' + path + '"]')
        done()
      })
  })
}

module.exports = RemoveFile
