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

  'Shows compiler source load error without blank screen': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .clickLaunchIcon('filePanel')
      .addFile('compiler-source-error.sol', source)
      .clickLaunchIcon('solidity')
      .waitForElementContainsText('*[data-id="compiledErrors"]', 'Worker error:', 60000)
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .waitForElementVisible('*[data-id="compilerContainerCompileBtn"]', 10000)
      .notContainsText('*[data-id="compiledErrors"]', 'worker error:undefined')
      .notContainsText('body', 'Uncaught RangeError: Maximum call stack size exceeded')
      .end()
  }
}
