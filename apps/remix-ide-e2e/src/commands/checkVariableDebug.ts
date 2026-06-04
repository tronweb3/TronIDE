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

import { NightwatchBrowser, NightwatchCheckVariableDebugValue } from 'nightwatch'
import EventEmitter from 'events'

const deepequal = require('deep-equal')

class CheckVariableDebug extends EventEmitter {
  command (this: NightwatchBrowser, id: string, debugValue: NightwatchCheckVariableDebugValue): NightwatchBrowser {
    this.api.perform((done) => {
      checkDebug(this.api, id, debugValue, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function checkDebug (browser: NightwatchBrowser, id: string, debugValue: NightwatchCheckVariableDebugValue, done: VoidFunction) {
  // id is soliditylocals or soliditystate
  browser.execute(function (id: string) {
    const elem = document.querySelector('#' + id + ' .dropdownrawcontent') as HTMLElement

    return elem.innerText
  }, [id], function (result) {
    let value
    try {
      value = JSON.parse(<string>result.value)
    } catch (e) {
      browser.assert.fail('cant parse solidity state', e.message, '')
      done()
      return
    }
    const equal = deepequal(debugValue, value)
    if (!equal) {
      browser.assert.fail(JSON.stringify(value), 'info about error\n ' + JSON.stringify(debugValue) + '\n ' + JSON.stringify(value), '')
    }
    done()
  })
}

module.exports = CheckVariableDebug
