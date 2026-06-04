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

const sources = [
  {
    'basic.sol': {
      content:
    `pragma solidity >=0.2.0 <0.7.0;

    /**
     * @title Basic contract
     */
    contract Basic {
        uint someVar;
        constructor() public {}
    }`
    }
  }
]

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },
  '@sources': function () {
    return sources
  },
  'Using Web Worker': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .clickLaunchIcon('filePanel')
      .addFile('basic.sol', sources[0]['basic.sol'])
      .clickLaunchIcon('solidity')
      .waitForElementVisible('*[data-id="compilerContainerCompileBtn"]', 10000)
      .noWorkerErrorFor('soljson-v0.5.17+commit.0a0a1275.js')
      .noWorkerErrorFor('soljson-v0.6.13+commit.b8267195.js')
      .end()
  }
}
