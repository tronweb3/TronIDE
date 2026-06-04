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
import EventEmitter from 'events'

class NoWorkerErrorFor extends EventEmitter {
  command (this: NightwatchBrowser, version: string): NightwatchBrowser {
    this.api.perform((done: VoidFunction) => {
      noWorkerErrorFor(this.api, version, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function noWorkerErrorFor (browser: NightwatchBrowser, version: string, callback: VoidFunction) {
  browser
    .setSolidityCompilerVersion(version)
    .pause(10000)
    .execute(function () {
      document.querySelector('#webpack-dev-server-client-overlay')?.remove()
      const button = document.querySelector('*[data-id="compilerContainerCompileBtn"]') as HTMLButtonElement
      if (button && !button.disabled) button.click()
    })
    .pause(10000)
    .execute(function () {
      const compileTab = document.querySelector('#compileTabView') as HTMLElement
      if (compileTab && compileTab.children.length > 0) return

      const recover = compileTab && (compileTab as HTMLElement & { remixEnsureRendered?: () => void }).remixEnsureRendered
      if (recover) recover()
      if (compileTab && compileTab.children.length > 0) return

      (document.querySelector('#icon-panel div[plugin="filePanel"]') as HTMLElement)?.click()
      ;(document.querySelector('#icon-panel div[plugin="solidity"]') as HTMLElement)?.click()
    })
    .waitForElementVisible('*[data-id="compilerContainerCompileBtn"]', 10000)
    .execute(function (version) {
      const compileTab = document.querySelector('#compileTabView') as HTMLElement
      const button = document.querySelector('*[data-id="compilerContainerCompileBtn"]') as HTMLButtonElement
      const errors = document.querySelector('*[data-id="compiledErrors"]')?.textContent || ''
      const finished = document.querySelector('[data-id="compilationFinishedWith_' + version + '"]')
      const compiledContracts = document.querySelectorAll('[data-id="compiledContracts"] option')
      return {
        hasCompileTab: Boolean(compileTab && compileTab.children.length > 0),
        hasCompileButton: Boolean(button),
        hasCompilationResult: Boolean(finished || compiledContracts.length > 0 || /Worker error:|Compiler load timed out|Failed to load compiler/.test(errors)),
        errors
      }
    }, [version], (result) => {
      const value = result.value as { hasCompileTab?: boolean, hasCompileButton?: boolean, hasCompilationResult?: boolean, errors?: string }
      browser.assert.ok(Boolean(value?.hasCompileTab), `Compiler tab stays mounted for ${version}`)
      browser.assert.ok(Boolean(value?.hasCompileButton), `Compile button stays available for ${version}`)
    })
    .notContainsText('*[data-id="compiledErrors"]', 'worker error:undefined')
    .notContainsText('*[data-id="compiledErrors"]', 'Uncaught RangeError: Maximum call stack size exceeded')
    .notContainsText('*[data-id="compiledErrors"]', 'RangeError: Maximum call stack size exceeded')
    .perform(() => {
      callback()
    })
}

module.exports = NoWorkerErrorFor
