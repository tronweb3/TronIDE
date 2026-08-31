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

import React, { useState, useEffect, useRef } from 'react' // eslint-disable-line
import { FileExplorer } from '@remix-ui/file-explorer' // eslint-disable-line
import './remix-ui-workspace.css'
import { ModalDialog } from '@remix-ui/modal-dialog' // eslint-disable-line
import { Toaster } from '@remix-ui/toaster'// eslint-disable-line
import { MenuItems } from 'libs/remix-ui/file-explorer/src/lib/types'
import Tooltip from 'antd/lib/tooltip'
import { workspace as remixLibWorkspace } from '@remix-project/remix-lib'

const TRON_TEMPLATES = (remixLibWorkspace && remixLibWorkspace.tronTemplates && remixLibWorkspace.tronTemplates.TRON_TEMPLATES) || []
declare global {
  interface Window {
    gtag: (
      command: 'event' | 'config',
      name: string,
      params?: Record<string, any>
    ) => void;
  }
}

/* eslint-disable-next-line */
export interface WorkspaceProps {
  setWorkspace: (workspace: { name: string, isLocalhost: boolean }, setEvent: boolean, syncComponent?: boolean, mutationToken?: number) => void,
  createWorkspace: (name: string, templateId?: string | boolean, mutationToken?: number) => void,
  renameWorkspace: (oldName: string, newName: string, mutationToken?: number) => void
  workspaceRenamed: (workspace: { name: string }) => void,
  workspaceCreated: (workspace: { name: string }) => void,
  workspaceDeleted: (workspace: { name: string }) => void,
  workspace: any // workspace provider,
  browser: any // browser provider
  localhost: any // localhost provider
  fileManager : any
  registry: any // registry
  plugin: any // plugin call and resetFocus
  request: any // api request,
  workspaces: any,
  registeredMenuItems: MenuItems // menu items
  removedMenuItems: MenuItems
  initialWorkspace: string
}

var canUpload = window.File || window.FileReader || window.FileList || window.Blob
export const Workspace = (props: WorkspaceProps) => {
  const LOCALHOST = ' - connect to localhost - '
  const NO_WORKSPACE = ' - none - '
  // Event listeners below are installed once. Keep the desired workspace in a
  // ref so a later remixd disconnect does not read the initial render's stale
  // NO_WORKSPACE value and clear a browser workspace the user just selected.
  const currentWorkspaceRef = useRef(NO_WORKSPACE)

  /* extends the parent 'plugin' with some function needed by the file explorer */
  props.plugin.resetFocus = (reset) => {
    setState(prevState => {
      return { ...prevState, reset }
    })
  }

  props.plugin.resetNewFile = () => {
    setState(prevState => {
      return { ...prevState, displayNewFile: false, newFileName: '' }
    })
  }

  props.plugin.resetUploadFile = () => {}

  /* implement an external API, consumed by the parent */
  props.request.createWorkspace = () => {
    return createWorkspace()
  }

  props.request.setWorkspace = (workspaceName, mutationToken) => {
    return setWorkspace(workspaceName, mutationToken)
  }

  props.request.createNewFile = async (suggestedName = '') => {
    if (!state.workspaces.length) await createNewWorkspace('default_workspace')
    setState(prevState => {
      return {
        ...prevState,
        displayNewFile: true,
        newFileName: typeof suggestedName === 'string' ? suggestedName : ''
      }
    })
  }

  props.request.uploadFile = async (target) => {
    if (!state.workspaces.length) await createNewWorkspace('default_workspace')

    setState(prevState => {
      return { ...prevState, uploadFileEvent: target }
    })
  }

  props.request.getCurrentWorkspace = () => {
    return { name: state.currentWorkspace, isLocalhost: state.currentWorkspace === LOCALHOST, absolutePath: `${props.workspace.workspacesPath}/${state.currentWorkspace}` }
  }

  useEffect(() => {
    let getWorkspaces = async () => {
      if (props.workspaces && Array.isArray(props.workspaces)) {
        if (props.workspaces.length > 0 && state.currentWorkspace === NO_WORKSPACE) {
          const currentWorkspace = props.workspace.getWorkspace() ? props.workspace.getWorkspace() : props.workspaces[0]
          await props.workspace.setWorkspace(currentWorkspace)
          currentWorkspaceRef.current = currentWorkspace
          setState(prevState => {
            return { ...prevState, workspaces: props.workspaces, currentWorkspace }
          })
        } else {
          setState(prevState => {
            return { ...prevState, workspaces: props.workspaces }
          })
        }
      }
    }

    getWorkspaces()

    return () => {
      getWorkspaces = async () => {}
    }
  }, [props.workspaces])

  const localhostDisconnect = () => {
    // A direct Plugin Manager deactivation emits `disconnected` while the
    // localhost workspace is still selected. Switch to a browser workspace,
    // but also hide the localhost explorer immediately so its last rendered
    // directory tree cannot remain visible under the fallback workspace.
    remixdExplorer.hide()
    if (currentWorkspaceRef.current === LOCALHOST) {
      setWorkspace(props.workspaces.length > 0 ? props.workspaces[0] : NO_WORKSPACE)
    }
  }

  useEffect(() => {
    props.localhost.event.off('disconnected', localhostDisconnect)
    props.localhost.event.on('disconnected', localhostDisconnect)
    props.localhost.event.on('connected', () => {
      remixdExplorer.show()
      setWorkspace(LOCALHOST)
    })

    props.localhost.event.on('loading', () => {
      remixdExplorer.loading()
    })

    props.workspace.event.on('createWorkspace', (name) => {
      createNewWorkspace(name)
    })

    if (props.initialWorkspace) {
      props.workspace.setWorkspace(props.initialWorkspace)
      currentWorkspaceRef.current = props.initialWorkspace
      setState(prevState => {
        return { ...prevState, currentWorkspace: props.initialWorkspace }
      })
    }
  }, [])

  const createNewWorkspace = async (workspaceName) => {
    let mutationToken
    setState(prevState => ({ ...prevState, workspaceMutationInProgress: true }))
    try {
      mutationToken = props.fileManager.beginWorkspaceMutation('create workspaces')
      await props.fileManager.closeAllFiles()
      await props.createWorkspace(workspaceName, true, mutationToken)
      await setWorkspace(workspaceName, mutationToken)
      toast('New default workspace has been created.')
    } catch (e) {
      modalMessage('Create Default Workspace', e.message)
      console.error(e)
    } finally {
      if (mutationToken !== undefined) props.fileManager.endWorkspaceMutation(mutationToken)
      setState(prevState => ({ ...prevState, workspaceMutationInProgress: false }))
    }
  }

  const [state, setState] = useState({
    workspaces: [],
    reset: false,
    currentWorkspace: NO_WORKSPACE,
    hideRemixdExplorer: true,
    displayNewFile: false,
    newFileName: '',
    externalUploads: null,
    uploadFileEvent: null,
    modal: {
      hide: true,
      title: '',
      message: null,
      okLabel: '',
      okFn: () => {},
      cancelLabel: '',
      cancelFn: () => {},
      handleHide: null
    },
    loadingLocalhost: false,
    workspaceMutationInProgress: false,
    toasterMsg: ''
  })

  const toast = (message: string) => {
    setState(prevState => {
      return { ...prevState, toasterMsg: message }
    })
  }

  /* workspace creation, renaming and deletion */

  const renameCurrentWorkspace = () => {
    modal('Rename Current Workspace', renameModalMessage(), 'OK', onFinishRenameWorkspace, '', () => {})
  }

  const createWorkspace = () => {
    modal('Create Workspace', createModalMessage(), 'OK', onFinishCreateWorkspace, '', () => {})
  }

  const deleteCurrentWorkspace = () => {
    modal('Delete workspace?', `Delete "${state.currentWorkspace}"? This cannot be undone.`, 'Delete', onFinishDeleteWorkspace, '', () => {})
  }

  const modalMessage = (title: string, body: string) => {
    setTimeout(() => { // wait for any previous modal a chance to close
      modal(title, body, 'OK', () => {}, '', null)
    }, 200)
  }

  const workspaceRenameInput = useRef()
  const workspaceCreateInput = useRef()
  const workspaceCreateTemplateInput = useRef()

  const onFinishRenameWorkspace = async () => {
    if (workspaceRenameInput.current === undefined) return
    // @ts-ignore: Object is possibly 'null'.
    const workspaceName = workspaceRenameInput.current.value
    if (/[.*+?^${}()|[\]\\]/g.test(workspaceName)) {
      modalMessage('Rename Workspace', 'Rename failed, special characters are not allowed')
      return
    }
    let mutationToken
    setState(prevState => ({ ...prevState, workspaceMutationInProgress: true }))
    try {
      mutationToken = props.fileManager.beginWorkspaceMutation('rename workspaces')
      await props.renameWorkspace(state.currentWorkspace, workspaceName, mutationToken)
      await setWorkspace(workspaceName, mutationToken)
      props.workspaceRenamed({ name: workspaceName })
    } catch (e) {
      modalMessage('Rename Workspace', e.message)
      console.error(e)
    } finally {
      if (mutationToken !== undefined) props.fileManager.endWorkspaceMutation(mutationToken)
      setState(prevState => ({ ...prevState, workspaceMutationInProgress: false }))
    }
  }

  const onFinishCreateWorkspace = async () => {
    if (workspaceCreateInput.current === undefined) return
    // @ts-ignore: Object is possibly 'null'.
    const workspaceName = workspaceCreateInput.current.value
    if (/[.*+?^${}()|[\]\\]/g.test(workspaceName)) {
      modalMessage('Create Workspace', 'Creation failed, special characters are not allowed')
      return
    }
    // @ts-ignore: Object is possibly 'null'.
    const templateId = workspaceCreateTemplateInput.current ? workspaceCreateTemplateInput.current.value : ''
    let mutationToken
    setState(prevState => ({ ...prevState, workspaceMutationInProgress: true }))
    try {
      mutationToken = props.fileManager.beginWorkspaceMutation('create workspaces')
      await props.fileManager.closeAllFiles()
      // Keep the empty-project choice explicit. The historical empty value
      // means "use the default sample contracts" in FilePanel, so map the UI
      // sentinel to false instead of passing an empty string and accidentally
      // seeding the sample workspace.
      const seed = templateId === 'empty' ? false : (templateId || undefined)
      await props.createWorkspace(workspaceName, seed, mutationToken)
      await setWorkspace(workspaceName, mutationToken)
      const picked = templateId ? TRON_TEMPLATES.find((template) => template.id === templateId) : null
      if (picked) await props.fileManager.openFile(picked.path)
    } catch (e) {
      modalMessage('Create Workspace', e.message)
      console.error(e)
    } finally {
      if (mutationToken !== undefined) props.fileManager.endWorkspaceMutation(mutationToken)
      setState(prevState => ({ ...prevState, workspaceMutationInProgress: false }))
    }
  }

  const onFinishDeleteWorkspace = async () => {
    let mutationToken
    setState(prevState => ({ ...prevState, workspaceMutationInProgress: true }))
    try {
      mutationToken = props.fileManager.beginWorkspaceMutation('delete workspaces')
      await props.fileManager.closeAllFiles()
      const workspacesPath = props.workspace.workspacesPath
      await props.browser.remove(workspacesPath + '/' + state.currentWorkspace)
      const name = state.currentWorkspace
      await setWorkspace(NO_WORKSPACE, mutationToken)
      props.workspaceDeleted({ name })
    } catch (e) {
      modalMessage('Delete Workspace', e.message)
      console.error(e)
    } finally {
      if (mutationToken !== undefined) props.fileManager.endWorkspaceMutation(mutationToken)
      setState(prevState => ({ ...prevState, workspaceMutationInProgress: false }))
    }
  }
  /** ** ****/

  const resetFocus = (reset) => {
    setState(prevState => {
      return { ...prevState, reset }
    })
  }

  const setWorkspace = async (name, activeMutationToken?) => {
    let mutationToken = activeMutationToken
    const ownsMutation = mutationToken === undefined
    if (ownsMutation) setState(prevState => ({ ...prevState, workspaceMutationInProgress: true }))
    try {
      if (ownsMutation) mutationToken = props.fileManager.beginWorkspaceMutation('switch workspaces')
      else props.fileManager.assertWorkspaceMutationToken(mutationToken)
      // Publish the user's destination before deactivating remixd. Its
      // `disconnected` event fires during this call and must not mistake the
      // transition for an unexpected localhost disconnect.
      currentWorkspaceRef.current = name
      await props.fileManager.closeAllFiles()
      if (name === LOCALHOST) {
        props.workspace.clearWorkspace()
      } else if (name === NO_WORKSPACE) {
        props.workspace.clearWorkspace()
      } else {
        await props.workspace.setWorkspace(name)
      }
      await props.setWorkspace({ name, isLocalhost: name === LOCALHOST }, !(name === LOCALHOST || name === NO_WORKSPACE), false, mutationToken)
      props.plugin.getWorkspaces()
      setState(prevState => {
        return { ...prevState, currentWorkspace: name }
      })
    } finally {
      if (ownsMutation) props.fileManager.endWorkspaceMutation(mutationToken)
      if (ownsMutation) setState(prevState => ({ ...prevState, workspaceMutationInProgress: false }))
    }
  }

  const remixdExplorer = {
    hide: () => {
      // Hiding the localhost tree is a view update only. The disconnect handler
      // chooses a fallback when localhost was active; clearing the workspace
      // here as well raced that fallback and emitted a duplicate create event.
      props.fileManager.setMode('browser')
      setState(prevState => {
        return { ...prevState, hideRemixdExplorer: true, loadingLocalhost: false }
      })
    },
    show: () => {
      props.fileManager.setMode('localhost')
      setState(prevState => {
        return { ...prevState, hideRemixdExplorer: false, loadingLocalhost: false }
      })
    },
    loading: () => {
      setState(prevState => {
        return { ...prevState, loadingLocalhost: true }
      })
    }
  }

  const handleHideModal = () => {
    setState(prevState => {
      return { ...prevState, modal: { ...state.modal, hide: true, message: null } }
    })
  }

  const modal = async (title: string, message: string | JSX.Element, okLabel: string, okFn: () => void, cancelLabel: string, cancelFn: () => void) => {
    await setState(prevState => {
      return {
        ...prevState,
        modal: {
          ...prevState.modal,
          hide: false,
          message,
          title,
          okLabel,
          okFn,
          cancelLabel,
          cancelFn,
          handleHide: handleHideModal
        }
      }
    })
  }

  const createModalMessage = () => {
    return (
      <>
        <span>{ state.modal.message }</span>
        <input type="text" data-id="modalDialogCustomPromptTextCreate" defaultValue={`workspace_${Date.now()}`} ref={workspaceCreateInput} className="form-control" />
        <label className="form-check-label mt-2" htmlFor="wsTemplateSelect">Template</label>
        <select id="wsTemplateSelect" data-id="modalDialogCustomSelectTemplate" defaultValue="" ref={workspaceCreateTemplateInput} className="form-control custom-select">
          <option value="">Default (sample contracts)</option>
          <option value="empty">Empty workspace (no files)</option>
          { TRON_TEMPLATES.map((template) => (
            <option key={template.id} value={template.id} title={template.description}>{template.name}</option>
          )) }
        </select>
      </>
    )
  }

  const renameModalMessage = () => {
    return (
      <>
        <span>{ state.modal.message }</span>
        <input type="text" data-id="modalDialogCustomPromptTextRename" defaultValue={ state.currentWorkspace } ref={workspaceRenameInput} className="form-control" />
      </>
    )
  }

  return (
    <div className='remixui_container'>
      <ModalDialog
        id='workspacesModalDialog'
        title={ state.modal.title }
        message={ state.modal.message }
        hide={ state.modal.hide }
        okLabel={ state.modal.okLabel }
        okFn={ state.modal.okFn }
        cancelLabel={ state.modal.cancelLabel }
        cancelFn={ state.modal.cancelFn }
        handleHide={ handleHideModal }>
        { (typeof state.modal.message !== 'string') && state.modal.message }
      </ModalDialog>
      <Toaster message={state.toasterMsg} />
      <div className='remixui_fileexplorer' onClick={() => resetFocus(true)}>
        <div>
          <header>
            <div className="mb-2">
              <label className="form-check-label" htmlFor="workspacesSelect">
                Workspaces
              </label>
              <span className="remixui_menu">
                <Tooltip title="Create workspace from a template">
                  <span
                    id='workspaceCreate'
                    data-id='workspaceCreate'
                    onClick={(e) => {
                      e.stopPropagation()
                      createWorkspace()
                      window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'workspace_create' })
                    }}
                    className='far fa-plus-square remixui_menuicon'
                  >
                  </span>
                </Tooltip>
                <Tooltip title="Rename workspace">
                  <span
                    hidden={state.currentWorkspace === LOCALHOST || state.currentWorkspace === NO_WORKSPACE}
                    id='workspaceRename'
                    data-id='workspaceRename'
                    onClick={(e) => {
                      e.stopPropagation()
                      renameCurrentWorkspace()
                      window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'workspace_rename' })
                    }}
                    className='far fa-edit remixui_menuicon'
                  >
                  </span>
                </Tooltip>
                <Tooltip title="Delete workspace">
                  <span
                    hidden={state.currentWorkspace === LOCALHOST || state.currentWorkspace === NO_WORKSPACE}
                    id='workspaceDelete'
                    data-id='workspaceDelete'
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteCurrentWorkspace()
                      window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'workspace_delete' })
                    }}
                    className='fas fa-trash'
                  >
                  </span>
                </Tooltip>
              </span>
              <select id="workspacesSelect" value={state.currentWorkspace} data-id="workspacesSelect" onChange={(e) => setWorkspace(e.target.value)} disabled={state.workspaceMutationInProgress} aria-busy={state.workspaceMutationInProgress} className="form-control custom-select">
                {
                  state.workspaces
                    .map((folder, index) => {
                      return <option key={index} value={folder}>{folder}</option>
                    })
                }
                <option value={LOCALHOST}>{state.currentWorkspace === LOCALHOST ? 'localhost' : LOCALHOST}</option>
                { state.workspaces.length <= 0 && <option value={NO_WORKSPACE}>{NO_WORKSPACE}</option> }
              </select>
            </div>
          </header>
        </div>
        <div className='remixui_fileExplorerTree'>
          <div>
            <div className='pl-2 remixui_treeview' data-id='filePanelFileExplorerTree'>
              { state.hideRemixdExplorer && state.currentWorkspace && state.currentWorkspace !== NO_WORKSPACE && state.currentWorkspace !== LOCALHOST &&
                  <FileExplorer
                    name={state.currentWorkspace}
                    registry={props.registry}
                    filesProvider={props.workspace}
                    menuItems={['createNewFile', 'createNewFolder', 'publishToGist', canUpload ? 'uploadFile' : '']}
                    plugin={props.plugin}
                    focusRoot={state.reset}
                    contextMenuItems={props.registeredMenuItems}
                    removedContextMenuItems={props.removedMenuItems}
                    displayInput={state.displayNewFile}
                    newFileName={state.newFileName}
                    externalUploads={state.uploadFileEvent}
                  />
              }
            </div>
            {
              state.loadingLocalhost ? <div className="text-center py-5"><i className="fas fa-spinner fa-pulse fa-2x"></i></div>
                : <div className='pl-2 filesystemexplorer remixui_treeview'>
                  { !state.hideRemixdExplorer &&
                      <FileExplorer
                        name='localhost'
                        registry={props.registry}
                        filesProvider={props.localhost}
                        menuItems={['createNewFile', 'createNewFolder']}
                        plugin={props.plugin}
                        focusRoot={state.reset}
                        contextMenuItems={props.registeredMenuItems}
                        removedContextMenuItems={props.removedMenuItems}
                      />
                  }
                </div>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

export default Workspace
