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

import React, { useEffect, useState, useRef, useReducer } from 'react'; // eslint-disable-line
// import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd' // eslint-disable-line
import { TreeView, TreeViewItem } from '@remix-ui/tree-view'; // eslint-disable-line
import { ModalDialog } from '@remix-ui/modal-dialog'; // eslint-disable-line
import { Toaster } from '@remix-ui/toaster'; // eslint-disable-line
import Gists from 'gists'
import { FileExplorerMenu } from './file-explorer-menu'; // eslint-disable-line
import { FileExplorerContextMenu } from './file-explorer-context-menu'; // eslint-disable-line
import { FileExplorerProps, File, MenuItems } from './types'
import {
  fileSystemReducer,
  fileSystemInitialState
} from './reducers/fileSystem'
import {
  fetchDirectory,
  init,
  resolveDirectory,
  addInputField,
  removeInputField
} from './actions/fileSystem'
import * as helper from '../../../../../apps/remix-ide/src/lib/helper'
import QueryParams from '../../../../../apps/remix-ide/src/lib/query-params'
import { customAction } from '@remixproject/plugin-api'

import './css/file-explorer.css'

// @ts-ignore
const queryParams = new QueryParams()

export const FileExplorer = (props: FileExplorerProps) => {
  const {
    name,
    registry,
    plugin,
    focusRoot,
    contextMenuItems,
    displayInput,
    externalUploads,
    removedContextMenuItems
  } = props
  const [state, setState] = useState({
    focusElement: [
      {
        key: '',
        type: 'folder'
      }
    ],
    files: [],
    fileManager: null,
    ctrlKey: false,
    newFileName: '',
    actions: [
      {
        id: 'newFile',
        name: 'New File',
        type: ['folder', 'gist'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'newFolder',
        name: 'New Folder',
        type: ['folder', 'gist'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'rename',
        name: 'Rename',
        type: ['file', 'folder'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'delete',
        name: 'Delete',
        type: ['file', 'folder', 'gist'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'run',
        name: 'Run',
        type: [],
        path: [],
        // extension: ['.js'],
        extension: ['.notSupported'],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'pushChangesToGist',
        name: 'Push changes to gist',
        type: ['gist'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'publishFolderToGist',
        name: 'Publish folder to gist',
        type: ['folder'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'publishFileToGist',
        name: 'Publish file to gist',
        type: ['file'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'copy',
        name: 'Copy',
        type: ['folder', 'file'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: false,
        label: ''
      },
      {
        id: 'deleteAll',
        name: 'Delete All',
        type: ['folder', 'file'],
        path: [],
        extension: [],
        pattern: [],
        multiselect: true,
        label: ''
      }
    ],
    focusContext: {
      element: null,
      x: null,
      y: null,
      type: ''
    },
    focusEdit: {
      element: null,
      type: '',
      isNew: false,
      lastEdit: ''
    },
    expandPath: [name],
    focusModal: {
      hide: true,
      title: '',
      message: '',
      okLabel: '',
      okFn: () => {},
      cancelLabel: '',
      cancelFn: () => {},
      handleHide: null
    },
    modals: [],
    toasterMsg: '',
    mouseOverElement: null,
    showContextMenu: false,
    reservedKeywords: [name, 'gist-'],
    copyElement: []
  })
  const [canPaste, setCanPaste] = useState(false)
  const [fileSystem, dispatch] = useReducer(
    fileSystemReducer,
    fileSystemInitialState
  )
  const editRef = useRef(null)

  useEffect(() => {
    init(props.filesProvider, props.plugin, props.registry)(dispatch)
  }, [])

  useEffect(() => {
    const provider = fileSystem.provider.provider

    if (provider) {
      fetchDirectory(provider, props.name)(dispatch)
    }
  }, [fileSystem.provider.provider, props.name])

  useEffect(() => {
    if (fileSystem.notification.message) {
      modal(
        fileSystem.notification.title,
        fileSystem.notification.message,
        fileSystem.notification.labelOk,
        fileSystem.notification.actionOk,
        fileSystem.notification.labelCancel,
        fileSystem.notification.actionCancel
      )
    }
  }, [fileSystem.notification.message])

  useEffect(() => {
    if (fileSystem.files.expandPath.length > 0) {
      setState(prevState => {
        return {
          ...prevState,
          expandPath: [
            ...new Set([
              ...prevState.expandPath,
              ...fileSystem.files.expandPath
            ])
          ]
        }
      })
    }
  }, [fileSystem.files.expandPath])

  useEffect(() => {
    if (state.focusEdit.element) {
      setTimeout(() => {
        if (editRef && editRef.current) {
          editRef.current.focus()
        }
      }, 150)
    }
  }, [state.focusEdit.element])

  useEffect(() => {
    (async () => {
      const fileManager = registry.get('filemanager').api

      setState(prevState => {
        return { ...prevState, fileManager, expandPath: [name] }
      })
    })()
  }, [name])

  useEffect(() => {
    if (focusRoot) {
      setState(prevState => {
        return { ...prevState, focusElement: [{ key: '', type: 'folder' }] }
      })
      plugin.resetFocus(false)
    }
  }, [focusRoot])

  useEffect(() => {
    if (contextMenuItems) {
      addMenuItems(contextMenuItems)
    }
  }, [contextMenuItems])

  useEffect(() => {
    if (removedContextMenuItems) {
      removeMenuItems(removedContextMenuItems)
    }
  }, [contextMenuItems])

  useEffect(() => {
    if (displayInput) {
      handleNewFileInput()
      plugin.resetNewFile()
    }
  }, [displayInput])

  useEffect(() => {
    if (externalUploads) {
      uploadFile(externalUploads)
      plugin.resetUploadFile()
    }
  }, [externalUploads])

  useEffect(() => {
    if (state.modals.length > 0) {
      setState(prevState => {
        const focusModal = {
          hide: false,
          title: prevState.modals[0].title,
          message: prevState.modals[0].message,
          okLabel: prevState.modals[0].okLabel,
          okFn: prevState.modals[0].okFn,
          cancelLabel: prevState.modals[0].cancelLabel,
          cancelFn: prevState.modals[0].cancelFn,
          handleHide: prevState.modals[0].handleHide
        }

        prevState.modals.shift()
        return {
          ...prevState,
          focusModal,
          modals: prevState.modals
        }
      })
    }
  }, [state.modals])

  useEffect(() => {
    const keyPressHandler = (e: KeyboardEvent) => {
      if (e.shiftKey) {
        setState(prevState => {
          return { ...prevState, ctrlKey: true }
        })
      }
    }

    const keyUpHandler = (e: KeyboardEvent) => {
      if (!e.shiftKey) {
        setState(prevState => {
          return { ...prevState, ctrlKey: false }
        })
      }
    }

    // Clear the multi-select modifier whenever the window loses focus: a Shift
    // keyup delivered to the editor iframe / another app / an OS shortcut is
    // never seen here, which would otherwise leave ctrlKey stuck true and turn
    // every plain click into a multi-select (files/folders unselectable).
    const resetCtrlKey = () => setState(prevState => (prevState.ctrlKey ? { ...prevState, ctrlKey: false } : prevState))
    document.addEventListener('keydown', keyPressHandler)
    document.addEventListener('keyup', keyUpHandler)
    window.addEventListener('blur', resetCtrlKey)
    return () => {
      document.removeEventListener('keydown', keyPressHandler)
      document.removeEventListener('keyup', keyUpHandler)
      window.removeEventListener('blur', resetCtrlKey)
    }
  }, [])

  useEffect(() => {
    if (canPaste) {
      addMenuItems([
        {
          id: 'paste',
          name: 'Paste',
          type: ['folder', 'file'],
          path: [],
          extension: [],
          pattern: [],
          multiselect: false,
          label: ''
        }
      ])
    } else {
      removeMenuItems([
        {
          id: 'paste',
          name: 'Paste',
          type: ['folder', 'file'],
          path: [],
          extension: [],
          pattern: [],
          multiselect: false,
          label: ''
        }
      ])
    }
  }, [canPaste])

  const addMenuItems = (items: MenuItems) => {
    setState(prevState => {
      // filter duplicate items
      const actions = items.filter(
        ({ name }) =>
          prevState.actions.findIndex(action => action.name === name) === -1
      )

      return { ...prevState, actions: [...prevState.actions, ...actions] }
    })
  }

  const removeMenuItems = (items: MenuItems) => {
    setState(prevState => {
      const actions = prevState.actions.filter(
        ({ id, name }) =>
          items.findIndex(item => id === item.id && name === item.name) === -1
      )
      return { ...prevState, actions }
    })
  }

  const extractNameFromKey = (key: string): string => {
    const keyPath = key.split('/')

    return keyPath[keyPath.length - 1]
  }

  const extractParentFromKey = (key: string): string => {
    if (!key) return
    const keyPath = key.split('/')
    keyPath.pop()

    return keyPath.join('/')
  }

  const hasReservedKeyword = (content: string): boolean => {
    if (
      state.reservedKeywords.findIndex(value => content.startsWith(value)) !==
      -1
    ) { return true } else return false
  }

  const getFocusedFolder = () => {
    if (state.focusElement[0]) {
      if (state.focusElement[0].type === 'folder' && state.focusElement[0].key) { return state.focusElement[0].key } else if (
        state.focusElement[0].type === 'gist' &&
        state.focusElement[0].key
      ) { return state.focusElement[0].key } else if (
        state.focusElement[0].type === 'file' &&
        state.focusElement[0].key
      ) {
        return extractParentFromKey(state.focusElement[0].key)
          ? extractParentFromKey(state.focusElement[0].key)
          : name
      } else return name
    }
  }

  const createNewFile = async (newFilePath: string) => {
    const fileManager = state.fileManager

    try {
      const newName = await helper.createNonClashingNameAsync(
        newFilePath,
        fileManager
      )
      const createFile = await fileManager.writeFile(newName, '')

      if (!createFile) {
        return toast('Failed to create file ' + newName)
      } else {
        const path =
          newName.indexOf(props.name + '/') === 0
            ? newName.replace(props.name + '/', '')
            : newName

        await fileManager.open(path)
        setState(prevState => {
          return {
            ...prevState,
            focusElement: [{ key: newName, type: 'file' }]
          }
        })
      }
    } catch (error) {
      return modal(
        'File Creation Failed',
        typeof error === 'string' ? error : error.message,
        'Close',
        async () => {}
      )
    }
  }

  const createNewFolder = async (newFolderPath: string) => {
    const fileManager = state.fileManager
    const dirName = newFolderPath + '/'

    try {
      const exists = await fileManager.exists(dirName)

      if (exists) {
        return modal(
          'Rename File Failed',
          `A file or folder ${extractNameFromKey(
            newFolderPath
          )} already exists at this location. Please choose a different name.`,
          'Close',
          () => {}
        )
      }
      await fileManager.mkdir(dirName)
      setState(prevState => {
        return {
          ...prevState,
          focusElement: [{ key: newFolderPath, type: 'folder' }]
        }
      })
    } catch (e) {
      return modal(
        'Folder Creation Failed',
        typeof e === 'string' ? e : e.message,
        'Close',
        async () => {}
      )
    }
  }

  const deletePath = async (path: string | string[]) => {
    const filesProvider = fileSystem.provider.provider
    if (!Array.isArray(path)) path = [path]
    for (const p of path) {
      if (filesProvider.isReadOnly(p)) {
        return toast(
          'cannot delete file. ' + name + ' is a read only explorer'
        )
      }
    }
    modal(
      `Delete ${path.length > 1 ? 'items' : 'item'}`,
      deleteMessage(path),
      'OK',
      async () => {
        const fileManager = state.fileManager
        for (const p of path) {
          try {
            await fileManager.remove(p)
          } catch (e) {
            const isDir = await state.fileManager.isDirectory(p)
            toast(`Failed to remove ${isDir ? 'folder' : 'file'} ${p}.`)
          }
        }
      },
      'Cancel',
      () => {}
    )
  }

  const renamePath = async (oldPath: string, newPath: string) => {
    try {
      const fileManager = state.fileManager
      const exists = await fileManager.exists(newPath)

      if (exists) {
        modal(
          'Rename File Failed',
          `A file or folder ${extractNameFromKey(
            newPath
          )} already exists at this location. Please choose a different name.`,
          'Close',
          () => {}
        )
      } else {
        await fileManager.rename(oldPath, newPath)
      }
    } catch (error) {
      modal(
        'Rename File Failed',
        'Unexpected error while renaming: ' + typeof error === 'string'
          ? error
          : error.message,
        'Close',
        async () => {}
      )
    }
  }

  const uploadFile = target => {
    const filesProvider = fileSystem.provider.provider
    // TODO The file explorer is merely a view on the current state of
    // the files module. Please ask the user here if they want to overwrite
    // a file and then just use `files.add`. The file explorer will
    // pick that up via the 'fileAdded' event from the files module.
    const parentFolder = getFocusedFolder()
    const expandPath = [...new Set([...state.expandPath, parentFolder])]

    setState(prevState => {
      return { ...prevState, expandPath }
    });

    [...target.files].forEach(file => {
      const loadFile = (name: string): void => {
        const fileReader = new FileReader()

        fileReader.onload = async function (event) {
          if (helper.checkSpecialChars(file.name)) {
            modal(
              'File Upload Failed',
              'Special characters are not allowed',
              'Close',
              async () => {}
            )
            return
          }
          // Decode the upload as UTF-8 text. If the bytes are not valid UTF-8 the
          // file is binary, so store it as a base64 data URL: the file storage and
          // workspace backup are string-based, and reading binary as text (the old
          // readAsText path) silently corrupted the bytes (finding WS-BIN-1).
          const buffer = event.target.result as ArrayBuffer
          let content: string
          try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer))
          } catch (e) {
            const bytes = new Uint8Array(buffer)
            let binary = ''
            const chunkSize = 0x8000
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[])
            }
            content = 'data:application/octet-stream;base64,' + btoa(binary)
          }
          const success = await filesProvider.set(name, content)

          if (!success) {
            return modal(
              'File Upload Failed',
              'Failed to create file ' + name,
              'Close',
              async () => {}
            )
          }
          const config = registry.get('config').api
          const editor = registry.get('editor').api

          if (
            config.get('currentFile') === name &&
            editor.currentContent() !== content
          ) {
            editor.setText(content)
          }
        }
        fileReader.readAsArrayBuffer(file)
      }
      const name = `${parentFolder}/${file.name}`

      filesProvider
        .exists(name)
        .then(exist => {
          if (!exist) {
            loadFile(name)
          } else {
            modal(
              'Confirm overwrite',
              `The file ${name} already exists! Would you like to overwrite it?`,
              'OK',
              () => {
                loadFile(name)
              },
              'Cancel',
              () => {}
            )
          }
        })
        .catch(error => {
          if (error) console.log(error)
          modal(
            'File Upload Failed',
            `Failed to upload file ${name}: ${typeof error === 'string' ? error : (error && error.message) || 'could not check if the file already exists'}`,
            'Close',
            async () => {}
          )
        })
    })
  }

  const copyFile = async (src: string, dest: string) => {
    const fileManager = state.fileManager

    try {
      await fileManager.copyFile(src, dest)
    } catch (error) {
      console.log(
        'Oops! An error ocurred while performing copyFile operation.' + error
      )
      modal(
        'Copy File Failed',
        `Failed to copy file ${src}: ${typeof error === 'string' ? error : error.message}`,
        'Close',
        () => {}
      )
    }
  }

  const copyFolder = async (src: string, dest: string) => {
    const fileManager = state.fileManager

    try {
      await fileManager.copyDir(src, dest)
    } catch (error) {
      console.log(
        'Oops! An error ocurred while performing copyDir operation.' + error
      )
      modal(
        'Copy Folder Failed',
        `Failed to copy folder ${src}: ${typeof error === 'string' ? error : error.message}`,
        'Close',
        () => {}
      )
    }
  }

  const publishToGist = (path?: string, type?: string) => {
    modal(
      'Create a public gist',
      `Are you sure you want to anonymously publish all your files in the ${name} workspace as a public gist on github.com?`,
      'OK',
      () => toGist(path, type),
      'Cancel',
      () => {}
    )
  }

  const pushChangesToGist = (path?: string, type?: string) => {
    modal(
      'Update gist',
      'Are you sure you want to push your changes to the remote gist on github.com?',
      'OK',
      () => toGist(path, type),
      'Cancel',
      () => {}
    )
  }

  const publishFolderToGist = (path?: string, type?: string) => {
    modal(
      'Create a public gist',
      `Are you sure you want to anonymously publish all your files in the ${path} folder as a public gist on github.com?`,
      'OK',
      () => toGist(path, type),
      'Cancel',
      () => {}
    )
  }

  const publishFileToGist = (path?: string, type?: string) => {
    modal(
      'Create a public gist',
      `Are you sure you want to anonymously publish ${path} file as a public gist on github.com?`,
      'OK',
      () => toGist(path, type),
      'Cancel',
      () => {}
    )
  }

  const toGist = (path?: string, type?: string) => {
    const filesProvider = fileSystem.provider.provider
    const proccedResult = function (error, data) {
      if (error) {
        // Try to give a cause-specific message instead of the generic "Failed to manage gist".
        // The error may be a thrown Error (e.g. from getOriginalFiles), a fetch/network failure,
        // or a rejection from the gists library which carries a statusCode/status and a message.
        const status = error.statusCode || error.status || 0
        const rawMessage =
          (typeof error === 'string' ? error : (error && error.message)) || ''
        // Surface the GitHub response body when the library provides one (more specific than the message).
        const body =
          error && error.body
            ? typeof error.body === 'string'
              ? error.body
              : (error.body.message || '')
            : ''
        const detail = [rawMessage, body].filter(Boolean).join(' ').trim()
        let message: string

        if (status === 404 || /\b404\b|Not Found/i.test(detail)) {
          message =
            'The gist could not be found. It may have been deleted, or the configured access token does not have permission to read it.'
        } else if (status === 401 || status === 403 || /\b401\b|\b403\b|Bad credentials|rate limit/i.test(detail)) {
          message =
            'GitHub rejected the request. Please check that your gist access token is valid and has gist permission (settings tab). ' +
            detail
        } else if (
          error instanceof TypeError ||
          /Failed to fetch|NetworkError|network/i.test(detail)
        ) {
          message =
            'A network error occurred while contacting github.com. Please check your connection and try again.'
        } else {
          message = 'Failed to manage gist: ' + (detail || error)
        }
        modal('Publish to gist Failed', message, 'Close', () => {})
      } else {
        if (data.html_url) {
          modal(
            'Gist is ready',
            `The gist is at ${data.html_url}. Would you like to open it in a new window?`,
            'OK',
            () => {
              window.open(data.html_url, '_blank', 'noopener,noreferrer')
            },
            'Cancel',
            () => {}
          )
        } else {
          const error = JSON.stringify(data.errors, null, '\t') || ''
          const message =
            data.message === 'Not Found'
              ? data.message +
                '. Please make sure the API token has right to create a gist.'
              : data.message
          modal(
            'Publish to gist Failed',
            message + ' ' + data.documentation_url + ' ' + error,
            'Close',
            () => {}
          )
        }
      }
    }

    /**
     * This function is to get the original content of given gist
     * @params id is the gist id to fetch
     */
    const getOriginalFiles = async (id, accessToken?) => {
      if (!id) {
        return []
      }

      const url = `https://api.github.com/gists/${id}`
      // Authenticate with the configured gist token so this update-path read shares the higher
      // GitHub rate limit (anonymous reads were hitting "API rate limit exceeded"). The caller
      // only reaches here once a token is present, but stay safe if it is ever called without one.
      const res = await fetch(url, accessToken ? { headers: { Authorization: `token ${accessToken}` } } : undefined)
      // A 404 (gist does not exist) or 401/403 (no permission) still returns a JSON body, but it is a
      // GitHub *error* object with no `files` key. Parsing it and falling back to `data.files || []`
      // silently yields `[]`, which the update flow then treats as a successful empty read and the
      // user is left hanging on "Saving gist...". Surface the failure instead of swallowing it.
      if (!res.ok) {
        throw new Error(`GitHub gist ${id} 不可读: ${res.status}`)
      }
      const data = await res.json()
      return data.files || []
    }

    // If 'id' is not defined, it is not a gist update but a creation so we have to take the files from the browser explorer.
    const folder = path || '/'
    const id = type === 'gist' ? extractNameFromKey(path).split('-')[1] : null

    packageFiles(filesProvider, folder, async (error, packaged) => {
      if (error) {
        console.log(error)
        modal(
          'Publish to gist Failed',
          'Failed to create gist: ' + error.message,
          'Close',
          async () => {}
        )
      } else {
        // check for token
        const config = registry.get('config').api
        const accessToken = config.get('settings/gist-access-token')

        if (!accessToken) {
          modal(
            'Authorize Token',
            'TronIDE requires an access token (which includes gists creation permission). Please go to the settings tab to create one.',
            'Close',
            () => {}
          )
        } else {
          const description =
            'Created using tron-ide: Realtime Tron Contract Compiler and Runtime. \n Load this file by pasting this gists URL or ID at http://tronide.io/#version=' +
            queryParams.get().version +
            '&optimize=' +
            queryParams.get().optimize +
            '&runs=' +
            queryParams.get().runs +
            '&gist='
          const gists = new Gists({ token: accessToken })

          if (id) {
            try {
              const originalFileList = await getOriginalFiles(id, accessToken)
              // Telling the GIST API to remove files
              const updatedFileList = Object.keys(packaged)
              const allItems = Object.keys(originalFileList)
                .filter(fileName => updatedFileList.indexOf(fileName) === -1)
                .reduce(
                  (acc, deleteFileName) => ({
                    ...acc,
                    [deleteFileName]: null
                  }),
                  originalFileList
                )
              // adding new files
              updatedFileList.forEach(file => {
                const _items = file.split('/')
                const _fileName = _items[_items.length - 1]
                allItems[_fileName] = packaged[file]
              })

              toast('Saving gist (' + id + ') ...')
              await gists.edit(id,
                {
                  description: description,
                  public: true,
                  files: allItems
                }
              ).then((result) => {
                proccedResult(null, result.body)
                for (const key in allItems) {
                  if (allItems[key] === null) delete allItems[key]
                }
              })
            } catch (error) {
              // Clear the "Saving gist..." toast so it does not linger next to the error modal,
              // then surface a clear failure (e.g. the gist id does not exist or token lacks access)
              // instead of leaving the user stuck on the loading message forever.
              toast('')
              proccedResult(error, {})
            }
          } else {
            // id is not existing, need to create a new gist
            toast('Creating a new gist ...')
            gists.create(
              {
                description: description,
                public: true,
                files: packaged
              }
            ).then(result => {
              proccedResult(null, result.body)
            }).catch(error => {
              // Clear the "Creating a new gist..." toast first so it does not linger
              // behind the error modal (avoids a stacked toast + modal).
              toast('')
              proccedResult(error, {})
            })
          }
        }
      }
    })
  }

  const runScript = async (path: string) => {
    const filesProvider = fileSystem.provider.provider

    filesProvider.get(path, (error, content: string) => {
      if (error) {
        console.log(error)
        return toast(
          `Failed to run script ${path}: ${typeof error === 'string' ? error : error.message}`
        )
      }
      plugin.call('scriptRunner', 'execute', content)
    })
  }

  const emitContextMenuEvent = (cmd: customAction) => {
    plugin.call(cmd.id, cmd.name, cmd)
  }

  const handleHideModal = () => {
    setState(prevState => {
      return { ...prevState, focusModal: { ...state.focusModal, hide: true } }
    })
  }

  const modal = (
    title: string,
    message: string | JSX.Element,
    okLabel: string,
    okFn: () => void,
    cancelLabel?: string,
    cancelFn?: () => void
  ) => {
    setState(prevState => {
      return {
        ...prevState,
        modals: [
          ...prevState.modals,
          {
            message,
            title,
            okLabel,
            okFn,
            cancelLabel,
            cancelFn,
            handleHide: handleHideModal
          }
        ]
      }
    })
  }

  const toast = (message: string) => {
    setState(prevState => {
      return { ...prevState, toasterMsg: message }
    })
  }

  const handleClickFile = (path: string, type: string, multiSelect = false) => {
    path =
      path.indexOf(props.name + '/') === 0
        ? path.replace(props.name + '/', '')
        : path
    if (!multiSelect) {
      state.fileManager.open(path)
      setState(prevState => {
        return { ...prevState, focusElement: [{ key: path, type }] }
      })
    } else {
      if (state.focusElement.findIndex(item => item.key === path) !== -1) {
        setState(prevState => {
          return {
            ...prevState,
            focusElement: prevState.focusElement.filter(
              item => item.key !== path
            )
          }
        })
      } else {
        setState(prevState => {
          const nonRootFocus = prevState.focusElement.filter(el => {
            return !(el.key === '' && el.type === 'folder')
          })

          nonRootFocus.push({ key: path, type })
          return { ...prevState, focusElement: nonRootFocus }
        })
      }
    }
  }

  const handleClickFolder = async (path: string, type: string, multiSelect = false) => {
    if (multiSelect) {
      if (state.focusElement.findIndex(item => item.key === path) !== -1) {
        setState(prevState => {
          return {
            ...prevState,
            focusElement: [
              ...prevState.focusElement.filter(item => item.key !== path)
            ]
          }
        })
      } else {
        setState(prevState => {
          const nonRootFocus = prevState.focusElement.filter(el => {
            return !(el.key === '' && el.type === 'folder')
          })

          nonRootFocus.push({ key: path, type })
          return { ...prevState, focusElement: nonRootFocus }
        })
      }
    } else {
      let expandPath = []

      if (!state.expandPath.includes(path)) {
        expandPath = [...new Set([...state.expandPath, path])]
        resolveDirectory(fileSystem.provider.provider, path)(dispatch)
      } else {
        expandPath = [
          ...new Set(
            state.expandPath.filter(
              key => key && typeof key === 'string' && !key.startsWith(path)
            )
          )
        ]
      }

      setState(prevState => {
        return {
          ...prevState,
          focusElement: [{ key: path, type }],
          expandPath
        }
      })
    }
  }

  const handleContextMenuFile = (
    pageX: number,
    pageY: number,
    path: string,
    content: string,
    type: string
  ) => {
    if (!content) return
    setState(prevState => {
      return {
        ...prevState,
        focusContext: { element: path, x: pageX, y: pageY, type },
        focusEdit: { ...prevState.focusEdit, lastEdit: content },
        showContextMenu: prevState.focusEdit.element !== path
      }
    })
  }

  const handleContextMenuFolder = (
    pageX: number,
    pageY: number,
    path: string,
    content: string,
    type: string
  ) => {
    if (!content) return
    setState(prevState => {
      return {
        ...prevState,
        focusContext: { element: path, x: pageX, y: pageY, type },
        focusEdit: { ...prevState.focusEdit, lastEdit: content },
        showContextMenu: prevState.focusEdit.element !== path
      }
    })
  }

  const hideContextMenu = () => {
    setState(prevState => {
      return {
        ...prevState,
        focusContext: { element: null, x: 0, y: 0, type: '' },
        showContextMenu: false
      }
    })
  }

  const editModeOn = (path: string, type: string, isNew: boolean = false) => {
    if (fileSystem.provider.provider.isReadOnly(path)) return
    setState(prevState => {
      return {
        ...prevState,
        focusEdit: { ...prevState.focusEdit, element: path, isNew, type }
      }
    })
  }

  const editModeOff = async (content: string) => {
    if (typeof content === 'string') content = content.trim()
    const parentFolder = extractParentFromKey(state.focusEdit.element)

    if (!content || content.trim() === '') {
      if (state.focusEdit.isNew) {
        removeInputField(parentFolder)(dispatch)
        setState(prevState => {
          return {
            ...prevState,
            focusEdit: { element: null, isNew: false, type: '', lastEdit: '' }
          }
        })
      } else {
        editRef.current.textContent = state.focusEdit.lastEdit
        setState(prevState => {
          return {
            ...prevState,
            focusEdit: { element: null, isNew: false, type: '', lastEdit: '' }
          }
        })
      }
    } else {
      if (state.focusEdit.lastEdit === content) {
        editRef.current.textContent = content
        return setState(prevState => {
          return {
            ...prevState,
            focusEdit: { element: null, isNew: false, type: '', lastEdit: '' }
          }
        })
      }
      if (helper.checkSpecialChars(content)) {
        modal(
          'Validation Error',
          'Special characters are not allowed',
          'OK',
          () => {}
        )
      } else {
        if (state.focusEdit.isNew) {
          if (hasReservedKeyword(content)) {
            removeInputField(parentFolder)(dispatch)
            modal(
              'Reserved Keyword',
              `File name contains remix reserved keywords. '${content}'`,
              'Close',
              () => {}
            )
          } else {
            state.focusEdit.type === 'file'
              ? createNewFile(joinPath(parentFolder, content))
              : createNewFolder(joinPath(parentFolder, content))
            removeInputField(parentFolder)(dispatch)
          }
        } else {
          if (hasReservedKeyword(content)) {
            editRef.current.textContent = state.focusEdit.lastEdit
            modal(
              'Reserved Keyword',
              `File name contains remix reserved keywords. '${content}'`,
              'Close',
              () => {}
            )
          } else {
            const oldPath: string = state.focusEdit.element
            const oldName = extractNameFromKey(oldPath)
            const newPath = oldPath.replace(oldName, content)

            editRef.current.textContent = extractNameFromKey(oldPath)
            renamePath(oldPath, newPath)
          }
        }
        setState(prevState => {
          return {
            ...prevState,
            focusEdit: { element: null, isNew: false, type: '', lastEdit: '' }
          }
        })
      }
    }
  }

  const handleNewFileInput = async (parentFolder?: string) => {
    if (!parentFolder) parentFolder = getFocusedFolder()
    const expandPath = [...new Set([...state.expandPath, parentFolder])]

    await addInputField(
      fileSystem.provider.provider,
      'file',
      parentFolder
    )(dispatch)
    setState(prevState => {
      return { ...prevState, expandPath }
    })
    editModeOn(parentFolder + '/blank', 'file', true)
  }

  const handleNewFolderInput = async (parentFolder?: string) => {
    if (!parentFolder) parentFolder = getFocusedFolder()
    else if (
      parentFolder.indexOf('.sol') !== -1 ||
      parentFolder.indexOf('.js') !== -1
    ) { parentFolder = extractParentFromKey(parentFolder) }
    const expandPath = [...new Set([...state.expandPath, parentFolder])]

    await addInputField(
      fileSystem.provider.provider,
      'folder',
      parentFolder
    )(dispatch)
    setState(prevState => {
      return { ...prevState, expandPath }
    })
    editModeOn(parentFolder + '/blank', 'folder', true)
  }

  const handleEditInput = event => {
    if (event.which === 13) {
      event.preventDefault()
      editModeOff(editRef.current.innerText)
    }
  }

  const handleMouseOver = (path: string) => {
    setState(prevState => {
      return { ...prevState, mouseOverElement: path }
    })
  }

  const handleMouseOut = () => {
    setState(prevState => {
      return { ...prevState, mouseOverElement: null }
    })
  }

  const handleCopyClick = (path: string, type: string) => {
    setState(prevState => {
      return { ...prevState, copyElement: [{ key: path, type }] }
    })
    setCanPaste(true)
    toast(`Copied to clipboard ${path}`)
  }

  const handlePasteClick = (dest: string, destType: string) => {
    dest =
      destType === 'file' ? extractParentFromKey(dest) || props.name : dest
    state.copyElement.map(({ key, type }) => {
      type === 'file' ? copyFile(key, dest) : copyFolder(key, dest)
    })
  }

  const deleteMessage = (path: string[]) => {
    return (
      <div>
        <div>
          Are you sure you want to delete{' '}
          {path.length > 1 ? 'these items' : 'this item'}?
        </div>
        {path.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </div>
    )
  }

  const label = (file: File) => {
    return (
      <div
        className="remixui_items d-inline-block w-100"
        ref={state.focusEdit.element === file.path ? editRef : null}
        suppressContentEditableWarning={true}
        contentEditable={state.focusEdit.element === file.path}
        onKeyDown={handleEditInput}
        onBlur={e => {
          e.stopPropagation()
          editModeOff(editRef.current.innerText)
        }}
      >
        <span
          title={file.path}
          className={
            'remixui_label ' + (file.isDirectory ? 'folder' : 'remixui_leaf')
          }
          data-path={file.path}
        >
          {file.name}
        </span>
      </div>
    )
  }

  const renderFiles = (file: File, index: number) => {
    if (
      !file ||
      !file.path ||
      typeof file === 'string' ||
      typeof file === 'number' ||
      typeof file === 'boolean'
    ) { return }
    const labelClass =
      state.focusEdit.element === file.path
        ? 'bg-light'
        : state.focusElement.findIndex(item => item.key === file.path) !== -1
          ? 'bg-secondary'
          : state.mouseOverElement === file.path
            ? 'bg-light border'
            : state.focusContext.element === file.path &&
          state.focusEdit.element !== file.path
              ? 'bg-light border'
              : ''
    const icon = helper.getPathIcon(file.path)
    const spreadProps = {
      onClick: e => e.stopPropagation()
    }

    if (file.isDirectory) {
      return (
        <TreeViewItem
          id={`treeViewItem${file.path}`}
          iconX="pr-3 fa fa-folder"
          iconY="pr-3 fa fa-folder-open"
          key={`${file.path + index}`}
          label={label(file)}
          onClick={e => {
            e.stopPropagation()
            if (state.focusEdit.element !== file.path) { handleClickFolder(file.path, file.type, e.shiftKey || e.ctrlKey || e.metaKey) }
          }}
          onContextMenu={e => {
            e.preventDefault()
            e.stopPropagation()
            handleContextMenuFolder(
              e.pageX,
              e.pageY,
              file.path,
              e.target.textContent,
              file.type
            )
          }}
          labelClass={labelClass}
          controlBehaviour={state.ctrlKey}
          expand={state.expandPath.includes(file.path)}
          onMouseOver={e => {
            e.stopPropagation()
            handleMouseOver(file.path)
          }}
          onMouseOut={e => {
            e.stopPropagation()
            if (state.mouseOverElement === file.path) handleMouseOut()
          }}
        >
          {file.child ? (
            <TreeView
              id={`treeView${file.path}`}
              key={`treeView${file.path}`}
              {...spreadProps}
            >
              {Object.keys(file.child).map((key, index) => {
                return renderFiles(file.child[key], index)
              })}
            </TreeView>
          ) : (
            <TreeView
              id={`treeView${file.path}`}
              key={`treeView${file.path}`}
              {...spreadProps}
            />
          )}
        </TreeViewItem>
      )
    } else {
      return (
        <TreeViewItem
          id={`treeViewItem${file.path}`}
          key={`treeView${file.path}`}
          label={label(file)}
          onClick={e => {
            e.stopPropagation()
            if (state.focusEdit.element !== file.path) { handleClickFile(file.path, file.type, e.shiftKey || e.ctrlKey || e.metaKey) }
          }}
          onContextMenu={e => {
            e.preventDefault()
            e.stopPropagation()
            handleContextMenuFile(
              e.pageX,
              e.pageY,
              file.path,
              e.target.textContent,
              file.type
            )
          }}
          icon={icon}
          labelClass={labelClass}
          onMouseOver={e => {
            e.stopPropagation()
            handleMouseOver(file.path)
          }}
          onMouseOut={e => {
            e.stopPropagation()
            if (state.mouseOverElement === file.path) handleMouseOut()
          }}
        />
      )
    }
  }

  return (
    <div>
      <TreeView id="treeView">
        <TreeViewItem
          id="treeViewItem"
          controlBehaviour={true}
          label={
            <div
              onClick={e => {
                e.stopPropagation()
                if (
                  e &&
                  (e.target as any).getAttribute('data-id') ===
                    'fileExplorerUploadFileuploadFile'
                ) { return } // we don't want to let propagate the input of type file
                if (
                  e &&
                  (e.target as any).getAttribute('data-id') ===
                    'fileExplorerFileUpload'
                ) { return } // we don't want to let propagate the input of type file
                let expandPath = []

                if (!state.expandPath.includes(props.name)) {
                  expandPath = [props.name, ...new Set([...state.expandPath])]
                } else {
                  expandPath = [
                    ...new Set(
                      state.expandPath.filter(
                        key =>
                          key &&
                          typeof key === 'string' &&
                          !key.startsWith(props.name)
                      )
                    )
                  ]
                }
                setState(prevState => {
                  return { ...prevState, expandPath }
                })
                plugin.resetFocus(true)
              }}
            >
              <FileExplorerMenu
                title={''}
                menuItems={props.menuItems}
                createNewFile={handleNewFileInput}
                createNewFolder={handleNewFolderInput}
                publishToGist={publishToGist}
                uploadFile={uploadFile}
                fileManager={state.fileManager}
              />
            </div>
          }
          expand={true}
        >
          <div className="pb-2">
            <TreeView id="treeViewMenu">
              {fileSystem.files.files[props.name] &&
                Object.keys(fileSystem.files.files[props.name]).map(
                  (key, index) => {
                    return renderFiles(
                      fileSystem.files.files[props.name][key],
                      index
                    )
                  }
                )}
            </TreeView>
          </div>
        </TreeViewItem>
      </TreeView>
      {props.name && (
        <ModalDialog
          id={props.name}
          title={state.focusModal.title}
          message={state.focusModal.message}
          hide={state.focusModal.hide}
          okLabel={state.focusModal.okLabel}
          okFn={state.focusModal.okFn}
          cancelLabel={state.focusModal.cancelLabel}
          cancelFn={state.focusModal.cancelFn}
          handleHide={handleHideModal}
        />
      )}
      <Toaster message={state.toasterMsg} />
      {state.showContextMenu && (
        <FileExplorerContextMenu
          actions={
            state.focusElement.length > 1
              ? state.actions.filter(item => item.multiselect)
              : state.actions.filter(item => !item.multiselect)
          }
          hideContextMenu={hideContextMenu}
          createNewFile={handleNewFileInput}
          createNewFolder={handleNewFolderInput}
          deletePath={deletePath}
          renamePath={editModeOn}
          runScript={runScript}
          copy={handleCopyClick}
          paste={handlePasteClick}
          emit={emitContextMenuEvent}
          pageX={state.focusContext.x}
          pageY={state.focusContext.y}
          path={state.focusContext.element}
          type={state.focusContext.type}
          focus={state.focusElement}
          onMouseOver={e => {
            e.stopPropagation()
            handleMouseOver(state.focusContext.element)
          }}
          pushChangesToGist={pushChangesToGist}
          publishFolderToGist={publishFolderToGist}
          publishFileToGist={publishFileToGist}
        />
      )}
    </div>
  )
}

export default FileExplorer

async function packageFiles (filesProvider, directory, callback) {
  const isFile = filesProvider.isFile(directory)
  const ret = {}

  if (isFile) {
    try {
      filesProvider.get(directory, (error, content) => {
        if (error) {
          throw new Error(
            'An error ocurred while getting file content. ' + directory
          )
        }
        if (/^\s+$/.test(content) || !content.length) {
          content =
            '// this line is added to create a gist. Empty file is not allowed.'
        }
        directory = directory.replace(/\//g, '...')
        ret[directory] = { content }
        callback(null, ret)
      })
    } catch (e) {
      return callback(e)
    }
  } else {
    try {
      await filesProvider.copyFolderToJson(directory, ({ path, content }) => {
        if (path.indexOf('gist-') === 0) {
          path = path.split('/')
          path.shift()
          path = path.join('/')
        }
        // Don't pack the resolved dependency cache (.deps/npm/...) into the gist.
        // On reload those files are written back into the workspace and, because
        // the import resolver prefers an existing local file over a fresh fetch,
        // a stale cached file (e.g. utils/Arrays.sol) shadows the version a newer
        // contract expects -> "Declaration ... not found" version-skew. Deps are
        // always re-resolved on compile, so they don't belong in the gist.
        if (path === '.deps' || path.indexOf('.deps/') === 0 || path.indexOf('/.deps/') !== -1) return
        if (/^\s+$/.test(content) || !content.length) {
          content =
            '// this line is added to create a gist. Empty file is not allowed.'
        }
        path = path.replace(/\//g, '...')
        ret[path] = { content }
      })
      callback(null, ret)
    } catch (e) {
      return callback(e)
    }
  }
}

function joinPath (...paths) {
  paths = paths
    .filter(value => value !== '')
    .map(path => path.replace(/^\/|\/$/g, '')) // remove first and last slash)
  if (paths.length === 1) return paths[0]
  return paths.join('/')
}
