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

const passphrase = process.env.account_passphrase
const password = process.env.account_password

module.exports = {

  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },

  '@sources': function () {
    return sources
  },

  'Should load run and deploy tab': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="sidePanelSwapitTitle"]')
      .assert.containsText('*[data-id="sidePanelSwapitTitle"]', 'DEPLOY & RUN TRANSACTIONS')
  },

  'Should load run and deploy tab and check value validation': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .assert.containsText('*[data-id="sidePanelSwapitTitle"]', 'DEPLOY & RUN TRANSACTIONS')
      .validateValueInput('#value', '0000', '0')
      .validateValueInput('#value', '', '0')
      .validateValueInput('#value', 'dragon', '0')
  },

  'Should show insufficient TRX when value exceeds account balance': function (browser: NightwatchBrowser) {
    browser
      .clickLaunchIcon('udapp')
      .clearValue('#value')
      .setValue('#value', '1000001')
      .click('#unit option[data-unit="mwei"]')
      .execute(function () {
        const valueEl = document.querySelector('#value') as HTMLInputElement
        valueEl.dispatchEvent(new Event('change', { bubbles: true }))
      })
      .waitForElementContainsText('#valueError', 'Insufficient TRX', 10000)
  },

  'Should show no asset when trc10 value exceeds selected account balance': function (browser: NightwatchBrowser) {
    browser
      .clickLaunchIcon('udapp')
      .selectAccount('0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db')
      .clearValue('#tokenId')
      .setValue('#tokenId', '1000001')
      .clearValue('#tokenValue')
      .setValue('#tokenValue', '1')
      .execute(function () {
        const tokenValueEl = document.querySelector('#tokenValue') as HTMLInputElement
        tokenValueEl.dispatchEvent(new Event('change', { bubbles: true }))
      })
      .waitForElementContainsText('#tokenValueError', 'No asset', 10000)
  },

  'Should sign message using account key': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="settingsRemixRunSignMsg"]')
      .click('select[id="selectExEnvOptions"] option[value="vm-berlin"]')
      .pause(2000)
      .click('*[data-id="settingsRemixRunSignMsg"]')
      .pause(2000)
      .waitForElementPresent('*[data-id="modalDialogCustomPromptText"]')
      .setValue('*[data-id="modalDialogCustomPromptText"]', 'Remix is cool!')
      .assert.elementNotPresent('*[data-id="settingsRemixRunSignMsgHash"]')
      .assert.elementNotPresent('*[data-id="settingsRemixRunSignMsgSignature"]')
      .modalFooterOKClick()
      .waitForElementPresent('*[data-id="modalDialogContainer"]', 12000)
      .assert.elementPresent('*[data-id="settingsRemixRunSignMsgHash"]')
      .assert.elementPresent('*[data-id="settingsRemixRunSignMsgSignature"]')
      .modalFooterOKClick()
  },

  'Should deploy contract on JavascriptVM': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .clickLaunchIcon('filePanel')
      .addFile('Greet.sol', sources[0]['Greet.sol'])
      .clickLaunchIcon('udapp')
      .waitForElementNotVisible('i[title="No contract compiled yet or compilation failed. Please check the compile tab for more information."]', 10000)
      .assert.not.containsText('*[data-id="contractDropdownContainer"]', 'No contract compiled yet or compilation failed')
      .clickLaunchIcon('solidity')
      .waitForElementNotPresent('*[data-id="verticalIconsKindsolidity"] i[title="loading compiler..."]', 10000)
      .clickLaunchIcon('udapp')
      .selectAccount('0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c')
      .waitForElementPresent('*[data-id="Deploy - transact (not payable)"]', 45000)
      .click('*[data-id="Deploy - transact (not payable)"]')
      .pause(5000)
      .testFunction('last', {
        status: 'true Transaction mined and execution succeed'
      })
  },

  'Should run low level interaction (fallback function)': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .waitForElementPresent('*[data-id="universalDappUiTitleExpander"]')
      .click('*[data-id="universalDappUiTitleExpander"]')
      .waitForElementPresent('*[data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"]')
      .click('*[data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"]')
      .pause(5000)
      .testFunction('last', {
        status: 'true Transaction mined and execution succeed'
      })
      // When this is removed and tests are running by connecting to metamask
      // Consider adding tests to check return value of contract call
      // See: https://github.com/ethereum/remix-project/pull/1229
      .end()
  },

  'Should connect to Goerli Test Network using MetaMask': '' + function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .setupMetamask(passphrase, password)
      .click('.network-indicator__down-arrow')
      .useXpath().click("//span[text()='Goerli Test Network']")
      .useCss().switchBrowserTab(0)
      .refresh()
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .click('*[data-id="landingPageStartSolidity"]')
      .pause(5000)
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="settingsSelectEnvOptions"]')
      .click('*[data-id="settingsSelectEnvOptions"] option[id="injected-mode"]')
      .waitForElementPresent('*[data-id="settingsNetworkEnv"]')
      .assert.containsText('*[data-id="settingsNetworkEnv"]', 'Goerli (5) network')
      .switchBrowserTab(2)
      .waitForElementPresent('.page-container__footer-button:nth-of-type(2)')
      .click('.page-container__footer-button:nth-of-type(2)')
      .switchBrowserTab(0)
  },

  'Should deploy contract on Goerli Test Network using MetaMask': '' + function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="runTabSelectAccount"] option')
      .clickLaunchIcon('filePanel')
      .openFile('Greet.sol')
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="Deploy - transact (not payable)"]')
      .click('*[data-id="Deploy - transact (not payable)"]')
      .switchBrowserTab(2)
      .waitForElementPresent('.transaction-status--unapproved')
      .click('.transaction-status--unapproved')
      .waitForElementPresent('.page-container__footer-button:nth-of-type(2)')
      .click('.page-container__footer-button:nth-of-type(2)')
      .waitForElementPresent('.transaction-status--submitted')
      .pause(25000)
      .switchBrowserTab(0)
  },

  'Should run low level interaction (fallback function) on Goerli Test Network using MetaMask': '' + function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .waitForElementPresent('*[data-id="universalDappUiTitleExpander"]')
      .click('*[data-id="universalDappUiTitleExpander"]')
      .waitForElementPresent('*[data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"]')
      .click('*[data-id="pluginManagerSettingsDeployAndRunLLTxSendTransaction"]')
      .switchBrowserTab(2)
      .waitForElementPresent('.transaction-status--unapproved')
      .click('.transaction-status--unapproved')
      .waitForElementPresent('.page-container__footer-button:nth-of-type(2)')
      .click('.page-container__footer-button:nth-of-type(2)')
      .waitForElementPresent('.transaction-status--submitted')
      .pause(25000)
      .switchBrowserTab(0)
      .end()
  },

  'Should connect to Ethereum Main Network using MetaMask': '' + function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .switchBrowserTab(2)
      .waitForElementPresent('.network-indicator__down-arrow')
      .click('.network-indicator__down-arrow')
      .useXpath().click("//span[text()='Main Ethereum Network']")
      .useCss().switchBrowserTab(0)
      .refresh()
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .click('*[data-id="landingPageStartSolidity"]')
      .pause(5000)
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="settingsSelectEnvOptions"]')
      .click('*[data-id="settingsSelectEnvOptions"] option[id="injected-mode"]')
      .waitForElementPresent('*[data-id="settingsNetworkEnv"]')
      .assert.containsText('*[data-id="settingsNetworkEnv"]', 'Main (1) network')
  },

  'Should deploy contract on Ethereum Main Network using MetaMask': '' + function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="runTabSelectAccount"] option')
      .clickLaunchIcon('filePanel')
      .openFile('Greet.sol')
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="Deploy - transact (not payable)"]')
      .click('*[data-id="Deploy - transact (not payable)"]')
      .waitForElementPresent('*[data-id="modalDialogContainer"]', 15000)
      .pause(10000)
      .assert.containsText('*[data-id="modalDialogModalBody"]', 'You are creating a transaction on the main network. Click confirm if you are sure to continue.')
      .modalFooterCancelClick()
  },

  /*
   * This test is using 3 differents services:
   * - Metamask for getting the transaction
   * - Source Verifier service for fetching the contract code
   * - Ropsten node for retrieving the trace and storage
   *
   */
  'Should debug Ropsten transaction with source highlighting using the source verifier service and MetaMask': '' + function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .switchBrowserTab(2)
      .waitForElementPresent('.network-indicator__down-arrow')
      .click('.network-indicator__down-arrow')
      .useXpath().click("//span[text()='Ropsten Test Network']") // switch to Ropsten
      .useCss().switchBrowserTab(0)
      .refresh()
      .clickLaunchIcon('pluginManager') // load debugger and source verification
    // .scrollAndClick('#pluginManager article[id="remixPluginManagerListItem_source-verification"] button')
    // debugger already activated .scrollAndClick('#pluginManager article[id="remixPluginManagerListItem_debugger"] button')
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="settingsSelectEnvOptions"]')
      .click('*[data-id="settingsSelectEnvOptions"] option[id="injected-mode"]') // switch to Ropsten in udapp
      .waitForElementPresent('*[data-id="settingsNetworkEnv"]')
      .assert.containsText('*[data-id="settingsNetworkEnv"]', 'Ropsten (3) network')
      .clickLaunchIcon('debugger')
      .setValue('*[data-id="debuggerTransactionInput"]', '0x959371506b8f6223d71c709ac2eb2d0158104dca2d76ca949f1662712cf0e6db') // debug tx
      .click('*[data-id="debuggerTransactionStartButton"]')
      .waitForElementVisible('*[data-id="treeViewDivto"]', 30000)
      .assert.containsText('*[data-id="stepdetail"]', 'loaded address:\n0x3c943Fb816694d7D1f4C738e3e7823818a88DD6C')
      .assert.containsText('*[data-id="solidityLocals"]', 'to: 0x6C3CCC7FBA111707D5A1AAF2758E9D4F4AC5E7B1')
  },

  'Call web3.eth.getAccounts() using Injected web3 (Metamask)': '' + function (browser: NightwatchBrowser) {
    browser
      .executeTerminalScript('web3.eth.getAccounts()')
      .pause(2000)
      .journalLastChildIncludes('[ "0x76a3ABb5a12dcd603B52Ed22195dED17ee82708f" ]')
      .end()
  }
}

const sources = [
  {
    'Greet.sol': {
      content:
      `
      pragma solidity ^0.8.0;
      contract helloWorld {
          string public message;
          
          fallback () external {
              message = 'Hello World!';
          }
          
          function greet(string memory _message) public {
              message = _message;
          }
      }`
    }
  }
]
