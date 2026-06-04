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

import { IframePlugin } from '@remixproject/engine-web'

// Hardened sandbox: drops `allow-top-navigation` from the upstream default to prevent
// a plugin from redirecting the parent IDE window (phishing vector). `allow-same-origin`
// is intentionally kept because the upstream postMessage handshake compares
// `event.origin` against the iframe's origin, and a fully opaque sandbox origin would
// surface as 'null' and break legitimate plugins. Revisit when plugins are moved to a
// dedicated origin.
const PLUGIN_SANDBOX = 'allow-popups allow-scripts allow-same-origin allow-forms'

const ALLOWED_PROTOCOLS = ['http:', 'https:']

export function resolvePluginUrl (url) {
  const parsed = new URL(url, window.location.href)
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Plugin URL must use http(s); got "${parsed.protocol}"`)
  }
  if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
    parsed.protocol = 'https:'
  }
  return parsed.href
}

function assertSafeUrl (url) {
  let parsed
  try {
    parsed = new URL(resolvePluginUrl(url))
  } catch (e) {
    if (e && e.message && e.message.indexOf('Plugin URL must use http(s)') === 0) throw e
    throw new Error(`Plugin URL is not a valid URL: ${url}`)
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Plugin URL must use http(s); got "${parsed.protocol}"`)
  }
}

export class SecureIframePlugin extends IframePlugin {
  render () {
    if (this.iframe.contentWindow) {
      throw new Error(`${this.name} plugin is already rendered`)
    }
    assertSafeUrl(this.url)
    this.iframe.setAttribute('sandbox', PLUGIN_SANDBOX)
    this.iframe.setAttribute('seamless', 'true')
    this.iframe.setAttribute('id', `plugin-${this.name}`)
    this.iframe.src = resolvePluginUrl(this.url)
    return this.iframe
  }
}
