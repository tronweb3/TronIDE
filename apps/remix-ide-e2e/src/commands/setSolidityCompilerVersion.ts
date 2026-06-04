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

class SetSolidityCompilerVersion extends EventEmitter {
  command (this: NightwatchBrowser, version: string): NightwatchBrowser {
    this.api
      .waitForElementPresent(`#compileTabView #versionSelector option[value="${version}"]`, 60000)
      .execute(function (targetVersion) {
        const selector = document.querySelector('#compileTabView #versionSelector') as HTMLSelectElement
        if (!selector) return false

        const option = selector.querySelector(`[value="${targetVersion}"]`) as HTMLOptionElement
        if (!option) return false

        selector.value = targetVersion
        selector.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, [version], (result) => {
        this.api.assert.ok(Boolean(result && result.value), `Solidity compiler version "${version}" not found in #versionSelector`)
      })
      .pause(5000)
      .perform(() => {
        this.emit('complete')
      })
    return this
  }
}

module.exports = SetSolidityCompilerVersion
