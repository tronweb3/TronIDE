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

class CreateContract extends EventEmitter {
  command (this: NightwatchBrowser, inputParams: string): NightwatchBrowser {
    this.api.perform((done) => {
      createContract(this.api, inputParams, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function createContract (browser: NightwatchBrowser, inputParams: string, callback: VoidFunction) {
  if (inputParams) {
    browser
      .waitForElementPresent('div[class^="contractActionsContainerSingle"] input', 60000)
      .execute(function (inputParams) {
        document.querySelectorAll('.ant-tooltip').forEach((element) => element.remove())
        const input = document.querySelector('div[class^="contractActionsContainerSingle"] input') as HTMLInputElement
        input.scrollIntoView()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, inputParams)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, [inputParams])
      .execute(function () {
        document.querySelectorAll('.ant-tooltip').forEach((element) => element.remove())
        const deployButton = (document.querySelector('#runTabView *[data-id="multiParamManagerFuncButton"]') || document.querySelector('#runTabView button[class^="instanceButton"]')) as HTMLElement
        deployButton.click()
      })
      .pause(500)
      .perform(function () { callback() })
  } else {
    browser
      .execute(function () {
        document.querySelectorAll('.ant-tooltip').forEach((element) => element.remove())
        const deployButton = (document.querySelector('#runTabView *[data-id="multiParamManagerFuncButton"]') || document.querySelector('#runTabView button[class^="instanceButton"]')) as HTMLElement
        deployButton.click()
      })
      .pause(500)
      .perform(function () { callback() })
  }
}

module.exports = CreateContract
