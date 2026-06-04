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
    init(browser, done, 'http://127.0.0.1:8080', false)
  },

  'Checks vertical icons panelcontex menu': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="remixIdeIconPanel"]', 10000)
      .waitForElementVisible('*[data-id="verticalIconsKindpluginManager"]')
      .click('*[data-id="verticalIconsKindpluginManager"]')
      .scrollAndClick('*[data-id="pluginManagerComponentActivateButtondebugger"]')
      .waitForElementVisible('*[data-id="pluginManagerComponentDeactivateButtondebugger"]', 7000)
      .rightClickElement('[data-id="verticalIconsKinddebugger"]')
      .waitForElementVisible('*[id="menuitemdeactivate"]')
      .waitForElementVisible('*[id="menuitemdocumentation"]')
      .click('*[data-id="remixIdeIconPanel"]')
  },

  'Checks vertical icons panel contex menu deactivate': function (browser: NightwatchBrowser) {
    browser.waitForElementVisible('div[data-id="remixIdeIconPanel"]', 10000)
      .waitForElementVisible('*[data-id="verticalIconsKinddebugger"]', 7000)
      .pause(5000)
      .rightClickElement('[data-id="verticalIconsKinddebugger"]')
      .click('*[id="menuitemdeactivate"]')
      .click('*[data-id="verticalIconsKindsettings"]')
      .click('*[data-id="verticalIconsKindpluginManager"]')
      .scrollInto('*[data-id="pluginManagerComponentActivateButtondebugger"]')
      .waitForElementVisible('*[data-id="pluginManagerComponentActivateButtondebugger"]')
  }
}
