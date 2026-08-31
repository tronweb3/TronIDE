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

import { Storage } from '@remix-project/remix-lib'
import { joinPath } from './lib/helper'
import sha256 from 'crypto-js/sha256.js'
import yo from 'yo-yo'
const modalDialogCustom = require('./app/ui/modal-dialog-custom')

export const LEGACY_MIGRATION_FINGERPRINT_KEY = 'tron_legacy_migration_fingerprint'
export const LEGACY_MIGRATION_ALREADY_CURRENT = 'MIGRATION_ALREADY_CURRENT'

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key])
    return result
  }, {})
}

const legacyRootFiles = (files = {}) => Object.keys(files).reduce((result, path) => {
  const normalized = String(path).replace(/^\/+/, '')
  // These are storage implementation details, not user files. In particular,
  // the IndexedDB marker must never be copied into a user-created recovery
  // workspace by the older root-file migration action.
  if (normalized !== '.workspaces' && normalized !== '.tronide-workspace-storage-v1') result[path] = files[path]
  return result
}, {})

export const getLegacyMigrationFingerprint = (files) => sha256(JSON.stringify(canonicalize(files))).toString()
/*
  Migrating the files to the BrowserFS storage instead or raw localstorage
*/
export default (fileProvider) => {
  const fileStorage = new Storage('sol:')
  const flag = 'status'
  const fileStorageBrowserFS = new Storage('remix_browserFS_migration:')
  if (fileStorageBrowserFS.get(flag) === 'done') return
  fileStorage.keys().forEach((path) => {
    if (path !== '.remix.config') {
      const content = fileStorage.get(path)
      fileProvider.set(path, content)
      // TODO https://github.com/ethereum/remix-ide/issues/2377
      // fileStorage.remove(path) we don't want to remove it as we are still supporting the old version
    }
  })
  fileStorageBrowserFS.set(flag, 'done')
}

export async function migrateToWorkspace (fileManager, filePanel, { previousFingerprint = null } = {}) {
  const browserProvider = fileManager.getProvider('browser')
  const workspaceProvider = fileManager.getProvider('workspace')
  const files = legacyRootFiles(await browserProvider.copyFolderToJson('/'))

  if (Object.keys(files).length === 0) {
    throw new Error('No file to migrate')
  }

  const sourceFingerprint = getLegacyMigrationFingerprint(files)
  if (previousFingerprint && previousFingerprint === sourceFingerprint) {
    const error = new Error('Legacy files are already migrated and unchanged.')
    error.code = LEGACY_MIGRATION_ALREADY_CURRENT
    throw error
  }

  const workspaceName = 'workspace_migrated_' + Date.now()
  await filePanel.processCreateWorkspace(workspaceName)
  await filePanel.getWorkspaces() // refresh list
  const workspacePath = joinPath('browser', workspaceProvider.workspacesPath, workspaceName)
  await populateWorkspace(workspacePath, files, browserProvider)
  // Migration is a user-facing workspace operation. Leave the user in the
  // migrated tree instead of creating an unreachable workspace in the
  // selector while the old browser-root files remain active.
  if (typeof filePanel.setWorkspace === 'function') {
    await filePanel.setWorkspace(workspaceName, true, true)
  }
  return { workspaceName, sourceFingerprint }
}

const populateWorkspace = async (workspace, json, browserProvider) => {
  for (const item in json) {
    const isFolder = json[item].content === undefined
    if (isFolder && item === '/.workspaces') continue // we don't want to replicate this one.
    if (isFolder) {
      browserProvider.createDir(joinPath(workspace, item))
      await populateWorkspace(workspace, json[item].children, browserProvider)
    } else {
      await browserProvider.set(joinPath(workspace, item), json[item].content, (err) => {
        if (err && err.message) {
          modalDialogCustom.alert(yo`<div>There was an error migrating your files:${err.message} <div>Please use the ‘Download all Files' action, clear the local storage and re-import your files manually or use the 'Restore files' action.</div></div>`)
        }
      })
    }
  }
}
