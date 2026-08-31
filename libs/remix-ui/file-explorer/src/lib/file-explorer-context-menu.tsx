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

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react' // eslint-disable-line
import { action, FileExplorerContextMenuProps } from './types'

import './css/file-explorer-context-menu.css'
import { customAction } from '@remixproject/plugin-api'

export const FileExplorerContextMenu = (
  props: FileExplorerContextMenuProps
) => {
  const {
    actions,
    createNewFile,
    createNewFolder,
    deletePath,
    renamePath,
    hideContextMenu,
    pushChangesToGist,
    publishFileToGist,
    publishFolderToGist,
    copy,
    paste,
    runScript,
    formatCode,
    emit,
    pageX,
    pageY,
    path,
    type,
    focus,
    ...otherProps
  } = props
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const menuItemRefs = useRef<Array<HTMLLIElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useLayoutEffect(() => {
    const positionInsideViewport = () => {
      const menuItemsContainer = contextMenuRef.current
      if (!menuItemsContainer) return

      const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight
      const boundary = menuItemsContainer.getBoundingClientRect()
      const margin = 8
      const requestedLeft = Number.isFinite(pageX) ? pageX : margin
      const requestedTop = Number.isFinite(pageY) ? pageY : margin
      const maxLeft = Math.max(margin, viewportWidth - boundary.width - margin)
      const maxTop = Math.max(margin, viewportHeight - boundary.height - margin)

      // The menu is position:fixed, so use viewport coordinates and clamp both
      // axes. The old bottom-only correction could leave a menu under the top
      // header (or beyond the right edge), making items visible but unclickable.
      menuItemsContainer.style.left =
        `${Math.min(Math.max(margin, requestedLeft), maxLeft)}px`
      menuItemsContainer.style.top =
        `${Math.min(Math.max(margin, requestedTop), maxTop)}px`
      menuItemsContainer.style.bottom = 'auto'
    }

    positionInsideViewport()
    window.addEventListener('resize', positionInsideViewport)
    return () => window.removeEventListener('resize', positionInsideViewport)
  }, [pageX, pageY])

  const filterItem = (item: action) => {
    /**
     * if there are multiple elements focused we need to take this and all conditions must be met
     * for example : 'downloadAsZip' with type ['file','folder'] will work on files and folders when multiple are selected
     **/
    const nonRootFocus = focus.filter((el) => {
      return !(el.key === '' && el.type === 'folder')
    })
    if (nonRootFocus.length > 1) {
      for (const element of nonRootFocus) {
        if (!itemMatchesCondition(item, element.type, element.key)) return false
      }
      return true
    } else {
      return itemMatchesCondition(item, type, path)
    }
  }

  const itemMatchesCondition = (
    item: action,
    itemType: string,
    itemPath: string
  ) => {
    if (typeof itemPath !== 'string') return false
    if (
      item.type &&
      Array.isArray(item.type) &&
      item.type.findIndex((name) => name === itemType) !== -1
    ) { return true } else if (
      item.path &&
      Array.isArray(item.path) &&
      item.path.findIndex((key) => key === itemPath) !== -1
    ) { return true } else if (
      item.extension &&
      Array.isArray(item.extension) &&
      item.extension.filter((ext) => typeof ext === 'string').findIndex((ext) => itemPath.endsWith(ext)) !== -1
    ) { return true } else if (
      item.pattern &&
      Array.isArray(item.pattern) &&
      item.pattern.filter((value) => {
        if (typeof value !== 'string') return false
        try {
          return new RegExp(value).test(itemPath)
        } catch (error) {
          return false
        }
      }).length > 0
    ) { return true } else return false
  }

  const getPath = () => {
    if (focus.length > 1) {
      return focus.map((element) => element.key)
    } else {
      return path
    }
  }

  const visibleActions = actions.filter((item) => filterItem(item))

  const focusItem = (index: number) => {
    if (!visibleActions.length) return
    const nextIndex = (index + visibleActions.length) % visibleActions.length
    setActiveIndex(nextIndex)
    menuItemRefs.current[nextIndex]?.focus()
  }

  useEffect(() => {
    focusItem(0)
  }, [])

  const activateItem = (item: action) => {
    switch (item.name) {
      case 'New File':
        createNewFile(path)
        break
      case 'New Folder':
        createNewFolder(path)
        break
      case 'Rename':
        renamePath(path, type)
        break
      case 'Delete':
        deletePath(getPath())
        break
      case 'Push changes to gist':
        pushChangesToGist(path, type)
        break
      case 'Publish folder to gist':
        publishFolderToGist(path, type)
        break
      case 'Publish file to gist':
        publishFileToGist(path, type)
        break
      case 'Run':
        runScript(path)
        break
      case 'Format code':
        formatCode(path)
        break
      case 'Copy':
        copy(path, type)
        break
      case 'Paste':
        paste(path, type)
        break
      case 'Delete All':
        deletePath(getPath())
        break
      default:
        emit && emit({ ...item, path: [path] } as customAction)
        break
    }
    // Actions such as Rename and Delete deliberately move focus into an input
    // or modal, so do not restore the tree-row focus after activation.
    hideContextMenu(false)
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const focusedIndex = menuItemRefs.current.findIndex(item => item === document.activeElement)
    const currentIndex = focusedIndex === -1 ? activeIndex : focusedIndex
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusItem(currentIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusItem(currentIndex - 1)
        break
      case 'Home':
        event.preventDefault()
        focusItem(0)
        break
      case 'End':
        event.preventDefault()
        focusItem(visibleActions.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (visibleActions[currentIndex]) activateItem(visibleActions[currentIndex])
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        hideContextMenu(true)
        break
      case 'Tab':
        // Menus are not tab traps. Close it and let the browser continue its
        // normal focus traversal instead of wrapping inside the menu.
        hideContextMenu(false)
        break
    }
  }

  return (
    <div
      id="menuItemsContainer"
      className="p-1 remixui_contextContainer bg-light shadow border"
      style={{ left: pageX, top: pageY }}
      ref={contextMenuRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hideContextMenu(false)
      }}
      {...otherProps}
    >
      <ul
        id="remixui_menuitems"
        role="menu"
        aria-label="File actions"
        onKeyDown={handleMenuKeyDown}
      >
        {visibleActions.map((item, index) => (
          <li
            id={`menuitem${item.name.toLowerCase()}`}
            key={item.id || item.name}
            ref={(element) => { menuItemRefs.current[index] = element }}
            role="menuitem"
            tabIndex={index === activeIndex ? 0 : -1}
            className="remixui_liitem"
            onMouseEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            onClick={(event) => {
              event.stopPropagation()
              activateItem(item)
            }}
          >
            {item.label || item.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default FileExplorerContextMenu
