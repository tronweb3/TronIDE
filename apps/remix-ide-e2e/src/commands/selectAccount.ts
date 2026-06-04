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

class SelectAccount extends EventEmitter {
  command (this: NightwatchBrowser, account?: string): NightwatchBrowser {
    if (account) {
      const lowercaseAccount = account.toLowerCase()
      this.api
        .waitForElementPresent('select[data-id="runTabSelectAccount"]', 20000)
        .perform((done) => {
          this.api.execute(function (acc, lowAcc) {
            const select = document.querySelector('select[data-id="runTabSelectAccount"]') as HTMLSelectElement
            if (select) {
              for (let i = 0; i < select.options.length; i++) {
                const opt = select.options[i]
                const val = opt.value ? opt.value.toLowerCase() : ''
                if (val === lowAcc || val === acc.toLowerCase()) {
                  select.selectedIndex = i
                  select.dispatchEvent(new Event('change'))
                  return true
                }
              }
            }
            return false
          }, [account, lowercaseAccount], (result) => {
            if (!result.value) {
              this.api.click(`select[data-id="runTabSelectAccount"] [value="${account}"]`)
            }
            done()
            this.emit('complete')
          })
        })
    } else this.emit('complete')
    return this
  }
}

module.exports = SelectAccount
