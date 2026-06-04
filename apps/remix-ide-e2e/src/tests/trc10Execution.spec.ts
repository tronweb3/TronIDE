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

const trc10HolderAccount = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4'
const trc10RecipientAccount = '0x14723a09acff6d2a60dcdf7aa4aff308fddc160c'
const trc10TokenId = '1000001'
const trc10TokenAmount = '1'
const trc10TransferInput = `"${trc10RecipientAccount}",${trc10TokenId},${trc10TokenAmount}`

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },

  'Should deploy and transfer TRC10 in JavaScript VM (Tron)': function (browser: NightwatchBrowser) {
    let deployHash = ''

    browser
      .waitForElementPresent('*[data-id="remixIdeSidePanel"]')
      .openFile('contracts/4_Trc10.sol')
      .clickLaunchIcon('solidity')
      .waitForElementPresent('#compileTabView #versionSelector option[value="soljson-v0.8.6+commit.0e36fba0.js"]', 60000)
      .verifyContracts(['Trc10'])
      .clickLaunchIcon('udapp')
      .click('select[id="selectExEnvOptions"] option[value="vm-tron"]')
      .selectAccount(trc10HolderAccount)
      .selectContract('Trc10')
      .createContract('')
      .pause(2000)
      .testFunction('last', {
        status: 'true Transaction mined and execution succeed'
      })
      .getLastTransactionHash((hash) => {
        deployHash = hash
      })
      .perform((done) => {
        browser.execute(function (hash) {
          const txHashCell = document.querySelector(`*[data-id="txLoggerTableHash${hash}"]`)
          const contractAddressCell = document.querySelector(`*[data-id="txLoggerTableContractAddress${hash}"]`)
          const instanceTitle = Array.from(document.querySelectorAll('.instance [class^="title"]')).pop()

          return {
            txHashHref: txHashCell?.querySelector('a')?.getAttribute('href') || null,
            contractAddressHref: contractAddressCell?.querySelector('a')?.getAttribute('href') || null,
            instanceAddressHref: instanceTitle?.querySelector('a')?.getAttribute('href') || null
          }
        }, [deployHash], function (result) {
          const links = result.value as { txHashHref: string | null, contractAddressHref: string | null, instanceAddressHref: string | null }

          browser.assert.strictEqual(links.txHashHref, null, 'VM (Tron) tx logger transaction hash has no Tronscan link')
          browser.assert.strictEqual(links.contractAddressHref, null, 'VM (Tron) tx logger contract address has no Tronscan link')
          browser.assert.strictEqual(links.instanceAddressHref, null, 'VM (Tron) deployed contract instance address has no Tronscan link')
          done()
        })
      })
      .waitForElementPresent('.instance button[title="TransferTokenTo - transact (payable)"]', 60000)
      .execute(function () {
        const instance = Array.from(document.querySelectorAll('.instance')).pop() as HTMLElement
        if (instance && instance.className.includes('hidesub')) {
          (instance.querySelector('*[data-id="universalDappUiTitleExpander"]') as HTMLElement).click()
        }
      })
      .execute(function (tokenId, tokenValue) {
        const tokenIdEl = document.querySelector('*[data-id="dandrTokenId"]') as HTMLInputElement
        const tokenValueEl = document.querySelector('*[data-id="dandrTokenValue"]') as HTMLInputElement

        tokenIdEl.value = tokenId
        tokenValueEl.value = tokenValue
        tokenIdEl.dispatchEvent(new Event('input', { bubbles: true }))
        tokenIdEl.dispatchEvent(new Event('change', { bubbles: true }))
        tokenValueEl.dispatchEvent(new Event('input', { bubbles: true }))
        tokenValueEl.dispatchEvent(new Event('change', { bubbles: true }))
      }, [trc10TokenId, trc10TokenAmount])
      .execute(function () {
        const instance = Array.from(document.querySelectorAll('.instance')).pop() as HTMLElement
        const button = instance.querySelector('button[title="TransferTokenTo - transact (payable)"]') as HTMLElement
        const input = button.parentElement.querySelector('input') as HTMLInputElement
        input.setAttribute('data-id', 'trc10TransferInput')
        input.value = ''
      })
      .setValue('*[data-id="trc10TransferInput"]', trc10TransferInput)
      .click('*[data-id="TransferTokenTo - transact (payable)"]')
      .pause(2000)
      .perform((done) => {
        browser.waitUntil(function () {
          return new Promise((resolve) => {
            browser.getLastTransactionHash((hash) => resolve(hash && hash !== deployHash))
          })
        }, 60000, 1000).perform(() => done())
      })
      .perform((done) => {
        browser.getLastTransactionHash((hash) => {
          browser.testFunction(hash, {
            status: 'true Transaction mined and execution succeed',
            tokenId: trc10TokenId,
            tokenValue: trc10TokenAmount
          })
          done()
        })
      })
      .assert.not.elementPresent('*[data-id="modalDialogContainer"]')
      .notContainsText('body', 'Uncaught')
      .notContainsText('body', 'uncaught')
      .click('*[data-id="deployAndRunClearInstances"]')
      .end()
  }
}
