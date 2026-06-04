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

import React, { useState, useEffect } from 'react' // eslint-disable-line
import { TreeViewItemProps } from '../../types'

import './tree-view-item.css'

export const TreeViewItem = (props: TreeViewItemProps) => {
  const { id, children, label, labelClass, expand, iconX = 'fas fa-caret-right', iconY = 'fas fa-caret-down', icon, controlBehaviour = false, innerRef, ...otherProps } = props
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    setIsExpanded(expand)
  }, [expand])

  return (
    <li ref={innerRef} key={`treeViewLi${id}`} data-id={`treeViewLi${id}`} className='li_tv' {...otherProps}>
      <div key={`treeViewDiv${id}`} data-id={`treeViewDiv${id}`} className={`d-flex flex-row align-items-center ${labelClass} py-1`} onClick={() => !controlBehaviour && setIsExpanded(!isExpanded)}>
        { children ? <div className={isExpanded ? `px-1 ${iconY} caret caret_tv` : `px-1 ${iconX} caret caret_tv`} style={{ visibility: children ? 'visible' : 'hidden' }}></div> : icon ? <div className={`pr-3 pl-1 ${icon} caret caret_tv`}></div> : null }
        <span className='w-100 pl-1'>
          { label }
        </span>
      </div>
      { isExpanded ? children : null }
    </li>
  )
}

export default TreeViewItem
