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

/* global localStorage, fetch */
import { PluginManager } from '@remixproject/engine'
import { SecureIframePlugin as IframePlugin } from './app/components/secure-iframe-plugin'
import { EventEmitter } from 'events'
import QueryParams from './lib/query-params'
import { PermissionHandler } from './app/ui/persmission-handler'
const _paq = window._paq = window._paq || []

const requiredModules = [ // services + layout views + system views
  'manager', 'compilerArtefacts', 'compilerMetadata', 'contextualListener', 'editor', 'offsetToLineColumnConverter', 'network', 'theme',
  'fileManager', 'contentImport', 'web3Provider', 'scriptRunner', 'fetchAndCompile', 'mainPanel', 'hiddenPanel', 'sidePanel', 'menuicons',
  'filePanel', 'terminal', 'settings', 'pluginManager', 'tabs', 'udapp', 'dGitProvider', 'aiPanel', 'headerPanel']

const dependentModules = ['git', 'hardhat'] // module which shouldn't be manually activated (e.g git is activated by remixd)

export function isNative (name) {
  const nativePlugins = ['vyper', 'workshops', 'debugger', 'remixd', 'menuicons', 'solidity', 'hardhat-provider', 'solidityStaticAnalysis', 'solidityUnitTesting']
  return nativePlugins.includes(name) || requiredModules.includes(name)
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
  return ['ethdoc'].includes(from.name) ||
  isNative(from.name) ||
  (to && from && from.canActivate && from.canActivate.includes(to.name))
}

export class RemixAppManager extends PluginManager {
  constructor () {
    super()
    this.event = new EventEmitter()
    this.pluginsDirectory = 'https://raw.githubusercontent.com/ethereum/remix-plugins-directory/master/build/metadata.json'
    this.pluginLoader = new PluginLoader()
    this.permissionHandler = new PermissionHandler()
  }

  async canActivatePlugin (from, to) {
    return canActivate(from, to)
  }

  async canDeactivatePlugin (from, to) {
    if (requiredModules.includes(to.name)) return false
    return isNative(from.name)
  }

  async deactivatePlugin (name) {
    const [to, from] = [
      await this.getProfile(name),
      await this.getProfile(this.requestFrom)
    ]
    if (this.canDeactivatePlugin(from, to)) {
      await this.toggleActive(name)
    }
  }

  async canCall (from, to, method, message) {
    // Make sure the caller of this methods is the target plugin
    if (to !== this.currentRequest.from) {
      return false
    }
    // skipping native plugins' requests
    if (isNative(from)) {
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
    let plugins
    try {
      // const res = await fetch(this.pluginsDirectory)
      // plugins = await res.json()
      // plugins = plugins.filter((plugin) => {
      //   if (plugin.targets && Array.isArray(plugin.targets) && plugin.targets.length > 0) {
      //     return (plugin.targets.includes('remix'))
      //   }
      //   return true
      // })
      // plugins = plugins.filter(plugin => {
      //   return [
      //     'scriptRunner', 'restorebackupzip'
      //   ].includes(plugin.name)
      // })
      plugins = [
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
          url: '/assets/plugins/scriptRunner',
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
          icon: '/assets/plugins/restorebackupzip/icon.png',
          location: 'mainPanel',
          url: '/assets/plugins/restorebackupzip',
          targets: [
            'remix'
          ],
          repo: 'https://github.com/bunsenstraat/restorezip',
          maintainedBy: '',
          authorContact: ''
        }
      ]
      localStorage.setItem('plugins-directory', JSON.stringify(plugins))
    } catch (e) {
      console.log('getting plugins list from localstorage...')
      const savedPlugins = localStorage.getItem('plugins-directory')
      if (savedPlugins) {
        try {
          plugins = JSON.parse(savedPlugins)
        } catch (e) {
          console.error(e)
        }
      }
    }
    return plugins.map(plugin => {
      return new IframePlugin(plugin)
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
    this.donotAutoReload = ['remixd', 'git'] // that would be a bad practice to force loading some plugins at page load.
    this.loaders = {}
    this.loaders.localStorage = {
      set: (plugin, actives) => {
        const saved = actives.filter((name) => !this.donotAutoReload.includes(name))
        localStorage.setItem('workspace', JSON.stringify(saved))
      },
      get: () => { return JSON.parse(localStorage.getItem('workspace')) }
    }

    this.loaders.queryParams = {
      set: () => {},
      get: () => {
        const { activate } = queryParams.get()
        if (!activate) return []
        return activate.split(',')
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
