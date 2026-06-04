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

class ClickLaunchIcon extends EventEmitter {
  command (this: NightwatchBrowser, icon: string): NightwatchBrowser {
    if (icon === 'settings') {
      this.api
        .waitForElementPresent('#icon-panel div[plugin="settings"], [data-id="verticalIconsSettingsIcons"] [plugin]')
        .execute(function () {
          const settingsIcon = document.querySelector('#icon-panel div[plugin="settings"]') as HTMLElement
          if (settingsIcon) {
            settingsIcon.click()
            return true
          }

          const settingsContainer = document.querySelector('[data-id="verticalIconsSettingsIcons"]')
          const fallbackIcon = settingsContainer && settingsContainer.querySelector('[plugin]') as HTMLElement
          if (fallbackIcon) {
            fallbackIcon.click()
            return true
          }
          return false
        }, [], (result) => {
          this.api.assert.ok(Boolean(result && result.value), 'Settings icon not found in #icon-panel or [data-id="verticalIconsSettingsIcons"]')
        })
        .waitForElementVisible('#settingsTab')
        .perform((done) => {
          done()
          this.emit('complete')
        })
      return this
    }

    this.api.waitForElementVisible('#icon-panel div[plugin="' + icon + '"]')
      .execute(function (icon) {
        document.querySelector('#webpack-dev-server-client-overlay')?.remove()
        const blockingModal = document.querySelector('#modal-dialog') as HTMLElement
        if (blockingModal && !blockingModal.querySelector('input, textarea')) blockingModal.remove()

        const iconElement = document.querySelector('#icon-panel div[plugin="' + icon + '"]') as HTMLElement
        if (!iconElement.classList.contains('active')) iconElement.click()
      }, [icon])
      .perform((done) => {
        done()
        this.emit('complete')
      })
    return this
  }
}

module.exports = ClickLaunchIcon
