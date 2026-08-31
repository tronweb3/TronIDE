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

// import yo from 'yo-yo'
import async from 'async'
import notification from 'antd/lib/notification'
import { Plugin } from '@remixproject/engine'
import * as packageJson from '../../../../../package.json'
const EventEmitter = require('events')
const globalRegistry = require('../../global/registry')
// const toaster = require('../ui/tooltip')
const modalDialogCustom = require('../ui/modal-dialog-custom')
const helper = require('../../lib/helper.js')
const { hasUserPermission, requireUserPermission } = require('../ui/permission-security')

/*
  attach to files event (removed renamed)
  trigger: currentFileChanged
*/

const profile = {
  name: 'fileManager',
  displayName: 'File manager',
  description: 'Service - read/write to any files or folders, require giving permissions',
  icon: 'assets/img/fileManager.webp',
  permission: true,
  version: packageJson.version,
  // The checked-save/rewrite-lock/sync trio brackets Git operations that
  // replace worktree files. getOpenedFiles lets the AI panel see which tabs
  // are open without a key ever leaving.
  methods: ['file', 'exists', 'open', 'writeFile', 'readFile', 'copyFile', 'copyDir', 'rename', 'mkdir', 'readdir', 'remove', 'getCurrentFile', 'getOpenedFiles', 'getFile', 'getFolder', 'setFile', 'switchFile', 'refresh', 'getProviderOf', 'getProviderByName', 'saveCurrentFileChecked', 'captureWorkspaceMutationContext', 'beginWorkspaceRewrite', 'endWorkspaceRewrite', 'syncEditor', 'reconcileOpenFilesAfterRewrite'],
  events: ['currentFileChanged', 'fileAdded', 'fileClosed', 'fileRemoved', 'fileRenamed', 'fileSaved', 'filesAllClosed', 'noFileSelected'],
  kind: 'file-system'
}
const errorMsg = {
  ENOENT: 'No such file or directory',
  EISDIR: 'Path is a directory',
  ENOTDIR: 'Path is not on a directory',
  EEXIST: 'File already exists',
  EPERM: 'Permission denied'
}
const createError = (err) => {
  return new Error(`${errorMsg[err.code]} ${err.message || ''}`)
}

class FileManager extends Plugin {
  constructor (editor, appManager) {
    super(profile)
    this.mode = 'browser'
    this.openedFiles = {} // list all opened files
    this.events = new EventEmitter()
    this.editor = editor
    this._workspaceRewriteLock = null
    this._workspaceRewriteToken = 0
    this._workspaceMutationOwner = null
    this._workspaceMutationSequence = 0
    this._components = {}
    this._components.registry = globalRegistry
    this.appManager = appManager
    // Invalidate callbacks from reads that started before a workspace or
    // provider switch. BrowserFS callbacks are asynchronous, so a read that
    // resumes after closeAllFiles must never repopulate the editor session.
    this._fileReadEpoch = 0
    this.init()
  }

  _withUserPermission (method, message, action) {
    if (!this.currentRequest) return action()
    return requireUserPermission(this, method, message).then(action)
  }

  getOpenedFiles () {
    return this._withUserPermission('getOpenedFiles', 'inspect opened files', () => this.openedFiles)
  }

  setMode (mode) {
    if (mode !== this.mode) this._fileReadEpoch++
    this.mode = mode
  }

  _captureFileReadContext (path, provider) {
    const readContext = {
      epoch: this._fileReadEpoch,
      provider,
      mutationContext: undefined
    }
    if (provider && typeof provider.captureMutationContext === 'function') {
      try { readContext.mutationContext = provider.captureMutationContext() } catch (error) {}
    }
    return readContext
  }

  _isFileReadContextCurrent (path, readContext) {
    if (!readContext || readContext.epoch !== this._fileReadEpoch) return false
    if (this.fileProviderOf(path) !== readContext.provider) return false
    if (readContext.mutationContext && typeof readContext.provider.captureMutationContext === 'function') {
      let currentContext
      try { currentContext = readContext.provider.captureMutationContext() } catch (error) { return false }
      return currentContext && currentContext.workspace === readContext.mutationContext.workspace &&
        currentContext.generation === readContext.mutationContext.generation
    }
    return true
  }

  _assertNoWorkspaceRewrite (action) {
    if (this._workspaceRewriteLock) throw new Error(`Cannot ${action} while Git is switching or updating the workspace.`)
  }

  assertWorkspaceMutationAllowed (action = 'change workspaces') {
    this._assertNoWorkspaceRewrite(action)
    return true
  }

  beginWorkspaceMutation (action = 'change workspaces') {
    this._assertNoWorkspaceRewrite(action)
    if (this._workspaceMutationOwner !== null) throw new Error('Another workspace change is already in progress.')
    const token = ++this._workspaceMutationSequence
    this._workspaceMutationOwner = token
    return token
  }

  assertWorkspaceMutationToken (token) {
    this._assertNoWorkspaceRewrite('change workspaces')
    if (this._workspaceMutationOwner !== token) throw new Error('The workspace change is no longer active.')
    return true
  }

  endWorkspaceMutation (token) {
    if (this._workspaceMutationOwner !== token) return false
    this._workspaceMutationOwner = null
    return true
  }

  _captureWorkspaceMutationContext (path) {
    try {
      const provider = this.fileProviderOf(path || '/')
      return provider && typeof provider.captureMutationContext === 'function'
        ? provider.captureMutationContext()
        : undefined
    } catch (error) { return undefined }
  }

  captureWorkspaceMutationContext (path = '/') {
    return this._withUserPermission('captureWorkspaceMutationContext', `bind ${path} to the active workspace`, () => {
      path = this.limitPluginScope(path)
      const context = this._captureWorkspaceMutationContext(path)
      if (!context) throw new Error('The active workspace could not be bound to this file operation.')
      return context
    })
  }

  limitPluginScope (path) {
    if (typeof path !== 'string') throw new TypeError('File paths must be strings')
    // `browser` is the BrowserFS provider namespace, not a plugin-visible
    // directory. Only the complete `browser/` prefix may be translated to a
    // workspace-relative path; otherwise `browser` exposes the root (and
    // `browserfoo` could be routed to the provider by prefix matching).
    const isBrowserNamespace = path === 'browser' || path === '/browser' ||
      (path.startsWith('browser') && !path.startsWith('browser/')) ||
      (path.startsWith('/browser') && !path.startsWith('/browser/'))
    if (this.currentRequest && isBrowserNamespace) {
      throw new Error('Browser provider root paths are not available to plugins.')
    }
    return path.replace(/^\/browser\//, '').replace(/^browser\//, '') // forbids plugin to access the root filesystem
  }

  /**
   * Emit error if path doesn't exist
   * @param {string} path path of the file/directory
   * @param {string} message message to display if path doesn't exist.
   */
  async _handleExists (path, message) {
    const exists = await this._exists(path)

    if (!exists) {
      throw createError({ code: 'ENOENT', message })
    }
  }

  /**
   * Emit error if path is not a file
   * @param {string} path path of the file/directory
   * @param {string} message message to display if path is not a file.
   */
  async _handleIsFile (path, message) {
    const isFile = await this.isFile(path)

    if (!isFile) {
      throw createError({ code: 'EISDIR', message })
    }
  }

  /**
   * Emit error if path is not a directory
   * @param {string} path path of the file/directory
   * @param {string} message message to display if path is not a directory.
   */
  async _handleIsDir (path, message) {
    const isDir = await this.isDirectory(path)

    if (!isDir) {
      throw createError({ code: 'ENOTDIR', message })
    }
  }

  /** The current opened file */
  file () {
    return this._withUserPermission('file', 'get the current file', () => this._currentFileOrThrow())
  }

  getCurrentFile () {
    return this._withUserPermission('getCurrentFile', 'get the current file', () => this._currentFileOrThrow())
  }

  _currentFileOrThrow () {
    const file = this.currentFile()
    if (!file) throw createError({ code: 'ENOENT', message: 'No file selected' })
    return file
  }

  /**
   * Verify if the path exists (directory or file)
   * @param {string} path path of the directory or file
   * @returns {boolean} true if the path exists
   */
  exists (path) {
    try {
      path = this.limitPluginScope(path)
      return this._withUserPermission('exists', `check whether ${path} exists`, () => this._exists(path))
    } catch (e) {
      throw new Error(e)
    }
  }

  _exists (path) {
    const provider = this.fileProviderOf(path)
    return provider.exists(path)
  }

  /*
  * refresh the file explorer
  */
  refresh (changedPaths = []) {
    return this._withUserPermission('refresh', 'refresh the file explorer', () => this._refresh(changedPaths))
  }

  _refresh (changedPaths = []) {
    const provider = this.fileProviderOf('/')
    // emit folderAdded so that File Explorer reloads the file tree
    provider.event.emit('folderAdded', '/')
    // A root-only refresh merges the existing nested tree and can leave an
    // expanded folder stale after raw Git restores/removes a file. Treat each
    // affected filepath as a folder-change hint: the explorer refresh handler
    // intentionally reloads its parent directory.
    // The root event above already refreshes root-level files.
    const hintedParents = new Set(['/'])
    for (const filepath of Array.isArray(changedPaths) ? changedPaths : []) {
      if (!filepath) continue
      const hint = String(filepath).replace(/^\/+|\/+$/g, '')
      const separator = hint.lastIndexOf('/')
      const parent = separator < 0 ? '/' : hint.slice(0, separator)
      // folderAdded derives the directory to reload from the hint's parent.
      // One representative child per parent is enough; emitting every tracked
      // file during checkout can otherwise enqueue thousands of identical tree
      // reloads for a large repository.
      if (!hintedParents.has(parent)) {
        hintedParents.add(parent)
        provider.event.emit('folderAdded', hint)
      }
    }
  }

  /**
   * Verify if the path provided is a file
   * @param {string} path path of the directory or file
   * @returns {boolean} true if path is a file.
   */
  isFile (path) {
    const provider = this.fileProviderOf(path)
    const result = provider.isFile(path)

    return result
  }

  /**
   * Verify if the path provided is a directory
   * @param {string} path path of the directory
   * @returns {boolean} true if path is a directory.
   */
  async isDirectory (path) {
    const provider = this.fileProviderOf(path)
    const result = await provider.isDirectory(path)

    return result
  }

  /**
   * Open the content of the file in the context (eg: Editor)
   * @param {string} path path of the file
   * @returns {void}
   */
  async open (path) {
    try {
      path = this.limitPluginScope(path)
      await requireUserPermission(this, 'open', `open ${path}`)
      return this._open(path)
    } catch (e) {
      throw new Error(e)
    }
  }

  async switchFile (path) {
    try {
      path = this.limitPluginScope(path)
      await requireUserPermission(this, 'switchFile', `open ${path}`)
      return this._open(path)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _open (path) {
    await this._handleExists(path, `Cannot open file ${path}`)
    await this._handleIsFile(path, `Cannot open file ${path}`)
    return this.openFile(path)
  }

  /**
   * Set the content of a specific file
   * @param {string} path path of the file
   * @param {string} data content to write on the file
   * @returns {void}
   */
  async writeFile (path, data, mutationContext) {
    let writeContext = mutationContext
    try {
      this._assertNoWorkspaceRewrite('write files')
      path = this.limitPluginScope(path)
      if (writeContext === undefined) writeContext = this._captureWorkspaceMutationContext(path)
      await requireUserPermission(this, 'writeFile', `modify ${path}`)
      return this._writeFile(path, data, writeContext)
    } catch (e) {
      throw new Error(e)
    }
  }

  async setFile (path, data, mutationContext) {
    let writeContext = mutationContext
    try {
      this._assertNoWorkspaceRewrite('write files')
      path = this.limitPluginScope(path)
      if (writeContext === undefined) writeContext = this._captureWorkspaceMutationContext(path)
      await requireUserPermission(this, 'setFile', `modify ${path}`)
      return this._writeFile(path, data, writeContext)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _writeFile (path, data, mutationContext) {
    const writeContext = mutationContext === undefined ? this._captureWorkspaceMutationContext(path) : mutationContext
    if (await this._exists(path)) {
      await this._handleIsFile(path, `Cannot write file ${path}`)
      return await this.setFileContent(path, data, writeContext)
    }
    const ret = await this.setFileContent(path, data, writeContext)
    this.emit('fileAdded', path)
    return ret
  }

  /**
   * Return the content of a specific file
   * @param {string} path path of the file
   * @returns {string} content of the file
   */
  async readFile (path) {
    try {
      path = this.limitPluginScope(path)
      await requireUserPermission(this, 'readFile', `read ${path}`)
      return this._readFile(path)
    } catch (e) {
      throw new Error(e)
    }
  }

  async getFile (path) {
    try {
      path = this.limitPluginScope(path)
      await requireUserPermission(this, 'getFile', `read ${path}`)
      return this._readFile(path)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _readFile (path) {
    await this._handleExists(path, `Cannot read file ${path}`)
    await this._handleIsFile(path, `Cannot read file ${path}`)
    return this.getFileContent(path)
  }

  /**
   * Upsert a file with the content of the source file
   * @param {string} src path of the source file
   * @param {string} dest path of the destrination file
   * @returns {void}
   */
  async copyFile (src, dest, customName, mutationContext) {
    let writeContext = mutationContext
    try {
      this._assertNoWorkspaceRewrite('copy files')
      src = this.limitPluginScope(src)
      dest = this.limitPluginScope(dest)
      if (writeContext === undefined) writeContext = this._captureWorkspaceMutationContext(dest)
      await requireUserPermission(this, 'copyFile', `copy ${src} into ${dest}`)
      await this._saveActiveCopySource(src, false)
      return this._copyFile(src, dest, customName, writeContext)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _copyFile (src, dest, customName, mutationContext) {
    await this._handleExists(src, `Cannot copy from ${src}. Path does not exist.`)
    await this._handleIsFile(src, `Cannot copy from ${src}. Path is not a file.`)
    await this._handleExists(dest, `Cannot paste content into ${dest}. Path does not exist.`)
    await this._handleIsDir(dest, `Cannot paste content into ${dest}. Path is not directory.`)
    const content = await this._readFile(src)
    let copiedFilePath = dest + (customName ? '/' + customName : '/' + `Copy_${helper.extractNameFromKey(src)}`)
    copiedFilePath = await helper.createNonClashingNameAsync(copiedFilePath, this._permissionlessFileLookup())

    await this._writeFile(copiedFilePath, content, mutationContext)
  }

  /**
   * Upsert a directory with the content of the source directory
   * @param {string} src path of the source dir
   * @param {string} dest path of the destination dir
   * @returns {void}
   */
  async copyDir (src, dest, mutationContext) {
    let writeContext = mutationContext
    try {
      this._assertNoWorkspaceRewrite('copy folders')
      src = this.limitPluginScope(src)
      dest = this.limitPluginScope(dest)
      if (writeContext === undefined) writeContext = this._captureWorkspaceMutationContext(dest)
      await requireUserPermission(this, 'copyDir', `copy directory ${src} into ${dest}`)
      await this._saveActiveCopySource(src, true)
      return this._copyDir(src, dest, writeContext)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _saveActiveCopySource (src, isDirectory) {
    const currentFile = this._deps.config.get('currentFile')
    if (!currentFile || !this.editor.current()) return

    const normalize = (value) => String(value).replace(/^\/+/, '').replace(/\/+$/, '')
    const sourcePath = normalize(src)
    const currentPath = normalize(currentFile)
    const containsCurrentFile = isDirectory
      ? currentPath === sourcePath || currentPath.startsWith(sourcePath + '/')
      : currentPath === sourcePath

    // Copy reads provider bytes, not the live editor buffer. Flush the active
    // source through the durable save barrier first so an immediate copy can
    // never reproduce an older or empty on-disk version.
    if (containsCurrentFile) await this._saveCurrentFileChecked()
  }

  async _copyDir (src, dest, mutationContext) {
    await this._handleExists(src, `Cannot copy from ${src}. Path does not exist.`)
    await this._handleIsDir(src, `Cannot copy from ${src}. Path is not a directory.`)
    await this._handleExists(dest, `Cannot paste content into ${dest}. Path does not exist.`)
    await this._handleIsDir(dest, `Cannot paste content into ${dest}. Path is not directory.`)
    return this._inDepthCopy(src, dest, 0, mutationContext)
  }

  async inDepthCopy (src, dest, count = 0, mutationContext) {
    return this._inDepthCopy(src, dest, count, mutationContext)
  }

  async _inDepthCopy (src, dest, count = 0, mutationContext) {
    const content = await this._readdir(src)
    let copiedFolderPath = count === 0 ? dest + '/' + `Copy_${helper.extractNameFromKey(src)}` : dest + '/' + helper.extractNameFromKey(src)
    copiedFolderPath = await helper.createNonClashingDirNameAsync(copiedFolderPath, this._permissionlessFileLookup())

    await this._mkdir(copiedFolderPath, mutationContext)

    for (const [key, value] of Object.entries(content)) {
      if (!value.isDirectory) {
        await this._copyFile(key, copiedFolderPath, helper.extractNameFromKey(key), mutationContext)
      } else {
        await this._inDepthCopy(key, copiedFolderPath, count + 1, mutationContext)
      }
    }
  }

  _permissionlessFileLookup () {
    return { exists: (path) => this._exists(this.limitPluginScope(path)) }
  }

  /**
   * Change the path of a file/directory
   * @param {string} oldPath current path of the file/directory
   * @param {string} newPath new path of the file/directory
   * @returns {void}
   */
  async rename (oldPath, newPath, suppliedMutationContext) {
    let mutationContext = suppliedMutationContext
    try {
      this._assertNoWorkspaceRewrite('rename files')
      oldPath = this.limitPluginScope(oldPath)
      newPath = this.limitPluginScope(newPath)
      if (mutationContext === undefined) mutationContext = this._captureWorkspaceMutationContext(oldPath)
      await requireUserPermission(this, 'rename', `rename ${oldPath} to ${newPath}`)
      await this._handleExists(oldPath, `Cannot rename ${oldPath}`)
      const isFile = await this.isFile(oldPath)
      const newPathExists = await this._exists(newPath)
      const provider = this.fileProviderOf(oldPath)

      if (isFile) {
        if (newPathExists) {
          modalDialogCustom.alert('File already exists.')
          return
        }
        return provider.rename(oldPath, newPath, false, mutationContext)
      } else {
        if (newPathExists) {
          modalDialogCustom.alert('Folder already exists.')
          return
        }
        return provider.rename(oldPath, newPath, true, mutationContext)
      }
    } catch (e) {
      throw new Error(e)
    }
  }

  /**
   * Create a directory
   * @param {string} path path of the new directory
   * @returns {void}
   */
  async mkdir (path, mutationContext) {
    let writeContext = mutationContext
    try {
      this._assertNoWorkspaceRewrite('create folders')
      path = this.limitPluginScope(path)
      if (writeContext === undefined) writeContext = this._captureWorkspaceMutationContext(path)
      await requireUserPermission(this, 'mkdir', `create directory ${path}`)
      return this._mkdir(path, writeContext)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _mkdir (path, mutationContext) {
    if (await this._exists(path)) {
      throw createError({ code: 'EEXIST', message: `Cannot create directory ${path}` })
    }
    const provider = this.fileProviderOf(path)
    return provider.createDir(path, undefined, mutationContext)
  }

  /**
   * Get the list of files in the directory
   * @param {string} path path of the directory
   * @returns {string[]} list of the file/directory name in this directory
   */
  async readdir (path) {
    try {
      path = this.limitPluginScope(path)
      await requireUserPermission(this, 'readdir', `list directory ${path}`)
      return this._readdir(path)
    } catch (e) {
      throw new Error(e)
    }
  }

  async getFolder (path) {
    try {
      path = this.limitPluginScope(path)
      await requireUserPermission(this, 'getFolder', `list directory ${path}`)
      return this._readdir(path)
    } catch (e) {
      throw new Error(e)
    }
  }

  async _readdir (path) {
    await this._handleExists(path)
    await this._handleIsDir(path)

    return new Promise((resolve, reject) => {
      const provider = this.fileProviderOf(path)
      provider.resolveDirectory(path, (error, filesProvider) => {
        if (error) reject(error)
        else resolve(filesProvider)
      })
    })
  }

  /**
   * Removes a file or directory recursively
   * @param {string} path path of the directory/file to remove
   * @returns {void}
   */
  async remove (path, suppliedMutationContext) {
    let mutationContext = suppliedMutationContext
    try {
      this._assertNoWorkspaceRewrite('remove files')
      path = this.limitPluginScope(path)
      if (mutationContext === undefined) mutationContext = this._captureWorkspaceMutationContext(path)
      await requireUserPermission(this, 'remove', `remove ${path}`)
      await this._handleExists(path, `Cannot remove file or directory ${path}`)
      const provider = this.fileProviderOf(path)
      return await provider.remove(path, mutationContext)
    } catch (e) {
      throw new Error(e)
    }
  }

  init () {
    this._deps = {
      config: this._components.registry.get('config').api,
      browserExplorer: this._components.registry.get('fileproviders/browser').api,
      localhostExplorer: this._components.registry.get('fileproviders/localhost').api,
      workspaceExplorer: this._components.registry.get('fileproviders/workspace').api,
      filesProviders: this._components.registry.get('fileproviders').api
    }
    this._deps.browserExplorer.event.on('fileChanged', (path) => { this.fileChangedEvent(path) })
    this._deps.browserExplorer.event.on('fileRenamed', (oldName, newName, isFolder) => { this.fileRenamedEvent(oldName, newName, isFolder) })
    this._deps.localhostExplorer.event.on('fileRenamed', (oldName, newName, isFolder) => { this.fileRenamedEvent(oldName, newName, isFolder) })
    this._deps.browserExplorer.event.on('fileRemoved', (path) => { this.fileRemovedEvent(path) })
    this._deps.browserExplorer.event.on('fileAdded', (path) => { this.fileAddedEvent(path) })
    this._deps.localhostExplorer.event.on('fileRemoved', (path) => { this.fileRemovedEvent(path) })
    this._deps.localhostExplorer.event.on('errored', (event) => { this.removeTabsOf(this._deps.localhostExplorer) })
    this._deps.localhostExplorer.event.on('closed', (event) => { this.removeTabsOf(this._deps.localhostExplorer) })
    this._deps.workspaceExplorer.event.on('fileChanged', (path) => { this.fileChangedEvent(path) })
    this._deps.workspaceExplorer.event.on('fileRenamed', (oldName, newName, isFolder) => { this.fileRenamedEvent(oldName, newName, isFolder) })
    this._deps.workspaceExplorer.event.on('fileRemoved', (path) => { this.fileRemovedEvent(path) })
    this._deps.workspaceExplorer.event.on('fileAdded', (path) => { this.fileAddedEvent(path) })
  }

  fileAddedEvent (path) {
    this.emit('fileAdded', path)
  }

  fileChangedEvent (path) {
    this.emit('currentFileChanged', path)
  }

  fileRenamedEvent (oldName, newName, isFolder) {
    if (!isFolder) {
      this._deps.config.set('currentFile', '')
      this.editor.discard(oldName)
      if (this.openedFiles[oldName]) {
        delete this.openedFiles[oldName]
        this.openedFiles[newName] = newName
      }
      this.openFile(newName)
    } else {
      for (var k in this.openedFiles) {
        if (k.indexOf(oldName + '/') === 0) {
          var newAbsolutePath = k.replace(oldName, newName)
          this.openedFiles[newAbsolutePath] = newAbsolutePath
          delete this.openedFiles[k]
          if (this._deps.config.get('currentFile') === k) {
            this._deps.config.set('currentFile', '')
          }
        }
      }
    }
    // TODO: Only keep `this.emit` (issue#2210)
    this.emit('fileRenamed', oldName, newName, isFolder)
    this.events.emit('fileRenamed', oldName, newName, isFolder)
  }

  currentFileProvider () {
    var path = this.currentPath()
    if (path) {
      return this.fileProviderOf(path)
    }
    return null
  }

  currentFile () {
    return this._deps.config.get('currentFile')
  }

  closeAllFiles () {
    this._fileReadEpoch++
    // TODO: Only keep `this.emit` (issue#2210)
    this.emit('filesAllClosed')
    this.events.emit('filesAllClosed')
    for (const file in this.openedFiles) {
      this.closeFile(file)
    }
  }

  closeFile (name) {
    delete this.openedFiles[name]
    if (!Object.keys(this.openedFiles).length) {
      this._deps.config.set('currentFile', '')
      // TODO: Only keep `this.emit` (issue#2210)
      this.emit('noFileSelected')
      this.events.emit('noFileSelected')
    }
    // TODO: Only keep `this.emit` (issue#2210)
    this.emit('fileClosed', name)
    this.events.emit('fileClosed', name)
  }

  currentPath () {
    var currentFile = this._deps.config.get('currentFile')
    return this.extractPathOf(currentFile)
  }

  extractPathOf (file) {
    var reg = /(.*)(\/).*/
    var path = reg.exec(file)
    return path ? path[1] : '/'
  }

  getFileContent (path) {
    const provider = this.fileProviderOf(path)

    if (!provider) throw createError({ code: 'ENOENT', message: `${path} not available` })
    const readContext = this._captureFileReadContext(path, provider)
    // TODO: change provider to Promise
    return new Promise((resolve, reject) => {
      if (this.currentFile() === path) {
        if (!this._isFileReadContextCurrent(path, readContext)) {
          return reject(new Error(`File read for ${path} was invalidated by a workspace change.`))
        }
        return resolve(this.editor.currentContent())
      }
      provider.get(path, (err, content) => {
        if (err) return reject(err)
        if (!this._isFileReadContextCurrent(path, readContext)) {
          return reject(new Error(`File read for ${path} was invalidated by a workspace change.`))
        }
        resolve(content)
      })
    })
  }

  async setFileContent (path, content, mutationContext) {
    const writeContext = mutationContext === undefined ? this._captureWorkspaceMutationContext(path) : mutationContext
    if (this.currentRequest) {
      // Derived build outputs (contracts/artifacts/*) are rewritten on EVERY
      // compile the user just clicked — two "is modifying" toasts per compile
      // is pure noise. Exempt the PATH class rather than one hardcoded writer
      // name (was `from !== 'compilerMetadata'`): renaming that plugin or
      // adding a second artifact writer must not resurrect the noise, and a
      // plugin writing outside artifacts/ still notifies.
      const isDerivedArtifactWrite = /(^|\/)artifacts\//.test(path)
      if (!isDerivedArtifactWrite) {
        // inform the user about modification after permission is granted and even if permission was saved before
        // toaster(yo`
        //   <div>
        //     <i class="fas fa-exclamation-triangle text-danger mr-1"></i>
        //     <span>
        //       ${this.currentRequest.from}
        //       <span class="font-weight-bold text-warning">
        //         is modifying
        //       </span>
        //       ${path}
        //     </span>
        //   </div>
        // `, '', { time: 3000 })

        notification.warning(
          {
            message: (
              <div
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {this.currentRequest.from}
                <span className="font-weight-bold text-warning" style={{ margin: '0 4px' }}>
                  is modifying
                </span>
                {path}
              </div>
            ),
            description: '',
            placement: 'bottom',
            style: {
              width: 'fit-content',
              maxWidth: '80vw'
            }
          }
        )
      }
    }
    return await this._setFileInternal(path, content, writeContext)
  }

  _setFileInternal (path, content, mutationContext) {
    const writeContext = mutationContext === undefined ? this._captureWorkspaceMutationContext(path) : mutationContext
    const provider = this.fileProviderOf(path)
    if (!provider) throw createError({ code: 'ENOENT', message: `${path} not available` })
    // TODO : Add permission
    // TODO : Change Provider to Promise
    return new Promise((resolve, reject) => {
      provider.set(path, content, (error) => {
        if (error) return reject(error)
        this._syncEditor(path)
        this.emit('fileSaved', path)
        resolve(true)
      }, writeContext)
    })
  }

  _saveAsCopy (path, content) {
    const fileProvider = this.fileProviderOf(path)
    const mutationContext = this._captureWorkspaceMutationContext(path)
    if (fileProvider) {
      helper.createNonClashingNameWithPrefix(path, fileProvider, '', (error, copyName) => {
        if (error) {
          copyName = path + '.' + this.currentRequest.from
        }
        this._setFileInternal(copyName, content, mutationContext)
        this.openFile(copyName)
      })
    }
  }

  removeTabsOf (provider) {
    for (var tab in this.openedFiles) {
      if (this.fileProviderOf(tab).type === provider.type) {
        this.fileRemovedEvent(tab)
      }
    }
  }

  fileRemovedEvent (path) {
    const wasCurrent = path === this._deps.config.get('currentFile')
    if (wasCurrent) {
      this._deps.config.set('currentFile', '')
    }
    this.editor.discard(path)
    delete this.openedFiles[path]
    // TODO: Only keep `this.emit` (issue#2210)
    this.emit('fileRemoved', path)
    this.events.emit('fileRemoved', path)
    if (wasCurrent) this.openFile()
  }

  unselectCurrentFile () {
    this.saveCurrentFile()
    this._deps.config.set('currentFile', '')
    // TODO: Only keep `this.emit` (issue#2210)
    this.emit('noFileSelected')
    this.events.emit('noFileSelected')
  }

  openFile (file, rewriteToken) {
    // A Git checkout is about to replace files on disk. Keep the active editor
    // session stable until its clean snapshot has been synced to the target
    // branch; otherwise a newly opened old-branch tab can be written back over
    // the checkout.
    if (this._workspaceRewriteLock && file && this._workspaceRewriteLock.token !== rewriteToken) return Promise.resolve(false)
    const _openFile = (file) => {
      return new Promise((resolve) => {
        this.saveCurrentFile()
        const provider = this.fileProviderOf(file)
        if (!provider) {
          console.error(`no provider for ${file}`)
          return resolve(false)
        }
        file = provider.getPathFromUrl(file) || file // in case an external URL is given as input, we resolve it to the right internal path
        const readContext = this._captureFileReadContext(file, provider)
        this._deps.config.set('currentFile', file)
        this.openedFiles[file] = file
        provider.get(file, (error, content) => {
          if (!this._isFileReadContextCurrent(file, readContext) || this._deps.config.get('currentFile') !== file) return resolve(false)
          if (error) {
            console.log(error)
            return resolve(false)
          } else {
            if (provider.isReadOnly(file)) {
              this.editor.openReadOnly(file, content)
            } else {
              this.editor.open(file, content)
            }
            // TODO: Only keep `this.emit` (issue#2210)
            this.emit('currentFileChanged', file)
            this.events.emit('currentFileChanged', file)
            return resolve(true)
          }
        })
      })
    }
    if (file) return _openFile(file)
    else {
      this.emit('noFileSelected')
      this.events.emit('noFileSelected')
      return Promise.resolve(false)
    }
  }

  openFileContent (file, content) {
    if (this._workspaceRewriteLock) return false
    this.saveCurrentFile()
    const provider = this.fileProviderOf(file)
    if (!provider) {
      console.error(`no provider for ${file}`)
      return false
    }
    file = provider.getPathFromUrl(file) || file // in case an external URL is given as input, we resolve it to the right internal path
    this._deps.config.set('currentFile', file)
    this.openedFiles[file] = file
    if (provider.isReadOnly(file)) {
      this.editor.openReadOnly(file, content)
    } else {
      this.editor.open(file, content)
    }
    // TODO: Only keep `this.emit` (issue#2210)
    this.emit('currentFileChanged', file)
    this.events.emit('currentFileChanged', file)
    return true
  }

  /**
  * Async API method getProviderOf
  * @param {string} file
  *
  */

  async getProviderOf (file) {
    if (!await hasUserPermission(this, 'getProviderOf', 'inspect a file provider')) return
    return file ? this.fileProviderOf(file) : this.currentFileProvider()
  }

  /**
  * Async API method getProviderByName
  * @param {string} name
  *
  */

  async getProviderByName (name) {
    if (!await hasUserPermission(this, 'getProviderByName', 'inspect a named file provider')) return
    return this.getProvider(name)
  }

  getProvider (name) {
    return this._deps.filesProviders[name]
  }

  fileProviderOf (file) {
    if (typeof file !== 'string') throw new TypeError('File paths must be strings')
    if (file === 'localhost' || file.startsWith('localhost/') || this.mode === 'localhost') {
      return this._deps.filesProviders.localhost
    }
    if (file === 'browser' || file.startsWith('browser/')) {
      return this._deps.filesProviders.browser
    }
    return this._deps.filesProviders.workspace
  }

  // returns the list of directories inside path
  dirList (path) {
    const dirPaths = []
    const collectList = (path) => {
      return new Promise((resolve, reject) => {
        this.readdir(path).then((ls) => {
          const promises = Object.keys(ls).map((item, index) => {
            if (ls[item].isDirectory && !dirPaths.includes(item)) {
              dirPaths.push(item)
              resolve(dirPaths)
            }
            return new Promise((resolve, reject) => { resolve() })
          })
          Promise.all(promises).then(() => { resolve(dirPaths) })
        })
      })
    }
    return collectList(path)
  }

  isRemixDActive () {
    return this.appManager.isActive('remixd')
  }

  saveCurrentFile () {
    // A debounce scheduled before checkout may fire while raw Git is replacing
    // the worktree. Let the checked save inside the rewrite own persistence;
    // otherwise the stale source-branch Ace buffer can be written back after
    // checkout and silently undo the switch.
    if (this._workspaceRewriteLock) return false
    var currentFile = this._deps.config.get('currentFile')
    if (currentFile && this.editor.current()) {
      var input = this.editor.get(currentFile)
      if ((input !== null) && (input !== undefined)) {
        var provider = this.fileProviderOf(currentFile)
        if (provider) {
          provider.set(currentFile, input, (error) => {
            if (error) {
              console.error(`Could not persist ${currentFile}:`, error)
              return
            }
            this.emit('fileSaved', currentFile)
          })
        } else {
          console.log('cannot save ' + currentFile + '. Does not belong to any explorer')
        }
      }
    }
  }

  saveCurrentFileChecked (rewriteToken) {
    return this._withUserPermission('saveCurrentFileChecked', 'save the current file before a workspace rewrite', () => this._saveCurrentFileChecked(rewriteToken))
  }

  _saveCurrentFileChecked (rewriteToken) {
    if (this._workspaceRewriteLock && this._workspaceRewriteLock.token !== rewriteToken) {
      return Promise.reject(new Error('A Git workspace rewrite is already in progress. Save cancelled.'))
    }
    const currentFile = this._deps.config.get('currentFile')
    if (!currentFile && !this.editor.current()) return Promise.resolve(true)
    if (!currentFile || this.editor.current() !== currentFile) {
      return Promise.reject(new Error('The active editor session is changing. Save cancelled.'))
    }

    const input = this.editor.get(currentFile)
    if (input === null || input === undefined) return Promise.resolve(true)

    const provider = this.fileProviderOf(currentFile)
    if (!provider) return Promise.reject(new Error(`Cannot save ${currentFile}. It does not belong to any explorer.`))

    return new Promise((resolve, reject) => {
      let settled = false
      let invoking = true
      let promiseReturned = false
      let callbackSucceeded = false
      const fail = (error) => {
        if (settled) return
        settled = true
        reject(error instanceof Error ? error : new Error(String(error || `Could not save ${currentFile}.`)))
      }
      const succeed = () => {
        if (settled) return
        try {
          this.emit('fileSaved', currentFile)
        } catch (error) {
          return fail(error)
        }
        settled = true
        resolve(true)
      }
      const callback = (error, result) => {
        if (error || result === false) return fail(error || `Could not save ${currentFile}.`)
        // Inspect a synchronous return value before accepting a synchronous
        // success callback, and let a returned Promise remain authoritative.
        if (invoking || promiseReturned) {
          callbackSucceeded = true
          return
        }
        succeed()
      }

      try {
        // The workspace provider enforces the same rewrite token at the final
        // synchronous BrowserFS mutation boundary. Other providers ignore the
        // extra argument.
        const returned = provider.set(currentFile, input, callback, rewriteToken)
        invoking = false
        promiseReturned = Boolean(returned && typeof returned.then === 'function')
        if (returned === false) return fail(`Could not save ${currentFile}.`)
        if (promiseReturned) {
          returned.then((result) => {
            if (result === false) return fail(`Could not save ${currentFile}.`)
            succeed()
          }).catch(fail)
        } else if (callbackSucceeded || returned !== undefined || provider.set.length < 3) {
          succeed()
        }
      } catch (error) {
        invoking = false
        fail(error)
      }
    })
  }

  beginWorkspaceRewrite (options = {}) {
    return this._withUserPermission('beginWorkspaceRewrite', 'lock the active workspace for a Git rewrite', () => this._beginWorkspaceRewrite(options))
  }

  _beginWorkspaceRewrite (options = {}) {
    if (this._workspaceRewriteLock) throw new Error('Another workspace rewrite is already in progress.')
    if (this._workspaceMutationOwner !== null) throw new Error('A workspace change is already in progress. Retry the Git operation when it finishes.')
    const token = ++this._workspaceRewriteToken
    const notificationKey = `git-workspace-rewrite-${token}`
    const warningAfterMs = Math.max(Number(options.warningAfterMs) || 65000, 10000)
    const warningTimer = window.setTimeout(() => {
      if (!this._workspaceRewriteLock || this._workspaceRewriteLock.token !== token) return
      notification.error({
        key: notificationKey,
        message: 'Git workspace update is taking too long',
        description: 'The editor remains protected because the underlying Git operation cannot be cancelled safely. Reload TronIDE to recover if it does not finish.',
        duration: 0
      })
    }, warningAfterMs)
    // Install the provider-level guard in this same synchronous stack. It
    // covers direct file-explorer uploads and async FileManager calls that
    // passed their entry check before the checkout lock was acquired.
    let providerGuarded
    try { providerGuarded = this._deps.workspaceExplorer.beginGitWorkspaceRewrite(token) } catch (error) {
      window.clearTimeout(warningTimer)
      throw error
    }
    if (providerGuarded !== true) {
      window.clearTimeout(warningTimer)
      throw new Error('Could not protect workspace writes for the Git operation.')
    }
    try {
      this._workspaceRewriteLock = { token, notificationKey, warningTimer }
      if (this.editor.editor && typeof this.editor.editor.setReadOnly === 'function') this.editor.editor.setReadOnly(true)
      return token
    } catch (error) {
      this._workspaceRewriteLock = null
      this._deps.workspaceExplorer.endGitWorkspaceRewrite(token)
      window.clearTimeout(warningTimer)
      try {
        const current = this.editor.current()
        const readOnly = current ? Boolean(this.editor.readOnlySessions[current]) : true
        if (this.editor.editor && typeof this.editor.editor.setReadOnly === 'function') this.editor.editor.setReadOnly(readOnly)
      } catch (restoreError) {}
      throw error
    }
  }

  endWorkspaceRewrite (token) {
    return this._withUserPermission('endWorkspaceRewrite', 'unlock the active workspace after a Git rewrite', () => this._endWorkspaceRewrite(token))
  }

  _endWorkspaceRewrite (token) {
    if (!this._workspaceRewriteLock || this._workspaceRewriteLock.token !== token) return false
    // Do not make provider writes available until reconciliation has completed
    // and the owner token is validated at both layers.
    if (this._deps.workspaceExplorer.endGitWorkspaceRewrite(token) !== true) return false
    const { warningTimer, notificationKey } = this._workspaceRewriteLock
    window.clearTimeout(warningTimer)
    // Some bundled Ant Design versions expose destroy(key), while older ones
    // expose close(key). Notification cleanup must never strand the editor in
    // its rewrite lock if one of those optional APIs is absent.
    try {
      if (typeof notification.destroy === 'function') notification.destroy(notificationKey)
      else if (typeof notification.close === 'function') notification.close(notificationKey)
    } catch (error) {}
    this._workspaceRewriteLock = null
    const current = this.editor.current()
    const readOnly = current ? Boolean(this.editor.readOnlySessions[current]) : true
    if (this.editor.editor && typeof this.editor.editor.setReadOnly === 'function') this.editor.editor.setReadOnly(readOnly)
    return true
  }

  syncEditor (path) {
    return this._withUserPermission('syncEditor', `reload ${path} in the editor`, () => this._syncEditor(path))
  }

  _syncEditor (path) {
    const currentFile = this._deps.config.get('currentFile')
    if (path !== currentFile) return Promise.resolve(false)

    const provider = this.fileProviderOf(currentFile)
    if (!provider) {
      const error = new Error('Cannot sync ' + currentFile + '. It does not belong to any explorer.')
      console.log(error.message)
      return Promise.resolve(false)
    }
    const readContext = this._captureFileReadContext(currentFile, provider)

    return new Promise((resolve, reject) => {
      provider.get(currentFile, async (error, content) => {
        try {
          if (!this._isFileReadContextCurrent(currentFile, readContext)) return resolve(false)
          if (this._deps.config.get('currentFile') !== currentFile || this.editor.current() !== currentFile) return resolve(false)
          if (error) {
            console.log(error)
            // During a rewrite this session was known saved and read-only.
            // Close an unreadable stale tab so autosave cannot corrupt the
            // target branch after the lock is released.
            if (this._workspaceRewriteLock) this.fileRemovedEvent(currentFile)
            return resolve(false)
          }
          if (content === null || content === undefined) {
            // Raw git checkout does not emit provider fileRemoved events. Close
            // the tab explicitly or its old buffer will recreate the file.
            this.fileRemovedEvent(currentFile)
            return resolve({ removed: true })
          }
          this.editor.setText(content)
          resolve({ synced: true })
        } catch (syncError) {
          reject(syncError)
        }
      })
    })
  }

  async reconcileOpenFilesAfterRewrite (rewriteToken) {
    return this._withUserPermission('reconcileOpenFilesAfterRewrite', 'reconcile open files after a Git rewrite', () => this._reconcileOpenFilesAfterRewrite(rewriteToken))
  }

  async _reconcileOpenFilesAfterRewrite (rewriteToken) {
    if (this._workspaceRewriteLock && this._workspaceRewriteLock.token !== rewriteToken) {
      throw new Error('Only the active Git rewrite can reconcile editor sessions.')
    }
    // Raw Git operations bypass provider events. Remove every workspace tab
    // whose target-branch file disappeared (including background tabs), then
    // update the still-current session from the checked-out bytes.
    const remaining = []
    for (const openedPath of Object.keys(this.openedFiles)) {
      const provider = this.fileProviderOf(openedPath)
      if (provider !== this._deps.workspaceExplorer) {
        remaining.push(openedPath)
        continue
      }
      let exists = false
      try { exists = await provider.exists(openedPath) } catch (e) { exists = false }
      if (!exists) this.fileRemovedEvent(openedPath)
      else remaining.push(openedPath)
    }
    let currentFile = this._deps.config.get('currentFile')
    if (!currentFile) {
      // Removing the active tab makes TabProxy select a remaining tab, but its
      // normal open call is intentionally blocked by the rewrite lock. Open a
      // known-existing fallback with the owner token so the visible active tab,
      // config, and Ace session cannot diverge when the lock is released.
      const fallback = remaining.find((openedPath) => this.openedFiles[openedPath])
      if (!fallback) return { synced: false }
      const opened = await this.openFile(fallback, rewriteToken)
      if (!opened) throw new Error('Could not open a verified editor tab after the Git workspace update.')
      return { synced: true, fallback }
    }
    try {
      const result = await this._syncEditor(currentFile)
      if (result === false) throw new Error('The active editor changed while Git was reconciling it.')
      return result
    } catch (error) {
      // Never release the lock with an unsynchronised source-branch buffer. If
      // updating Ace fails, discard that session and open another verified tab.
      this.fileRemovedEvent(currentFile)
      currentFile = this._deps.config.get('currentFile')
      if (currentFile) {
        const result = await this._syncEditor(currentFile)
        if (result === false) throw new Error('Could not reconcile the replacement editor tab after the Git workspace update.')
        return result
      }
      const fallback = remaining.find((openedPath) => this.openedFiles[openedPath])
      if (!fallback) return { synced: false, discarded: true }
      const opened = await this.openFile(fallback, rewriteToken)
      if (!opened) throw new Error('Could not open a fallback editor tab after the Git workspace update.')
      return { synced: true, fallback, discarded: true }
    }
  }

  setBatchFiles (filesSet, fileProvider, override, callback, suppliedMutationContext) {
    const self = this
    if (!fileProvider) fileProvider = 'browser'
    if (override === undefined) override = false
    const targetProvider = self._deps.filesProviders[fileProvider]
    const mutationContext = suppliedMutationContext === undefined && targetProvider && typeof targetProvider.captureMutationContext === 'function'
      ? targetProvider.captureMutationContext()
      : suppliedMutationContext

    async.each(Object.keys(filesSet), (file, callback) => {
      if (override) {
        try {
          const accepted = targetProvider.set(file, filesSet[file].content, undefined, mutationContext)
          if (accepted === false) return callback('Workspace changed before the files could be written.')
        } catch (e) {
          return callback(e.message || e)
        }
        self._syncEditor(fileProvider + file)
        return callback()
      }

      helper.createNonClashingName(file, targetProvider,
        (error, name) => {
          if (error) {
            modalDialogCustom.alert('Unexpected error loading the file ' + error)
          } else if (helper.checkSpecialChars(name)) {
            modalDialogCustom.alert('Special characters are not allowed')
          } else {
            try {
              const accepted = targetProvider.set(name, filesSet[file].content, undefined, mutationContext)
              if (accepted === false) return callback('Workspace changed before the files could be written.')
            } catch (e) {
              return callback(e.message || e)
            }
            self._syncEditor(fileProvider + name)
          }
          callback()
        })
    }, (error) => {
      if (callback) callback(error)
    })
  }

  currentWorkspace () {
    if (this.mode !== 'localhost') {
      const file = this.currentFile() || ''
      const provider = this.fileProviderOf(file)

      return provider.workspace
    }
  }
}

module.exports = FileManager
