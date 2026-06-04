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
    return sources
  },

  'Add Lib Test File': function (browser: NightwatchBrowser) {
    browser.addFile('Untitled5.sol', sources[0]['Untitled5.sol'])
      .clickLaunchIcon('udapp')
      .selectAccount('0xCA35b7d915458EF540aDe6068dFe2F44E8fa733c') // this account will be used for this test suite
  },

  'Test Auto Deploy Lib': function (browser: NightwatchBrowser) {
    let addressRef: string
    browser.verifyContracts(['test'])
      .clickLaunchIcon('udapp')
      .selectContract('test')
      .createContract('')
      .getAddressAtPosition(0, (address) => {
        console.log('testAutoDeployLib ' + address)
        addressRef = address
      })
      .waitForElementPresent('.instance:nth-of-type(2)')
      .click('.instance:nth-of-type(2) > div > button')
      .perform((done) => {
        browser.testConstantFunction(addressRef, 'get - call', null, '0:\nuint256: 45').perform(() => {
          done()
        })
      })
  },

  'Test Manual Deploy Lib': function (browser: NightwatchBrowser) {
    console.log('testManualDeployLib')
    browser.click('*[data-id="deployAndRunClearInstances"]')
      .pause(5000)
      .clickLaunchIcon('settings')
      .click('*[data-id="settingsTabGenerateContractMetadataLabel"]')
      .clickLaunchIcon('solidity')
      .click('#compileTabView button[title="Compile"]') // that should generate the JSON artefact
      .clickLaunchIcon('udapp')
      .verifyContracts(['test'])
      .clickLaunchIcon('udapp')
      .selectContract('lib') // deploy lib
      .createContract('')
      .perform((done) => {
        browser.getAddressAtPosition(0, (address) => {
          console.log(address)
          checkDeployShouldFail(browser, () => {
            checkDeployShouldSucceed(browser, address, () => {
              done()
            })
          })
        })
      })
      .end()
  }
}

function checkDeployShouldFail (browser: NightwatchBrowser, callback: VoidFunction) {
  let config
  browser.openFile('artifacts/test.json')
    .getEditorValue((content) => {
      config = JSON.parse(content)
      getDeployMetadata(config).autoDeployLib = false
    })
    .perform(() => {
      browser.setEditorValue(JSON.stringify(config))
    })
    .pause(5500)
    .openFile('Untitled5.sol')
    .clickLaunchIcon('udapp')
    .selectContract('test') // deploy lib
    .createContract('')
    .getText('div[class^="terminal"]', (value) => {
      console.log('value: ', value)
    })
    .assert.containsText('div[class^="terminal"]', '<address> is not a valid address')
    .perform(() => { callback() })
}

function checkDeployShouldSucceed (browser: NightwatchBrowser, address: string, callback: VoidFunction) {
  let addressRef: string
  let config
  browser.openFile('artifacts/test.json')
    .getEditorValue((content) => {
      config = JSON.parse(content)
      const deployMetadata = getDeployMetadata(config)
      deployMetadata.autoDeployLib = false
      deployMetadata.linkReferences['Untitled5.sol'].lib = address
    })
    .perform(() => {
      browser.setEditorValue(JSON.stringify(config))
    })
    .pause(5500)
    .openFile('Untitled5.sol')
    .clickLaunchIcon('udapp')
    .selectContract('test') // deploy lib
    .createContract('')
    .getAddressAtPosition(1, (address) => {
      addressRef = address
    })
    .waitForElementPresent('.instance:nth-of-type(3)')
    .click('.instance:nth-of-type(3) > div > button')
    .perform(() => {
      browser
        .testConstantFunction(addressRef, 'get - call', null, '0:\nuint256: 45')
        .perform(() => { callback() })
    })
}

function getDeployMetadata (config) {
  return Object.values(config.deploy).find((metadata: any) => metadata.linkReferences && metadata.linkReferences['Untitled5.sol'] && metadata.linkReferences['Untitled5.sol'].lib) || config.deploy[Object.keys(config.deploy)[0]]
}

const sources = [
  {
    'Untitled5.sol': {
      content: `library lib {
      function getInt () public view returns (uint) {
          return 45;
      }
    }

    contract test {
      function get () public view returns (uint) {
          return lib.getInt();
      }
    }`
    }
  }
]
