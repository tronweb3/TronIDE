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

import React, { useState, useEffect } from 'react' //eslint-disable-line
import { Tooltip } from 'antd'
import { FileExplorerMenuProps } from './types'

export const FileExplorerMenu = (props: FileExplorerMenuProps) => {
  const [state, setState] = useState({
    menuItems: [
      {
        action: 'createNewFile',
        title: 'Create New File',
        icon: 'far fa-file'
      },
      {
        action: 'createNewFolder',
        title: 'Create New Folder',
        icon: 'far fa-folder'
      },
      {
        action: 'publishToGist',
        title: 'Publish all the current workspace files (only root) to a github gist',
        icon: 'fab fa-github'
      },
      {
        action: 'uploadFile',
        title: 'Load a local file into current workspace',
        icon: 'fa fa-upload'
      },
      {
        action: 'updateGist',
        title: 'Update the current [gist] explorer',
        icon: 'fab fa-github'
      }
    ].filter(item => props.menuItems && props.menuItems.find((name) => { return name === item.action })),
    actions: {}
  })

  useEffect(() => {
    const actions = {
      updateGist: () => {}
    }

    setState(prevState => {
      return { ...prevState, actions }
    })
  }, [])

  return (
    <>
      <span className='remixui_label' title={props.title} data-path={props.title} style={{ fontWeight: 'bold' }}>{ props.title }</span>
      <span className="pl-2">{
        state.menuItems.map(({ action, title, icon }, index) => {
          if (action === 'uploadFile') {
            return (
              <Tooltip title={title} key={index}>
                <label
                  id={action}
                  data-id={'fileExplorerUploadFile' + action }
                  className={icon + ' mb-0 remixui_newFile'}
                  // title={title}
                  // key={index}
                >
                  <input id="fileUpload" data-id="fileExplorerFileUpload" type="file" onChange={(e) => {
                    e.stopPropagation()
                    props.uploadFile(e.target)
                    e.target.value = null
                    window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'upload_file' })
                  }}
                  multiple />
                </label>
              </Tooltip>
            )
          } else {
            return (
              <Tooltip title={title} key={index}>
                <span
                  id={action}
                  data-id={'fileExplorerNewFile' + action}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (action === 'createNewFile') {
                      props.createNewFile()
                      window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'create_new_file' })
                    } else if (action === 'createNewFolder') {
                      props.createNewFolder()
                      window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'create_new_folder' })
                    } else if (action === 'publishToGist') {
                      props.publishToGist()
                      window?.gtag('event', 'click', { event_category: 'workspace_user_action', event_label: 'publish_to_gist' })
                    } else {
                      state.actions[action]()
                    }
                  }}
                  className={'newFile ' + icon + ' remixui_newFile'}
                  // title={title}
                  // key={index}
                >
                </span>
              </Tooltip>
            )
          }
        })}
      </span>
    </>
  )
}

export default FileExplorerMenu
