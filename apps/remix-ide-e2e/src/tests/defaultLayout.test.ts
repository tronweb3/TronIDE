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
    init(browser, done, 'http://127.0.0.1:8080', false)
  },

  'Loads Icon\'s Panel': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="remixIdeIconPanel"]', 10000)
      .waitForElementVisible('div[data-id="verticalIconsHomeIcon"]')
      .waitForElementVisible('div[plugin="filePanel"]')
      .waitForElementVisible('div[plugin="pluginManager"]')
      .waitForElementVisible('div[plugin="settings"]')
  },

  'Loads Side Panel': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="remixIdeSidePanel"]')
      .assert.containsText('h6[data-id="sidePanelSwapitTitle"]', 'FILE EXPLORERS')
      .waitForElementVisible('div[data-id="filePanelFileExplorerTree"]')
      .waitForElementVisible('[data-id="treeViewLitreeViewItemcontracts"]')
      .waitForElementVisible('[data-id="treeViewLitreeViewItemscripts"]')
      .waitForElementVisible('[data-id="treeViewLitreeViewItemtests"]')
      .waitForElementVisible('[data-id="treeViewLitreeViewItemREADME.txt"]')
  },

  'Loads Main View': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="mainPanelPluginsContainer"]')
      .waitForElementVisible('div[data-id="landingPageHomeContainer"]')
      .waitForElementVisible('div[data-id="landingRemix220Shell"]')
      .waitForElementVisible('div[data-id="landingProductTopBar"]')
      .waitForElementVisible('main[data-id="landingRemix220Main"]')
      .waitForElementVisible('aside[data-id="landingRemix220RightRail"]')
      .waitForElementVisible('div[data-id="landingBottomStatusBar"]')
      .waitForElementVisible('div[data-id="landingPageHpSections"]')
      .waitForElementVisible('div[data-id="terminalContainer"]')
  },

  'Loads terminal': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('div[data-id="terminalCli"]', 10000)
      .journalLastChildIncludes('Welcome to Tron IDE')
  },

  'Toggles Side Panel': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="remixIdeSidePanel"]')
      .assert.containsText('h6[data-id="sidePanelSwapitTitle"]', 'FILE EXPLORERS')
      .clickLaunchIcon('filePanel')
      .assert.hidden('div[data-id="remixIdeSidePanel"]')
      .clickLaunchIcon('filePanel')
      .assert.visible('div[data-id="remixIdeSidePanel"]')
      .assert.containsText('h6[data-id="sidePanelSwapitTitle"]', 'FILE EXPLORERS')
  },

  'Toggles Terminal': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="terminalContainer"]')
      .assert.visible('div[data-id="terminalContainerDisplay"]')
      .click('i[data-id="terminalToggleIcon"]')
      .checkElementStyle('div[data-id="terminalToggleMenu"]', 'height', '35px')
      .click('i[data-id="terminalToggleIcon"]')
      .assert.visible('div[data-id="terminalContainerDisplay"]')
  },

  'Toggles AI Panel without reserving right-side layout space': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('#ai-panel', 10000)
      .execute(function () {
        const aiPanel = document.querySelector('#ai-panel') as HTMLElement
        const closeButton = document.querySelector('#ai-panel .close-btn') as HTMLElement
        const beforeWidth = aiPanel ? aiPanel.getBoundingClientRect().width : 0
        closeButton?.click()
        return { beforeWidth }
      }, [], (result) => {
        browser.assert.ok((result.value as { beforeWidth: number }).beforeWidth > 0, 'AI panel is initially visible')
      })
      .perform((done) => {
        browser.waitUntil(function () {
          return new Promise((resolve) => {
            browser.execute(function () {
              const aiPanel = document.querySelector('#ai-panel') as HTMLElement
              return Boolean(aiPanel && window.getComputedStyle(aiPanel).display === 'none' && aiPanel.getBoundingClientRect().width === 0)
            }, [], (result) => resolve(Boolean(result && result.value)))
          })
        }, 10000, 250).perform(() => done())
      })
      .waitForElementVisible('.ai-show-btn', 10000)
  },

  'Switch Tabs using tabs icon': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('div[data-id="filePanelFileExplorerTree"]')
      .click('[data-id="treeViewLitreeViewItemcontracts"]')
      .openFile('contracts/3_Ballot.sol')
      .assert.containsText('div[title="default_workspace/contracts/3_Ballot.sol"]', '3_Ballot.sol')
      .click('span[class^=dropdownCaret]')
      .click('#homeItem')
      .assert.containsText('div[title="home"]', 'Home')
      .end()
  }
}
