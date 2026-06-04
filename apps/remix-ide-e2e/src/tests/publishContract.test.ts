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
    init(browser, done)
  },

  '@sources': function () {
    return []
  },

  'Publish on IPFS': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('#icon-panel', 10000)
      .clickLaunchIcon('filePanel')
      .click('[data-id="treeViewLitreeViewItemcontracts"]')
      .openFile('contracts/3_Ballot.sol')
      .verifyContracts(['Ballot'])
      .click('#publishOnIpfs')
      .pause(8000)
      .waitForElementVisible('[data-id="publishToStorageModalDialogModalBody-react"]', 60000)
      .getText('[data-id="publishToStorageModalDialogModalBody-react"]', (result) => {
        const value = <string>(result.value)

        browser.perform((done) => {
          if (value.indexOf('Metadata of "ballot" was published successfully.') === -1) browser.assert.fail('ipfs deploy failed')
          done()
        })
      })
      .click('[data-id="publishToStorage-modal-footer-ok-react"]')
  },

  'Publish on Swarm': '' + function (browser: NightwatchBrowser) {
    browser
      .click('#publishOnSwarm')
      .pause(8000)
      .getText('[data-id="publishToStorageModalDialogModalBody-react"]', (result) => {
        const value = <string>(result.value)

        browser.perform((done) => {
          if (value.indexOf('Metadata of "ballot" was published successfully.') === -1) browser.assert.fail('swarm deploy failed')
          if (value.indexOf('bzz') === -1) browser.assert.fail('swarm deploy failed')
          done()
        })
      })
      .click('[data-id="publishToStorage-modal-footer-ok-react"]')
  },

  'Should publish contract metadata to ipfs on deploy': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('#icon-panel')
      .clickLaunchIcon('filePanel')
      .openFile('contracts/1_Storage.sol')
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="contractDropdownIpfsCheckbox"]')
      .click('*[data-id="contractDropdownIpfsCheckbox"]')
      .waitForElementVisible('*[data-id="Deploy - transact (not payable)"]')
      .click('*[data-id="Deploy - transact (not payable)"]')
      .pause(8000)
      .getModalBody((value, done) => {
        if (value.indexOf('Metadata of "storage" was published successfully.') === -1) browser.assert.fail('ipfs deploy failed')
        done()
      })
      .modalFooterOKClick()
  },

  'Should remember choice after page refresh': function (browser: NightwatchBrowser) {
    browser
      .refresh()
      .waitForElementVisible('[data-id="treeViewLitreeViewItemcontracts"]')
      .click('[data-id="treeViewLitreeViewItemcontracts"]')
      .openFile('contracts/1_Storage.sol')
      .clickLaunchIcon('udapp')
      .waitForElementPresent('*[data-id="contractDropdownIpfsCheckbox"]')
      .verify.elementPresent('*[data-id="contractDropdownIpfsCheckbox"]:checked')
      .end()
  }
}
