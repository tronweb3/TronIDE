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

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done, undefined, false)
  },

  'Shows TRON Quick Start entries on the landing page': function (browser: NightwatchBrowser) {
    browser
      .clickIfPresent('remix-tabs remix-tab#home')
      .waitForElementVisible('*[data-id="landingPageHomeContainer"]', 15000)
      .waitForElementContainsText('*[data-id="landingHeroTitle"]', 'TRON Native Smart Contract IDE', 10000)
      .waitForElementVisible('*[data-id="headerGithubConnect"]', 10000)
      .waitForElementVisible('*[data-id="headerWalletConnect"]', 10000)
      .assert.containsText('*[data-id="headerGithubConnect"]', 'Connect GitHub')
      .assert.containsText('*[data-id="headerWalletConnect"]', 'Connect Wallet')
      .waitForElementVisible('*[data-id="quickStartCreateContract"]', 10000)
      .waitForElementVisible('*[data-id="landingDappStarterCard"]', 10000)
      .waitForElementVisible('*[data-id="landingOpenGlobalSearchButton"]', 10000)
      .waitForElementVisible('*[data-id="landingWalletConnectEntry"]', 10000)
      .click('*[data-id="headerWorkspaceDropdown"]')
      .waitForElementVisible('*[data-id="headerRestoreWorkspace"]', 10000)
      .click('*[data-id="headerRestoreWorkspace"]')
      .waitForElementContainsText('remix-tabs remix-tab.active', 'Restore Backup', 10000)
      .click('remix-tabs remix-tab#home')
      .click('*[data-id="headerWorkspaceDropdown"]')
      .waitForElementVisible('*[data-id="headerRestoreWorkspace"]', 10000)
      .click('*[data-id="headerRestoreWorkspace"]')
      .waitForElementContainsText('remix-tabs remix-tab.active', 'Restore Backup', 10000)
      .click('remix-tabs remix-tab#home')
      .clickLaunchIcon('solidity')
      .waitForElementVisible('*[data-id="quickStartCreateContract"]', 10000)
      .click('*[data-id="quickStartCreateContract"]')
      .assert.containsText('h6[data-id="sidePanelSwapitTitle"]', 'FILE EXPLORERS')
      .waitForElementVisible('*[data-id="fileExplorerNewFilecreateNewFile"]', 10000)
      .end()
  }
}
