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

class VerifyContracts extends EventEmitter {
  command (this: NightwatchBrowser, compiledContractNames: string[], opts = { wait: 1000, version: null }): NightwatchBrowser {
    this.api.perform((done) => {
      verifyContracts(this.api, compiledContractNames, opts, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function verifyContracts (browser: NightwatchBrowser, compiledContractNames: string[], opts: { wait: number, version?: string }, callback: VoidFunction) {
  browser
    .clickLaunchIcon('solidity')
    .waitForElementVisible('*[data-id="compilerContainerCompileBtn"]', 60000)
    .execute(function () {
      const compileButton = document.querySelector('[data-id="compilerContainerCompileBtn"]') as HTMLButtonElement
      const title = (compileButton && compileButton.textContent) || ''
      const selectedFile = title.replace(/^\s*Compile\s*/, '').trim()
      return { disabled: Boolean(compileButton && compileButton.disabled), selectedFile }
    }, [], (result) => {
      const value = result && result.value as { disabled?: boolean, selectedFile?: string }
      if (value && value.disabled && value.selectedFile === '<no file selected>') {
        browser.clickLaunchIcon('filePanel')
          .execute(function () {
            const selected = document.querySelector('.remixui_selected, .active[data-id^="treeViewLitreeViewItem"], li[data-id^="treeViewLitreeViewItem"]:focus') as HTMLElement
            selected?.click()
          })
          .pause(1000)
          .clickLaunchIcon('solidity')
      }
    })
    .waitForElementVisible('*[data-id="compilerContainerCompileBtn"]:not([disabled])', 60000)
    .execute(function () {
      const compileButton = document.querySelector('[data-id="compilerContainerCompileBtn"]') as HTMLElement
      compileButton.click()
    })
    .pause(opts.wait)
    .perform((done) => {
      browser.waitUntil(function () {
        return new Promise((resolve) => {
          browser.execute(function () {
            document.querySelector('#webpack-dev-server-client-overlay')?.remove()

            const compileTab = document.querySelector('#compileTabView') as HTMLElement
            if (compileTab && compileTab.children.length === 0) {
              const recover = (compileTab as HTMLElement & { remixEnsureRendered?: () => void }).remixEnsureRendered
              if (recover) recover()
            }

            const hasContracts = document.querySelectorAll('[data-id="compiledContracts"] option').length > 0
            if (hasContracts) return true

            const compileButton = document.querySelector('[data-id="compilerContainerCompileBtn"]') as HTMLButtonElement
            if (compileButton && !compileButton.disabled) compileButton.click()
            return false
          }, [], (result) => resolve(Boolean(result && result.value)))
        })
      }, 60000, 1000).perform(() => done())
    })
    .waitForElementPresent('*[data-id="compiledContracts"] option', 1000)
    .perform((done) => {
      if (opts.version) {
        browser
          .click('*[data-id="compilation-details"]')
          .waitForElementVisible('*[data-id="remixui_treeviewitem_metadata"]')
          .pause(2000)
          .click('*[data-id="remixui_treeviewitem_metadata"]')
          .waitForElementVisible('*[data-id="treeViewDivtreeViewItemcompiler"]')
          .pause(2000)
          .click('*[data-id="treeViewDivtreeViewItemcompiler"]')
          .waitForElementVisible('*[data-id="treeViewLiversion"]')
          .assert.containsText('*[data-id="treeViewLiversion"]', `${opts.version}`)
          .click('[data-id="workspacesModalDialog-modal-footer-ok-react"]')
          .perform(() => {
            done()
            callback()
          })
      } else {
        compiledContractNames.forEach((name) => {
          browser.waitForElementPresent(`[data-id="compiledContracts"] option[value="${name}"]`, 60000)
        })
        browser.perform(() => {
          done()
          callback()
        })
      }
    })
}

module.exports = VerifyContracts
