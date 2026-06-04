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

class SelectContract extends EventEmitter {
  command (this: NightwatchBrowser, msg: string, callback: (hash: { value: string }, signature: { value: string }) => void): NightwatchBrowser {
    this.api.perform((done) => {
      signMsg(this.api, msg, (hash, signature) => {
        callback(hash, signature)
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function signMsg (browser: NightwatchBrowser, msg: string, cb: (hash: { value: string }, signature: { value: string }) => void) {
  let hash, signature
  browser
    .waitForElementPresent('i[id="remixRunSignMsg"]')
    .click('i[id="remixRunSignMsg"]')
    .waitForElementVisible('textarea[id="prompt_text"]')
    .setValue('textarea[id="prompt_text"]', msg, () => {
      browser.modalFooterOKClick().perform(
        (client, done) => {
          browser.waitForElementVisible('span[id="remixRunSignMsgHash"]').getText('span[id="remixRunSignMsgHash"]', (v) => { hash = v; done() })
        }
      )
        .perform(
          (client, done) => {
            browser.waitForElementVisible('span[id="remixRunSignMsgSignature"]').getText('span[id="remixRunSignMsgSignature"]', (v) => { signature = v; done() })
          }
        )
        .modalFooterOKClick()
        .perform(
          () => {
            cb(hash, signature)
          }
        )
    })
}

module.exports = SelectContract
