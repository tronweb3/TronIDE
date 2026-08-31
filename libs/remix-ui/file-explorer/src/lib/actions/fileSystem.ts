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

import React from 'react'
import { File } from '../types'
import { extractNameFromKey, extractParentFromKey } from '../utils'

export const fetchDirectoryError = (error: any) => {
  return {
    type: 'FETCH_DIRECTORY_ERROR',
    payload: error
  }
}

export const fetchDirectoryRequest = (promise: Promise<any>) => {
  return {
    type: 'FETCH_DIRECTORY_REQUEST',
    payload: promise
  }
}

export const fetchDirectorySuccess = (path: string, files: File[]) => {
  return {
    type: 'FETCH_DIRECTORY_SUCCESS',
    payload: { path, files }
  }
}

export const fileSystemReset = () => {
  return {
    type: 'FILESYSTEM_RESET'
  }
}

const normalize = (parent, filesList, newInputType?: string): any => {
  const folders = {}
  const files = {}

  Object.keys(filesList || {}).forEach(key => {
    key = key.replace(/^\/|\/$/g, '') // remove first and last slash
    let path = key
    path = path.replace(/^\/|\/$/g, '') // remove first and last slash

    if (filesList[key].isDirectory) {
      folders[extractNameFromKey(key)] = {
        path,
        name: extractNameFromKey(path).indexOf('gist-') === 0 ? extractNameFromKey(path).split('-')[1] : extractNameFromKey(path),
        isDirectory: filesList[key].isDirectory,
        type: extractNameFromKey(path).indexOf('gist-') === 0 ? 'gist' : 'folder'
      }
    } else {
      files[extractNameFromKey(key)] = {
        path,
        name: extractNameFromKey(path),
        isDirectory: filesList[key].isDirectory,
        type: 'file'
      }
    }
  })

  if (newInputType === 'folder') {
    const path = parent + '/blank'

    folders[path] = {
      path: path,
      name: '',
      isDirectory: true,
      type: 'folder'
    }
  } else if (newInputType === 'file') {
    const path = parent + '/blank'

    files[path] = {
      path: path,
      name: '',
      isDirectory: false,
      type: 'file'
    }
  }

  return Object.assign({}, folders, files)
}

const fetchDirectoryContent = async (provider, folderPath: string, newInputType?: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    provider.resolveDirectory(folderPath, (error, fileTree) => {
      // A read failure used to be swallowed and resolved as an EMPTY directory, so
      // every caller saw "success" with no contents — the folder silently showed
      // empty (and the explicit-listing paths' error dispatch never fired). Reject
      // instead: the listing paths surface the error, and the re-fetch callers
      // (fileAdded/folderAdded/fileRenamed, guarded with try/catch) skip the update
      // rather than wiping the tree to empty.
      if (error) return reject(error)
      const files = normalize(folderPath, fileTree, newInputType)

      resolve({ [extractNameFromKey(folderPath)]: files })
    })
  })
}

export const fetchDirectory = (provider, path: string) => (dispatch: React.Dispatch<any>) => {
  const promise = fetchDirectoryContent(provider, path)

  dispatch(fetchDirectoryRequest(promise))
  promise.then((files) => {
    dispatch(fetchDirectorySuccess(path, files))
  }).catch((error) => {
    dispatch(fetchDirectoryError({ error }))
  })
  return promise
}

export const resolveDirectoryError = (error: any) => {
  return {
    type: 'RESOLVE_DIRECTORY_ERROR',
    payload: error
  }
}

export const resolveDirectoryRequest = (promise: Promise<any>) => {
  return {
    type: 'RESOLVE_DIRECTORY_REQUEST',
    payload: promise
  }
}

export const resolveDirectorySuccess = (path: string, files: File[]) => {
  return {
    type: 'RESOLVE_DIRECTORY_SUCCESS',
    payload: { path, files }
  }
}

export const resolveDirectory = (provider, path: string) => (dispatch: React.Dispatch<any>) => {
  const promise = fetchDirectoryContent(provider, path)

  dispatch(resolveDirectoryRequest(promise))
  promise.then((files) => {
    dispatch(resolveDirectorySuccess(path, files))
  }).catch((error) => {
    dispatch(resolveDirectoryError({ error }))
  })
  return promise
}

export const fetchProviderError = (error: any) => {
  return {
    type: 'FETCH_PROVIDER_ERROR',
    payload: error
  }
}

export const fetchProviderRequest = (promise: Promise<any>) => {
  return {
    type: 'FETCH_PROVIDER_REQUEST',
    payload: promise
  }
}

export const fetchProviderSuccess = (provider: any) => {
  return {
    type: 'FETCH_PROVIDER_SUCCESS',
    payload: provider
  }
}

export const fileAddedSuccess = (path: string, files) => {
  return {
    type: 'FILE_ADDED',
    payload: { path, files }
  }
}

export const folderAddedSuccess = (path: string, files) => {
  return {
    type: 'FOLDER_ADDED',
    payload: { path, files }
  }
}

export const fileRemovedSuccess = (path: string, removePath: string) => {
  return {
    type: 'FILE_REMOVED',
    payload: { path, removePath }
  }
}

export const fileRenamedSuccess = (path: string, removePath: string, files) => {
  return {
    type: 'FILE_RENAMED',
    payload: { path, removePath, files }
  }
}

export const init = (fileProvider, filePanel, registry) => (reducerDispatch: React.Dispatch<any>) => {
  const provider = fileProvider
  const plugin = filePanel
  const dispatch = reducerDispatch
  let active = true
  const queuedEvents = []
  const pendingEvents = {}

  const isActive = () => active && provider === fileProvider

  const fileAdded = async (filePath: string) => {
    if (!isActive() || extractParentFromKey(filePath) === '/.workspaces') return
    const path = extractParentFromKey(filePath) || provider.workspace || provider.type || ''
    try {
      const data = await fetchDirectoryContent(provider, path)
      if (!isActive()) return
      await dispatch(fileAddedSuccess(path, data))
    } catch (error) {
      console.error('[fileSystem] could not refresh directory after file add', error)
    }
    if (isActive() && filePath.includes('_test.sol')) {
      plugin.emit('newTestFileCreated', filePath)
    }
  }

  const folderAdded = async (folderPath: string) => {
    if (!isActive() || extractParentFromKey(folderPath) === '/.workspaces') return
    const path = extractParentFromKey(folderPath) || provider.workspace || provider.type || ''
    try {
      const data = await fetchDirectoryContent(provider, path)
      if (!isActive()) return
      await dispatch(folderAddedSuccess(path, data))
    } catch (error) {
      console.error('[fileSystem] could not refresh directory after folder add', error)
    }
  }

  const fileRemoved = async (removePath: string) => {
    if (!isActive()) return
    const path = extractParentFromKey(removePath) || provider.workspace || provider.type || ''
    await dispatch(fileRemovedSuccess(path, removePath))
  }

  const fileRenamed = async (oldPath: string) => {
    if (!isActive()) return
    const path = extractParentFromKey(oldPath) || provider.workspace || provider.type || ''
    try {
      const data = await fetchDirectoryContent(provider, path)
      if (!isActive()) return
      await dispatch(fileRenamedSuccess(path, oldPath, data))
    } catch (error) {
      console.error('[fileSystem] could not refresh directory after rename', error)
    }
  }

  const rootFolderChanged = async () => {
    if (!isActive()) return
    const workspaceName = provider.workspace || provider.type || ''
    const promise = fetchDirectoryContent(provider, workspaceName)
    dispatch(fetchDirectoryRequest(promise))
    try {
      const files = await promise
      if (isActive()) dispatch(fetchDirectorySuccess(workspaceName, files))
    } catch (error) {
      if (isActive()) dispatch(fetchDirectoryError({ error }))
    }
  }

  const executeEvent = async (eventName: 'fileAdded' | 'folderAdded' | 'fileRemoved' | 'fileRenamed' | 'rootFolderChanged', path?: string) => {
    if (!isActive()) return
    if (Object.keys(pendingEvents).length) {
      queuedEvents.push({ eventName, path })
      return
    }
    const eventKey = eventName + path
    pendingEvents[eventKey] = { eventName, path }
    try {
      switch (eventName) {
        case 'fileAdded':
          await fileAdded(path)
          break
        case 'folderAdded':
          await folderAdded(path)
          break
        case 'fileRemoved':
          await fileRemoved(path)
          break
        case 'fileRenamed':
          await fileRenamed(path)
          break
        case 'rootFolderChanged':
          await rootFolderChanged()
          break
      }
    } finally {
      delete pendingEvents[eventKey]
      if (isActive() && queuedEvents.length) {
        const next = queuedEvents.shift()
        await executeEvent(next.eventName, next.path)
      }
    }
  }

  const runEvent = (eventName, path?) => {
    executeEvent(eventName, path).catch(error => {
      if (isActive()) console.error(`[fileSystem] ${eventName} event failed`, error)
    })
  }

  const listeners = []
  const register = (eventName, listener) => {
    provider.event.on(eventName, listener)
    listeners.push({ eventName, listener })
  }

  if (!provider) {
    dispatch(fetchProviderError('No provider available'))
    return () => { active = false }
  }

  register('fileAdded', (filePath) => runEvent('fileAdded', filePath))
  register('folderAdded', (folderPath) => runEvent('folderAdded', folderPath))
  register('fileRemoved', (removePath) => runEvent('fileRemoved', removePath))
  register('fileRenamed', (oldPath) => runEvent('fileRenamed', oldPath))
  register('rootFolderChanged', () => runEvent('rootFolderChanged'))
  register('fileExternallyChanged', (path: string, file: { content: string }) => {
    if (!isActive()) return
    const config = registry.get('config').api
    const editor = registry.get('editor').api

    if (config.get('currentFile') === path && editor.currentContent() !== file.content) {
      if (provider.isReadOnly(path)) return editor.setText(file.content)
      dispatch(displayNotification(
        path + ' changed',
        'This file has been changed outside of Remix IDE.',
        'Replace by the new content', 'Keep the content displayed in Remix',
        () => {
          if (isActive()) editor.setText(file.content)
        }
      ))
    }
  })
  register('fileRenamedError', () => {
    if (isActive()) dispatch(displayNotification('File Renamed Failed', '', 'Ok', 'Cancel'))
  })
  dispatch(fetchProviderSuccess(provider))

  return () => {
    if (!active) return
    active = false
    queuedEvents.length = 0
    Object.keys(pendingEvents).forEach(key => delete pendingEvents[key])
    listeners.forEach(({ eventName, listener }) => {
      if (typeof provider.event.off === 'function') provider.event.off(eventName, listener)
      else if (typeof provider.event.removeListener === 'function') provider.event.removeListener(eventName, listener)
      else if (typeof provider.event.unregister === 'function') provider.event.unregister(eventName, listener)
    })
  }
}

export const setCurrentWorkspace = (name: string) => {
  return {
    type: 'SET_CURRENT_WORKSPACE',
    payload: name
  }
}

export const addInputFieldSuccess = (path: string, files: File[]) => {
  return {
    type: 'ADD_INPUT_FIELD',
    payload: { path, files }
  }
}

export const addInputField = (provider, type: string, path: string) => (dispatch: React.Dispatch<any>) => {
  const promise = fetchDirectoryContent(provider, path, type)

  promise.then((files) => {
    dispatch(addInputFieldSuccess(path, files))
  }).catch((error) => {
    console.error(error)
  })
  return promise
}

export const removeInputFieldSuccess = (path: string) => {
  return {
    type: 'REMOVE_INPUT_FIELD',
    payload: { path }
  }
}

export const removeInputField = (path: string) => (dispatch: React.Dispatch<any>) => {
  return dispatch(removeInputFieldSuccess(path))
}

export const displayNotification = (title: string, message: string, labelOk: string, labelCancel: string, actionOk?: (...args) => void, actionCancel?: (...args) => void) => {
  return {
    type: 'DISPLAY_NOTIFICATION',
    payload: { title, message, labelOk, labelCancel, actionOk, actionCancel }
  }
}

export const hideNotification = () => {
  return {
    type: 'HIDE_NOTIFICATION'
  }
}

export const closeNotificationModal = () => (dispatch: React.Dispatch<any>) => {
  dispatch(hideNotification())
}
