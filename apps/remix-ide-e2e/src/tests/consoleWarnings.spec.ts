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

'use strict'
import { NightwatchBrowser } from 'nightwatch'

module.exports = {
  'Home and top header do not emit fixed console warnings': async function (browser: NightwatchBrowser) {
    await browser.chrome.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__fixedWarningMessages = [];
        ['warn', 'error'].forEach((level) => {
          const original = console[level];
          console[level] = function (...args) {
            window.__fixedWarningMessages.push(args.map((arg) => String(arg)).join(' '));
            return original.apply(console, args);
          };
        });
      `
    })

    browser
      .url('http://127.0.0.1:8080')
      .waitForElementVisible('*[data-id="landingPageHomeContainer"]', 10000)
      .pause(1500)
      .execute(function () {
        return window['__fixedWarningMessages'] || []
      }, [], function (result) {
        const messages = result.value as string[]
        const fixedWarningPatterns = [
          'Unable to load landing workspace status',
          'Invalid DOM property `class`',
          'Each child in a list should have a unique "key" prop',
          '`dropdownMatchSelectWidth` is deprecated',
          '`dropdownClassName` is deprecated',
          '`onDropdownVisibleChange` is deprecated'
        ]
        fixedWarningPatterns.forEach((pattern) => {
          browser.assert.equal(messages.some((message) => message.includes(pattern)), false, `Console should not include: ${pattern}`)
        })
      })
      .end()
  }
}
