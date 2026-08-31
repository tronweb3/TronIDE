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

import { NightwatchBrowser, NightwatchContractContent } from 'nightwatch'
import EventEmitter from 'events'

class AddFile extends EventEmitter {
  command (this: NightwatchBrowser, name: string, content: NightwatchContractContent): NightwatchBrowser {
    this.api.perform((done) => {
      addFile(this.api, name, content, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function addFile (browser: NightwatchBrowser, name: string, content: NightwatchContractContent, done: VoidFunction) {
  browser.clickLaunchIcon('udapp')
    .clickLaunchIcon('filePanel')
    // Do not use README.txt as an optional proxy for the workspace root. After
    // opening a nested file that row can be outside the rendered tree, leaving
    // focus on e.g. tests/Foo.sol; adding tests/Bar.sol would then silently
    // create tests/tests/Bar.sol. Click the root label itself on every call.
    .focusWorkspaceRoot()
    .click('.newFile')
    .waitForElementContainsText('*[data-id$="/blank"]', '', 60000)
    .execute(function () {
      const blank = document.querySelector('*[data-id$="/blank"]')
      const workspace = (document.querySelector('*[data-id="workspacesSelect"]') as HTMLSelectElement)?.value
      return {
        blankPath: blank?.querySelector('[data-path]')?.getAttribute('data-path'),
        workspace
      }
    }, [], function (result) {
      const value = result.value as { blankPath?: string, workspace?: string }
      // The localhost option keeps a display-only sentinel as its select
      // value, while the file provider correctly namespaces paths as
      // `localhost/…`. Normalize that one UI sentinel before asserting the
      // input is rooted at the active explorer rather than a nested path.
      const root = value.workspace === ' - connect to localhost - ' ? 'localhost' : value.workspace
      browser.assert.equal(value.blankPath, `${root}/blank`, `new-file input is rooted in ${value.workspace}: ${JSON.stringify(value)}`)
    })
    .sendKeys('*[data-id$="/blank"] .remixui_items', name)
    .sendKeys('*[data-id$="/blank"] .remixui_items', browser.Keys.ENTER)
    .waitForElementVisible(`li[data-id="treeViewLitreeViewItem${name}"]`, 15000)
    .getAttribute(`li[data-id="treeViewLitreeViewItem${name}"] [data-path]`, 'data-path', function (result) {
      browser.assert.equal(result.value, name, `created file is rendered at the requested path ${name}`)
    })
    .setEditorValue(content.content)
    .pause(5500)
    .perform(function () {
      done()
    })
}

module.exports = AddFile
