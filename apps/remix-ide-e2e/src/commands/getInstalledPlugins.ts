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

class GetInstalledPlugins extends EventEmitter {
  command (this: NightwatchBrowser, cb: (plugins: string[]) => void): NightwatchBrowser {
    const browser = this.api

    browser.waitForElementPresent('[plugin]:not([plugin=""]')
      .perform((done) => {
        browser.execute(function () {
          const pluginNames = []
          const plugins = document.querySelectorAll('[plugin]:not([plugin=""]')

          plugins.forEach(plugin => {
            pluginNames.push(plugin.getAttribute('plugin'))
          })
          return pluginNames
        }, [], (result) => {
          done()
          Array.isArray(result.value) && cb(result.value)
          this.emit('complete')
        })
      })
    return this
  }
}

module.exports = GetInstalledPlugins
