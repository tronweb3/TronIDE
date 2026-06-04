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
import yo from 'yo-yo'
const modalDialogCustom = require('./app/ui/modal-dialog-custom')
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

export async function migrateToWorkspace (fileManager, filePanel) {
  const browserProvider = fileManager.getProvider('browser')
  const workspaceProvider = fileManager.getProvider('workspace')
  const files = await browserProvider.copyFolderToJson('/')

  if (Object.keys(files).length === 0) {
    // we don't have any root file, only .workspaces
    // don't need to create a workspace
    throw new Error('No file to migrate')
  }

  if (Object.keys(files).length === 1 && files['/.workspaces']) {
    // we don't have any root file, only .workspaces
    // don't need to create a workspace
    throw new Error('No file to migrate')
  }

  const workspaceName = 'workspace_migrated_' + Date.now()
  await filePanel.processCreateWorkspace(workspaceName)
  filePanel.getWorkspaces() // refresh list
  const workspacePath = joinPath('browser', workspaceProvider.workspacesPath, workspaceName)
  await populateWorkspace(workspacePath, files, browserProvider)
  return workspaceName
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
