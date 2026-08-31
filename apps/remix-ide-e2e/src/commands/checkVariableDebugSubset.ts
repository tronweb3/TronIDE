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
import {
  formatDebugVariableFailure,
  isDeepSubset,
  parseDebugVariable,
  readDebugVariableSnapshot
} from '../helpers/debugVariable'

class CheckVariableDebugSubset extends EventEmitter {
  command (this: NightwatchBrowser, id: string, expected: NightwatchCheckVariableDebugValue): NightwatchBrowser {
    this.api.perform((done) => {
      readDebugVariableSnapshot(this.api, id, (snapshot) => {
        let actual
        try {
          actual = parseDebugVariable(snapshot)
        } catch (error) {
          this.api.assert.fail(`Unable to read #${id} debugger variables: ${(error as Error).message}`)
          done()
          this.emit('complete')
          return
        }

        const matches = isDeepSubset(expected, actual)
        this.api.assert.ok(matches, matches
          ? `#${id} contains the expected debugger values`
          : formatDebugVariableFailure(id, expected, actual, snapshot))
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

module.exports = CheckVariableDebugSubset
