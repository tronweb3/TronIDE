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

'use strict'
import { Plugin } from '@remixproject/engine'
import * as packageJson from '../../../../../package.json'

const EventManager = require('../../lib/events')
const yo = require('yo-yo')
const csjs = require('csjs-inject')
const ace = require('brace')

const globalRegistry = require('../../global/registry')
const SourceHighlighters = require('./SourceHighlighters')
const addTooltip = require('../ui/tooltip')

const Range = ace.acequire('ace/range').Range
require('brace/ext/language_tools')
require('brace/ext/searchbox')
const langTools = ace.acequire('ace/ext/language_tools')
// require('ace-mode-solidity/build/remix-ide/mode-solidity')
require('./ace-mode-tron-solidity')
require('ace-mode-move/build/remix-ide/mode-move')
require('ace-mode-zokrates')
require('ace-mode-lexon')
require('brace/mode/javascript')
require('brace/mode/python')
require('brace/mode/json')
require('brace/mode/rust')
// Web-artifact modes: dapp frontends live in the workspace too (the AI panel
// can generate them), and an unregistered mode silently renders as plain text.
// brace's html mode embeds the css/javascript sub-modes for <style>/<script>.
require('brace/mode/html')
require('brace/mode/css')
require('brace/mode/markdown')
require('brace/mode/typescript')
require('brace/theme/chrome') // for all light themes
require('brace/theme/chaos') // for all dark themes
require('../../assets/js/editor/darkTheme') // a custom one for remix 'Dark' theme

const css = csjs`
  .ace-editor {
    width     : 100%;
  }
`
document.head.appendChild(yo`
  <style>
    .ace-tm .ace_gutter,
    .ace-tm .ace_gutter-active-line,
    .ace-tm .ace_marker-layer .ace_active-line {
        background-color: var(--secondary);
    }
    .ace_gutter-cell.ace_breakpoint{
      background-color: var(--secondary);
    }
  </style>
`)

const profile = {
  displayName: 'Editor',
  name: 'editor',
  description: 'service - editor',
  version: packageJson.version,
  methods: ['highlight', 'discardHighlight', 'discardHighlightAt', 'clearAnnotations', 'addAnnotation'],
  events: ['breakpointAdded', 'breakpointCleared', 'contentChanged', 'requiringToSaveCurrentfile', 'sessionSwitched']
}

class Editor extends Plugin {
  constructor (opts = {}, themeModule) {
    super(profile)
    // Dependancies
    this._components = {}
    this._components.registry = globalRegistry
    this._deps = {
      config: this._components.registry.get('config').api
    }

    this._themes = {
      light: 'chrome',
      dark: 'chaos',
      remixDark: 'remixDark'
    }
    themeModule.events.on('themeChanged', (theme) => {
      this.setTheme(theme.name === 'Dark' ? 'remixDark' : theme.quality)
    })

    // Init
    this.event = new EventManager()
    this.sessions = {}
    this.sourceAnnotationsPerFile = []
    this.readOnlySessions = {}
    this.previousInput = ''
    this.saveTimeout = null
    this.sourceHighlighters = new SourceHighlighters()
    this.emptySession = this._createSession('')
    this.modes = {
      sol: 'ace/mode/solidity',
      yul: 'ace/mode/solidity',
      mvir: 'ace/mode/move',
      js: 'ace/mode/javascript',
      py: 'ace/mode/python',
      vy: 'ace/mode/python',
      zok: 'ace/mode/zokrates',
      lex: 'ace/mode/lexon',
      txt: 'ace/mode/text',
      json: 'ace/mode/json',
      abi: 'ace/mode/json',
      rs: 'ace/mode/rust',
      html: 'ace/mode/html',
      htm: 'ace/mode/html',
      css: 'ace/mode/css',
      md: 'ace/mode/markdown',
      ts: 'ace/mode/typescript'
    }

    // Editor Setup
    const el = yo`<div id="input" data-id="editorInput"></div>`
    this.editor = ace.edit(el)

    ace.acequire('ace/ext/language_tools')

    // Unmap ctrl-l & cmd-l
    this.editor.commands.bindKeys({
      'ctrl-L': null,
      'Command-L': null
    })

    // shortcuts for "Ctrl-"" and "Ctrl+"" to increase/decrease font size of the editor
    this.editor.commands.addCommand({
      name: 'increasefontsizeEqual',
      bindKey: { win: 'Ctrl-=', mac: 'Command-=' },
      exec: (editor) => {
        this.editorFontSize(1)
      },
      readOnly: true
    })

    this.editor.commands.addCommand({
      name: 'increasefontsizePlus',
      bindKey: { win: 'Ctrl-+', mac: 'Command-+' },
      exec: (editor) => {
        this.editorFontSize(1)
      },
      readOnly: true
    })

    this.editor.commands.addCommand({
      name: 'decreasefontsize',
      bindKey: { win: 'Ctrl--', mac: 'Command--' },
      exec: (editor) => {
        this.editorFontSize(-1)
      },
      readOnly: true
    })

    // AI: explain the current contract (Cmd/Ctrl-Alt-E). Sends the whole file
    // to the AI panel's chat via aiPanel.explainContract.
    this.editor.commands.addCommand({
      name: 'aiExplainContract',
      bindKey: { win: 'Ctrl-Alt-E', mac: 'Command-Alt-E' },
      exec: () => { this.aiExplainContract() },
      readOnly: true
    })

    // AI: inline `//` request (Cmd/Ctrl-I). If the current line is a `// ...`
    // comment, treat its text as an instruction, send it + surrounding context
    // to the LLM, and insert the returned code on the next line.
    this.editor.commands.addCommand({
      name: 'aiInlineRequest',
      bindKey: { win: 'Ctrl-I', mac: 'Command-I' },
      exec: () => { this.aiInlineRequest() }
    })

    this.editor.setShowPrintMargin(false)
    this.editor.resize(true)

    this.editor.setOptions({
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true
    })

    el.className += ' ' + css['ace-editor']
    el.editor = this.editor // required to access the editor during tests
    // Ace (brace 0.8.0) renders its OWN selection, not a native DOM selection,
    // so the browser's right-click "Copy" operates on an empty native
    // selection and copies nothing. Provide a custom editor context menu wired
    // to Ace's selection + the clipboard so right-click Copy/Cut/Paste works.
    this._setupEditorContextMenu(el)
    this.render = () => el

    // AI-backed completer. Only active for .sol files; pulls the current
    // vendor/model/key from the AI panel, then asks the LLM for a FIM-style
    // completion. Requests are debounced (~300ms) and any superseded request is
    // aborted so only the latest keystroke's suggestion is delivered to Ace.
    this._aiCompleteTimer = null
    this._aiCompleteSeq = 0
    const flowCompleter = {
      getCompletions: (editor, session, pos, prefix, callback) => {
        const path = this.currentSession
        if (!path || !/\.sol$/.test(path)) {
          callback(null, [])
          return
        }
        if (this._aiCompleteTimer) clearTimeout(this._aiCompleteTimer)
        // No AbortController across the plugin RPC boundary; instead tag each
        // request and drop any result that a newer keystroke has superseded.
        const seq = ++this._aiCompleteSeq
        this._aiCompleteTimer = setTimeout(async () => {
          try {
            // Build prefix/suffix context around the cursor (bounded so we don't
            // ship the whole file on every keystroke).
            const doc = session.getValue()
            const idx = session.doc.positionToIndex(pos, 0)
            const MAX = 2000
            const before = doc.slice(Math.max(0, idx - MAX), idx)
            const after = doc.slice(idx, idx + MAX)
            // The AI panel holds the key and runs the completion; only text
            // comes back (returns '' when no key / panel never opened).
            const suggestion = await this.call('aiPanel', 'aiComplete', { prefix: before, suffix: after, maxTokens: 64 })
            if (seq !== this._aiCompleteSeq) return
            const text = (suggestion || '').trim()
            if (!text) { callback(null, []); return }
            // Ace fuzzy-filters candidates against the typed identifier prefix
            // and deletes that prefix before inserting `value` on accept. The
            // FIM continuation deliberately does NOT repeat the prefix, so the
            // raw text would (a) fail the filter and never show while typing,
            // and (b) mangle the code when accepted. Prepend the prefix so the
            // candidate both matches and inserts correctly.
            const value = (prefix || '') + text
            callback(null, [{
              caption: (prefix || '') + text.split('\n')[0].slice(0, 60),
              value,
              meta: 'AI',
              score: 1000
            }])
          } catch (e) {
            // Never disrupt typing: log and return no AI suggestion.
            console.debug('[aiComplete] skipped:', e && e.message)
            callback(null, [])
          }
        }, 300)
      }
    }
    langTools.addCompleter(flowCompleter)

    // zoom with Ctrl+wheel
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey && Math.abs(e.wheelY) > 5) {
        this.editorFontSize(e.wheelY > 0 ? 1 : -1)
      }
    })

    // EVENTS LISTENERS

    // Gutter Mouse down
    this.editor.on('guttermousedown', e => {
      const target = e.domEvent.target
      if (target.className.indexOf('ace_gutter-cell') === -1) {
        return
      }
      const row = e.getDocumentPosition().row
      const breakpoints = e.editor.session.getBreakpoints()
      for (const k in breakpoints) {
        if (k === row.toString()) {
          this.triggerEvent('breakpointCleared', [this.currentSession, row])
          e.editor.session.clearBreakpoint(row)
          e.stop()
          return
        }
      }
      this.setBreakpoint(row)
      this.triggerEvent('breakpointAdded', [this.currentSession, row])
      e.stop()
    })

    // Do setup on initialisation here
    this.editor.on('changeSession', () => {
      this._onChange()
      this.triggerEvent('sessionSwitched', [])
      this.scheduleLint()
      this.editor.getSession().on('change', () => {
        this._onChange()
        this.sourceHighlighters.discardAllHighlights()
        this.triggerEvent('contentChanged', [])
        this.scheduleLint()
      })
    })
  }

  // Debounced in-editor Solidity lint: parse the current .sol on idle and
  // surface focused warnings as annotations (own 'solidityLint' tag, kept
  // separate from compiler errors). Parser is lazy-loaded.
  scheduleLint () {
    if (this._lintTimer) clearTimeout(this._lintTimer)
    this._lintTimer = setTimeout(() => this._runLint(), 600)
  }

  async _runLint () {
    const path = this.currentSession
    if (!path || !/\.sol$/.test(path)) return
    const session = this.sessions[path]
    if (!session) return
    const content = session.getValue()
    try {
      // lazy chunk: parser + rules load only when a .sol is first linted
      const { lintSolidity } = await import(/* webpackChunkName: "solidity-lint" */ '../tabs/solidity-lint')
      const findings = lintSolidity(content)
      // the file may have changed/closed while we awaited the parser
      if (this.currentSession !== path || !this.sessions[path]) return
      const kept = (this.sourceAnnotationsPerFile[path] || []).filter((a) => a.from !== 'solidityLint')
      for (const f of findings) {
        kept.push({ row: f.line - 1, column: Math.max(0, f.column - 1), text: `${f.message} [${f.rule}]`, type: f.severity === 'info' ? 'info' : 'warning', from: 'solidityLint' })
      }
      this.sourceAnnotationsPerFile[path] = kept
      this._setAnnotations(this.sessions[path], path)
    } catch (e) {
      // lint must never disrupt editing
      console.debug('[solidityLint] skipped:', e && e.message)
    }
  }

  triggerEvent (name, params) {
    this.event.trigger(name, params) // internal stack
    this.emit(name, ...params) // plugin stack
  }

  onActivation () {
    this.on('sidePanel', 'focusChanged', (name) => {
      this.sourceHighlighters.hideHighlightsExcept(name)
      this.keepAnnotationsFor(name)
    })
    this.on('sidePanel', 'pluginDisabled', (name) => {
      this.sourceHighlighters.discardHighlight(name)
      this.clearAllAnnotationsFor(name)
    })
  }

  onDeactivation () {
    if (this._closeEditorContextMenu) this._closeEditorContextMenu()
    this.off('sidePanel', 'focusChanged')
    this.off('sidePanel', 'pluginDisabled')
  }

  highlight (position, filePath, hexColor) {
    const { from } = this.currentRequest
    this.sourceHighlighters.highlight(position, filePath, hexColor, from)
  }

  discardHighlight () {
    const { from } = this.currentRequest
    this.sourceHighlighters.discardHighlight(from)
  }

  discardHighlightAt (line, filePath) {
    const { from } = this.currentRequest
    this.sourceHighlighters.discardHighlightAt(line, filePath, from)
  }

  setTheme (type) {
    this.editor.setTheme('ace/theme/' + this._themes[type])
  }

  _onChange () {
    const currentFile = this._deps.config.get('currentFile')
    if (!currentFile) {
      return
    }
    const input = this.get(currentFile)
    if (!input) {
      return
    }
    // if there's no change, don't do anything
    if (input === this.previousInput) {
      return
    }
    this.previousInput = input

    // fire storage update
    // NOTE: save at most once per 5 seconds
    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout)
    }
    this.saveTimeout = window.setTimeout(() => {
      this.triggerEvent('requiringToSaveCurrentfile', [])
    }, 5000)
  }

  _switchSession (path) {
    this.currentSession = path
    this.editor.setSession(this.sessions[this.currentSession])
    this.editor.setReadOnly(this.readOnlySessions[this.currentSession])
    this.editor.focus()
  }

  /**
   * Get Ace mode base of the extension of the session file
   * @param {string} path Path of the file
   */
  _getMode (path) {
    if (!path) return this.modes.txt
    const root = path.split('#')[0].split('?')[0]
    let ext = root.indexOf('.') !== -1 ? /[^.]+$/.exec(root) : null
    if (ext) ext = ext[0]
    else ext = 'txt'
    return ext && this.modes[ext] ? this.modes[ext] : this.modes.txt
  }

  /**
   * Create an Ace session
   * @param {string} content Content of the file to open
   * @param {string} mode Ace Mode for this file [Default is `text`]
   */
  _createSession (content, mode) {
    const s = new ace.EditSession(content)
    s.setMode(mode || 'ace/mode/text')
    s.setUndoManager(new ace.UndoManager())
    s.setTabSize(4)
    s.setUseSoftTabs(true)
    return s
  }

  /**
   * Attempts to find the string in the current document
   * @param {string} string
   */
  find (string) {
    return this.editor.find(string)
  }

  /**
   * Display an Empty read-only session
   */
  displayEmptyReadOnlySession () {
    this.currentSession = null
    this.editor.setSession(this.emptySession)
    this.editor.setReadOnly(true)
  }

  /**
   * Sets a breakpoint on the row number
   * @param {number} row Line index of the breakpoint
   * @param {string} className Class of the breakpoint
   */
  setBreakpoint (row, className) {
    this.editor.session.setBreakpoint(row, className)
  }

  /**
   * Increment the font size (in pixels) for the editor text.
   * @param {number} incr The amount of pixels to add to the font.
   */
  editorFontSize (incr) {
    const newSize = this.editor.getFontSize() + incr
    if (newSize >= 6) {
      this.editor.setFontSize(newSize)
    }
  }

  // Custom right-click menu for the Ace editor: Copy / Cut / Paste / Select all
  // wired to the editor's own selection API + the async clipboard, because the
  // native context menu can't see Ace's rendered selection.
  _setupEditorContextMenu (el) {
    const closeMenu = (refocusEditor) => {
      if (!this._editorContextMenuEl) return
      this._editorContextMenuEl.remove()
      this._editorContextMenuEl = null
      document.removeEventListener('mousedown', this._editorContextMenuClose, true)
      document.removeEventListener('keydown', this._editorContextMenuKey, true)
      window.removeEventListener('blur', closeMenu)
      // keyboard dismissals (Escape/Tab) hand focus back to the editor; an
      // outside mousedown must NOT — the click's own target takes focus
      if (refocusEditor === true) { try { this.editor.focus() } catch (e) { /* editor gone */ } }
    }
    this._closeEditorContextMenu = closeMenu
    this._editorContextMenuClose = (e) => {
      if (this._editorContextMenuEl && !this._editorContextMenuEl.contains(e.target)) closeMenu()
    }
    this._editorContextMenuKey = (e) => {
      const menu = this._editorContextMenuEl
      if (!menu) return
      // While the menu is open IT owns the keyboard (focus sits on the menu,
      // not Ace's hidden textarea, so characters can't edit the document
      // underneath). Escape/Tab must not fall through and also close/move
      // whatever sits below the menu.
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        return closeMenu(true)
      }
      const rows = Array.from(menu.querySelectorAll('[role="menuitem"][data-enabled="true"]'))
      if (!rows.length) return
      const focusRow = (index) => {
        e.preventDefault()
        e.stopPropagation()
        rows[(index + rows.length) % rows.length].focus()
      }
      if (e.key === 'ArrowDown') return focusRow(rows.indexOf(document.activeElement) + 1)
      if (e.key === 'ArrowUp') return focusRow(rows.indexOf(document.activeElement) < 0 ? -1 : rows.indexOf(document.activeElement) - 1)
      if (e.key === 'Home') return focusRow(0)
      if (e.key === 'End') return focusRow(rows.length - 1)
      if ((e.key === 'Enter' || e.key === ' ') && rows.includes(document.activeElement)) {
        e.preventDefault()
        e.stopPropagation()
        document.activeElement.click()
      }
    }

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
      const selection = this.editor.getSelectedText() || ''
      const hasSelection = !!selection
      const readOnly = this.editor.getReadOnly && this.editor.getReadOnly()
      const items = [
        { label: 'Copy', enabled: hasSelection, run: () => this._editorCopy() },
        { label: 'Cut', enabled: hasSelection && !readOnly, run: () => this._editorCut() },
        { label: 'Paste', enabled: !readOnly, run: () => this._editorPaste() },
        { sep: true },
        { label: 'Select all', enabled: true, run: () => { this.editor.selectAll(); this.editor.focus() } }
      ]
      const menu = document.createElement('div')
      menu.setAttribute('data-id', 'editorContextMenu')
      menu.setAttribute('role', 'menu')
      menu.tabIndex = -1
      // The menu is attached directly to <body>, where the legacy --text
      // variable is not defined by any built-in theme. Its dark fallback then
      // rendered dark-on-dark in Dark/Black/Cyborg. --ai-title is defined by
      // every theme and has AA contrast against that theme's --light surface.
      menu.style.cssText = 'position:fixed; z-index:10050; min-width:150px; padding:4px 0; background:var(--light,#fff); color:var(--ai-title,#212529); border:1px solid var(--secondary,#ced4da); border-radius:4px; box-shadow:0 2px 10px rgba(0,0,0,.3); font-size:13px; user-select:none; outline:none;'
      items.forEach((it) => {
        if (it.sep) {
          const s = document.createElement('div')
          s.style.cssText = 'height:1px; margin:4px 0; background:var(--secondary,#ced4da); opacity:.6;'
          menu.appendChild(s)
          return
        }
        const row = document.createElement('div')
        row.setAttribute('data-id', 'editorContextMenu' + it.label.replace(/\s/g, ''))
        row.setAttribute('role', 'menuitem')
        row.textContent = it.label
        row.style.cssText = 'padding:5px 14px; white-space:nowrap; outline:none; cursor:' + (it.enabled ? 'pointer' : 'default') + '; opacity:' + (it.enabled ? '1' : '.82') + ';'
        if (it.enabled) {
          // focusable via the roving ArrowUp/Down handler (not the Tab order);
          // focus shares the hover highlight as its visible indicator
          row.tabIndex = -1
          row.setAttribute('data-enabled', 'true')
          // A low-opacity tint preserves contrast across every built-in theme;
          // some themes use --secondary as a mid-tone with insufficient text
          // contrast when it is used as the entire hover surface.
          const highlight = () => { row.style.background = 'color-mix(in srgb, currentColor 8%, transparent)' }
          const unhighlight = () => { row.style.background = 'transparent' }
          row.addEventListener('mouseenter', highlight)
          row.addEventListener('mouseleave', unhighlight)
          row.addEventListener('focus', highlight)
          row.addEventListener('blur', unhighlight)
          row.addEventListener('click', () => { closeMenu(); it.run() })
        } else {
          row.setAttribute('aria-disabled', 'true')
        }
        menu.appendChild(row)
      })
      document.body.appendChild(menu)
      this._editorContextMenuEl = menu
      // a keyboard-invoked contextmenu (Shift+F10 / menu key) carries no mouse
      // point and would land at the top-left clamp — anchor it to the text
      // cursor instead, one line below so the current line stays readable
      let ax = e.clientX
      let ay = e.clientY
      if (ax <= 0 && ay <= 0) {
        try {
          const cur = this.editor.getCursorPosition()
          const sc = this.editor.renderer.textToScreenCoordinates(cur.row, cur.column)
          ax = sc.pageX - window.scrollX
          ay = (sc.pageY - window.scrollY) + (this.editor.renderer.lineHeight || 14)
        } catch (err) { ax = 8; ay = 8 }
      }
      // keep the menu inside the viewport
      const mw = menu.offsetWidth
      const mh = menu.offsetHeight
      menu.style.left = Math.max(2, Math.min(ax, window.innerWidth - mw - 4)) + 'px'
      menu.style.top = Math.max(2, Math.min(ay, window.innerHeight - mh - 4)) + 'px'
      // The open menu owns the keyboard: take focus OFF Ace's hidden textarea
      // (typing used to edit the document underneath the floating menu). A
      // keyboard invocation lands on the first item so ArrowDown/Enter work
      // immediately; a mouse invocation focuses the container, keeping hover
      // behavior unchanged until the arrows are used.
      const keyboardInvoked = e.clientX <= 0 && e.clientY <= 0
      const firstRow = keyboardInvoked ? menu.querySelector('[role="menuitem"][data-enabled="true"]') : null
      if (firstRow) firstRow.focus()
      else menu.focus()
      document.addEventListener('mousedown', this._editorContextMenuClose, true)
      document.addEventListener('keydown', this._editorContextMenuKey, true)
      window.addEventListener('blur', closeMenu)
    })
  }

  _writeClipboard (text) {
    if (!text) return
    // Fallback: Ace fills the clipboard on its own 'copy' event.
    const execCommandFallback = () => {
      try { this.editor.focus(); document.execCommand('copy') } catch (e) { /* give up silently */ }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        // writeText rejects ASYNCHRONOUSLY on permission/focus loss — a bare
        // try/catch would miss it and skip the intended fallback
        navigator.clipboard.writeText(text).catch(execCommandFallback)
        return
      }
    } catch (e) { /* fall through to the Ace/execCommand path */ }
    execCommandFallback()
  }

  _editorCopy () {
    this._writeClipboard(this.editor.getSelectedText())
    this.editor.focus()
  }

  _editorCut () {
    if (this.editor.getReadOnly && this.editor.getReadOnly()) return
    const text = this.editor.getSelectedText()
    if (!text) return
    this._writeClipboard(text)
    this.editor.insert('') // remove the selection
    this.editor.focus()
  }

  async _editorPaste () {
    if (this.editor.getReadOnly && this.editor.getReadOnly()) return
    this.editor.focus()
    try {
      const text = await navigator.clipboard.readText()
      if (text) this.editor.insert(text)
    } catch (e) {
      // Clipboard read blocked (permission/insecure context): leave the editor
      // focused so the user can still paste with Ctrl/Cmd+V.
    }
  }

  /**
   * Set the text in the current session, if any.
   * @param {string} text New text to be place.
   */
  setText (text) {
    if (!this.currentSession || !this.sessions[this.currentSession]) return
    const session = this.sessions[this.currentSession]
    const current = session.getValue()
    // No-op save (editor already holds this content): leave the document and
    // its undo stack untouched, so a plain Ctrl+S doesn't churn history.
    if (current === text) return
    // Replace over the whole document instead of setValue: setValue resets the
    // session and wipes the undo stack, so a "Format code" became un-undoable.
    // A full-range replace is recorded as a single undoable edit (Ctrl+Z then
    // reverts the format). Cursor/scroll are restored around the edit.
    const selectionRange = session.selection ? session.selection.getRange() : null
    const scrollTop = this.editor && this.editor.getSession() === session ? this.editor.getSession().getScrollTop() : null
    const lastRow = session.getLength() - 1
    const fullRange = new Range(0, 0, lastRow, session.getLine(lastRow).length)
    session.replace(fullRange, text)
    try {
      if (selectionRange) session.selection.setRange(selectionRange)
      if (scrollTop !== null) session.setScrollTop(scrollTop)
    } catch (e) { /* selection/scroll restore is best-effort */ }
  }

  /**
   * Upsert and open a session.
   * @param {string} path Path of the session to open.
   * @param {string} content Content of the document or update.
   */
  open (path, content) {
    /*
      we have the following cases:
       - URL prepended with "localhost"
       - URL prepended with "browser"
       - URL not prepended with the file explorer. We assume (as it is in the whole app, that this is a "browser" URL
    */
    if (!this.sessions[path]) {
      const session = this._createSession(content, this._getMode(path))
      this.sessions[path] = session
      this.readOnlySessions[path] = false
    } else if (this.sessions[path].getValue() !== content) {
      this.sessions[path].setValue(content)
    }
    this._switchSession(path)
  }

  /**
   * Upsert and Open a session and set it as Read-only.
   * @param {string} path Path of the session to open.
   * @param {string} content Content of the document or update.
   */
  openReadOnly (path, content) {
    if (!this.sessions[path]) {
      const session = this._createSession(content, this._getMode(path))
      this.sessions[path] = session
      this.readOnlySessions[path] = true
    }
    this._switchSession(path)
  }

  /**
   * Content of the current session
   * @return {String} content of the file referenced by @arg path
   */
  currentContent () {
    return this.get(this.current())
  }

  /**
   * Content of the session targeted by @arg path
   * if @arg path is null, the content of the current session is returned
   * @param {string} path Path of the session to get.
   * @return {String} content of the file referenced by @arg path
   */
  get (path) {
    if (!path || this.currentSession === path) {
      return this.editor.getValue()
    } else if (this.sessions[path]) {
      return this.sessions[path].getValue()
    }
  }

  /**
   * Path of the currently editing file
   * returns `undefined` if no session is being editer
   * @return {String} path of the current session
   */
  current () {
    if (this.editor.getSession() === this.emptySession) {
      return
    }
    return this.currentSession
  }

  /**
   * The position of the cursor
   */
  getCursorPosition () {
    return this.editor.session.doc.positionToIndex(
      this.editor.getCursorPosition(),
      0
    )
  }

  /**
   * Remove the current session from the list of sessions.
   */
  discardCurrentSession () {
    if (this.sessions[this.currentSession]) {
      delete this.sessions[this.currentSession]
      this.currentSession = null
    }
  }

  /**
   * Remove a session based on its path.
   * @param {string} path
   */
  discard (path) {
    if (this.sessions[path]) delete this.sessions[path]
    if (this.currentSession === path) this.currentSession = null
  }

  /**
   * Resize the editor, and sets whether or not line wrapping is enabled.
   * @param {boolean} useWrapMode Enable (or disable) wrap mode
   */
  resize (useWrapMode) {
    this.editor.resize()
    const session = this.editor.getSession()
    session.setUseWrapMode(useWrapMode)
    if (session.getUseWrapMode()) {
      const characterWidth = this.editor.renderer.characterWidth
      const contentWidth = this.editor.container.ownerDocument.getElementsByClassName(
        'ace_scroller'
      )[0].clientWidth

      if (contentWidth > 0) {
        session.setWrapLimit(parseInt(contentWidth / characterWidth, 10))
      }
    }
  }

  /**
   * Adds a new marker to the given `Range`.
   * @param {*} lineColumnPos
   * @param {string} source Path of the session to add the mark on.
   * @param {string} cssClass css to apply to the mark.
   */
  addMarker (lineColumnPos, source, cssClass) {
    const currentRange = new Range(
      lineColumnPos.start.line,
      lineColumnPos.start.column,
      lineColumnPos.end.line,
      lineColumnPos.end.column
    )
    if (this.sessions[source]) {
      return this.sessions[source].addMarker(currentRange, cssClass)
    }
    return null
  }

  /**
   * Scrolls to a line. If center is true, it puts the line in middle of screen (or attempts to).
   * @param {number} line The line to scroll to
   * @param {boolean} center If true
   * @param {boolean} animate If true animates scrolling
   * @param {Function} callback Function to be called when the animation has finished
   */
  scrollToLine (line, center, animate, callback) {
    this.editor.scrollToLine(line, center, animate, callback)
  }

  /**
   * Remove a marker from the session
   * @param {string} markerId Id of the marker
   * @param {string} source Path of the session
   */
  removeMarker (markerId, source) {
    if (this.sessions[source]) {
      this.sessions[source].removeMarker(markerId)
    }
  }

  /**
   * Clears all the annotations for the given @arg filePath and @arg plugin, if none is given, the current sesssion is used.
   * An annotation has the following shape:
      column: -1
      row: -1
      text: "browser/Untitled1.sol: Warning: SPDX license identifier not provided in source file. Before publishing, consider adding a comment containing "SPDX-License-Identifier: <SPDX-License>" to each source file. Use "SPDX-License-Identifier: UNLICENSED" for non-open-source code. Please see https://spdx.org for more information.↵"
      type: "warning"
   * @param {String} filePath
   * @param {String} plugin
   */
  clearAnnotationsByPlugin (filePath, plugin) {
    if (filePath && !this.sessions[filePath]) throw new Error('file not found' + filePath)
    const session = this.sessions[filePath] || this.editor.getSession()
    const path = filePath || this.currentSession

    const currentAnnotations = this.sourceAnnotationsPerFile[path]
    if (!currentAnnotations) return

    const newAnnotations = []
    for (const annotation of currentAnnotations) {
      if (annotation.from !== plugin) newAnnotations.push(annotation)
    }
    this.sourceAnnotationsPerFile[path] = newAnnotations

    this._setAnnotations(session, path)
  }

  keepAnnotationsFor (name) {
    if (!this.currentSession) return
    if (!this.sourceAnnotationsPerFile[this.currentSession]) return

    const annotations = this.sourceAnnotationsPerFile[this.currentSession]
    for (const annotation of annotations) {
      // 'solidityLint' is the editor's own live linter, not a side panel
      // plugin, so a panel focus change must never hide its annotations
      annotation.hide = annotation.from !== name && annotation.from !== 'solidityLint'
    }

    this._setAnnotations(this.editor.getSession(), this.currentSession)
  }

  /**
   * Clears all the annotations for the given @arg filePath, the plugin name is retrieved from the context, if none is given, the current sesssion is used.
   * An annotation has the following shape:
      column: -1
      row: -1
      text: "browser/Untitled1.sol: Warning: SPDX license identifier not provided in source file. Before publishing, consider adding a comment containing "SPDX-License-Identifier: <SPDX-License>" to each source file. Use "SPDX-License-Identifier: UNLICENSED" for non-open-source code. Please see https://spdx.org for more information.↵"
      type: "warning"
   * @param {String} filePath
   * @param {String} plugin
   */
  clearAnnotations (filePath) {
    const { from } = this.currentRequest
    this.clearAnnotationsByPlugin(filePath, from)
  }

  /**
   * Clears all the annotations and for all the sessions for the given @arg plugin
   * An annotation has the following shape:
      column: -1
      row: -1
      text: "browser/Untitled1.sol: Warning: SPDX license identifier not provided in source file. Before publishing, consider adding a comment containing "SPDX-License-Identifier: <SPDX-License>" to each source file. Use "SPDX-License-Identifier: UNLICENSED" for non-open-source code. Please see https://spdx.org for more information.↵"
      type: "warning"
   * @param {String} filePath
   */
  clearAllAnnotationsFor (plugin) {
    for (const session in this.sessions) {
      this.clearAnnotationsByPlugin(session, plugin)
    }
  }

  /**
   * Add an annotation to the current session.
   * An annotation has the following shape:
      column: -1
      row: -1
      text: "browser/Untitled1.sol: Warning: SPDX license identifier not provided in source file. Before publishing, consider adding a comment containing "SPDX-License-Identifier: <SPDX-License>" to each source file. Use "SPDX-License-Identifier: UNLICENSED" for non-open-source code. Please see https://spdx.org for more information.↵"
      type: "warning"
   * @param {Object} annotation
   * @param {String} filePath
   */
  addAnnotation (annotation, filePath) {
    if (filePath && !this.sessions[filePath]) throw new Error('file not found' + filePath)
    const session = this.sessions[filePath] || this.editor.getSession()
    const path = filePath || this.currentSession

    const { from } = this.currentRequest
    if (!this.sourceAnnotationsPerFile[path]) this.sourceAnnotationsPerFile[path] = []
    annotation.from = from
    this.sourceAnnotationsPerFile[path].push(annotation)

    this._setAnnotations(session, path)
  }

  _setAnnotations (session, path) {
    const annotations = this.sourceAnnotationsPerFile[path]
    session.setAnnotations(annotations.filter((element) => !element.hide))
  }

  // Best-effort user notification; never throws. Uses the app's tooltip toast
  // directly — there is no 'notification' plugin on the bus, so a this.call
  // there would reject and the message would silently die in the console,
  // making the AI keybindings look broken on every guard path.
  _notify (message) {
    try {
      addTooltip(message)
    } catch (e) {
      console.warn('[editor] ' + message)
    }
  }

  // Send the current file to the AI panel for a plain-language explanation.
  async aiExplainContract () {
    const file = this.current()
    const code = this.currentContent()
    if (!code) { this._notify('Nothing to explain: the editor is empty.'); return }
    try {
      await this.call('aiPanel', 'explainContract', { code, file })
    } catch (e) {
      this._notify('Could not reach the AI panel: ' + (e && e.message))
    }
  }

  // Inline `//` AI request. Reads the current line; if it is a `// instruction`
  // comment, asks the LLM to fulfil it using the surrounding file as context and
  // inserts the returned code on the line below the comment.
  async aiInlineRequest () {
    const path = this.currentSession
    if (!path) return
    const session = this.editor.getSession()
    const cursor = this.editor.getCursorPosition()
    const lineText = session.getLine(cursor.row) || ''
    const m = lineText.match(/^\s*\/\/\s?(.*)$/)
    if (!m || !m[1].trim()) {
      this._notify('Place the cursor on a `// your request` comment line first.')
      return
    }
    const instruction = m[1].trim()

    let hasKey
    try {
      hasKey = await this.call('aiPanel', 'hasAiKey')
    } catch (e) {
      this._notify('Could not reach the AI panel: ' + (e && e.message))
      return
    }
    if (!hasKey) {
      this._notify('Set an AI key in the AI panel to use inline `//` requests.')
      return
    }

    const doc = session.getValue()
    const idx = session.doc.positionToIndex({ row: cursor.row + 1, column: 0 }, 0)
    const MAX = 4000
    const before = doc.slice(Math.max(0, idx - MAX), idx)
    const after = doc.slice(idx, idx + MAX)
    const prefix = `${before}\n// Task: ${instruction}\n`

    try {
      // Key stays in the AI panel; only the generated text returns.
      const result = await this.call('aiPanel', 'aiComplete', { prefix, suffix: after, maxTokens: 512 })
      let text = (result || '').trim()
      // Strip accidental markdown fences if the model added them.
      text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
      if (!text) { this._notify('AI returned no code for that request.'); return }
      // Insert at the end of the comment line so it works even when the comment
      // is the last line of the file (no trailing newline to land on).
      const commentEnd = { row: cursor.row, column: lineText.length }
      session.insert(commentEnd, '\n' + text)
    } catch (e) {
      if (e && e.name === 'AbortError') return
      this._notify('AI request failed: ' + (e && e.message))
    }
  }

  /**
   * Moves the cursor and focus to the specified line and column number
   * @param {number} line
   * @param {number} col
   */
  gotoLine (line, col) {
    this.editor.focus()
    this.editor.gotoLine(line + 1, col - 1, true)
  }
}

module.exports = Editor
