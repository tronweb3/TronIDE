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

require('dotenv').config()

export default function (browser: NightwatchBrowser, callback: VoidFunction, url?: string, preloadPlugins = true): void {
  let targetUrl = url || process.env.E2E_BASE_URL || 'http://127.0.0.1:8080'
  if (process.env.E2E_BASE_URL) {
    targetUrl = targetUrl.replace('http://127.0.0.1:8080', process.env.E2E_BASE_URL)
    targetUrl = targetUrl.replace('http://localhost:8080', process.env.E2E_BASE_URL)
  }
  browser
    .url(targetUrl)
    .pause(5000)
    .switchBrowserTab(0)
    .execute(function () {
      const skip = document.querySelector('[id="remixTourSkipbtn"]') as HTMLElement
      if (skip) skip.click()
      const introSkip = document.querySelector('.introjs-skipbutton') as HTMLElement
      if (introSkip) introSkip.click()
      document.querySelectorAll('.introjs-overlay').forEach((el) => el.parentElement && el.parentElement.removeChild(el))
      document.querySelectorAll('.introjs-tooltip').forEach((el) => el.parentElement && el.parentElement.removeChild(el))
      document.querySelectorAll('.introjs-helperLayer').forEach((el) => el.parentElement && el.parentElement.removeChild(el))
      document.querySelectorAll('.introjs-tooltipReferenceLayer').forEach((el) => el.parentElement && el.parentElement.removeChild(el))

      const modal = document.querySelector('#modal-dialog')
      if (modal && modal.parentElement) modal.parentElement.removeChild(modal)
      document.querySelectorAll('.modal-backdrop').forEach((el) => el.parentElement && el.parentElement.removeChild(el))
      const overlay = document.querySelector('#webpack-dev-server-client-overlay')
      if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay)
    })
    .fullscreenWindow(() => {
      if (preloadPlugins) {
        initModules(browser, () => {
          browser.clickLaunchIcon('solidity')
            .waitForElementVisible('[for="autoCompile"]')
            .click('[for="autoCompile"]')
            .verify.elementPresent('[data-id="compilerContainerAutoCompile"]:checked')
        })
      }
    })
    .perform(() => {
      callback()
    })
}

function initModules (browser: NightwatchBrowser, callback: VoidFunction) {
  browser.pause(5000)
    .click('[data-id="verticalIconsKindpluginManager"]')
    .clickIfPresent('[data-id="pluginManagerComponentActivateButtonsolidityStaticAnalysis"]')
    .clickIfPresent('[data-id="pluginManagerComponentActivateButtondebugger"]')
    .scrollAndClick('[data-id="verticalIconsKindfilePanel"]')
    .clickLaunchIcon('settings')
    .click('*[data-id="settingsTabGenerateContractMetadataLabel"]')
    .setValue('[data-id="settingsTabGistAccessToken"]', process.env.gist_token)
    .click('[data-id="settingsTabSaveGistToken"]')
    .clickIfPresent('[data-id="settingsTabThemeLabelFlatly"]') // e2e tests were initially developed with Flatly. Some tests are failing with the default one (Dark), because the dark theme put uppercase everywhere.
    .perform(() => { callback() })
}
