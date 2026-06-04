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
import * as path from 'path'

const testData = {
  testFile1: path.resolve(__dirname + '/editor.spec.js'), // eslint-disable-line
  testFile2: path.resolve(__dirname + '/fileExplorer.test.js'), // eslint-disable-line
  testFile3: path.resolve(__dirname + '/generalSettings.test.js'), // eslint-disable-line
  restoreBackupZip: '/tmp/tronide-restore-e2e.zip'
}

module.exports = {

  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },

  'Should create a new file `5_New_contract.sol` in file explorer': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="remixIdeSidePanel"]')
      .clickLaunchIcon('filePanel')
      .assert.containsText('h6[data-id="sidePanelSwapitTitle"]', 'FILE EXPLORERS')
      .clickIfPresent('li[data-id="treeViewLitreeViewItemREADME.txt"]') // focus on root directory when present
      .click('*[data-id="fileExplorerNewFilecreateNewFile"]')
      .pause(1000)
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', '5_New_contract.sol')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItem5_New_contract.sol"]', 7000)
  },

  'Should rename `5_New_contract.sol` to 5_Renamed_Contract.sol': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="treeViewLitreeViewItem5_New_contract.sol"]')
      .click('*[data-id="treeViewLitreeViewItem5_New_contract.sol"]')
      .renamePath('5_New_contract.sol', '5_Renamed_Contract.sol', '5_Renamed_Contract.sol')
      .waitForElementVisible('*[data-id="treeViewLitreeViewItem5_Renamed_Contract.sol"]')
  },

  'Should delete file `5_Renamed_Contract.sol` from file explorer': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="treeViewLitreeViewItem5_Renamed_Contract.sol"]')
      .removeFile('5_Renamed_Contract.sol', 'default_workspace')
      .waitForElementNotPresent('*[data-id="treeViewLitreeViewItem5_Renamed_Contract.sol"]')
  },

  'Should create a new folder': function (browser: NightwatchBrowser) {
    browser
      .clickIfPresent('li[data-id="treeViewLitreeViewItemREADME.txt"]') // focus on root directory when present
      .click('[data-id="fileExplorerNewFilecreateNewFolder"]')
      .pause(1000)
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', 'Browser_Tests')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemBrowser_Tests"]')
  },

  'Should rename Browser_Tests folder to Browser_E2E_Tests': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemBrowser_Tests"]')
      .click('*[data-id="treeViewLitreeViewItemBrowser_Tests"]')
      .renamePath('Browser_Tests', 'Browser_E2E_Tests', 'Browser_E2E_Tests')
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemBrowser_E2E_Tests"]')
  },

  'Should delete Browser_E2E_Tests folder': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemBrowser_E2E_Tests"]')
      .rightClickElement('[data-path="Browser_E2E_Tests"]')
      .click('*[id="menuitemdelete"]')
      .waitForElementVisible('*[data-id="default_workspaceModalDialogContainer-react"]', 60000)
      .pause(2000)
      .click('*[data-id="default_workspaceModalDialogContainer-react"] .modal-ok')
      .waitForElementNotPresent('*[data-id="treeViewLitreeViewItemBrowser_E2E_Tests"]')
  },

  'Should copy file through context menu and preserve contents': function (browser: NightwatchBrowser) {
    const original = 'contract CopySource { function value () public pure returns (uint) { return 77; } }'

    browser
      .addFile('CopySource.sol', { content: original })
      .openFile('CopySource.sol')
      .testEditorValue(original)
      .rightClickElement('[data-path="CopySource.sol"]')
      .waitForElementVisible('#menuitemcopy')
      .click('#menuitemcopy')
      .pause(3000)
      .rightClickElement('[data-path="contracts"]')
      .waitForElementVisible('#menuitempaste')
      .click('#menuitempaste')
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemcontracts/Copy_CopySource.sol"]', 60000)
      .openFile('contracts/Copy_CopySource.sol')
      .testEditorValue(original)
  },

  'Should copy folder through context menu and preserve copied tree contents': function (browser: NightwatchBrowser) {
    const nestedContent = 'contract CopyNested { function nested () public pure returns (uint) { return 88; } }'

    browser
      .clickLaunchIcon('filePanel')
      .clickIfPresent('li[data-id="treeViewLitreeViewItemREADME.txt"]')
      .click('[data-id="fileExplorerNewFilecreateNewFolder"]')
      .pause(3000)
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', 'CopyFolder')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemCopyFolder"]')
      .click('[data-path="CopyFolder"]')
      .click('[data-id="fileExplorerNewFilecreateNewFile"]')
      .pause(3000)
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', 'Nested.sol')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemCopyFolder/Nested.sol"]', 60000)
      .setEditorValue(nestedContent)
      .pause(5500)
      .openFile('CopyFolder/Nested.sol')
      .testEditorValue(nestedContent)
      .rightClickElement('[data-path="CopyFolder"]')
      .waitForElementVisible('#menuitemcopy')
      .execute(function () {
        ;(document.querySelector('#menuitemcopy') as HTMLElement).click()
      })
      .pause(3000)
      .rightClickElement('[data-path="contracts"]')
      .waitForElementVisible('#menuitempaste')
      .execute(function () {
        ;(document.querySelector('#menuitempaste') as HTMLElement).click()
      })
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemcontracts/Copy_CopyFolder"]', 60000)
      .openFile('contracts/Copy_CopyFolder/Nested.sol')
      .testEditorValue(nestedContent)
  },

  'Should copy a large workspace folder and preserve representative files without mutating unrelated files': function (browser: NightwatchBrowser) {
    const files = Array.from({ length: 8 }, (_, index) => ({
      path: `LargeCopyFolder/File${index}.sol`,
      content: `contract LargeCopy${index} { function value () public pure returns (uint) { return ${index}; } }`
    }))
    const unrelated = 'contract LargeCopyUnrelated { function value () public pure returns (uint) { return 999; } }'

    browser
      .clickLaunchIcon('filePanel')
      .clickIfPresent('li[data-id="treeViewLitreeViewItemREADME.txt"]')
      .addFile('LargeCopyUnrelated.sol', { content: unrelated })
      .clickLaunchIcon('filePanel')
      .clickIfPresent('li[data-id="treeViewLitreeViewItemREADME.txt"]')
      .click('[data-id="fileExplorerNewFilecreateNewFolder"]')
      .pause(3000)
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', 'LargeCopyFolder')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemLargeCopyFolder"]', 60000)

    files.forEach((fixture) => {
      browser
        .click('[data-path="LargeCopyFolder"]')
        .click('[data-id="fileExplorerNewFilecreateNewFile"]')
        .pause(1000)
        .waitForElementVisible('*[data-id$="/blank"]')
        .sendKeys('*[data-id$="/blank"] .remixui_items', fixture.path.replace('LargeCopyFolder/', ''))
        .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
        .waitForElementVisible(`*[data-id="treeViewLitreeViewItem${fixture.path}"]`, 60000)
        .setEditorValue(fixture.content)
        .pause(1000)
    })

    browser
      .openFile(files[0].path)
      .testEditorValue(files[0].content)
      .openFile(files[files.length - 1].path)
      .testEditorValue(files[files.length - 1].content)
      .rightClickElement('[data-path="LargeCopyFolder"]')
      .waitForElementVisible('#menuitemcopy')
      .execute(function () {
        ;(document.querySelector('#menuitemcopy') as HTMLElement).click()
      })
      .pause(3000)
      .rightClickElement('[data-path="contracts"]')
      .waitForElementVisible('#menuitempaste')
      .execute(function () {
        ;(document.querySelector('#menuitempaste') as HTMLElement).click()
      })
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemcontracts/Copy_LargeCopyFolder"]', 60000)
      .openFile('contracts/Copy_LargeCopyFolder/File0.sol')
      .testEditorValue(files[0].content)
      .openFile(`contracts/Copy_LargeCopyFolder/File${files.length - 1}.sol`)
      .testEditorValue(files[files.length - 1].content)
      .openFile('LargeCopyUnrelated.sol')
      .testEditorValue(unrelated)
  },

  'Should document copy name collision behavior without silent data loss': function (browser: NightwatchBrowser) {
    const original = 'contract CollisionSource { function value () public pure returns (uint) { return 123; } }'

    browser
      .addFile('CollisionSource.sol', { content: original })
      .openFile('CollisionSource.sol')
      .testEditorValue(original)
      .rightClickElement('[data-path="CollisionSource.sol"]')
      .waitForElementVisible('#menuitemcopy')
      .click('#menuitemcopy')
      .pause(3000)
      .rightClickElement('[data-path="contracts"]')
      .waitForElementVisible('#menuitempaste')
      .click('#menuitempaste')
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemcontracts/Copy_CollisionSource.sol"]', 60000)
      .rightClickElement('[data-path="CollisionSource.sol"]')
      .waitForElementVisible('#menuitemcopy')
      .click('#menuitemcopy')
      .pause(3000)
      .rightClickElement('[data-path="contracts"]')
      .waitForElementVisible('#menuitempaste')
      .click('#menuitempaste')
      .pause(5000)
      .execute(function () {
        const paths = Array.from(document.querySelectorAll('[data-path]')).map((node) => node.getAttribute('data-path')).filter(Boolean) as string[]
        return paths.filter((path) => path.includes('CollisionSource.sol'))
      }, [], function (result) {
        const collisionPaths = result.value as string[]
        this.assert.ok(collisionPaths.includes('CollisionSource.sol'), `source remains after collision copy: ${JSON.stringify(collisionPaths)}`)
        this.assert.ok(collisionPaths.includes('contracts/Copy_CollisionSource.sol'), `first copy remains after collision copy: ${JSON.stringify(collisionPaths)}`)
        this.assert.equal(collisionPaths.filter((path) => path.startsWith('contracts/Copy_')).length, 1, `second paste did not create a distinct duplicate path: ${JSON.stringify(collisionPaths)}`)
      })
      .openFile('contracts/Copy_CollisionSource.sol')
      .testEditorValue(original)
      .openFile('CollisionSource.sol')
      .testEditorValue(original)
  },
  'Should publish all explorer files to github gist': '' + function (browser: NightwatchBrowser) {
    const runtimeBrowser = browser.options.desiredCapabilities.browserName

    browser.refresh()
      .pause(10000)
      .waitForElementVisible('*[data-id="fileExplorerNewFilepublishToGist"]')
      .click('*[data-id="fileExplorerNewFilepublishToGist"]')
      .waitForElementVisible('*[data-id="default_workspaceModalDialogContainer-react"]', 60000)
      .pause(2000)
      .click('*[data-id="default_workspaceModalDialogContainer-react"] .modal-ok')
      .pause(2000)
      .waitForElementVisible('*[data-id="default_workspaceModalDialogContainer-react"]', 60000)
      .pause(2000)
      .click('*[data-id="default_workspaceModalDialogContainer-react"] .modal-ok')
      .pause(2000)
      .perform((done) => {
        if (runtimeBrowser === 'chrome') {
          browser.switchBrowserTab(1)
            .assert.urlContains('https://gist.github.com')
            .switchBrowserTab(0)
        }
        done()
      })
  },

  'Should create TronIDE backup zip artifact from landing download workflow': function (browser: NightwatchBrowser) {
    browser
      .url(process.env.E2E_BASE_URL || 'http://127.0.0.1:8080')
      .pause(5000)
      .execute(function () {
        const skip = document.querySelector('[id="remixTourSkipbtn"]') as HTMLElement
        if (skip) skip.click()
        const modal = document.querySelector('#modal-dialog')
        if (modal && modal.parentElement) modal.parentElement.removeChild(modal)
        document.querySelectorAll('.modal-backdrop').forEach((el) => el.parentElement && el.parentElement.removeChild(el))
        const win = window as unknown as { __tronideBackupBlob?: Blob, __tronideBackupName?: string }
        win.__tronideBackupBlob = undefined
        win.__tronideBackupName = undefined
        const originalCreateObjectURL = URL.createObjectURL.bind(URL)
        URL.createObjectURL = function (blob: Blob) {
          win.__tronideBackupBlob = blob
          return originalCreateObjectURL(blob)
        }
        const originalDispatch = HTMLAnchorElement.prototype.dispatchEvent
        HTMLAnchorElement.prototype.dispatchEvent = function (event: Event) {
          if (this.download) win.__tronideBackupName = this.download
          return originalDispatch.call(this, event)
        }
      })
      .waitForElementVisible('*[data-id="landingPageHomeContainer"]', 60000)
      .execute(function () {
        const buttons = Array.from(document.querySelectorAll('button, a, u, span')) as HTMLElement[]
        const downloadButton = buttons.find((node) => /download all files/i.test(node.textContent || ''))
        if (downloadButton) downloadButton.click()
        return { clicked: !!downloadButton, labels: buttons.map((node) => (node.textContent || '').trim()).filter(Boolean).slice(0, 80) }
      }, [], function (result) {
        const value = result.value as { clicked: boolean, labels: string[] }
        this.assert.equal(value.clicked, true, `Download all files control is reachable: ${JSON.stringify(value.labels)}`)
      })
      .pause(5000)
      .execute(function () {
        const win = window as unknown as { __tronideBackupBlob?: Blob, __tronideBackupName?: string }
        return { name: win.__tronideBackupName, size: win.__tronideBackupBlob && win.__tronideBackupBlob.size }
      }, [], function (result) {
        const value = result.value as { name?: string, size?: number }
        this.assert.equal(value.name, 'tronideBackup.zip', `backup blob is generated: ${JSON.stringify(value)}`)
        this.assert.ok((value.size || 0) > 0, `backup blob has non-zero size before reading: ${JSON.stringify(value)}`)
      })
      .executeAsync(function (done) {
        const win = window as unknown as { __tronideBackupBlob?: Blob, __tronideBackupName?: string }
        if (!win.__tronideBackupBlob) return done({ hasBlob: false })
        const reader = new FileReader()
        reader.onload = function () {
          const bytes = Array.from(new Uint8Array(reader.result as ArrayBuffer).slice(0, 4))
          done({ hasBlob: true, name: win.__tronideBackupName, size: win.__tronideBackupBlob && win.__tronideBackupBlob.size, bytes })
        }
        reader.onerror = function () {
          done({ hasBlob: true, name: win.__tronideBackupName, error: reader.error && reader.error.message })
        }
        reader.readAsArrayBuffer(win.__tronideBackupBlob)
      }, [], function (result) {
        const value = result.value as { hasBlob: boolean, name?: string, size?: number, bytes?: number[], error?: string }
        this.assert.equal(value.hasBlob, true, `backup blob exists: ${JSON.stringify(value)}`)
        this.assert.equal(value.name, 'tronideBackup.zip', `backup filename: ${JSON.stringify(value)}`)
        this.assert.ok((value.size || 0) > 0, `backup zip has non-zero size: ${JSON.stringify(value)}`)
        this.assert.deepEqual(value.bytes, [80, 75, 3, 4], `backup artifact has ZIP header: ${JSON.stringify(value)}`)
      })
  },

  'Should import TronIDE backup zip workspace shell through Restore Backup Zip plugin': function (browser: NightwatchBrowser) {
    browser
      .clickLaunchIcon('pluginManager')
      .waitForElementVisible('*[data-id="pluginManagerComponentPluginManager"]')
      .clickIfPresent('*[data-id="pluginManagerComponentActivateButtonrestorebackupzip"]')
      .waitForElementVisible('[plugin="restorebackupzip"], #plugin-restorebackupzip', 60000)
      .execute(function () {
        const pluginIcon = document.querySelector('[plugin="restorebackupzip"]') as HTMLElement
        if (pluginIcon) pluginIcon.click()
      })
      .waitForElementVisible('iframe#plugin-restorebackupzip', 60000)
      .frame('plugin-restorebackupzip')
      .waitForElementVisible('#file-input', 60000)
      .setValue('#file-input', testData.restoreBackupZip)
      .waitForElementVisible('.importfile', 60000)
      .assert.containsText('#file-list', 'RestoreE2E')
      .perform(function (done) {
        browser.frameParent()
        done()
      })
      .execute(function () {
        const win = window as Window & { __restorePermissionAutoAccept?: number }
        if (win.__restorePermissionAutoAccept) window.clearInterval(win.__restorePermissionAutoAccept)
        win.__restorePermissionAutoAccept = window.setInterval(function () {
          const remember = document.querySelector('#remember') as HTMLInputElement
          if (remember && !remember.checked) remember.click()
          const ok = document.querySelector('#modal-footer-ok') as HTMLButtonElement
          if (ok && /Accept|OK/i.test(ok.innerText || ok.textContent || '')) ok.click()
        }, 100)
      })
      .frame('plugin-restorebackupzip')
      .click('.importfile')
      .waitForElementContainsText('#log-entry', 'imported contracts/Restored.sol', 60000)
      .waitForElementContainsText('#log-entry', 'imported README.txt', 60000)
      .perform(function (done) {
        browser.frameParent()
        done()
      })
      .execute(function () {
        const win = window as Window & { __restorePermissionAutoAccept?: number }
        if (win.__restorePermissionAutoAccept) window.clearInterval(win.__restorePermissionAutoAccept)
      })
      .clickLaunchIcon('filePanel')
      .waitForElementVisible('#workspacesSelect', 60000)
      .execute(function () {
        const select = document.querySelector('#workspacesSelect') as HTMLSelectElement
        const option = Array.from(select.options).find(option => option.textContent && option.textContent.includes('RestoreE2E'))
        const fs = (window as any).BrowserFS.BFSRequire('fs')
        const read = (path: string) => {
          try { return fs.readFileSync(path, 'utf8') } catch (error) { return String(error && error.message ? error.message : error) }
        }
        return {
          found: !!option,
          value: option && option.value,
          text: option && option.textContent,
          restoredSol: read('/.workspaces/RestoreE2E/contracts/Restored.sol'),
          restoredReadme: read('/.workspaces/RestoreE2E/README.txt')
        }
      }, [], function (result) {
        const value = result.value as { found: boolean, restoredSol: string, restoredReadme: string }
        this.assert.equal(value.found, true, 'restored workspace is listed')
        this.assert.equal(value.restoredSol, 'contract Restored { function value() public pure returns (uint) { return 12345; } }', 'restored Solidity file content matches backup')
        this.assert.equal(value.restoredReadme, 'restore backup e2e marker', 'restored README content matches backup')
      })
      .click('*[data-id="workspacesSelect"] option[value="RestoreE2E"]')
      .pause(5000)
      .execute(function () {
        return {
          currentWorkspace: (document.querySelector('#workspacesSelect') as HTMLSelectElement).value,
          paths: Array.from(document.querySelectorAll('[data-path]')).map((node) => node.getAttribute('data-path')).filter(Boolean)
        }
      }, [], function (result) {
        const value = result.value as { currentWorkspace: string, paths: string[] }
        this.assert.equal(value.currentWorkspace, 'RestoreE2E', 'RestoreE2E workspace is selected')
        this.assert.ok(value.paths.includes('contracts/Restored.sol'), `restored workspace rendered file explorer paths: ${JSON.stringify(value.paths)}`)
        this.assert.ok(value.paths.includes('README.txt'), `restored workspace rendered file explorer paths: ${JSON.stringify(value.paths)}`)
      })
  },

  'Should open local filesystem explorer': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('*[data-id="filePanelFileExplorerTree"]')
      .execute(function () {
        const uploadInput = document.querySelector('*[data-id="fileExplorerFileUpload"]') as HTMLElement
        uploadInput.style.display = 'block'
        uploadInput.style.visibility = 'visible'
        uploadInput.style.opacity = '1'
        uploadInput.style.width = '1px'
        uploadInput.style.height = '1px'
      })
      .setValue('*[data-id="fileExplorerFileUpload"]', testData.testFile1)
      .setValue('*[data-id="fileExplorerFileUpload"]', testData.testFile2)
      .setValue('*[data-id="fileExplorerFileUpload"]', testData.testFile3)
      .waitForElementVisible('[data-id="treeViewLitreeViewItemeditor.spec.js"]')
      .waitForElementVisible('[data-id="treeViewLitreeViewItemfileExplorer.test.js"]')
      .waitForElementVisible('[data-id="treeViewLitreeViewItemgeneralSettings.test.js"]')
      .end()
  }
}
