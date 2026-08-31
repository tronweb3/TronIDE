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

import { ViewPlugin } from '@remixproject/engine-web'

import * as packageJson from '../../../../../package.json'
import React from 'react' // eslint-disable-line
import ReactDOM from 'react-dom'
import { Workspace } from '@remix-ui/workspace' // eslint-disable-line
import { bufferToHex, keccakFromString } from 'ethereumjs-util'
import { checkSpecialChars, checkSlash } from '../../lib/helper'
const { RemixdHandle } = require('../files/remixd-handle.js')
const { GitHandle } = require('../files/git-handle.js')
const { SlitherHandle } = require('../files/slither-handle.js')
const globalRegistry = require('../../global/registry')
const examples = require('../editor/examples')
const { searchWorkspaceFiles, collectSearchableFiles, DEFAULT_LIMITS: SEARCH_LIMITS, DEFAULT_EXCLUDE_PATTERN: SEARCH_EXCLUDE } = require('../search/workspace-search')
const { workspace: remixLibWorkspace } = require('@remix-project/remix-lib')
const getTronTemplate = (id) => {
  try {
    return remixLibWorkspace.tronTemplates.getTronTemplate(id)
  } catch (e) {
    return null
  }
}
const getTronTemplateFiles = (template) => {
  try {
    return remixLibWorkspace.tronTemplates.getTronTemplateFiles(template)
  } catch (e) {
    return [{ path: template.path, content: template.content }]
  }
}
const GistHandler = require('../../lib/gist-handler')
const QueryParams = require('../../lib/query-params')
const { normalizeUrlImport } = require('../../lib/url-param-security')
const { DEEP_LINK_LIMITS, decodeUrlBase64 } = require('../../lib/url-base64')
const { STORAGE_MARKER_PATH } = require('../../lib/workspace-storage/migration')
const lastWorkspace = require('../../lib/last-workspace')
const modalDialogCustom = require('../ui/modal-dialog-custom')
const { requireUserPermission } = require('../ui/permission-security')
/*
  Overview of APIs:
   * fileManager: @args fileProviders (browser, shared-folder, swarm, github, etc ...) & config & editor
      - listen on browser & localhost file provider (`fileRenamed` & `fileRemoved`)
      - update the tabs, switchFile
      - trigger `currentFileChanged`
      - set the current file in the config
   * fileProvider: currently browser, swarm, localhost, github, gist
      - link to backend
      - provide properties `type`, `readonly`
      - provide API `resolveDirectory`, `remove`, `exists`, `rename`, `get`, `set`
      - trigger `fileExternallyChanged`, `fileRemoved`, `fileRenamed`, `fileRenamedError`, `fileAdded`
   * file-explorer: treeview @args fileProvider
      - listen on events triggered by fileProvider
      - call fileProvider API
*/

const profile = {
  name: 'filePanel',
  displayName: 'File explorers',
  methods: ['createNewFile', 'uploadFile', 'getCurrentWorkspace', 'getWorkspaces', 'createWorkspace', 'openCreateWorkspaceDialog', 'setWorkspace', 'registerContextMenuItem', 'getWorkspaceTemplates', 'aiSearchWorkspace'],
  events: ['setWorkspace', 'renameWorkspace', 'deleteWorkspace', 'createWorkspace'],
  icon: 'assets/img/fileManager.webp',
  description: ' - ',
  permission: true,
  kind: 'fileexplorer',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version
}
module.exports = class Filepanel extends ViewPlugin {
  constructor (appManager) {
    super(profile)
    this._components = {}
    this._components.registry = globalRegistry
    this._deps = {
      fileProviders: this._components.registry.get('fileproviders').api,
      fileManager: this._components.registry.get('filemanager').api
    }

    this.el = document.createElement('div')
    this.el.setAttribute('id', 'fileExplorerView')

    this.remixdHandle = new RemixdHandle(this._deps.fileProviders.localhost, appManager)
    this.gitHandle = new GitHandle()
    this.slitherHandle = new SlitherHandle()
    this.registeredMenuItems = []
    this.removedMenuItems = []
    this.request = {}
    this.workspaces = []
    this.initialWorkspace = null
    this.appManager = appManager
  }

  _withUserPermission (method, message, action) {
    if (!this.currentRequest) return action()
    return requireUserPermission(this, method, message).then(action)
  }

  render () {
    this.initWorkspace().then(() => this.getWorkspaces()).catch(console.error)
    return this.el
  }

  renderComponent () {
    ReactDOM.render(
      <Workspace
        createWorkspace={this.createWorkspace.bind(this)}
        renameWorkspace={this.renameWorkspace.bind(this)}
        setWorkspace={this.setWorkspace.bind(this)}
        workspaceRenamed={this.workspaceRenamed.bind(this)}
        workspaceDeleted={this.workspaceDeleted.bind(this)}
        workspaceCreated={this.workspaceCreated.bind(this)}
        workspace={this._deps.fileProviders.workspace}
        browser={this._deps.fileProviders.browser}
        localhost={this._deps.fileProviders.localhost}
        fileManager={this._deps.fileManager}
        registry={this._components.registry}
        plugin={this}
        request={this.request}
        workspaces={this.workspaces}
        registeredMenuItems={this.registeredMenuItems}
        removedMenuItems={this.removedMenuItems}
        initialWorkspace={this.initialWorkspace}
      />
      , this.el)
  }

  /**
   * @param item { id: string, name: string, type?: string[], path?: string[], extension?: string[], pattern?: string[] }
   * @param callback (...args) => void
   */
  registerContextMenuItem (item) {
    const caller = this.currentRequest && this.currentRequest.from
    return this._withUserPermission('registerContextMenuItem', 'register a workspace context-menu action', () => {
      // The action is later dispatched to item.id. Never let an external
      // connector route the click to another plugin or create an undeletable
      // sticky action under a victim's identity.
      const boundItem = caller ? { ...item, id: caller, sticky: false } : item
      return this._registerContextMenuItem(boundItem)
    })
  }

  _registerContextMenuItem (item) {
    if (!item) throw new Error('Invalid register context menu argument')
    if (!item.name || !item.id) throw new Error('Item name and id is mandatory')
    if (!item.type && !item.path && !item.extension && !item.pattern) throw new Error('Invalid file matching criteria provided')
    for (const field of ['type', 'path', 'extension', 'pattern']) {
      if (item[field] !== undefined && (!Array.isArray(item[field]) || item[field].some(value => typeof value !== 'string'))) {
        throw new Error(`Invalid ${field} matching criteria provided`)
      }
    }
    for (const pattern of item.pattern || []) {
      try {
        // Compile at registration time so malformed plugin input cannot crash
        // the FileExplorer render path when the context menu is opened.
        RegExp(pattern)
      } catch (error) {
        throw new Error(`Invalid pattern matching criteria provided: ${pattern}`)
      }
    }
    if (this.registeredMenuItems.filter((o) => {
      return o.id === item.id && o.name === item.name
    }).length) throw new Error(`Action ${item.name} already exists on ${item.id}`)
    this.registeredMenuItems = [...this.registeredMenuItems, item]
    this.removedMenuItems = this.removedMenuItems.filter(menuItem => item.id !== menuItem.id)
    this.renderComponent()
  }

  removePluginActions (plugin) {
    this.registeredMenuItems = this.registeredMenuItems.filter((item) => {
      if (item.id !== plugin.name || item.sticky === true) return true
      else {
        this.removedMenuItems.push(item)
        return false
      }
    })
    this.renderComponent()
  }

  async getCurrentWorkspace () {
    await requireUserPermission(this, 'getCurrentWorkspace', 'read the current workspace name')
    return await this.request.getCurrentWorkspace()
  }

  // AI assistant: content search across the current workspace, reusing the
  // Search panel's pure engine + shared collector. Read-only. options:
  // { query, useRegex, matchCase, matchWholeWord, includePattern, excludePattern }.
  // Defaults are AI-friendly: include '*' (every searchable text file, not just
  // the panel's '*.sol, *.js') and the standard dot-dir exclude.
  async aiSearchWorkspace (options = {}) {
    await requireUserPermission(this, 'aiSearchWorkspace', 'search workspace file contents')
    const fileManager = this._deps.fileManager
    const { files, skippedFiles, warnings } = await collectSearchableFiles(fileManager, SEARCH_LIMITS)
    const result = searchWorkspaceFiles(files, {
      query: String(options.query || ''),
      includePattern: options.includePattern ? String(options.includePattern) : '*',
      excludePattern: options.excludePattern ? String(options.excludePattern) : SEARCH_EXCLUDE,
      matchCase: !!options.matchCase,
      matchWholeWord: !!options.matchWholeWord,
      useRegex: !!options.useRegex,
      skippedFiles,
      limits: SEARCH_LIMITS
    })
    if (warnings.length) result.warnings = warnings.concat(result.warnings || [])
    return result
  }

  // The TRON starter templates a new workspace can be seeded from (id/name/
  // description). Exposed so the AI assistant can offer them for create_workspace.
  getWorkspaceTemplates () {
    return this._withUserPermission('getWorkspaceTemplates', 'read available workspace templates', () => {
      try {
        const list = remixLibWorkspace && remixLibWorkspace.tronTemplates && remixLibWorkspace.tronTemplates.TRON_TEMPLATES
        return (list || []).map((t) => ({ id: t.id, name: t.name, description: t.description }))
      } catch (e) {
        return []
      }
    })
  }

  async getWorkspaces () {
    await requireUserPermission(this, 'getWorkspaces', 'list workspace names')
    const result = new Promise((resolve, reject) => {
      const workspacesPath = this._deps.fileProviders.workspace.workspacesPath
      this._deps.fileProviders.browser.resolveDirectory('/' + workspacesPath, (error, items) => {
        if (error) {
          console.error(error)
          return reject(error)
        }
        resolve(Object.keys(items)
          .filter((item) => items[item].isDirectory)
          .map((folder) => folder.replace(workspacesPath + '/', '')))
      })
    })
    try {
      this.workspaces = await result
    } catch (e) {
      modalDialogCustom.alert('Workspaces have not been created on your system. Please use "Migrate old filesystem to workspace" on the home page to transfer your files or start by creating a new workspace in the File Explorers.')
      console.log(e)
    }
    this.renderComponent()
    return this.workspaces
  }

  async initWorkspace () {
    this.renderComponent()
    const queryParams = new QueryParams()
    const gistHandler = new GistHandler()
    const params = queryParams.get()
    // get the file from gist
    let loadedFromGist = false
    if (params.gist) {
      await this.processCreateWorkspace('gist-sample')
      this._deps.fileProviders.workspace.setWorkspace('gist-sample')
      this.initialWorkspace = 'gist-sample'
      loadedFromGist = gistHandler.loadFromGist(params, this._deps.fileManager)
    }
    if (loadedFromGist) return

    if (params.code || params.url) {
      try {
        const safeImportUrl = params.url ? normalizeUrlImport(params.url) : null
        if (params.url && !safeImportUrl) {
          modalDialogCustom.alert(
            'URL import blocked',
            'For your security, URL deep links can only import source files from GitHub or GitHub Gist over HTTPS.'
          )
          return
        }
        // Validate and decode before creating/switching workspaces. A malformed
        // deep link must not strand the user in an empty `code-sample`
        // workspace, and UTF-8 bytes must not be interpreted as Latin-1.
        const decodedCode = params.code ? decodeUrlBase64(params.code, DEEP_LINK_LIMITS.code) : null
        const decodedRemappings = params.remaps ? decodeUrlBase64(params.remaps, DEEP_LINK_LIMITS.remaps) : null
        await this.processCreateWorkspace('code-sample')
        const workspaceProvider = this._deps.fileProviders.workspace
        workspaceProvider.setWorkspace('code-sample')
        // A URL import can finish after the user has switched branches or
        // workspaces. Bind both deep-link variants before that async resolve so
        // the provider rejects the eventual write instead of targeting the new
        // workspace implicitly.
        const mutationContext = workspaceProvider.captureMutationContext()
        const writeDeepLinkFile = (path, content) => new Promise((resolve, reject) => {
          workspaceProvider.set(path, content, (error) => error ? reject(error) : resolve(true), mutationContext)
        })
        let path = ''
        let content = ''
        if (params.code) {
          var hash = bufferToHex(keccakFromString(params.code))
          path = 'contract-' + hash.replace('0x', '').substring(0, 10) + '.sol'
          content = decodedCode
          await writeDeepLinkFile(path, content)
        }
        if (decodedRemappings !== null) {
          await writeDeepLinkFile('remappings.txt', decodedRemappings)
        }
        if (safeImportUrl) {
          const data = await this.call('contentImport', 'resolve', safeImportUrl)
          path = data.cleanUrl
          content = data.content
          await writeDeepLinkFile(path, content)
        }
        this.initialWorkspace = 'code-sample'
        await this._deps.fileManager.openFile(path)
      } catch (e) {
        console.error(e)
        modalDialogCustom.alert('Unable to import source', e && e.message ? e.message : 'The source link could not be decoded.')
      }
      return
    }

    const self = this
    this.appManager.on('manager', 'pluginDeactivated', self.removePluginActions.bind(this))
    // insert example contracts if there are no files to show
    return new Promise((resolve, reject) => {
      this._deps.fileProviders.browser.resolveDirectory('/', async (error, filesList) => {
        if (error) return reject(error)
        // The IndexedDB backend keeps one verified root marker. It is storage
        // metadata, not user content; a fresh browser must still receive the
        // default workspace instead of being mistaken for a legacy root that
        // needs manual migration.
        const userRootEntries = Object.keys(filesList).filter((entry) => `/${entry.replace(/^\/+/, '')}` !== STORAGE_MARKER_PATH)
        if (userRootEntries.length === 0) {
          await this.createWorkspace('default_workspace')
          resolve('default_workspace')
        } else {
          this._deps.fileProviders.browser.resolveDirectory('.workspaces', async (error, filesList) => {
            if (error) return reject(error)
            if (Object.keys(filesList).length > 0) {
              const available = Object.keys(filesList).map((path) => {
                const parts = path.split('/').filter(val => val)
                return parts[parts.length - 1]
              })
              // prefer the workspace the user last worked in (persisted by
              // workspaceFileProvider.setWorkspace) over the arbitrary first
              // directory entry — a restart used to land on the
              // alphabetically-first workspace (typically default_workspace).
              // lastWorkspace prefers THIS tab's own marker (sessionStorage)
              // over the cross-tab localStorage fallback, so a reload cannot
              // adopt whatever workspace another tab touched last.
              const saved = lastWorkspace.get()
              const workspaceName = (saved && available.includes(saved)) ? saved : available[0]

              this._deps.fileProviders.workspace.setWorkspace(workspaceName)
              return resolve(workspaceName)
            }
            return reject(new Error('Can\'t find available workspace.'))
          })
        }
      })
    })
  }

  async createNewFile (suggestedName) {
    await requireUserPermission(this, 'createNewFile', 'create a workspace file')
    return await this.request.createNewFile(suggestedName)
  }

  async uploadFile (event) {
    await requireUserPermission(this, 'uploadFile', 'upload a workspace file')
    return await this.request.uploadFile(event)
  }

  _workspaceMutation (action, suppliedToken) {
    if (suppliedToken !== undefined) {
      this._deps.fileManager.assertWorkspaceMutationToken(suppliedToken)
      return { token: suppliedToken, owned: false }
    }
    return { token: this._deps.fileManager.beginWorkspaceMutation(action), owned: true }
  }

  async processCreateWorkspace (name, mutationToken) {
    const mutation = this._workspaceMutation('create workspaces', mutationToken)
    try {
      const workspaceProvider = this._deps.fileProviders.workspace
      const browserProvider = this._deps.fileProviders.browser
      const workspacePath = 'browser/' + workspaceProvider.workspacesPath + '/' + name
      const workspaceRootPath = 'browser/' + workspaceProvider.workspacesPath
      const workspaceRootPathExists = await browserProvider.exists(workspaceRootPath)
      const workspacePathExists = await browserProvider.exists(workspacePath)

      // Recheck after the async existence reads and immediately before the raw
      // browser-provider mutations. The surrounding workspace lease also keeps
      // Git checkout from starting until the whole create/switch flow completes.
      this._deps.fileManager.assertWorkspaceMutationToken(mutation.token)
      if (!workspaceRootPathExists) await browserProvider.createDir(workspaceRootPath)
      if (!workspacePathExists) await browserProvider.createDir(workspacePath)
    } finally {
      if (mutation.owned) this._deps.fileManager.endWorkspaceMutation(mutation.token)
    }
  }

  async workspaceExists (name) {
    const workspaceProvider = this._deps.fileProviders.workspace
    const browserProvider = this._deps.fileProviders.browser
    const workspacePath = 'browser/' + workspaceProvider.workspacesPath + '/' + name
    return browserProvider.exists(workspacePath)
  }

  async createWorkspace (workspaceName, setDefaultsOrTemplateId = true, suppliedMutationToken) {
    await requireUserPermission(this, 'createWorkspace', 'create and select a workspace')
    const mutation = this._workspaceMutation('create workspaces', suppliedMutationToken)
    try {
      if (!workspaceName) throw new Error('name cannot be empty')
      if (checkSpecialChars(workspaceName) || checkSlash(workspaceName)) throw new Error('special characters are not allowed')
      if (await this.workspaceExists(workspaceName)) throw new Error('workspace already exists')
      const workspaceProvider = this._deps.fileProviders.workspace
      await this.processCreateWorkspace(workspaceName, mutation.token)
      workspaceProvider.setWorkspace(workspaceName)
      await this.request.setWorkspace(workspaceName, mutation.token) // tells the react component to switch to that workspace
      // second arg keeps its historical boolean meaning (seed the default
      // sample contracts); a string selects one of the TRON templates instead
      const template = typeof setDefaultsOrTemplateId === 'string' ? getTronTemplate(setDefaultsOrTemplateId) : null
      if (template) {
        // seeding only — the caller opens the file after the UI has switched
        // workspaces, or the switch would close the tab again
        for (const file of getTronTemplateFiles(template)) {
          await workspaceProvider.set(file.path, file.content)
        }
      } else if (setDefaultsOrTemplateId === true || typeof setDefaultsOrTemplateId === 'string') {
        // unknown template id falls back to the default seed rather than an empty workspace
        for (const file in examples) {
          try {
            await workspaceProvider.set(examples[file].name, examples[file].content)
          } catch (error) {
            console.error(error)
          }
        }
      }
    } finally {
      if (mutation.owned) this._deps.fileManager.endWorkspaceMutation(mutation.token)
    }
  }

  async openCreateWorkspaceDialog () {
    await requireUserPermission(this, 'openCreateWorkspaceDialog', 'open the workspace creation dialog')
    if (!this.request || typeof this.request.createWorkspace !== 'function') {
      throw new Error('The workspace creator is not ready. Try again.')
    }
    return this.request.createWorkspace()
  }

  async renameWorkspace (oldName, workspaceName, suppliedMutationToken) {
    const mutation = this._workspaceMutation('rename workspaces', suppliedMutationToken)
    try {
      if (!workspaceName) throw new Error('name cannot be empty')
      if (checkSpecialChars(workspaceName) || checkSlash(workspaceName)) throw new Error('special characters are not allowed')
      if (await this.workspaceExists(workspaceName)) throw new Error('workspace already exists')
      this._deps.fileManager.assertWorkspaceMutationToken(mutation.token)
      const browserProvider = this._deps.fileProviders.browser
      const workspacesPath = this._deps.fileProviders.workspace.workspacesPath
      await browserProvider.rename('browser/' + workspacesPath + '/' + oldName, 'browser/' + workspacesPath + '/' + workspaceName, true)
    } finally {
      if (mutation.owned) this._deps.fileManager.endWorkspaceMutation(mutation.token)
    }
  }

  /** these are called by the react component, action is already finished whent it's called */
  async setWorkspace (workspace, setEvent = true, syncComponent = false, suppliedMutationToken) {
    await requireUserPermission(this, 'setWorkspace', 'change the current workspace')
    const mutation = this._workspaceMutation('switch workspaces', suppliedMutationToken)
    try {
      if (typeof workspace === 'string') workspace = { name: workspace, isLocalhost: false }
      if (syncComponent && this.request.setWorkspace) return await this.request.setWorkspace(workspace.name, mutation.token)
      if (workspace.isLocalhost) {
        // remixd's provider can finish its handshake while the plugin manager
        // is still inside toggleActive(). Its init callback calls back into
        // this method before the manager has added remixd to actives. Asking
        // the manager to activate remixd again from that callback recursively
        // toggles the same plugin and leaves it deactivated. A call originating
        // from remixd is already part of that activation; let it publish the
        // localhost workspace without re-entering the manager.
        const caller = this.currentRequest && this.currentRequest.from
        // The daemon emits `connected` before the workspace component's
        // listener publishes localhost. In that callback the provider is
        // already live; trying to activate remixd again (and awaiting the
        // handle's own initialisation promise) deadlocks the workspace lease.
        // Let the existing connection proceed and only activate when this is
        // a genuinely disconnected workspace request.
        if (caller !== 'remixd' && !this._deps.fileProviders.localhost.isConnected()) {
          this.remixdHandle.requestWorkspaceActivation()
          try {
            await this.call('manager', 'activatePlugin', 'remixd')
            await this.remixdHandle.whenReady()
          } finally {
            this.remixdHandle.clearWorkspaceActivationRequest()
          }
        }
      } else if (this._deps.fileProviders.localhost.isConnected() && await this.call('manager', 'isActive', 'remixd')) {
      // Wait for the disconnect event to settle before publishing the browser
      // workspace. The Workspace component has already recorded the user's
      // destination, so the event only hides the localhost tree.
        await this.call('manager', 'deactivatePlugin', 'remixd')
      }
      if (setEvent) {
        this._deps.fileManager.setMode(workspace.isLocalhost ? 'localhost' : 'browser')
        this.emit('setWorkspace', workspace)
      }
    } finally {
      if (mutation.owned) this._deps.fileManager.endWorkspaceMutation(mutation.token)
    }
  }

  workspaceRenamed (workspace) {
    this.emit('renameWorkspace', workspace)
  }

  workspaceDeleted (workspace) {
    this.emit('deleteWorkspace', workspace)
  }

  workspaceCreated (workspace) {
    this.emit('createWorkspace', workspace)
  }
  /** end section */
}
