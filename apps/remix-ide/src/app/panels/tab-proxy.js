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

import { Plugin } from '@remixproject/engine'
const yo = require('yo-yo')
const $ = require('jquery')
const EventEmitter = require('events')
const globalRegistry = require('../../global/registry')
const csjs = require('csjs-inject')
const helper = require('../../lib/helper')
require('remix-tabs')

const css = csjs`
  .remix_tabs{
    height: 32px;
    width: calc(100% - 84px);
  }
  .remix_tabs div[title]{
    display: flex;
  }
  .remix_tabs > div{
    position: absolute;
  }
  [data-title] {
    position: relative;
    cursor: pointer;
  }
  [data-id="tabProxyCompileCurrent"] {
    min-width: 28px;
  }
  [data-id="tabProxyCompileCurrent"].disabled {
    cursor: not-allowed;
    opacity: 0.38;
    pointer-events: auto;
  }
  [data-id="tabProxyZoomIn"]::after { /* Targeting zoom-in specifically */
    content: attr(data-title);
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(5px);
    background-color: #333;
    color: #fff;
    padding: 5px 8px;
    border-radius: 4px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s ease;
    z-index: 1000;
    pointer-events: none;
  }
  [data-id="tabProxyZoomIn"]:hover::after {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) translateY(0);
  }
  [data-id="tabProxyZoomOut"]::after {
    content: attr(data-title); /* Make sure content is explicitly set */
    position: absolute;
    top: 100%;
    left: 0; /* Position to the left edge of the parent */
    transform: translateX(0) translateY(5px); /* No horizontal transform, just move down */
    background-color: #333; /* Inherit or set explicitly */
    color: #fff;
    padding: 5px 8px;
    border-radius: 4px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s ease;
    z-index: 1000;
    pointer-events: none;
  }
  [data-id="tabProxyZoomOut"]:hover::after {
    opacity: 1;
    visibility: visible;
    transform: translateX(0) translateY(0);
  }
`

const profile = {
  name: 'tabs',
  methods: ['focus'],
  kind: 'other'
}

// @todo(#650) Merge this with MainPanel into one plugin
export class TabProxy extends Plugin {
  constructor (fileManager, editor, appManager) {
    super(profile)
    this.event = new EventEmitter()
    this.fileManager = fileManager
    this.appManager = appManager
    this.editor = editor
    this.data = {}
    this._view = {}
    this._handlers = {}
    this.loadedTabs = []
    this.activeFile = ''
    this.injectTabStyles()

    globalRegistry.get('themeModule').api.events.on('themeChanged', (theme) => {
    // update invert for all icons
      this.updateImgStyles()
    })

    fileManager.events.on('filesAllClosed', () => {
      this.call('manager', 'activatePlugin', 'home')
      this._view.filetabs.active = 'home'
    })

    fileManager.events.on('fileRemoved', (name) => {
      const workspace = this.fileManager.currentWorkspace()
      workspace ? this.removeTab(workspace + '/' + name) : this.removeTab(this.fileManager.mode + '/' + name)
    })

    fileManager.events.on('fileClosed', (name) => {
      const workspace = this.fileManager.currentWorkspace()

      workspace ? this.removeTab(workspace + '/' + name) : this.removeTab(this.fileManager.mode + '/' + name)
    })

    fileManager.events.on('currentFileChanged', (file) => {
      const workspace = this.fileManager.currentWorkspace()
      this.activeFile = file
      this.updateCompileButtonState()

      if (workspace) {
        const workspacePath = workspace + '/' + file

        if (this._handlers[workspacePath]) {
          this._view.filetabs.activateTab(workspacePath)
          return
        }
        this.addTab(workspacePath, '', () => {
          this.fileManager.open(file)
          this.event.emit('openFile', file)
        },
        () => {
          this.fileManager.closeFile(file)
          this.event.emit('closeFile', file)
        })
      } else {
        const path = this.fileManager.mode + '/' + file

        if (this._handlers[path]) {
          this._view.filetabs.activateTab(path)
          return
        }
        this.addTab(path, '', () => {
          this.fileManager.open(file)
          this.event.emit('openFile', file)
        },
        () => {
          this.fileManager.closeFile(file)
          this.event.emit('closeFile', file)
        })
      }
    })

    fileManager.events.on('fileRenamed', (oldName, newName, isFolder) => {
      const workspace = this.fileManager.currentWorkspace()

      if (workspace) {
        if (isFolder) {
          for (const tab of this.loadedTabs) {
            if (tab.name.indexOf(workspace + '/' + oldName + '/') === 0) {
              const newTabName = workspace + '/' + newName + tab.name.slice(workspace + '/' + oldName.length, tab.name.length)
              this.renameTab(tab.name, newTabName)
            }
          }
          return
        }
        // should change the tab title too
        this.renameTab(workspace + '/' + oldName, workspace + '/' + newName)
      } else {
        if (isFolder) {
          for (const tab of this.loadedTabs) {
            if (tab.name.indexOf(this.fileManager.mode + '/' + oldName + '/') === 0) {
              const newTabName = this.fileManager.mode + '/' + newName + tab.name.slice(this.fileManager.mode + '/' + oldName.length, tab.name.length)
              this.renameTab(tab.name, newTabName)
            }
          }
          return
        }
        // should change the tab title too
        this.renameTab(this.fileManager.mode + '/' + oldName, workspace + '/' + newName)
      }
    })

    appManager.event.on('activate', ({ name, location, displayName, icon }) => {
      if (location === 'mainPanel') {
        this.addTab(
          name,
          displayName,
          () => this.event.emit('switchApp', name),
          () => {
            this.event.emit('closeApp', name)
            this.call('manager', 'deactivatePlugin', name)
          },
          icon
        )
        this.switchTab(name)
      }
    })

    appManager.event.on('deactivate', (profile) => {
      this.removeTab(profile.name)
    })
  }

  alignTabsDropdown (dropdownToggle) {
    requestAnimationFrame(() => {
      const dropdownMenu = this._view.filetabs?.querySelector('#dropdownMenu')
      if (!dropdownToggle || !dropdownMenu) return

      const dropdownCaret = dropdownToggle.querySelector('.dropdownCaret') || dropdownToggle
      const rect = dropdownCaret.getBoundingClientRect()
      dropdownMenu.style.top = `${rect.bottom + 4}px`
      dropdownMenu.style.left = `${rect.right - dropdownMenu.offsetWidth}px`
      dropdownMenu.style.right = 'auto'
    })
  }

  injectTabStyles () {
    const styleId = 'custom-remix-tabs-styles'
    if (document.getElementById(styleId)) {
      return
    }

    const customCss = `
      .${css.remix_tabs}:not(.active) div:hover .close {
        visibility: visible;
      }
      .${css.remix_tabs} .header {
        align-items: center !important;
        height: 32px !important;
      }
      .${css.remix_tabs} remix-tab.nav-link {
        align-items: center !important;
        display: inline-flex !important;
        height: 32px !important;
        margin-top: 0 !important;
        min-height: 32px !important;
        padding-bottom: 0 !important;
        padding-top: 0 !important;
      }
      .${css.remix_tabs} remix-tab.nav-link > div[title] {
        align-items: center !important;
        display: inline-flex !important;
        height: 32px !important;
      }
      .${css.remix_tabs} .dropdown {
        align-items: center !important;
        display: flex !important;
        height: 32px !important;
        padding-bottom: 0 !important;
        padding-top: 0 !important;
        position: absolute !important;
        right: 6px !important;
        top: 0 !important;
        z-index: 110 !important;
      }
      .${css.remix_tabs}.tabs-empty .dropdown,
      .${css.remix_tabs}.tabs-empty #dropdownMenu {
        display: none !important;
      }
      .${css.remix_tabs} #dropdownMenu.tabList {
        min-width: 142px;
        max-width: 220px;
        padding: 2px 0 4px;
        border: 1px solid var(--secondary);
        box-shadow: 0 6px 16px rgba(0, 0, 0, .12);
        z-index: 109 !important;
      }
      .${css.remix_tabs} #dropdownMenu .listItems {
        display: block;
        padding: 6px 14px 6px 18px !important;
        border: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${css.remix_tabs} #dropdownMenu .listItems.active {
        background: var(--info);
        color: var(--light);
      }
    `

    const styleElement = document.createElement('style')
    styleElement.id = styleId
    styleElement.type = 'text/css'
    if (styleElement.styleSheet) {
      styleElement.styleSheet.cssText = customCss
    } else {
      styleElement.appendChild(document.createTextNode(customCss))
    }
    document.head.appendChild(styleElement)
  }

  applyTabAlignmentStyles () {
    const styleId = 'custom-remix-tabs-alignment-styles'
    const filetabs = this._view.filetabs
    if (!filetabs || !filetabs.shadowRoot) return false

    const customCss = `
      .header { align-items: flex-end !important; }
      remix-tab.nav-link {
        align-items: center !important;
        box-sizing: border-box;
        display: inline-flex !important;
        min-height: 38px;
        padding-bottom: 0 !important;
        padding-top: 0 !important;
      }
    `

    if (!filetabs.shadowRoot.getElementById(styleId)) {
      const styleElement = document.createElement('style')
      styleElement.id = styleId
      styleElement.type = 'text/css'
      styleElement.appendChild(document.createTextNode(customCss))
      filetabs.shadowRoot.appendChild(styleElement)
    }

    for (const tab of filetabs.shadowRoot.querySelectorAll('remix-tab.nav-link')) {
      const content = tab.querySelector('div[title]')
      const title = tab.querySelector('.title')
      const close = tab.querySelector('.close')
      const icon = tab.querySelector('i, img.iconImage')
      Object.assign(tab.style, { alignItems: 'center', display: 'inline-flex', minHeight: '38px', paddingBottom: '0', paddingTop: '0' })
      if (content) Object.assign(content.style, { alignItems: 'center', display: 'inline-flex', height: '100%', minHeight: '38px' })
      if (title) Object.assign(title.style, { alignItems: 'center', display: 'inline-flex', lineHeight: '1', marginBottom: '0', marginTop: '0', paddingBottom: '0', paddingTop: '0', transform: 'translateY(-2px)' })
      if (close) Object.assign(close.style, { alignItems: 'center', display: 'inline-flex', lineHeight: '1', marginBottom: '0', marginTop: '0', paddingTop: '0', transform: 'translateY(-2px)' })
      if (icon) Object.assign(icon.style, { alignItems: 'center', display: 'inline-flex', lineHeight: '1', marginBottom: '0', marginTop: '0', transform: 'translateY(-1px)' })
    }

    this.observeTabAlignment()
    return true
  }

  observeTabAlignment () {
    const filetabs = this._view.filetabs
    if (!filetabs || !filetabs.shadowRoot || this._tabAlignmentObserver) return
    this._tabAlignmentObserver = new MutationObserver(() => this.scheduleTabAlignmentStyles())
    this._tabAlignmentObserver.observe(filetabs.shadowRoot, { childList: true, subtree: true })
  }

  scheduleTabAlignmentStyles (attempt = 0) {
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const applied = this.applyTabAlignmentStyles()
      if (attempt >= 8) return
      if (applied && attempt >= 2) return
      window.setTimeout(() => this.scheduleTabAlignmentStyles(attempt + 1), 25)
    })
  }

  focus (name) {
    this.event.emit('switchApp', name)
    this._view.filetabs.activateTab(name)
    this.updateTabsEmptyState()
  }

  updateImgStyles () {
    const images = this._view.filetabs.getElementsByClassName('iconImage')
    for (const element of images) {
      globalRegistry.get('themeModule').api.fixInvert(element)
    };
  }

  switchTab (tabName) {
    if (this._handlers[tabName]) {
      this._handlers[tabName].switchTo()
      this._view.filetabs.activateTab(tabName)
      this.updateTabsEmptyState()
    }
  }

  switchNextTab () {
    const active = this._view.filetabs.active
    if (active && this._handlers[active]) {
      const handlers = Object.keys(this._handlers)
      let i = handlers.indexOf(active)
      if (i >= 0) {
        i = handlers[i + 1] ? i + 1 : 0
        this.switchTab(handlers[i])
      }
    }
  }

  switchPreviousTab () {
    const active = this._view.filetabs.active
    if (active && this._handlers[active]) {
      const handlers = Object.keys(this._handlers)
      let i = handlers.indexOf(active)
      if (i >= 0) {
        i = handlers[i - 1] ? i - 1 : handlers.length - 1
        this.switchTab(handlers[i])
      }
    }
  }

  switchToActiveTab () {
    const active = this._view.filetabs.active
    if (active && this._handlers[active]) {
      this.switchTab(active)
    }
  }

  renameTab (oldName, newName) {
    this.addTab(newName, '', () => {
      this.fileManager.open(newName)
      this.event.emit('openFile', newName)
    },
    () => {
      this.fileManager.closeFile(newName)
      this.event.emit('closeFile', newName)
    })
    this.removeTab(oldName)
  }

  addTab (name, title, switchTo, close, icon) {
    if (this._handlers[name]) return

    var slash = name.split('/')
    const tabPath = slash.reverse()
    const tempTitle = []

    if (!title) {
      for (let i = 0; i < tabPath.length; i++) {
        tempTitle.push(tabPath[i])
        const formatPath = [...tempTitle].reverse()
        const index = this.loadedTabs.findIndex(({ title }) => title === formatPath.join('/'))

        if (index === -1) {
          title = formatPath.join('/')
          const titleLength = formatPath.length
          this.loadedTabs.push({
            name,
            title
          })
          formatPath.shift()
          if (formatPath.length > 0) {
            const duplicateTabName = this.loadedTabs.find(({ title }) => title === formatPath.join('/')).name
            const duplicateTabPath = duplicateTabName.split('/')
            const duplicateTabFormatPath = [...duplicateTabPath].reverse()
            const duplicateTabTitle = duplicateTabFormatPath.slice(0, titleLength).reverse().join('/')

            this.loadedTabs.push({
              name: duplicateTabName,
              title: duplicateTabTitle
            })
            this._view.filetabs.removeTab(duplicateTabName)
            this._view.filetabs.addTab({
              id: duplicateTabName,
              title: duplicateTabTitle,
              icon,
              tooltip: duplicateTabName,
              iconClass: helper.getPathIcon(duplicateTabName)
            })
            this.scheduleTabAlignmentStyles()
          }
          break
        }
      }
    } else {
      this.loadedTabs.push({
        name,
        title
      })
    }

    this._view.filetabs.addTab({
      id: name,
      title,
      icon,
      tooltip: name,
      iconClass: helper.getPathIcon(name)
    })
    this.scheduleTabAlignmentStyles()
    this.updateImgStyles()
    this.updateTabsEmptyState()
    this._handlers[name] = { switchTo, close }
  }

  removeTab (name) {
    this._view.filetabs.removeTab(name)
    delete this._handlers[name]
    this.switchToActiveTab()
    this.loadedTabs = this.loadedTabs.filter(tab => tab.name !== name)
    this.updateImgStyles()
    this.updateTabsEmptyState()
  }

  updateTabsEmptyState () {
    if (!this._view.filetabs) return
    const isEmpty = !this._view.filetabs.tabs || this._view.filetabs.tabs.length === 0
    const isHomeOnly = this._view.filetabs.tabs && this._view.filetabs.tabs.length === 1 && this._view.filetabs.active === 'home'
    this._view.filetabs.classList.toggle('tabs-empty', isEmpty)
    if (this._view.tabs) this._view.tabs.classList.toggle('tab-proxy-home-only', isHomeOnly)
    this.updateTabCountLabel()
    this.updateCompileButtonState()
  }

  updateTabCountLabel () {
    if (!this._view.filetabs || typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const count = this._view.filetabs.tabs ? this._view.filetabs.tabs.length : 0
      const dropdownCaret = this._view.filetabs.querySelector('.dropdownCaret')
      if (!dropdownCaret) return
      for (const child of [...dropdownCaret.childNodes]) {
        if (child.nodeType === window.Node.TEXT_NODE) dropdownCaret.removeChild(child)
      }
      dropdownCaret.insertBefore(document.createTextNode(`${count} ${count === 1 ? 'tab' : 'tabs'} `), dropdownCaret.firstChild)
    })
  }

  addHandler (type, fn) {
    this.handlers[type] = fn
  }

  onZoomOut () {
    this.editor.editorFontSize(-1)
  }

  onZoomIn () {
    this.editor.editorFontSize(1)
  }

  getActiveSolidityFile () {
    const activeTab = this._view.filetabs && this._view.filetabs.active
    const workspace = this.fileManager.currentWorkspace()
    let file = this.activeFile

    if (activeTab && activeTab !== 'home') {
      if (workspace && activeTab.indexOf(workspace + '/') === 0) file = activeTab.slice(workspace.length + 1)
      else if (this.fileManager.mode && activeTab.indexOf(this.fileManager.mode + '/') === 0) file = activeTab.slice(this.fileManager.mode.length + 1)
      else file = activeTab
    }

    return file && /\.sol$/i.test(file) ? file : ''
  }

  updateCompileButtonState () {
    if (!this._view.compileButton) return
    const file = this.getActiveSolidityFile()
    this._view.compileButton.classList.toggle('disabled', !file)
    this._view.compileButton.setAttribute('aria-disabled', file ? 'false' : 'true')
    this._view.compileButton.setAttribute('title', file ? `Compile ${file}` : 'Open a .sol tab to compile')
    this._view.compileButton.setAttribute('data-title', file ? `Compile ${file}` : 'Open a .sol tab to compile')
  }

  async onCompileCurrentFile () {
    const file = this.getActiveSolidityFile()
    if (!file) return
    await this.appManager.activatePlugin(['solidity'])
    await this.call('solidity', 'compile', file)
  }

  renderTabsbar () {
    this._view.filetabs = yo`<remix-tabs class=${css.remix_tabs}></remix-tabs>`
    this.scheduleTabAlignmentStyles()
    this.updateTabsEmptyState()
    this._view.filetabs.addEventListener('tabClosed', (event) => {
      if (this._handlers[event.detail]) this._handlers[event.detail].close()
      this.event.emit('tabCountChanged', this._view.filetabs.tabs.length)
      this.updateTabsEmptyState()
    })
    this._view.filetabs.addEventListener('tabActivated', (event) => {
      if (this._handlers[event.detail]) this._handlers[event.detail].switchTo()
      this.event.emit('tabCountChanged', this._view.filetabs.tabs.length)
      this.updateTabsEmptyState()
    })
    this._view.filetabs.addEventListener('click', (event) => {
      const dropdownToggle = event.target.closest('.dropdown')
      if (dropdownToggle) this.alignTabsDropdown(dropdownToggle)
    }, true)

    this._view.filetabs.canAdd = false

    this._view.compileButton = yo`
      <span
        data-id="tabProxyCompileCurrent"
        class="btn btn-sm px-1 fas fa-play text-dark disabled"
        role="button"
        aria-disabled="true"
        onclick=${() => this.onCompileCurrentFile()}
        data-title="Open a .sol tab to compile"
        title="Open a .sol tab to compile">
      </span>
    `

    const zoomBtns = yo`
      <div class="d-flex flex-row justify-content-center align-items-center">
        ${this._view.compileButton}
        <span data-id="tabProxyZoomOut" class="btn btn-sm px-1 fas fa-search-minus text-dark" onclick=${() => this.onZoomOut()} data-title="Zoom out"></span>
        <span data-id="tabProxyZoomIn" class="btn btn-sm px-1 fas fa-search-plus text-dark" onclick=${() => this.onZoomIn()} data-title="Zoom in"></span>
      </div>
    `

    // @todo(#2492) remove style after the mainPanel layout fix.
    this._view.tabs = yo`
      <div style="align-items: center; display: flex; height: 32px; max-height: 32px; overflow: visible; position: relative;">
        ${zoomBtns}
        ${this._view.filetabs}
      </div>
    `
    this.updateTabsEmptyState()
    this.updateCompileButtonState()

    // tabs
    var $filesEl = $(this._view.filetabs)

    // Switch tab
    var self = this
    $filesEl.on('click', '.file:not(.active)', function (ev) {
      ev.preventDefault()
      var name = $(this).find('.name').text()
      self._handlers[name].switchTo()
      return false
    })

    // Remove current tab
    $filesEl.on('click', '.file .remove', function (ev) {
      ev.preventDefault()
      var name = $(this).parent().find('.name').text()
      self._handlers[name].close()
      return false
    })

    return this._view.tabs
  }
}
