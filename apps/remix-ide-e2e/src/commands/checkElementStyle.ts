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

class checkElementStyle extends EventEmitter {
  command (this: NightwatchBrowser, cssSelector: string, styleProperty: string, expectedResult: string): NightwatchBrowser {
    this.api.perform((done) => {
      checkStyle(this.api, cssSelector, styleProperty, expectedResult, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function checkStyle (browser: NightwatchBrowser, cssSelector: string, styleProperty: string, expectedResult: string, callback: VoidFunction) {
  browser.execute(function (cssSelector, styleProperty) {
    return window.getComputedStyle(document.querySelector(cssSelector)).getPropertyValue(styleProperty)
  }, [cssSelector, styleProperty], function (result) {
    const value = result.value

    if (typeof value === 'string') {
      browser.assert.equal(value.trim().toLowerCase(), expectedResult.toLowerCase())
    } else {
      browser.assert.fail('Failed with error info :', result.value.toString())
    }
    callback()
  })
}

module.exports = checkElementStyle
