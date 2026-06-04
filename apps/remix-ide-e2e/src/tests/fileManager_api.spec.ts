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

  'Should execute `file` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('file.js', { content: executeFile })
      .executeTerminalScript('remix.exeCurrent()')
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'file.js', 60000)
  },

  'Should execute `exists` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('exists.js', { content: executeExists })
      .executeTerminalScript('remix.exeCurrent()')
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'exists.js true', 60000)
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'non-exists.js false', 60000)
  },

  'Should execute `open` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('open.js', { content: executeOpen })
      .executeTerminalScript('remix.exeCurrent()')
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'contracts/3_Ballot.sol', 60000)
  },

  'Should execute `writeFile` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('writeFile.js', { content: executeWriteFile })
      .executeTerminalScript('remix.exeCurrent()')
      .pause(2000)
      .openFile('new_contract.sol')
      .assert.containsText('[data-id="editorInput"]', 'pragma solidity ^0.6.0')
  },

  'Should execute `readFile` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('readFile.js', { content: executeReadFile })
      .executeTerminalScript('remix.exeCurrent()')
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'pragma solidity ^0.6.0', 60000)
  },

  'Should execute `copyFile` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('copyFile.js', { content: executeCopyFile })
      .executeTerminalScript('remix.exeCurrent()')
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'pragma solidity >=0.7.0 <0.9.0;', 60000)
  },

  'Should execute `rename` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('renameFile.js', { content: executeRename })
      .executeTerminalScript('remix.exeCurrent()')
      .pause(2000)
      .waitForElementPresent('[data-id="treeViewLitreeViewItemold_contract.sol"]', 60000)
  },

  'Should execute `mkdir` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('mkdirFile.js', { content: executeMkdir })
      .executeTerminalScript('remix.exeCurrent()')
      .pause(2000)
      .waitForElementPresent('[data-id="treeViewLitreeViewItemTest_Folder"]', 60000)
  },

  'Should execute `readdir` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('readdirFile.js', { content: executeReaddir })
      .executeTerminalScript('remix.exeCurrent()')
      .waitForElementContainsText('*[data-id="terminalJournal"]', 'Test_Folder isDirectory true', 60000)
  },

  'Should execute `remove` api from file manager external api': function (browser: NightwatchBrowser) {
    browser
      .addFile('removeFile.js', { content: executeRemove })
      .executeTerminalScript('remix.exeCurrent()')
      .pause(2000)
      .waitForElementNotPresent('[data-id="treeViewLitreeViewItemold_contract.sol"]', 60000)
  },

  // TODO: Fix remove root directory prefix for browser and localhost
  'Should execute `remove` api from file manager external api on a folder': function (browser: NightwatchBrowser) {
    browser
      .addFile('test_jsRemoveFolder.js', { content: executeRemoveOnFolder })
      .executeTerminalScript('remix.exeCurrent()')
      .pause(2000)
      .waitForElementNotPresent('[data-id="treeViewLitreeViewItemTest_Folder"]', 60000)
      .end()
  }
}

const executeFile = `
  const run = async () => {
    const result = await remix.call('fileManager', 'file')

    console.log(result)
  }

  run()
`

const executeExists = `
  const run = async () => {
    const result1 = await remix.call('fileManager', 'exists', 'exists.js')
    const result2 = await remix.call('fileManager', 'exists', 'non-exists.js')

    console.log('exists.js ' + result1)
    console.log('non-exists.js ' + result2)
  }

  run()
`

const executeOpen = `
  const run = async () => {
    await remix.call('fileManager', 'open', 'contracts/3_Ballot.sol')
    const result = await remix.call('fileManager', 'file')

    console.log(result)
  }

  run()
`

const executeWriteFile = `
  const run = async () => {
    await remix.call('fileManager', 'writeFile', 'new_contract.sol', 'pragma solidity ^0.6.0')
  }

  run()
`

const executeReadFile = `
  const run = async () => {
    const result = await remix.call('fileManager', 'readFile', 'new_contract.sol')

    console.log(result)
  }

  run()
`

const executeCopyFile = `
  const run = async () => {
    await remix.call('fileManager', 'copyFile', 'contracts/3_Ballot.sol', '/', 'copy_contract.sol')
    const result = await remix.call('fileManager', 'readFile', 'copy_contract.sol')

    console.log(result)
  }

  run()
`

const executeRename = `
  const run = async () => {
    await remix.call('fileManager', 'rename', 'new_contract.sol', 'old_contract.sol')
  }

  run()
`

const executeMkdir = `
  const run = async () => {
    await remix.call('fileManager', 'mkdir', 'Test_Folder/')
  }

  run()
`

const executeReaddir = `
  const run = async () => {
    const result = await remix.call('fileManager', 'readdir', '/')

    console.log('Test_Folder isDirectory ', result["Test_Folder"].isDirectory)
  }

  run()
`

const executeRemove = `
  const run = async () => {
    await remix.call('fileManager', 'remove', 'old_contract.sol')
  }

  run()
`

const executeRemoveOnFolder = `(async () => {
  try {      
      await remix.call('fileManager', 'remove', 'Test_Folder')
  } catch (e) {
      console.log(e.message)
  }
})()`
