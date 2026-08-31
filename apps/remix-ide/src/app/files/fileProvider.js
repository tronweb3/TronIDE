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

import { CompilerImports } from '@remix-project/core-plugin'
const EventManager = require('events')
const modalDialogCustom = require('../ui/modal-dialog-custom')
const tooltip = require('../ui/tooltip')
const remixLib = require('@remix-project/remix-lib')
const Storage = remixLib.Storage

class FileProvider {
  constructor (name) {
    this.event = new EventManager()
    this.type = name
    this.providerExternalsStorage = new Storage('providerExternals:')
    this.externalFolders = [this.type + '/swarm', this.type + '/ipfs', this.type + '/github', this.type + '/gists', this.type + '/https']
  }

  _workspaceStorage () {
    if (typeof window === 'undefined') return null
    const storage = window.tronideWorkspaceStorage
    return storage && storage.mode === 'indexeddb-mirror' ? storage : null
  }

  _assertStorageWritable () {
    const storage = this._workspaceStorage()
    if (storage) storage.assertWritable()
  }

  _completeStorageMutation (callback, result = true) {
    const storage = this._workspaceStorage()
    if (!storage) {
      callback()
      return result
    }
    const checkpoint = storage.checkpoint()
    const persistence = storage.whenDurable(checkpoint).then(() => {
      callback()
      return result
    }, (error) => {
      callback(error)
      throw error
    })
    // Many legacy provider callers intentionally ignore the return value. Keep
    // their eventual failure observable through the storage status service,
    // without also producing an unhandled rejection. Awaiting callers still
    // receive the original rejected Promise.
    persistence.catch(() => {})
    return persistence
  }

  addNormalizedName (path, url) {
    this.providerExternalsStorage.set(this.type + '/' + path, url)
    this.providerExternalsStorage.set('reverse-' + url, this.type + '/' + path)
  }

  removeNormalizedName (path) {
    const value = this.providerExternalsStorage.get(path)
    this.providerExternalsStorage.remove(path)
    this.providerExternalsStorage.remove('reverse-' + value)
  }

  normalizedNameExists (path) {
    return this.providerExternalsStorage.exists(path)
  }

  getNormalizedName (path) {
    return this.providerExternalsStorage.get(path)
  }

  getPathFromUrl (url) {
    return this.providerExternalsStorage.get('reverse-' + url)
  }

  isExternalFolder (path) {
    return this.externalFolders.includes(path)
  }

  discardChanges (path) {
    this.remove(path)
    const compilerImport = new CompilerImports()
    this.providerExternalsStorage.keys().map(value => {
      if (value.indexOf(path) === 0) {
        compilerImport.import(
          this.getNormalizedName(value),
          true,
          (loadingMsg) => { tooltip(loadingMsg) },
          (error, content, cleanUrl, type, url) => {
            if (error) {
              modalDialogCustom.alert(error)
            } else {
              this.addExternal(type + '/' + cleanUrl, content, url)
            }
          }
        )
      }
    })
  }

  async exists (path) {
    // todo check the type (directory/file) as well #2386
    // currently it is not possible to have a file and folder with same path
    const ret = this._exists(path)

    return ret
  }

  _exists (path) {
    path = this.getPathFromUrl(path) || path // ensure we actually use the normalized path from here
    var unprefixedpath = this.removePrefix(path)
    return path === this.type ? true : window.remixFileSystem.existsSync(unprefixedpath)
  }

  init (cb) {
    cb()
  }

  get (path, cb) {
    cb = cb || function () {}
    path = this.getPathFromUrl(path) || path // ensure we actually use the normalized path from here
    var unprefixedpath = this.removePrefix(path)
    var exists = window.remixFileSystem.existsSync(unprefixedpath)
    if (!exists) return cb(null, null)
    window.remixFileSystem.readFile(unprefixedpath, 'utf8', (err, content) => {
      cb(err, content)
    })
  }

  set (path, content, cb) {
    cb = cb || function () {}
    try { this._assertStorageWritable() } catch (error) {
      cb(error)
      return false
    }
    var unprefixedpath = this.removePrefix(path)
    var exists = window.remixFileSystem.existsSync(unprefixedpath)
    if (exists && window.remixFileSystem.readFileSync(unprefixedpath, 'utf8') === content) {
      // A preceding save may already have placed these bytes in the
      // synchronous mirror while its IndexedDB write is still pending. Join
      // that checkpoint instead of reporting a misleading early success.
      return this._completeStorageMutation(cb)
    }
    if (!exists && unprefixedpath.indexOf('/') !== -1) {
      // the last element is the filename and we should remove it
      this.createDir(path.substr(0, path.lastIndexOf('/')))
    }
    try {
      window.remixFileSystem.writeFileSync(unprefixedpath, content)
    } catch (e) {
      cb(e)
      return false
    }
    if (!exists) {
      this.event.emit('fileAdded', this._normalizePath(unprefixedpath), false)
    } else {
      this.event.emit('fileChanged', this._normalizePath(unprefixedpath))
    }
    return this._completeStorageMutation(cb)
  }

  createDir (path, cb) {
    cb = cb || function () {}
    try { this._assertStorageWritable() } catch (error) {
      cb(error)
      return false
    }
    const unprefixedpath = this.removePrefix(path)
    const paths = unprefixedpath.split('/')
    if (paths.length && paths[0] === '') paths.shift()
    let currentCheck = ''
    let changed = false
    paths.forEach((value) => {
      currentCheck = currentCheck + '/' + value
      if (!window.remixFileSystem.existsSync(currentCheck)) {
        window.remixFileSystem.mkdirSync(currentCheck)
        changed = true
        this.event.emit('folderAdded', this._normalizePath(currentCheck))
      }
    })
    if (!changed) {
      cb()
      return true
    }
    return this._completeStorageMutation(cb)
  }

  // this will not add a folder as readonly but keep the original url to be able to restore it later
  addExternal (path, content, url, mutationContext) {
    // Bind an asynchronously fetched dependency to the workspace/branch that
    // requested it. WorkspaceFileProvider validates the context in `set` at
    // the final synchronous BrowserFS mutation boundary; other providers
    // simply ignore the extra argument.
    const accepted = this.set(path, content, undefined, mutationContext)
    // Do not leave a URL mapping behind when a stale workspace context rejects
    // the write, otherwise a later lookup can point at a file that was never
    // materialised in the active workspace.
    if (accepted && typeof accepted.then === 'function') {
      const persisted = accepted.then((result) => {
        if (result !== false && url) this.addNormalizedName(path, url)
        return result
      })
      persisted.catch(() => {})
      return persisted
    }
    if (accepted !== false && url) this.addNormalizedName(path, url)
    return accepted
  }

  isReadOnly (path) {
    return false
  }

  isDirectory (path) {
    const unprefixedpath = this.removePrefix(path)

    return path === this.type ? true : window.remixFileSystem.statSync(unprefixedpath).isDirectory()
  }

  isFile (path) {
    path = this.getPathFromUrl(path) || path // ensure we actually use the normalized path from here
    path = this.removePrefix(path)
    return window.remixFileSystem.statSync(path).isFile()
  }

  /**
   * Removes the folder recursively
   * @param {*} path is the folder to be removed
   */
  async remove (path) {
    this._assertStorageWritable()
    path = this.removePrefix(path)
    try {
      if (!window.remixFileSystem.existsSync(path)) return true
      const stat = window.remixFileSystem.statSync(path)
      if (!stat.isDirectory()) {
        const removed = this.removeFile(path)
        const storage = this._workspaceStorage()
        if (removed && storage) await storage.whenDurable(storage.checkpoint())
        return removed
      }

      const items = window.remixFileSystem.readdirSync(path)
      for (const item of items) {
        const curPath = `${path}${path.endsWith('/') ? '' : '/'}${item}`
        if (window.remixFileSystem.statSync(curPath).isDirectory()) {
          if (await this.remove(curPath) === false) return false
        } else if (!this.removeFile(curPath)) {
          return false
        }
      }
      if (window.remixFileSystem.readdirSync(path).length !== 0) {
        throw new Error(`Could not remove directory ${path}`)
      }
      window.remixFileSystem.rmdirSync(path, console.log)
      this.event.emit('fileRemoved', this._normalizePath(path))
      const storage = this._workspaceStorage()
      if (storage) await storage.whenDurable(storage.checkpoint())
      return true
    } catch (e) {
      console.log(e)
      return false
    }
  }

  /**
   * copy the folder recursively (internal use)
   * @param {string} path is the folder to be copied over
   * @param {Function} visitFile is a function called for each visited files
   * @param {Function} visitFolder is a function called for each visited folders
   */
  async _copyFolderToJsonInternal (path, visitFile, visitFolder) {
    visitFile = visitFile || (() => {})
    visitFolder = visitFolder || (() => {})
    const json = {}
    path = this.removePrefix(path)
    if (!window.remixFileSystem.existsSync(path)) return json

    const items = window.remixFileSystem.readdirSync(path)
    visitFolder({ path })
    for (const item of items) {
      const file = {}
      const curPath = `${path}${path.endsWith('/') ? '' : '/'}${item}`
      if (window.remixFileSystem.statSync(curPath).isDirectory()) {
        file.children = await this._copyFolderToJsonInternal(curPath, visitFile, visitFolder)
      } else {
        file.content = window.remixFileSystem.readFileSync(curPath, 'utf8')
        visitFile({ path: curPath, content: file.content })
      }
      json[curPath] = file
    }
    return json
  }

  /**
   * copy the folder recursively
   * @param {string} path is the folder to be copied over
   * @param {Function} visitFile is a function called for each visited files
   * @param {Function} visitFolder is a function called for each visited folders
   */
  copyFolderToJson (path, visitFile, visitFolder) {
    visitFile = visitFile || (() => {})
    visitFolder = visitFolder || (() => {})
    return this._copyFolderToJsonInternal(path, visitFile, visitFolder)
  }

  removeFile (path) {
    this._assertStorageWritable()
    path = this.removePrefix(path)
    if (window.remixFileSystem.existsSync(path) && !window.remixFileSystem.statSync(path).isDirectory()) {
      window.remixFileSystem.unlinkSync(path, console.log)
      this.event.emit('fileRemoved', this._normalizePath(path))
      return true
    } else return false
  }

  rename (oldPath, newPath, isFolder) {
    try { this._assertStorageWritable() } catch (error) { return Promise.reject(error) }
    var unprefixedoldPath = this.removePrefix(oldPath)
    var unprefixednewPath = this.removePrefix(newPath)
    if (this._exists(unprefixedoldPath)) {
      window.remixFileSystem.renameSync(unprefixedoldPath, unprefixednewPath)
      this.event.emit('fileRenamed',
        this._normalizePath(unprefixedoldPath),
        this._normalizePath(unprefixednewPath),
        isFolder
      )
      return this._completeStorageMutation(function () {})
    }
    return false
  }

  resolveDirectory (path, callback) {
    if (!path) return callback(null, { [this.type]: {} })
    path = this.removePrefix(path)
    if (path.indexOf('/') !== 0) path = '/' + path

    window.remixFileSystem.readdir(path, (error, files) => {
      var ret = {}

      if (files) {
        files.forEach(element => {
          path = path.replace(/^\/|\/$/g, '') // remove first and last slash
          element = element.replace(/^\/|\/$/g, '') // remove first and last slash
          const absPath = (path === '/' ? '' : path) + '/' + element
          ret[absPath.indexOf('/') === 0 ? absPath.substr(1, absPath.length) : absPath] = { isDirectory: window.remixFileSystem.statSync(absPath).isDirectory() }
          // ^ ret does not accept path starting with '/'
        })
      }
      callback(error, ret)
    })
  }

  removePrefix (path) {
    path = path.indexOf(this.type) === 0 ? path.replace(this.type, '') : path
    if (path === '') return '/'
    return path
  }

  _normalizePath (path) {
    return this.type + path
  }
}

module.exports = FileProvider
