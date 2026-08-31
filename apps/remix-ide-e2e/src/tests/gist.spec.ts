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

const testData = {
  validGistId: '02a847917a6a7ecaf4a7e0d4e68715bf',
  invalidGistId: '6368b389f9302v32902msk2402'
}
// 99266d6da54cc12f37f11586e8171546c7700d67

function openLoadGistPrompt (browser: NightwatchBrowser): NightwatchBrowser {
  // executeTerminalScript sends Enter twice; use the real single-Enter user
  // path so the prompt remains open for validation.
  return browser
    .clearEditableContent('*[data-id="terminalCliInput"]')
    .click('*[data-id="terminalCli"]')
    .sendKeys('*[data-id="terminalCliInput"]', "remix.loadgist('')")
    .sendKeys('*[data-id="terminalCliInput"]', browser.Keys.ENTER)
}

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },
  UploadToGists: function (browser: NightwatchBrowser) {
    /*
       - set the access token
       - publish to gist
       - retrieve the gist
       - switch to a file in the new gist
      */
    const gistid = '17ac9315bc065a3d95cf8dc1b28d71f8'
    browser
      // A fresh default workspace no longer guarantees README.txt. Create an
      // explicit root file so folder creation has a deterministic root anchor.
      .addFile('README.txt', { content: '# Gist browser test root' })
      .waitForElementVisible('li[data-id="treeViewLitreeViewItemREADME.txt"]')
      .refresh()
      .pause(10000)
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .click('li[data-id="treeViewLitreeViewItemREADME.txt"]') // focus on root directory
      .waitForElementVisible('*[data-id="fileExplorerNewFilecreateNewFolder"]')
      .click('[data-id="fileExplorerNewFilecreateNewFolder"]')
      .pause(1000)
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', 'Browser_Tests')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemBrowser_Tests"]')
      // The new folder remains focused, so create the file directly inside it.
      // Tree item data-id values use the full workspace-relative path.
      .click('[data-id="fileExplorerNewFilecreateNewFile"]')
      .waitForElementVisible('*[data-id$="/blank"]')
      .sendKeys('*[data-id$="/blank"] .remixui_items', 'File.sol')
      .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemBrowser_Tests/File.sol"]', 60000)
      .executeTerminalScript(`remix.loadgist('${gistid}')`)
      // .perform((done) => { if (runtimeBrowser === 'chrome') { browser.openFile('gists') } done() })
      .waitForElementVisible(`[data-id="treeViewLitreeViewItem/gist-${gistid}"]`, 60000)
      .click(`[data-id="treeViewLitreeViewItem/gist-${gistid}"]`)
      .openFile(`gist-${gistid}/README.txt`)
      // Remix publish to gist
      /* .click('*[data-id="fileExplorerNewFilepublishToGist"]')
         .pause(2000)
         .waitForElementVisible('*[data-id="default_workspaceModalDialogContainer-react"]')
         .click('*[data-id="default_workspaceModalDialogContainer-react"] .modal-ok')
         .pause(10000)
         .getText('[data-id="default_workspaceModalDialogModalBody-react"]', (result) => {
        console.log(result)
        const value = typeof result.value === 'string' ? result.value : null
        const reg = /gist.github.com\/([^.]+)/
        const id = value.match(reg)

        console.log('gist regex', id)
        if (!id) {
          browser.assert.fail('cannot get the gist id', '', '')
        } else {
          const gistid = id[1]
          browser
            .click('[data-id="default_workspace-modal-footer-cancel-react"]')
            .executeTerminalScript(`remix.loadgist('${gistid}')`)
            // .perform((done) => { if (runtimeBrowser === 'chrome') { browser.openFile('gists') } done() })
            .waitForElementVisible(`[data-id="treeViewLitreeViewItem/gist-${gistid}"]`)
            .click(`[data-id="treeViewLitreeViewItem/gist-${gistid}"]`)
            .openFile(`gist-${gistid}/README.txt`)
        }
      })
      */
  },

  'Load Gist Modal': function (browser: NightwatchBrowser) {
    // Gist import remains supported through the Terminal API. Calling it
    // with an empty ID opens the same GistHandler prompt used by the old Home UI.
    openLoadGistPrompt(browser)
      .waitForElementVisible('*[data-id="modalDialogModalTitle"]')
      .assert.textContains('*[data-id="modalDialogModalTitle"]', 'Load a Gist')
      .waitForElementVisible('*[data-id="modalDialogModalBody"]')
      .assert.textContains('*[data-id="modalDialogModalBody"]', 'Enter the ID of the Gist or URL you would like to load.')
      .waitForElementVisible('*[data-id="modalDialogCustomPromptText"]')
      .modalFooterCancelClick()
  },

  'Display Error Message For Invalid Gist ID': function (browser: NightwatchBrowser) {
    openLoadGistPrompt(browser)
      .waitForElementVisible('*[data-id="modalDialogCustomPromptText"]')
      .setValue('*[data-id="modalDialogCustomPromptText"]', testData.invalidGistId)
      .modalFooterOKClick()
      .waitForElementVisible('*[data-id="modalDialogModalTitle"]')
      .assert.textContains('*[data-id="modalDialogModalTitle"]', 'Gist load error')
      .waitForElementVisible('*[data-id="modalDialogModalBody"]')
      .assert.textContains('*[data-id="modalDialogModalBody"]', 'Please provide a valid Gist ID or URL.')
      .modalFooterOKClick()
  },

  // The Settings gist-token panel is retired: with no in-memory GitHub
  // connection, publishing must point the user at the Connect GitHub flow.
  'Display Error Message For Missing GitHub Connection When Publishing': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="remixIdeIconPanel"]', 10000)
      .clickLaunchIcon('filePanel')
      .waitForElementVisible('*[data-id="fileExplorerNewFilepublishToGist"]')
      .click('*[data-id="fileExplorerNewFilepublishToGist"]')
      .waitForElementVisible('*[data-id="default_workspaceModalDialogContainer-react"]')
      .pause(2000)
      .click('*[data-id="default_workspaceModalDialogContainer-react"] .modal-ok')
      .pause(10000)
      .getText('[data-id="default_workspaceModalDialogModalBody-react"]', (result) => {
        browser.assert.ok(result.value === 'Publishing a gist needs a GitHub connection that can create gists. Use "Connect GitHub" on the Home page (or the header button) to sign in, then publish again.', 'Assert failed. Gist connect-GitHub error message not displayed.')
      })
      .click('[data-id="default_workspace-modal-footer-ok-react"]')
  },

  'Import From Gist For Valid Gist ID': function (browser: NightwatchBrowser) {
    // Public gists load anonymously — the Settings gist-token panel is retired.
    openLoadGistPrompt(browser)
      .waitForElementVisible('*[data-id="modalDialogCustomPromptText"]')
      .setValue('*[data-id="modalDialogCustomPromptText"]', testData.validGistId)
      .modalFooterOKClick()
      .waitForElementVisible(`[data-id="treeViewLitreeViewItem/gist-${testData.validGistId}"]`, 60000)
      .click(`[data-id="treeViewLitreeViewItem/gist-${testData.validGistId}"]`)
      .openFile(`gist-${testData.validGistId}/README.txt`)
      .waitForElementVisible(`div[title='default_workspace/gist-${testData.validGistId}/README.txt']`)
      .assert.textContains(`div[title='default_workspace/gist-${testData.validGistId}/README.txt'] > span`, 'README.txt')
      .end()
  }
}
