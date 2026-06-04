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

class MetaMask extends EventEmitter {
  command (this: NightwatchBrowser, passphrase: string, password: string): NightwatchBrowser {
    this.api.perform((done) => {
      setupMetaMask(this.api, passphrase, password, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function setupMetaMask (browser: NightwatchBrowser, passphrase: string, password: string, done: VoidFunction) {
  browser
    .switchBrowserWindow('chrome-extension://poemojpkcjbpmcccohjnomjffeinlafe/home.html#initialize/welcome', 'MetaMask', (browser) => {
      browser.waitForElementPresent('.first-time-flow__button')
        .click('.first-time-flow__button')
        .waitForElementPresent('.select-action__select-button:nth-of-type(1) > .first-time-flow__button')
        .click('.select-action__select-button:nth-of-type(1) > .first-time-flow__button')
        .waitForElementPresent('.page-container__footer-button:nth-of-type(2)')
        .click('.page-container__footer-button:nth-of-type(2)')
        .waitForElementPresent('.first-time-flow__textarea')
        .setValue('.first-time-flow__textarea', passphrase)
        .setValue('*[autocomplete="new-password"]', password)
        .setValue('*[autocomplete="confirm-password"]', password)
        .click('.first-time-flow__checkbox')
        .click('.first-time-flow__button')
        .pause(5000)
        .click('.first-time-flow__button')
        .perform(() => {
          done()
        })
    })
}

module.exports = MetaMask
