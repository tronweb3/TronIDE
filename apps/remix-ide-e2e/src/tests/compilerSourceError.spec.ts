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
import init from '../helpers/init'

const source = {
  content:
`pragma solidity >=0.2.0 <0.7.0;

contract CompilerSourceError {
  uint value;
}
`
}

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done, 'http://127.0.0.1:8080/#mockCompilerSource=unreachable&tronideAllowCompilerSourceMock=1')
  },

  'Falls back to the bundled compiler when the selected source is unreachable': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .clickLaunchIcon('filePanel')
      .addFile('compiler-source-error.sol', source)
      .clickLaunchIcon('solidity')
      .waitForElementContainsText(
        '*[data-id="compilerBuiltinFallbackNotice"]',
        'TronIDE switched to the built-in compiler (0.8.20).',
        60000
      )
      .waitForElementContainsText(
        '*[data-id="compilerBuiltinFallbackNotice"]',
        'Contracts requiring another compiler version may not compile.',
        10000
      )
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .waitForElementVisible('*[data-id="compilerContainerCompileBtn"]:not([disabled])', 60000)
      .execute(function () {
        const notice = document.querySelector('*[data-id="compilerBuiltinFallbackNotice"]')
        const versionSelector = document.querySelector('#versionSelector') as HTMLSelectElement
        return {
          noticeRole: notice && notice.getAttribute('role'),
          selectedVersion: versionSelector && versionSelector.value,
          selectedLabel: versionSelector && versionSelector.selectedOptions[0] && versionSelector.selectedOptions[0].textContent.trim()
        }
      }, [], function (result) {
        const snapshot = result.value as { noticeRole: string, selectedVersion: string, selectedLabel: string }
        browser.assert.equal(snapshot.noticeRole, 'alert', 'Fallback notice keeps alert semantics')
        browser.assert.equal(snapshot.selectedVersion, 'builtin', 'Compiler selection switches to the bundled build')
        browser.assert.equal(snapshot.selectedLabel, 'Built-in compiler (local) - 0.8.20', 'Bundled compiler version is explicit')
      })
      .notContainsText('body', 'Worker error:')
      .notContainsText('body', 'worker error:undefined')
      .notContainsText('body', 'Uncaught RangeError: Maximum call stack size exceeded')
      .end()
  }
}
