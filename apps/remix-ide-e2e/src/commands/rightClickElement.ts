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

class RightClickElement extends EventEmitter {
  command (this: NightwatchBrowser, cssSelector: string) {
    this.api.perform((done) => {
      rightClick(this.api, cssSelector, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function rightClick (browser: NightwatchBrowser, cssSelector: string, callback: VoidFunction) {
  browser.execute(function (cssSelector: string) {
    const element: any = document.querySelector(cssSelector)
    const evt = element.ownerDocument.createEvent('MouseEvents')
    const RIGHT_CLICK_BUTTON_CODE = 2

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
  }, [cssSelector], function () {
    callback()
  })
}

module.exports = RightClickElement
