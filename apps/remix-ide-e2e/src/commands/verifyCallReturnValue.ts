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

class VerifyCallReturnValue extends EventEmitter {
  command (this: NightwatchBrowser, address: string, checks: string[]): NightwatchBrowser {
    this.api.perform((done) => {
      verifyCallReturnValue(this.api, address, checks, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function verifyCallReturnValue (browser: NightwatchBrowser, address: string, checks: string[], done: VoidFunction) {
  browser.execute(function (address: string) {
    const nodes = document.querySelectorAll('#instance' + address + ' div[class^="contractActionsContainer"] div[class^="value"]') as NodeListOf<HTMLElement>
    const ret = []
    for (let k = 0; k < nodes.length; k++) {
      const text = nodes[k].innerText ? nodes[k].innerText : nodes[k].textContent
      ret.push(text.replace('\n', ''))
    }
    return ret
  }, [address], function (result) {
    console.log('verifyCallReturnValue', result)
    for (const k in checks) {
      browser.assert.equal(result.value[k].trim(), checks[k].trim())
    }
    done()
  })
}

module.exports = VerifyCallReturnValue
