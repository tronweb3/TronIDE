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

import { customAction } from '@remixproject/plugin-api'

export interface FileExplorerProps {
  name: string,
  registry: any,
  filesProvider: any,
  menuItems?: string[],
  plugin: any,
  focusRoot: boolean,
  contextMenuItems: MenuItems,
  removedContextMenuItems: MenuItems,
  displayInput?: boolean,
  externalUploads?: EventTarget & HTMLInputElement
}

export interface File {
  path: string,
  name: string,
  isDirectory: boolean,
  type: string,
  child?: File[],
}

export interface FileExplorerMenuProps {
  title: string,
  menuItems: string[],
  fileManager: any,
  createNewFile: (folder?: string) => void,
  createNewFolder: (parentFolder?: string) => void,
  publishToGist: (path?: string) => void,
  uploadFile: (target: EventTarget & HTMLInputElement) => void,
}

export type action = {
  name: string,
  type: string[],
  path: string[],
  extension: string[],
  pattern: string[],
  id: string,
  multiselect: boolean,
  label: string,
}

export type MenuItems = action[]
export interface FileExplorerContextMenuProps {
  actions: action[],
  createNewFile: (folder?: string) => void,
  createNewFolder: (parentFolder?: string) => void,
  deletePath: (path: string | string[]) => void,
  renamePath: (path: string, type: string) => void,
  hideContextMenu: () => void,
  publishToGist?: (path?: string, type?: string) => void,
  pushChangesToGist?: (path?: string, type?: string) => void,
  publishFolderToGist?: (path?: string, type?: string) => void,
  publishFileToGist?: (path?: string, type?: string) => void,
  runScript?: (path: string) => void,
  emit?: (cmd: customAction) => void,
  pageX: number,
  pageY: number,
  path: string,
  type: string,
  focus: { key: string; type: string }[],
  onMouseOver?: (...args) => void,
  copy?: (path: string, type: string) => void,
  paste?: (destination: string, type: string) => void,
}

declare global {
  interface Window {
    gtag: (
      command: 'event' | 'config',
      name: string,
      params?: Record<string, any>
    ) => void;
  }
}
