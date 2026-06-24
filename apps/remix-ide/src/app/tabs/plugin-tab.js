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
    // Validate the plugin URL as soon as the tab is created (the URL is already
    // known here), not only when render() is first called. This surfaces an
    // illegal URL up front instead of after the user has opened/activated the
    // tab and is staring at the rendered warning. render() keeps its own check
    // below as a defence-in-depth fallback; this is purely an earlier signal.
    this.safeSrc = safePluginUrl(json && json.url)
    if (!this.safeSrc) {
      console.warn(
        `Refusing to load plugin "${(json && json.name) || ''}": URL must be http(s). ` +
        `Got: ${(json && json.url) || '(none)'}`
      )
    }
  }

  render () {
    if (this.el) return this.el

    // Reuse the result computed in the constructor; recompute defensively if a
    // PluginTab were ever constructed without going through it. The validation
    // (safePluginUrl) and the refusal behaviour are intentionally unchanged.
    const src = this.safeSrc !== undefined ? this.safeSrc : safePluginUrl(this.data.json.url)
    if (!src) {
      const rawUrl = (this.data.json && this.data.json.url) || '(none)'
      this.el = yo`
        <div class="${css.pluginTabView}" id="pluginView">
          <p class="text-warning">
            Refusing to load plugin: URL must be http(s). Got: ${rawUrl}
          </p>
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
