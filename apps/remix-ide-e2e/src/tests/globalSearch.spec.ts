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
  beforeEach: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done, undefined, false)
  },

  after: function (browser: NightwatchBrowser) {
    browser.end()
  },

  'Searches the default workspace and opens a result': function (browser: NightwatchBrowser) {
    browser
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .setValue('*[data-id="globalSearchInput"]', 'Storage')
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', 'results', 10000)
      .waitForElementVisible('*[data-id="globalSearchResultItem"]', 10000)
      .assert.containsText('*[data-id="globalSearchPanel"]', 'contracts/1_Storage.sol')
      .click('*[data-id="globalSearchResultItem"]')
      .waitForElementVisible('*[data-id="editorInput"]', 10000)
  },

  'Replaces matches and undoes the last replace': function (browser: NightwatchBrowser) {
    const original = 'contract SearchReplaceUndo { string public value = "TRONIDE_UNDO_TOKEN"; }'
    const replaced = 'contract SearchReplaceUndo { string public value = "TRONIDE_REPLACED_TOKEN"; }'

    browser
      .addFile('SearchReplaceUndo.sol', { content: original })
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .setValue('*[data-id="globalSearchInput"]', 'TRONIDE_UNDO_TOKEN')
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', 'results', 10000)
      .click('*[data-id="globalSearchToggleReplace"]')
      .waitForElementVisible('*[data-id="globalSearchReplaceInput"]', 10000)
      .setValue('*[data-id="globalSearchReplaceInput"]', 'TRONIDE_REPLACED_TOKEN')
      .waitForElementContainsText('*[data-id="globalSearchReplaceMeta"]', '1 matches in 1 files', 10000)
      .execute(function () { window.confirm = function () { return true } })
      .click('*[data-id="globalSearchApplyReplace"]')
      .pause(2000)
      .openFile('SearchReplaceUndo.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, replaced)
      })
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchUndoReplace"]', 10000)
      .click('*[data-id="globalSearchUndoReplace"]')
      .pause(2000)
      .openFile('SearchReplaceUndo.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, original)
      })
  },

  'Does not write when replace confirmation is cancelled': function (browser: NightwatchBrowser) {
    const original = 'contract SearchReplaceCancel { string public value = "TRONIDE_CANCEL_TOKEN"; }'

    browser
      .addFile('SearchReplaceCancel.sol', { content: original })
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .setValue('*[data-id="globalSearchInput"]', 'TRONIDE_CANCEL_TOKEN')
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', 'results', 10000)
      .click('*[data-id="globalSearchToggleReplace"]')
      .waitForElementVisible('*[data-id="globalSearchReplaceInput"]', 10000)
      .setValue('*[data-id="globalSearchReplaceInput"]', 'TRONIDE_CANCEL_REPLACED')
      .waitForElementContainsText('*[data-id="globalSearchReplaceMeta"]', '1 matches in 1 files', 10000)
      .execute(function () { window.confirm = function () { return false } })
      .click('*[data-id="globalSearchApplyReplace"]')
      .pause(1000)
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', 'results', 10000)
      .waitForElementContainsText('*[data-id="globalSearchReplaceMeta"]', '1 matches in 1 files', 10000)
      .assert.elementPresent('*[data-id="globalSearchApplyReplace"]')
      .openFile('SearchReplaceCancel.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, original)
      })
  },

  'Searches with a regular expression and opens the expected match': function (browser: NightwatchBrowser) {
    const original = 'contract SearchRegexOnly { function tronideRegexGamma() public {} function unrelatedGamma() public {} }'

    browser
      .addFile('SearchRegexOnly.sol', { content: original })
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .setValue('*[data-id="globalSearchInput"]', 'tronideRegexGamma')
      .execute(function () {
        const button = document.querySelector('button[title="Use Regular Expression"]') as HTMLButtonElement
        if (button) button.click()
      })
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', '1 results in 1 files', 10000)
      .assert.containsText('*[data-id="globalSearchPanel"]', 'SearchRegexOnly.sol')
      .assert.containsText('*[data-id="globalSearchPanel"]', 'tronideRegexGamma')
      .click('*[data-id="globalSearchResultItem"]')
      .waitForElementVisible('*[data-id="editorInput"]', 10000)
      .getEditorValue((content) => {
        browser.assert.equal(content, original)
      })
  },

  'Replaces regular expression matches from the global search panel': function (browser: NightwatchBrowser) {
    const original = 'contract SearchReplaceRegex { function regexReplaceUniqueAlpha() public {} function regexReplaceUniqueBeta() public {} }'
    const replaced = 'contract SearchReplaceRegex { function replacedAlpha() public {} function replacedBeta() public {} }'

    browser
      .addFile('SearchReplaceRegex.sol', { content: original })
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .execute(function () {
        const button = document.querySelector('button[title="Use Regular Expression"]') as HTMLButtonElement
        if (button && button.getAttribute('aria-pressed') !== 'true') button.click()
      })
      .setValue('*[data-id="globalSearchInput"]', 'regexReplaceUnique')
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', 'results', 10000)
      .click('*[data-id="globalSearchToggleReplace"]')
      .waitForElementVisible('*[data-id="globalSearchReplaceInput"]', 10000)
      .pause(500)
      .setValue('*[data-id="globalSearchReplaceInput"]', 'replaced')
      .pause(500)
      .waitForElementContainsText('*[data-id="globalSearchReplaceMeta"]', '2 matches in 1 files', 10000)
      .execute(function () { window.confirm = function () { return true } })
      .click('*[data-id="globalSearchApplyReplace"]')
      .pause(2000)
      .openFile('SearchReplaceRegex.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, replaced)
      })
  },

  'Replaces regular expression capture groups from the global search panel': function (browser: NightwatchBrowser) {
    const original = 'contract SearchReplaceCapture { function captureAlpha() public {} function captureBeta() public {} }'
    const replaced = 'contract SearchReplaceCapture { function renamedAlpha() public {} function renamedBeta() public {} }'

    browser
      .addFile('SearchReplaceCapture.sol', { content: original })
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .execute(function () {
        const button = document.querySelector('button[title="Use Regular Expression"]') as HTMLButtonElement
        if (button && button.getAttribute('aria-pressed') !== 'true') button.click()
      })
      .setValue('*[data-id="globalSearchInput"]', 'capture(Alpha|Beta)')
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', '2 results in 1 files', 10000)
      .click('*[data-id="globalSearchToggleReplace"]')
      .waitForElementVisible('*[data-id="globalSearchReplaceInput"]', 10000)
      .setValue('*[data-id="globalSearchReplaceInput"]', 'renamed$1')
      .waitForElementContainsText('*[data-id="globalSearchReplaceMeta"]', '2 matches in 1 files', 10000)
      .execute(function () { window.confirm = function () { return true } })
      .click('*[data-id="globalSearchApplyReplace"]')
      .pause(2000)
      .openFile('SearchReplaceCapture.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, replaced)
      })
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchUndoReplace"]', 10000)
      .click('*[data-id="globalSearchUndoReplace"]')
      .pause(2000)
      .openFile('SearchReplaceCapture.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, original)
      })
  },

  'Reports invalid regular expressions without changing files': function (browser: NightwatchBrowser) {
    const original = 'contract SearchInvalidRegex { string public value = "TRONIDE_INVALID_REGEX_TOKEN"; }'

    browser
      .addFile('SearchInvalidRegex.sol', { content: original })
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .execute(function () {
        const button = document.querySelector('button[title="Use Regular Expression"]') as HTMLButtonElement
        if (button && button.getAttribute('aria-pressed') !== 'true') button.click()
      })
      .setValue('*[data-id="globalSearchInput"]', '[')
      .waitForElementContainsText('*[data-id="globalSearchPanel"]', 'Regex error', 10000)
      .waitForElementContainsText('*[data-id="globalSearchPanel"]', 'Invalid regular expression', 10000)
      .assert.not.containsText('*[data-id="globalSearchPanel"]', 'TRONIDE_INVALID_REGEX_TOKEN')
      .openFile('SearchInvalidRegex.sol')
      .getEditorValue((content) => {
        browser.assert.equal(content, original)
      })
  },

  'Replaces intended matches in a large workspace without touching unrelated files': function (browser: NightwatchBrowser) {
    const matchingFiles = Array.from({ length: 12 }, (_, index) => `LargeSearchMatch${index}.sol`)
    const nonMatchingFile = 'LargeSearchNoMatch.sol'
    const matchingContent = 'contract LargeSearchMatch { string public value = "TRONIDE_LARGE_TOKEN"; }'
    const replacedContent = 'contract LargeSearchMatch { string public value = "TRONIDE_LARGE_REPLACED"; }'
    const nonMatchingContent = 'contract LargeSearchNoMatch { string public value = "TRONIDE_OTHER_TOKEN"; }'

    for (const file of matchingFiles) {
      browser.addFile(file, { content: matchingContent })
    }
    browser.addFile(nonMatchingFile, { content: nonMatchingContent })

    browser
      .waitForElementVisible('*[data-id="verticalIconsKindglobalSearch"]', 10000)
      .click('*[data-id="verticalIconsKindglobalSearch"]')
      .waitForElementVisible('*[data-id="globalSearchInput"]', 10000)
      .clearValue('*[data-id="globalSearchInput"]')
      .setValue('*[data-id="globalSearchInput"]', 'TRONIDE_LARGE_TOKEN')
      .waitForElementContainsText('*[data-id="globalSearchMeta"]', '12 results', 10000)
      .click('*[data-id="globalSearchToggleReplace"]')
      .waitForElementVisible('*[data-id="globalSearchReplaceInput"]', 10000)
      .setValue('*[data-id="globalSearchReplaceInput"]', 'TRONIDE_LARGE_REPLACED')
      .waitForElementContainsText('*[data-id="globalSearchReplaceMeta"]', '12 matches in 12 files', 10000)
      .execute(function () { window.confirm = function () { return true } })
      .click('*[data-id="globalSearchApplyReplace"]')
      .pause(3000)
      .openFile(matchingFiles[0])
      .getEditorValue((content) => {
        browser.assert.equal(content, replacedContent)
      })
      .openFile(matchingFiles[matchingFiles.length - 1])
      .getEditorValue((content) => {
        browser.assert.equal(content, replacedContent)
      })
      .openFile(nonMatchingFile)
      .getEditorValue((content) => {
        browser.assert.equal(content, nonMatchingContent)
      })
  }
}
