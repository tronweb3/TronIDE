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

var yo = require('yo-yo')
var css = require('./styles/plugin-tab-styles')

const ALLOWED_PROTOCOLS = ['http:', 'https:']
const PLUGIN_TAB_SANDBOX = 'allow-popups allow-scripts allow-same-origin allow-forms'

function safePluginUrl (rawUrl) {
  try {
    const parsed = new URL(rawUrl, window.location.href)
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return null
    return `${parsed.origin}${parsed.pathname.replace(/\/?$/, '/')}index.html`
  } catch (e) {
    return null
  }
}

class PluginTab {
  constructor (json) {
    this.el = null
    this.data = { json }
  }

  render () {
    if (this.el) return this.el

    const src = safePluginUrl(this.data.json.url)
    if (!src) {
      this.el = yo`
        <div class="${css.pluginTabView}" id="pluginView">
          <p class="text-warning">Refusing to load plugin: URL must be http(s).</p>
        </div>`
      return this.el
    }

    this.el = yo`
      <div class="${css.pluginTabView}" id="pluginView">
        <iframe
          class="${css.iframe}"
          src="${src}"
          sandbox="${PLUGIN_TAB_SANDBOX}"
          referrerpolicy="no-referrer"></iframe>
      </div>`

    return this.el
  }
}

module.exports = PluginTab
