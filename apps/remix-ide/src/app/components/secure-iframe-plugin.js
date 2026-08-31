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
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const PLUGIN_CONNECT_TIMEOUT_MS = 20000

function isLocalPluginProfile (profile) {
  return Boolean(profile && typeof profile.hash === 'string' && profile.hash.startsWith('local:'))
}

export function resolvePluginUrl (url, localOnly = false) {
  const parsed = new URL(url, window.location.href)
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Plugin URL must use http(s); got "${parsed.protocol}"`)
  }
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
  if (localOnly && !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error('Local plugin URL must use localhost, 127.0.0.1, or ::1.')
  }
  if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
    parsed.protocol = 'https:'
  }
  return parsed.href
}

function assertSafeUrl (url, profile) {
  let parsed
  try {
    parsed = new URL(resolvePluginUrl(url, isLocalPluginProfile(profile)))
  } catch (e) {
    if (e && e.message && (e.message.indexOf('Plugin URL must use http(s)') === 0 || e.message.indexOf('Local plugin URL must use') === 0)) throw e
    throw new Error(`Plugin URL is not a valid URL: ${url}`)
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Plugin URL must use http(s); got "${parsed.protocol}"`)
  }
}

export class SecureIframePlugin extends IframePlugin {
  resetIframe () {
    this.loaded = false
    this.source = undefined
    this.origin = undefined
    this.iframe = document.createElement('iframe')
  }

  // The upstream connector has no load/handshake timeout. A blocked redirect,
  // CSP error, or dead plugin therefore leaves activatePlugin() pending forever
  // and every calling button stuck in its busy state. Bound the whole connect
  // operation and remove the partial view so activation remains retryable.
  connect (url) {
    this.url = url
    const iframe = this.render()
    return new Promise((resolve, reject) => {
      let settled = false
      let viewAdded = false
      const finishFailure = (error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        iframe.onload = null
        iframe.onerror = null
        iframe.remove()
        window.removeEventListener(...this.listener)
        if (viewAdded) this.call(this.profile.location, 'removeView', this.profile).catch(() => {})
        this.resetIframe()
        reject(error)
      }
      const timer = window.setTimeout(() => {
        finishFailure(new Error(`${this.name} plugin did not finish loading. Check the plugin URL and try again`))
      }, PLUGIN_CONNECT_TIMEOUT_MS)

      iframe.onerror = () => finishFailure(new Error(`${this.name} plugin cannot load ${this.profile.url}`))
      iframe.onload = async () => {
        if (settled) return
        try {
          if (!iframe.contentWindow) throw new Error(`${this.name} plugin cannot find url ${this.profile.url}`)
          this.origin = new URL(iframe.src).origin
          this.source = iframe.contentWindow
          window.addEventListener(...this.listener)
          await this.handshake()
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          resolve()
        } catch (error) {
          finishFailure(error)
        }
      }

      this.call(this.profile.location, 'addView', this.profile, iframe)
        .then(() => {
          viewAdded = true
          if (settled) this.call(this.profile.location, 'removeView', this.profile).catch(() => {})
        })
        .catch(finishFailure)
    })
  }

  async disconnect () {
    await super.disconnect()
    // HTMLIFrameElement.contentWindow stays non-null after remove(). Reusing
    // that detached element makes the next activation throw "already rendered".
    // A fresh element makes activate -> deactivate -> activate deterministic.
    this.resetIframe()
  }

  render () {
    if (this.iframe.contentWindow) {
      throw new Error(`${this.name} plugin is already rendered`)
    }
    assertSafeUrl(this.url, this.profile)
    this.iframe.setAttribute('sandbox', PLUGIN_SANDBOX)
    this.iframe.setAttribute('seamless', 'true')
    this.iframe.setAttribute('id', `plugin-${this.name}`)
    this.iframe.src = resolvePluginUrl(this.url, isLocalPluginProfile(this.profile))
    return this.iframe
  }
}
