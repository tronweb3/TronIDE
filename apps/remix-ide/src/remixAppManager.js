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
import { PluginManager } from '@remixproject/engine'
import { SecureIframePlugin as IframePlugin } from './app/components/secure-iframe-plugin'
import { EventEmitter } from 'events'
import QueryParams from './lib/query-params'
import { filterUrlPluginNames } from './lib/url-param-security'
import { PermissionHandler } from './app/ui/persmission-handler'
const { installPermissionedCallPluginMethod, isSafePermissionKey } = require('./app/ui/permission-security')
const { assertSafeProfileUpdate, clonePluginProfile } = require('./lib/plugin-profile-security')
const {
  assertAllowedPluginProfile,
  isNativePluginName,
  isTrustedHostPluginProfile,
  requiredPluginNames
} = require('./lib/plugin-trust-security')
const _paq = window._paq = window._paq || []

const requiredModules = [...requiredPluginNames] // services + layout views + system views

const dependentModules = ['git', 'hardhat'] // module which shouldn't be manually activated (e.g git is activated by remixd)

// Profiles returned directly to an untrusted connector are capability
// metadata, not the manager's internal registration records. Keep this an
// explicit allowlist so new private fields (for example connector URLs or
// security diagnostics) cannot become public by accident.
const publicProfileFields = [
  'name', 'displayName', 'methods', 'events', 'permission', 'description',
  'documentation', 'version', 'kind', 'canActivate', 'icon', 'maintainedBy',
  'author', 'repo', 'authorContact', 'location'
]
const publicProfileArrayFields = new Set(['methods', 'events', 'canActivate'])

function clonePublicPluginProfile (profile) {
  if (!profile || typeof profile !== 'object') return profile
  const result = {}
  for (const key of publicProfileFields) {
    if (!Object.prototype.hasOwnProperty.call(profile, key)) continue
    const value = profile[key]
    if (publicProfileArrayFields.has(key)) {
      if (Array.isArray(value)) result[key] = value.filter((entry) => typeof entry === 'string')
    } else if (key === 'permission') {
      if (typeof value === 'boolean') result[key] = value
    } else if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

export function isNative (name) {
  return isNativePluginName(name)
}

/**
 * Checks if plugin caller 'from' is allowed to activate plugin 'to'
 * The caller can have 'canActivate' as a optional property in the plugin profile.
 * This is an array containing the 'name' property of the plugin it wants to call.
 * canActivate = ['plugin1-to-call','plugin2-to-call',....]
 * or the plugin is allowed by default because it is native
 *
 * @param {any, any}
 * @returns {boolean}
 */
export function canActivate (from, to) {
  return isTrustedHostPluginProfile(from) ||
  Boolean(to && from && from.canActivate && from.canActivate.includes(to.name))
}

export class RemixAppManager extends PluginManager {
  constructor () {
    super()
    // Manager lifecycle events carry complete plugin profiles. Mark the
    // manager as permission-aware so external event subscriptions go through
    // RemixEngine's event permission gate.
    this.profile = { ...clonePluginProfile(this.profile), permission: true }
    this.event = new EventEmitter()
    this.pluginLoader = new PluginLoader()
    this.permissionHandler = new PermissionHandler()
    this.fullProfileReadRequests = new WeakMap()
  }

  async getProfile (name) {
    if (!isSafePermissionKey(name) || !Object.prototype.hasOwnProperty.call(this.profiles, name)) return undefined

    const profile = this.profiles[name]
    const request = this.currentRequest
    if (!request || (typeof request === 'object' && this.fullProfileReadRequests.has(request))) return profile

    const callerName = request.from
    const callerProfile = isSafePermissionKey(callerName) && Object.prototype.hasOwnProperty.call(this.profiles, callerName)
      ? this.profiles[callerName]
      : null
    return isTrustedHostPluginProfile(callerProfile) ? profile : clonePublicPluginProfile(profile)
  }

  async canActivatePlugin (from, to) {
    return canActivate(from, to)
  }

  async canDeactivatePlugin (from, to) {
    if (requiredModules.includes(to.name)) return false
    return isTrustedHostPluginProfile(from)
  }

  async canUpdateProfile (from, to) {
    await super.canUpdateProfile(from, to)
    return assertSafeProfileUpdate(from, to)
  }

  async updateProfile (profile) {
    const request = this.currentRequest
    const scopedRequest = request && typeof request === 'object' ? request : null
    // PluginManager.updateProfile reads the caller through this.getProfile().
    // Keep that one request on the full-profile path so websocket handshakes
    // can resend unchanged identity fields while direct external reads remain
    // redacted. The manager request queue serializes connector calls, and the
    // identity check prevents an unrelated request from inheriting this scope.
    if (scopedRequest) {
      this.fullProfileReadRequests.set(scopedRequest, (this.fullProfileReadRequests.get(scopedRequest) || 0) + 1)
    }
    try {
      return await super.updateProfile(profile && clonePluginProfile(profile))
    } finally {
      if (scopedRequest) {
        const remaining = (this.fullProfileReadRequests.get(scopedRequest) || 1) - 1
        if (remaining > 0) this.fullProfileReadRequests.set(scopedRequest, remaining)
        else this.fullProfileReadRequests.delete(scopedRequest)
      }
    }
  }

  addProfile (profiles) {
    const cloneAndValidate = (profile) => {
      const cloned = clonePluginProfile(profile)
      return assertAllowedPluginProfile(cloned)
    }
    return super.addProfile(Array.isArray(profiles) ? profiles.map(cloneAndValidate) : cloneAndValidate(profiles))
  }

  async deactivatePlugin (name) {
    const [to, from] = [
      await this.getProfile(name),
      await this.getProfile(this.requestFrom)
    ]
    if (await this.canDeactivatePlugin(from, to)) {
      await this.toggleActive(name)
    }
  }

  async canCall (from, to, method, message) {
    const hasOwn = Object.prototype.hasOwnProperty
    const requestTarget = this.currentRequest && this.currentRequest.from
    // canCall is itself exposed by the manager. Bind its arguments back to the
    // permission-aware target that made the nested request, and never accept a
    // synthetic target/method tuple supplied directly by an external plugin.
    if (!isSafePermissionKey(from) || !isSafePermissionKey(to) || !isSafePermissionKey(method) ||
      to !== requestTarget || !hasOwn.call(this.profiles, from) || !hasOwn.call(this.profiles, to)) {
      return false
    }

    const targetProfile = this.profiles[to]
    if (!targetProfile || !hasOwn.call(targetProfile, 'methods') || !Array.isArray(targetProfile.methods) ||
      !targetProfile.methods.includes(method)) return false

    // skipping native plugins' requests
    const callerProfile = this.profiles[from]
    if (isTrustedHostPluginProfile(callerProfile)) {
      return true
    }
    // ask the user for permission
    return await this.permissionHandler.askPermission(this.profiles[from], this.profiles[to], method, message)
  }

  onPluginActivated (plugin) {
    this.pluginLoader.set(plugin, this.actives)
    this.event.emit('activate', plugin)
    if (!requiredModules.includes(plugin.name)) _paq.push(['trackEvent', 'pluginManager', 'activate', plugin.name])
  }

  getAll () {
    return Object.keys(this.profiles).map((p) => {
      return this.profiles[p]
    })
  }

  getIds () {
    return Object.keys(this.profiles)
  }

  onPluginDeactivated (plugin) {
    this.pluginLoader.set(plugin, this.actives)
    this.event.emit('deactivate', plugin)
    _paq.push(['trackEvent', 'pluginManager', 'deactivate', plugin.name])
  }

  isDependent (name) {
    return dependentModules.includes(name)
  }

  isRequired (name) {
    // excluding internal use plugins
    return requiredModules.includes(name)
  }

  async registeredPlugins () {
    const plugins = [
      {
        name: 'scriptRunner',
        displayName: 'Script Runner',
        description: 'Execute script and emit logs',
        version: '1.0.0-alpha.1',
        methods: [
          'execute'
        ],
        kind: 'none',
        icon: '/assets/plugins/scriptRunner/icon.png',
        location: 'hiddenPanel',
        // Use the concrete file, not the directory URL. The test host redirects
        // a slashless HTTPS directory to HTTP, which mixed-content blocking
        // turns into a plugin activation that never completes.
        url: '/assets/plugins/scriptRunner/index.html',
        repo: 'https://github.com/bunsenstraat/remix-script-runner',
        maintainedBy: 'Remix',
        authorContact: ''
      },
      {
        name: 'restorebackupzip',
        displayName: 'Restore Backup Zip',
        description: 'Use this to restore your TronIDE backup zip files to the new workspaces.',
        documentation: '',
        version: '0.1.0',
        events: [],
        methods: [],
        // Keep remembered permissions bound to the bundled plugin content.
        // The regression test recomputes this from index.html + bundle.js.
        hash: 'sha256:b09d52e2a8e4e841b8663b730db3b3647def389b3d613d1f38813cf2f04cb0cb',
        icon: '/assets/plugins/restorebackupzip/icon.png',
        location: 'mainPanel',
        url: '/assets/plugins/restorebackupzip/index.html',
        targets: [
          'remix'
        ],
        repo: 'https://github.com/bunsenstraat/restorezip',
        maintainedBy: '',
        authorContact: ''
      }
    ]
    return plugins.map(plugin => {
      // Bundled iframe code executes outside this class, but calls arrive at
      // its connector instance first. Gate that dispatch so an untrusted
      // plugin cannot turn a trusted utility such as scriptRunner into a
      // confused deputy that reads files or reaches unrestricted provider
      // APIs under the host plugin's identity.
      return installPermissionedCallPluginMethod(
        new IframePlugin(plugin),
        (method) => plugin.name === 'scriptRunner' && method === 'execute'
          ? 'execute script code with access to IDE capabilities'
          : `use bundled iframe capability ${plugin.name}.${method}`
      )
    })
  }
}

/** @class Reference loaders.
 *  A loader is a get,set based object which load a workspace from a defined sources.
 *  (localStorage, queryParams)
 **/
class PluginLoader {
  get currentLoader () {
    return this.loaders[this.current]
  }

  constructor () {
    const queryParams = new QueryParams()
    // releaseNotes is retained only as a legacy saved-workspace value. The
    // current Release Notes is a standalone document, so filter any stale
    // activation left by older versions instead of trying to load a removed
    // workbench plugin at startup.
    this.donotAutoReload = ['remixd', 'git', 'releaseNotes'] // that would be a bad practice to force loading some plugins at page load.
    this.loaders = {}
    this.loaders.localStorage = {
      set: (plugin, actives) => {
        const saved = actives.filter((name) => !this.donotAutoReload.includes(name))
        localStorage.setItem('workspace', JSON.stringify(saved))
      },
      get: () => {
        // Guard against a corrupt 'workspace' value: an unparseable string here
        // throws on the boot path (app.js run()) and white-screens the IDE.
        try {
          const saved = JSON.parse(localStorage.getItem('workspace'))
          return Array.isArray(saved) ? saved.filter((name) => !this.donotAutoReload.includes(name)) : []
        } catch (e) { return [] }
      }
    }

    this.loaders.queryParams = {
      set: () => {},
      get: () => {
        const { activate } = queryParams.get()
        if (!activate) return []
        return filterUrlPluginNames(activate)
      }
    }

    this.current = queryParams.get().activate ? 'queryParams' : 'localStorage'
  }

  set (plugin, actives) {
    this.currentLoader.set(plugin, actives)
  }

  get () {
    return this.currentLoader.get()
  }
}
