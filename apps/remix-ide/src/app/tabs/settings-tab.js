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

import React from 'react' // eslint-disable-line
import { ViewPlugin } from '@remixproject/engine-web'
import ReactDOM from 'react-dom'
import * as packageJson from '../../../../../package.json'
import { RemixUiSettings } from '@remix-ui/settings' //eslint-disable-line
const globalRegistry = require('../../global/registry')

const profile = {
  name: 'settings',
  displayName: 'Settings',
  methods: ['get'],
  events: [],
  icon: 'assets/img/settings.webp',
  description: 'Remix-IDE settings',
  kind: 'settings',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version,
  permission: true
}

module.exports = class SettingsTab extends ViewPlugin {
  constructor (config, editor) {
    super(profile)
    this.config = config
    this.editor = editor
    this._deps = {
      themeModule: globalRegistry.get('themeModule').api
    }
    this.element = document.createElement('div')
    this.element.setAttribute('id', 'settingsTab')
    this.useMatomoAnalytics = null
  }

  onActivation () {
    this.renderComponent()
  }

  render () {
    return this.element
  }

  renderComponent () {
    ReactDOM.render(
      <RemixUiSettings
        config = { this.config }
        editor = { this.editor }
        _deps = { this._deps }
        useMatomoAnalytics = {this.useMatomoAnalytics}
      />,
      this.element
    )
  }

  get (key) {
    return this.config.get(key)
  }

  updateMatomoAnalyticsChoice (isChecked) {
    this.config.set('settings/matomo-analytics', isChecked)
    this.useMatomoAnalytics = isChecked
    this.renderComponent()
  }
}
