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

/* global localStorage */
const yo = require('yo-yo')
const modalDialog = require('../ui/modaldialog')
const pluginSecurity = loadPluginSecurity()

const defaultProfile = {
  methods: [],
  location: 'sidePanel',
  type: 'iframe'
}

function assertSafePluginUrl (url) {
  const validation = pluginSecurity.validateLocalPluginUrl(url)
  if (!validation.ok) {
    const reason = (validation.errors && validation.errors[0]) || 'Plugin URL failed validation.'
    throw new Error(reason)
  }
  return validation
}

function loadPluginSecurity () {
  try {
    const remixLib = require('@remix-project/remix-lib')
    if (remixLib.workspace && remixLib.workspace.pluginSecurity) return remixLib.workspace.pluginSecurity
  } catch (error) {
    console.debug('[localPlugin] remix-lib pluginSecurity unavailable; using local fallback', error)
  }
  return {
    validateLocalPluginUrl: function (url) {
      let parsed
      try {
        parsed = new URL(url, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
      } catch (error) {
        return { ok: false, errors: [`Plugin URL is not a valid URL: ${url}`], warnings: [] }
      }
      if (['http:', 'https:'].indexOf(parsed.protocol) < 0) {
        return { ok: false, errors: [`Plugin URL must use http(s); got "${parsed.protocol}"`], warnings: [] }
      }
      const host = parsed.hostname
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
      const isApprovedRemote = parsed.protocol === 'https:' && host.endsWith('.example.com')
      if (parsed.protocol === 'http:' && !isLocal) {
        return { ok: false, errors: ['HTTP local plugin URLs are only allowed for localhost.'], warnings: [] }
      }
      if (!isLocal && !isApprovedRemote) {
        return { ok: false, errors: ['Remote plugin URL must be approved before activation.'], warnings: [] }
      }
      const warnings = []
      if (isLocal) warnings.push('Only connect local plugins you trust. They can interact with your workspace.')
      if (isApprovedRemote) warnings.push('Approved remote plugin URL — review permissions before enabling.')
      return { ok: true, errors: [], warnings }
    },
    summarizePluginPermissions: function (methods) {
      return (methods || []).map((method) => `${method}: custom plugin API access`)
    }
  }
}

function sanitizeStoredLocalProfile (raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // Corrupt 'plugins/local' value — fall back to defaults instead of throwing.
    console.debug('[localPlugin] ignoring corrupt plugins/local entry', error)
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  // Trust only a known field whitelist from this localStorage-backed profile —
  // a tampered entry could otherwise inject arbitrary fields into the form.
  const allowed = ['name', 'displayName', 'description', 'documentation', 'url', 'methods', 'location', 'icon', 'type', 'version']
  const clean = {}
  for (const key of allowed) {
    if (parsed[key] !== undefined) clean[key] = parsed[key]
  }
  // methods drives the permission surface — force a string[] or drop it.
  if (clean.methods !== undefined && !(Array.isArray(clean.methods) && clean.methods.every((m) => typeof m === 'string'))) {
    clean.methods = []
  }
  return clean
}

module.exports = class LocalPlugin {
  /**
   * Open a modal to create a local plugin
   * @param {Profile[]} plugins The list of the plugins in the store
   * @returns {Promise<{api: any, profile: any}>} A promise with the new plugin profile
   */
  open (plugins) {
    this.profile = sanitizeStoredLocalProfile(localStorage.getItem('plugins/local')) || defaultProfile
    return new Promise((resolve, reject) => {
      const onValidation = () => {
        try {
          const profile = this.create()
          resolve(profile)
        } catch (err) {
          reject(err)
        }
      }
      modalDialog('Local Plugin', this.form(),
        { fn: () => onValidation() },
        { fn: () => resolve() }
      )
    })
  }

  /**
   * Create the object to add to the plugin-list
   */
  create () {
    const profile = {
      icon: 'assets/img/localPlugin.webp',
      methods: [],
      location: 'sidePanel',
      type: 'iframe',
      ...this.profile,
      hash: `local-${this.profile.name}`
    }
    if (!profile.location) throw new Error('Plugin should have a location')
    if (!profile.name) throw new Error('Plugin should have a name')
    if (!profile.url) throw new Error('Plugin should have an URL')
    const validation = assertSafePluginUrl(profile.url)
    profile.securityWarnings = validation.warnings
    profile.permissionSummary = pluginSecurity.summarizePluginPermissions(profile.methods || [])
    localStorage.setItem('plugins/local', JSON.stringify(profile))
    return profile
  }

  updateName ({ target }) {
    this.profile.name = target.value
  }

  updateUrl ({ target }) {
    this.profile.url = target.value
  }

  updateDisplayName ({ target }) {
    this.profile.displayName = target.value
  }

  updateProfile (key, e) {
    this.profile[key] = e.target.value
  }

  updateMethods ({ target }) {
    if (target.value) {
      try {
        this.profile.methods = target.value.split(',')
      } catch (e) { console.warn('[local-plugin] failed to parse methods list', e) }
    }
  }

  /** The form to create a local plugin */
  form () {
    const name = this.profile.name || ''
    const url = this.profile.url || ''
    const displayName = this.profile.displayName || ''
    const methods = (this.profile.methods && this.profile.methods.join(',')) || ''
    const radioSelection = (key, label, message) => {
      return this.profile[key] === label
        ? yo`<div class="radio">
          <input class="form-check-input" type="radio" name="${key}" onclick="${e => this.updateProfile(key, e)}" value="${label}" id="${label}" data-id="localPluginRadioButton${label}" checked="checked" />
          <label class="form-check-label" for="${label}">${message}</label>
        </div>`
        : yo`<div class="radio">
          <input class="form-check-input" type="radio" name="${key}" onclick="${e => this.updateProfile(key, e)}" value="${label}" id="${label}" data-id="localPluginRadioButton${label}" />
          <label class="form-check-label" for="${label}">${message}</label>
        </div>`
    }

    return yo`
    <form id="local-plugin-form">
      <div class="form-group">
        <label for="plugin-name">Plugin Name <small>(required)</small></label>
        <input class="form-control" oninput="${e => this.updateName(e)}" value="${name}" id="plugin-name" data-id="localPluginName" placeholder="Should be camelCase">
      </div>
      <div class="form-group">
        <label for="plugin-displayname">Display Name</label>
        <input class="form-control" oninput="${e => this.updateDisplayName(e)}" value="${displayName}" id="plugin-displayname" data-id="localPluginDisplayName" placeholder="Name in the header">
      </div>

      <div class="form-group">
        <label for="plugin-methods">Api (comma separated list of methods name)</label>
        <input class="form-control" oninput="${e => this.updateMethods(e)}" value="${methods}" id="plugin-methods" data-id="localPluginMethods" placeholder="Methods">
      </div>

      <div class="form-group">
        <label for="plugin-url">Url <small>(required)</small></label>
        <input class="form-control" oninput="${e => this.updateUrl(e)}" value="${url}" id="plugin-url" data-id="localPluginUrl" placeholder="ex: https://localhost:8000">
        <small class="form-text text-muted">Local plugins must use localhost/127.0.0.1 or an approved HTTPS plugin host. Requested APIs are summarized before activation.</small>
      </div>
      <h6>Type of connection <small>(required)</small></h6>
      <div class="form-check form-group">
        ${radioSelection('type', 'iframe', 'Iframe')}
        ${radioSelection('type', 'ws', 'Websocket')}
      </div>
      <h6>Location in remix <small>(required)</small></h6>
      <div class="form-check form-group">
        ${radioSelection('location', 'sidePanel', 'Side Panel')}
        ${radioSelection('location', 'mainPanel', 'Main Panel')}
        ${radioSelection('location', 'none', 'None')}
      </div>
    </form>`
  }
}

module.exports.assertSafePluginUrl = assertSafePluginUrl
