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

export class FramingService {
  constructor (sidePanel, verticalIcon, mainView, resizeFeature) {
    this.sidePanel = sidePanel
    this.verticalIcon = verticalIcon
    this.mainPanel = mainView.getAppPanel()
    this.mainView = mainView
    this.resizeFeature = resizeFeature
  }

  start (params) {
    this.sidePanel.events.on('toggle', () => {
      this.resizeFeature.panel.clientWidth !== 0 ? this.resizeFeature.hidePanel() : this.resizeFeature.showPanel()
    })
    this.sidePanel.events.on('showing', () => {
      if (this.resizeFeature.panel.clientWidth === 0) this.resizeFeature.showPanel()
    })
    this.mainPanel.events.on('toggle', () => {
      this.resizeFeature.showPanel()
    })

    this.verticalIcon.select('filePanel')

    document.addEventListener('keypress', (e) => {
      if (e.shiftKey && e.ctrlKey) {
        if (e.code === 'KeyF') { // Ctrl+Shift+F
          this.verticalIcon.select('filePanel')
        } else if (e.code === 'KeyA') { // Ctrl+Shift+A
          this.verticalIcon.select('pluginManager')
        } else if (e.code === 'KeyS') { //  Ctrl+Shift+S
          this.verticalIcon.select('settings')
        }
        e.preventDefault()
      }
    })

    if (params.minimizeterminal) this.mainView.minimizeTerminal()
    if (params.minimizesidepanel) this.resizeFeature.hidePanel()
  }

  embed () {
    this.mainView.minimizeTerminal()
    this.resizeFeature.hidePanel()
  }
}
