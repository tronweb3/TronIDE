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

  before: function (browser: NightwatchBrowser, done) {
    init(browser, done)
  },

  '@sources': function () {
    return sources
  },

  'Should launch solidity unit test plugin': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .clickLaunchIcon('filePanel')
      .addFile('simple_storage.sol', sources[0]['simple_storage.sol'])
      .addFile('ks2a.sol', sources[0]['ks2a.sol'])
      .clickLaunchIcon('pluginManager')
      .scrollAndClick('*[data-id="pluginManagerComponentActivateButtonsolidityUnitTesting"]')
      .click('*[data-id="verticalIconsKindsolidityUnitTesting"]')
      .waitForElementPresent('*[data-id="sidePanelSwapitTitle"]')
      .assert.containsText('*[data-id="sidePanelSwapitTitle"]', 'SOLIDITY UNIT TESTING')
  },

  'Should generate test file': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .clickLaunchIcon('filePanel')
      .openFile('simple_storage.sol')
      .click('*[data-id="verticalIconsKindsolidityUnitTesting"]')
      .waitForElementVisible('*[data-id="testTabGenerateTestFile"]')
      .execute(function () {
        const win = window as any
        const fs = win.remixFileSystem
        const collectFiles = (directory: string): string[] => {
          if (!fs.existsSync(directory)) return []
          return fs.readdirSync(directory).reduce((files: string[], name: string) => {
            const path = `${directory.replace(/\/$/, '')}/${name}`
            return fs.statSync(path).isDirectory() ? files.concat(collectFiles(path)) : files.concat(path)
          }, [])
        }
        win.__unitGenerateFilesBefore = collectFiles('/.workspaces')
        win.__unitGenerateErrors = []
        window.addEventListener('error', (event) => win.__unitGenerateErrors.push(`error: ${event.message}`))
        window.addEventListener('unhandledrejection', (event) => win.__unitGenerateErrors.push(`rejection: ${String(event.reason && event.reason.message ? event.reason.message : event.reason)}`))
        const editor = document.getElementById('input') as any
        return {
          buttonDisabled: (document.querySelector('[data-id="testTabGenerateTestFile"]') as HTMLButtonElement).disabled,
          inputPath: (document.querySelector('[data-id="uiPathInput"]') as HTMLInputElement).value,
          activeTab: document.querySelector('remix-tabs remix-tab.active')?.textContent?.trim(),
          editorContainsSimpleStorage: !!(editor && editor.editor && editor.editor.getValue().includes('contract SimpleStorage')),
          files: win.__unitGenerateFilesBefore
        }
      }, [], function (result) {
        const value = result.value as { buttonDisabled: boolean, inputPath: string, activeTab?: string, editorContainsSimpleStorage: boolean, files: string[] }
        this.assert.equal(value.buttonDisabled, false, `Generate is enabled for the existing test folder: ${JSON.stringify(value)}`)
        this.assert.equal(value.inputPath, 'tests', `Generate targets the default tests folder: ${JSON.stringify(value)}`)
        this.assert.ok(value.editorContainsSimpleStorage && /simple_storage/i.test(value.activeTab || ''), `the selected Solidity file is current before Generate: ${JSON.stringify(value)}`)
      })
      .click('*[data-id="testTabGenerateTestFile"]')
      .executeAsync(function (done) {
        const win = window as any
        const fs = win.remixFileSystem
        const before = win.__unitGenerateFilesBefore || []
        const collectFiles = (directory: string): string[] => {
          if (!fs.existsSync(directory)) return []
          return fs.readdirSync(directory).reduce((files: string[], name: string) => {
            const path = `${directory.replace(/\/$/, '')}/${name}`
            return fs.statSync(path).isDirectory() ? files.concat(collectFiles(path)) : files.concat(path)
          }, [])
        }
        const deadline = Date.now() + 10000
        const poll = () => {
          const files = collectFiles('/.workspaces')
          const created = files.filter((path: string) => !before.includes(path) && path.endsWith('_test.sol'))
          if (created.length || Date.now() >= deadline) {
            const modal = document.querySelector('.modal.show, [data-id$="ModalDialogContainer-react"]')
            const editor = document.getElementById('input') as any
            return done({
              created,
              files,
              errors: win.__unitGenerateErrors,
              modalText: modal && modal.textContent,
              buttonDisabled: (document.querySelector('[data-id="testTabGenerateTestFile"]') as HTMLButtonElement).disabled,
              inputPath: (document.querySelector('[data-id="uiPathInput"]') as HTMLInputElement).value,
              activeTab: document.querySelector('remix-tabs remix-tab.active')?.textContent?.trim(),
              editorContainsSimpleStorage: !!(editor && editor.editor && editor.editor.getValue().includes('contract SimpleStorage'))
            })
          }
          window.setTimeout(poll, 100)
        }
        poll()
      }, [], function (result) {
        const value = result.value as { created: string[], files: string[], errors: string[], modalText?: string }
        this.assert.deepEqual(value.created, ['/.workspaces/default_workspace/tests/simple_storage_test.sol'], `Generate creates exactly the expected workspace file: ${JSON.stringify(value)}`)
        this.assert.deepEqual(value.errors, [], `Generate raises no page errors: ${JSON.stringify(value)}`)
        this.assert.ok(!value.modalText, `Generate raises no failure modal: ${JSON.stringify(value)}`)
      })
      .execute(function () {
        return (window as any).remixFileSystem.readFileSync('/.workspaces/default_workspace/tests/simple_storage_test.sol', 'utf8')
      }, [], function (result) {
        const content = result.value as string
        this.assert.ok(content.includes('import "../simple_storage.sol";'), 'generated workspace file imports the selected contract')
        this.assert.ok(content.includes('contract testSuite'), 'generated workspace file contains the executable test-suite scaffold')
      })
      .clickLaunchIcon('filePanel')
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemtests"]', 60000)
      .execute(function () {
        const generated = document.querySelector('[data-path="tests/simple_storage_test.sol"]')
        const testsFolder = document.querySelector('*[data-id="treeViewLitreeViewItemtests"]') as HTMLElement
        if (!generated && testsFolder) testsFolder.click()
      })
      .waitForElementVisible('*[data-id="treeViewLitreeViewItemtests/simple_storage_test.sol"]', 60000)
      .openFile('tests/simple_storage_test.sol')
      .getEditorValue((content) => {
        browser.assert.ok(content.includes('import "../simple_storage.sol";'), 'opened generated test imports the selected contract')
        browser.assert.ok(content.includes('contract testSuite'), 'opened generated test contains the executable test-suite scaffold')
      })
      .removeFile('tests/simple_storage_test.sol', 'default_workspace')
      .waitForElementNotPresent('*[data-id="treeViewLitreeViewItemtests/simple_storage_test.sol"]')
  },

  'Should run simple unit test `simple_storage_test.sol` ': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .addFile('tests/simple_storage_test.sol', sources[0]['tests/simple_storage_test.sol'])
      .click('*[data-id="verticalIconsKindsolidityUnitTesting"]')
      .waitForElementPresent('*[data-id="testTabCheckAllTests"]')
      .click('*[data-id="testTabCheckAllTests"]')
      .clickElementAtPosition('.singleTestLabel', 1)
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'MyTest (/tests/simple_storage_test.sol)', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✓ Initial value should be100', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✓ Value is set200', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✘ Should fail for wrong value200', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'Passing: 2', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'Failing: 1', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'FAIL MyTest (/tests/simple_storage_test.sol)', 120000)
  },

  'Should run advance unit test using natspec and experimental ABIEncoderV2 `ks2b_test.sol` ': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .clickLaunchIcon('filePanel')
      .addFile('tests/ks2b_test.sol', sources[0]['tests/ks2b_test.sol'])
      .click('*[data-id="verticalIconsKindsolidityUnitTesting"]')
      .waitForElementPresent('*[data-id="testTabCheckAllTests"]')
      .click('*[data-id="testTabCheckAllTests"]')
      .clickElementAtPosition('.singleTestLabel', 2)
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '/tests/ks2b_test.sol', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✓ Check project exists', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✘ Check wrong project owner', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✘ Check wrong sender', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✘ Check wrong value', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '✓ Check project is fundable', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'owner is incorrect', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'wrong sender', 120000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'wrong value', 120000)
  },

  'Should stop unit tests during test execution` ': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .waitForElementPresent('*[data-id="testTabRunTestsTabRunAction"]')
      .clickElementAtPosition('.singleTestLabel', 0)
      .clickElementAtPosition('.singleTestLabel', 1)
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .pause(2000)
      .click('*[data-id="testTabRunTestsTabStopAction"]')
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '/tests/ks2b_test.sol', 200000)
      .notContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '/tests/4_Ballot_test.sol')
      .notContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', '/tests/simple_storage_test.sol')
      .waitForElementContainsText('*[data-id="testTabTestsExecutionStopped"]', 'The test execution has been stopped', 60000)
  },

  'Should fail on compilation': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .addFile('tests/compilationError_test.sol', sources[0]['compilationError_test.sol'])
      .clickLaunchIcon('filePanel')
      .openFile('tests/compilationError_test.sol')
      .clickLaunchIcon('solidityUnitTesting')
      .click('*[data-id="testTabCheckAllTests"]')
      .clickElementAtPosition('.singleTestLabel', 3)
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'SyntaxError: No visibility specified', 120000)
      .waitForElementContainsText('*[data-id="testTabTestsExecutionStoppedError"]', 'The test execution has been stopped because of error(s) in your test file', 120000)
  },

  'Should fail on deploy': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .addFile('tests/deployError_test.sol', sources[0]['tests/deployError_test.sol'])
      .clickLaunchIcon('filePanel')
      .openFile('tests/deployError_test.sol')
      .clickLaunchIcon('solidityUnitTesting')
      .click('*[data-id="testTabCheckAllTests"]')
      .clickElementAtPosition('.singleTestLabel', 4)
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'contract deployment failed after trying twice', 120000)
  },

  'Should fail when parameters are to method in test contract': function (browser: NightwatchBrowser) {
    browser.waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .addFile('tests/methodFailure_test.sol', sources[0]['tests/methodFailure_test.sol'])
      .clickLaunchIcon('filePanel')
      .openFile('tests/methodFailure_test.sol')
      .clickLaunchIcon('solidityUnitTesting')
      .click('*[data-id="testTabCheckAllTests"]')
      .clickElementAtPosition('.singleTestLabel', 5)
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'Method \'add\' can not have parameters inside a test contract', 120000)
  },

  'Changing current path': function (browser: NightwatchBrowser) {
    browser
      .waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .addFile('myTests/simple_storage_test.sol', sources[0]['tests/simple_storage_test.sol'])
      .clickLaunchIcon('solidityUnitTesting')
      .setValue('*[data-id="uiPathInput"]', 'myTests')
      // myTests already exists because the fixture was just created. Commit
      // the path with Enter rather than clicking the disabled Create button.
      .sendKeys('*[data-id="uiPathInput"]', browser.Keys.ENTER)
      .waitForElementContainsText('.singleTestLabel', '/myTests/simple_storage_test.sol', 15000)
      .execute(function () {
        return {
          inputPath: (document.querySelector('[data-id="uiPathInput"]') as HTMLInputElement).value,
          labels: Array.from(document.querySelectorAll('.singleTestLabel')).map((label) => label.textContent.trim()),
          checked: Array.from(document.querySelectorAll('.singleTest')).filter((input: HTMLInputElement) => input.checked).length,
          runDisabled: (document.querySelector('[data-id="testTabRunTestsTabRunAction"]') as HTMLButtonElement).disabled
        }
      }, [], function (result) {
        const value = result.value as { inputPath: string, labels: string[], checked: number, runDisabled: boolean }
        this.assert.deepEqual(value, {
          inputPath: 'myTests',
          labels: ['/myTests/simple_storage_test.sol'],
          checked: 1,
          runDisabled: false
        }, `the existing test directory is selected without deselecting its only test: ${JSON.stringify(value)}`)
      })
      .scrollAndClick('*[data-id="testTabRunTestsTabRunAction"]')
      .waitForElementPresent('*[data-id="testTabSolidityUnitTestsOutputheader"]', 60000)
      .waitForElementContainsText('*[data-id="testTabSolidityUnitTestsOutput"]', 'MyTest (/myTests/simple_storage_test.sol)', 60000)
      .clearValue('*[data-id="uiPathInput"]')
      .setValue('*[data-id="uiPathInput"]', 'tests')
      .sendKeys('*[data-id="uiPathInput"]', browser.Keys.ENTER)
      .waitForElementContainsText('.singleTestLabel', '/tests/4_Ballot_test.sol', 15000)
  },

  'Changing current path when workspace changed': function (browser: NightwatchBrowser) {
    browser
      .waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
      .clickLaunchIcon('settings')
      .clickLaunchIcon('solidityUnitTesting')
      .waitForElementPresent('*[data-id="uiPathInput"]', 3000)
      .clearValue('*[data-id="uiPathInput"]')
      .setValue('*[data-id="uiPathInput"]', 'tests1')
      .click('*[data-id="testTabGenerateTestFolder"]')
      .clickLaunchIcon('filePanel')
      // creating a new workspace
      .click('*[data-id="workspaceCreate"]')
      .waitForElementVisible('*[data-id="modalDialogCustomPromptTextCreate"]')
      // eslint-disable-next-line dot-notation
      .execute(function () { document.querySelector('*[data-id="modalDialogCustomPromptTextCreate"]')['value'] = 'workspace_new' })
      .click('*[data-id="workspacesModalDialogModalDialogModalFooter-react"] .modal-ok')
      .click('*[data-id="workspacesSelect"] option[value="workspace_new"]')
      // end of creating
      .clickLaunchIcon('solidityUnitTesting')
      .pause(2000)
      .verify.attributeEquals('*[data-id="uiPathInput"]', 'value', 'tests')
  },

  'Solidity Unittests': function (browser: NightwatchBrowser) {
    runTests(browser)
  }
}

function runTests (browser: NightwatchBrowser) {
  browser
    .waitForElementPresent('*[data-id="verticalIconsKindfilePanel"]')
    .clickLaunchIcon('filePanel')
    .click('*[data-id="treeViewLitreeViewItemcontracts"]')
    .openFile('contracts/3_Ballot.sol')
    .clickLaunchIcon('solidityUnitTesting')
    .pause(2000)
    .verify.attributeEquals('*[data-id="uiPathInput"]', 'value', 'tests')
    .scrollAndClick('#runTestsTabRunAction')
    .waitForElementVisible('*[data-id="testTabSolidityUnitTestsOutputheader"]', 120000)
    .waitForElementPresent('#solidityUnittestsOutput div[class^="testPass"]', 60000)
    .waitForElementContainsText('#solidityUnittestsOutput', '/tests/4_Ballot_test.sol', 60000)
    .waitForElementContainsText('#solidityUnittestsOutput', '✓ Check winning proposal', 60000)
    .waitForElementContainsText('#solidityUnittestsOutput', '✓ Check winnin proposal with return value', 60000)
    .end()
}

const sources = [
  {
    'simple_storage.sol': {
      content: `
      pragma solidity >=0.4.22 <0.9.0;

      contract SimpleStorage {
        uint public storedData;
      
        constructor() {
          storedData = 100;
        }
      
        function set(uint x) public {
          storedData = x;
        }
      
        function get() public view returns (uint retVal) {
          return storedData;
        }
      }
        `
    },
    'tests/simple_storage_test.sol': {
      content: `
      pragma solidity >=0.4.22 <0.9.0;
      import "remix_tests.sol";
      import "../simple_storage.sol";

      contract MyTest {
        SimpleStorage foo;

        function beforeEach() public {
          foo = new SimpleStorage();
        }

        function initialValueShouldBe100() public returns (bool) {
          return Assert.equal(foo.get(), 100, "initial value is not correct");
        }

        function valueIsSet200() public returns (bool) {
          foo.set(200);
          return Assert.equal(foo.get(), 200, "value is not 200");
        }

        function shouldFailForWrongValue200() public returns (bool) {
          foo.set(300);
          return Assert.equal(foo.get(), 200, "value is not 200");
        }
      }
        `
    },
    'ks2a.sol': {
      content: `
      pragma solidity >=0.4.22 <0.9.0;
      contract Kickstarter {
          enum State { Started, Completed }
      
          struct Project {
              address owner;
              string name;
              uint goal;
              uint fundsAvailable; // added
              uint amountContributed; // added
              State state;
              mapping(address => uint) funders; // added
          }
          uint numProjects;
          Project[] public projects;
      
          constructor() {
          }
      
          function createProject(string memory name, uint goal) public {
              projects.push(); // new line
              Project storage project = projects[projects.length - 1];
              project.name = name;
              project.goal = goal;
              project.owner = msg.sender;
              project.state = State.Started;
          }
          
          function fundProject(uint projectId) payable public {
          Project storage project = projects[projectId];
              // require project exists
              // PLEASE CHECK / or erase
              // not this: require(projects[projectId].exists, "the project must exist to be funded");
      
              // require for... underflow/overflow protection
              project.funders[msg.sender] += msg.value;
              project.amountContributed += msg.value;
              project.fundsAvailable += msg.value;
      
              if (project.amountContributed >= project.goal) {
                  project.state = State.Completed;
              }
          }
          
          // this function is here because we can't use web3 when using the VM
          function getContractBalance() public view returns(uint balance) {
              return address(this).balance;
          }
            
      }
        `
    },
    'tests/ks2b_test.sol': {
      content: `
      pragma solidity >=0.4.22 <0.9.0;
      pragma experimental ABIEncoderV2;

      import "remix_tests.sol"; // this import is automatically injected by Remix.
      import "remix_accounts.sol";
      import "../ks2a.sol";

      contract kickstarterTest {
          enum State { Started, Completed }

          Kickstarter kickstarter;
          
          function beforeAll () public {
            kickstarter = new Kickstarter();
            kickstarter.createProject("ProjectA", 123000);
            kickstarter.createProject("ProjectB", 100);
          }
      
          /// #sender: account-1
          /// #value: 10000000
          function checkProjectExists () public payable {
              (address owner, string memory name, uint goal, uint fundsAvailable, uint amountContributed, Kickstarter.State state) = kickstarter.projects(0);
              Assert.equal(name, "ProjectA", "project name is incorrect");
              Assert.equal(goal, 123000, "funding goal is incorrect");
              Assert.equal(owner, address(this), "owner is incorrect");
              Assert.equal(msg.sender, TestsAccounts.getAccount(1), "wrong sender");
              Assert.equal(msg.value, 10000000, "wrong value");
          }

          /// #sender: account-1
          /// #value: 10000000
          function checkWrongProjectOwner () public payable {
            (address owner,,,,,) = kickstarter.projects(0);
            Assert.equal(owner, TestsAccounts.getAccount(0), "owner is incorrect"); //failing case
          }

          /// #sender: account-1
          /// #value: 10000000
          function checkWrongSender () public payable {
            Assert.equal(msg.sender, TestsAccounts.getAccount(0), "wrong sender"); //failing case
          }

          /// #sender: account-1
          /// #value: 10000000
          function checkWrongValue () public payable {
            Assert.equal(msg.value, 5000000, "wrong value"); //failing case
          }

          function checkProjectIsFundable () public {
              kickstarter.fundProject{value:120000}(0);
              (address owner, string memory name, uint goal, uint fundsAvailable, uint amountContributed, Kickstarter.State state) = kickstarter.projects(0);
              Assert.equal(amountContributed, 120000, "contributed amount is incorrect");
          }
          
      }
        `
    },
    'compilationError_test.sol': {
      content: `
      pragma solidity ^0.7.0;
      
      contract failOnCompilation {
        fallback() {

        }
      }
        `
    },
    'tests/deployError_test.sol': {
      content: `
      pragma solidity ^0.7.0;

      contract failingDeploy {
          constructor() {
              revert('Deploy Failed');
          }
      }
        `
    },
    'tests/methodFailure_test.sol': {
      content: `
      pragma solidity ^0.7.0;

      contract methodfailure {
        function add(uint a, uint b) public {
           uint c = a+b;
           Assert.equal(a+b, c, "wrong value");
        }
      } 
        `
    }
  }
]
