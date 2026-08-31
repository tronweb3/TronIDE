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

const sources = [
  {
    'Untitled.sol': {
      content: `
pragma solidity >=0.6.0 <0.8.0;
contract test1 { address test = tx.origin; }
contract test2 {}
contract TooMuchGas {
  uint x;
  fallback() external { 
      x++;
    uint test;
    uint test1;
  }
}`
    }
  }
]

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },
  '@sources': function () {
    return sources
  },
  'Static Analysis': function (browser: NightwatchBrowser) {
    runTests(browser)
  }
}

function runTests (browser: NightwatchBrowser) {
  browser
    .waitForElementVisible('#icon-panel', 10000)
    .clickLaunchIcon('solidity')
    .pause(10000)
    .testContracts('Untitled.sol', sources[0]['Untitled.sol'], ['TooMuchGas', 'test1', 'test2'])
    .clickLaunchIcon('solidityStaticAnalysis')
    .click('#staticanalysisButton button')
    .waitForElementContainsText('*[data-id="staticAnalysisSummary-SEC"]', 'Security 1', 10000)
    .waitForElementContainsText('*[data-id="staticAnalysisSummary-GAS"]', 'Gas 1', 10000)
    .waitForElementContainsText('*[data-id="staticAnalysisSummary-MISC"]', 'Advisory 2', 10000)
    .execute(readAnalysisContract, [], function (result) {
      assertAnalysisContract(browser, result.value as AnalysisContract, false)
    })
    // Miscellaneous findings are advisory and intentionally collapsed by
    // default. Expand that exact group and prove both findings are still
    // present rather than merely changing the visible warning count from 4.
    .click('*[data-id="staticAnalysisGroupHeaderMiscellaneous"]')
    .waitForElementContainsText(
      '#staticanalysisresult',
      'TooMuchGas.() : Variables have very similar names "test" and "test1".',
      10000
    )
    .execute(readAnalysisContract, [], function (result) {
      assertAnalysisContract(browser, result.value as AnalysisContract, true)
    })
    .end()
}

interface AnalysisGroup {
  expanded: string
  count: string
  warnings: string[]
}

interface AnalysisContract {
  summary: Array<{ id: string, text: string, className: string, title: string }>
  visibleWarningCount: number
  security: AnalysisGroup
  gas: AnalysisGroup
  advisory: AnalysisGroup
}

function readAnalysisContract (): AnalysisContract {
  const text = (node: Element) => ((node as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()
  const group = (dataId: string): AnalysisGroup => {
    const header = document.querySelector(`[data-id="${dataId}"]`)
    const container = header && header.parentElement
    return {
      expanded: header && header.getAttribute('aria-expanded'),
      count: header && header.querySelector('.badge') ? text(header.querySelector('.badge')) : '',
      warnings: container ? Array.from(container.querySelectorAll('.warning')).map(text) : []
    }
  }
  return {
    summary: Array.from(document.querySelectorAll('[data-id^="staticAnalysisSummary-"]')).map((node) => ({
      id: node.getAttribute('data-id'),
      text: text(node),
      className: node.getAttribute('class') || '',
      title: node.getAttribute('title') || ''
    })),
    visibleWarningCount: document.querySelectorAll('#staticanalysisresult .warning').length,
    security: group('staticAnalysisGroupHeaderSecurity'),
    gas: group('staticAnalysisGroupHeaderGas & Economy'),
    advisory: group('staticAnalysisGroupHeaderMiscellaneous')
  }
}

function assertAnalysisContract (browser: NightwatchBrowser, contract: AnalysisContract, advisoryExpanded: boolean) {
  browser.assert.equal(
    JSON.stringify(contract.summary.map((item) => [item.id, item.text])),
    JSON.stringify([
      ['staticAnalysisSummary-SEC', 'Security 1'],
      ['staticAnalysisSummary-GAS', 'Gas 1'],
      ['staticAnalysisSummary-MISC', 'Advisory 2']
    ]),
    'Summary reports the exact Security/Gas/Advisory split'
  )
  browser.assert.equal(contract.summary[0].className.includes('badge-danger'), true, 'Security keeps danger severity')
  browser.assert.equal(contract.summary[1].className.includes('badge-warning'), true, 'Gas keeps warning severity')
  browser.assert.equal(contract.summary[2].className.includes('badge-light'), true, 'Advisory is visually non-blocking')
  browser.assert.equal(
    contract.summary[2].title,
    'Advisory / style reminders — not counted in the sidebar badge',
    'Advisory exclusion from the sidebar count is explicit'
  )

  browser.assert.equal(contract.security.expanded, 'true', 'Security findings are expanded by default')
  browser.assert.equal(contract.security.count, '1', 'Security group has exactly one finding')
  browser.assert.equal(contract.security.warnings.length, 1, 'One Security finding is rendered')
  browser.assert.equal(String(contract.security.warnings[0] || '').includes('Use of tx.origin'), true, 'Security finding identifies tx.origin')

  browser.assert.equal(contract.gas.expanded, 'true', 'Gas findings are expanded by default')
  browser.assert.equal(contract.gas.count, '1', 'Gas group has exactly one finding')
  browser.assert.equal(contract.gas.warnings.length, 1, 'One Gas finding is rendered')
  browser.assert.equal(
    String(contract.gas.warnings[0] || '').includes('Fallback function of contract TooMuchGas requires too much gas'),
    true,
    'Gas finding identifies the expensive fallback'
  )

  browser.assert.equal(contract.advisory.expanded, advisoryExpanded ? 'true' : 'false', `Advisory group is ${advisoryExpanded ? 'expanded' : 'collapsed'}`)
  browser.assert.equal(contract.advisory.count, '2', 'Advisory group has exactly two findings')
  browser.assert.equal(contract.advisory.warnings.length, advisoryExpanded ? 2 : 0, `Advisory renders ${advisoryExpanded ? 'two findings after expansion' : 'no rows while collapsed'}`)
  browser.assert.equal(contract.visibleWarningCount, advisoryExpanded ? 4 : 2, `Exactly ${advisoryExpanded ? 4 : 2} finding rows are visible`)

  if (advisoryExpanded) {
    browser.assert.equal(
      contract.advisory.warnings.every((warning) => warning.includes('TooMuchGas.() : Variables have very similar names "test" and "test1".')),
      true,
      'Both Advisory findings are the expected similar-name reminders'
    )
  }
}
