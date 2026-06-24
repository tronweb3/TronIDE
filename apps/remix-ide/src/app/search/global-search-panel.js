'use strict'

const yo = require('yo-yo')
const csjs = require('csjs-inject')
const {
  searchWorkspaceFiles,
  createWorkspaceReplacePreview,
  DEFAULT_LIMITS,
  DEFAULT_INCLUDE_PATTERN,
  DEFAULT_EXCLUDE_PATTERN
} = require('./workspace-search')

const HISTORY_KEY = 'tronide.globalSearch.history'
const LONG_SEARCH_MS = 5000

function logGlobalSearchStorageError (action, error) {
  if (typeof console !== 'undefined' && console.debug) console.debug('[global-search] localStorage ' + action + ' failed', error)
}

const css = csjs`
  .globalSearchPanel {
    width: 100%;
    height: 100%;
    display: none;
    flex-direction: column;
    background: var(--body-bg);
    color: var(--text);
    overflow: hidden;
  }
  .floatingPanel {
    position: absolute;
    right: 16px;
    top: 44px;
    width: 380px;
    max-height: 70vh;
    z-index: 20;
    border: 1px solid var(--secondary);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  }
  .searchHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--secondary);
  }
  .title {
    font-size: 11px;
    letter-spacing: .08em;
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .actionButton {
    border: 1px solid var(--secondary);
    background: transparent;
    color: var(--text);
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    line-height: 20px;
    min-width: 24px;
  }
  .searchControls {
    padding: 10px 12px;
    border-bottom: 1px solid var(--secondary);
  }
  .inputWrap {
    position: relative;
  }
  .searchInput {
    width: 100%;
    padding-right: 96px;
  }
  .modifiers {
    position: absolute;
    right: 4px;
    top: 4px;
    display: flex;
    gap: 3px;
  }
  .modifier {
    border: 1px solid var(--secondary);
    background: var(--body-bg);
    color: var(--text);
    border-radius: 3px;
    font-size: 11px;
    height: 24px;
    min-width: 26px;
    cursor: pointer;
  }
  .modifierOn {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--light);
  }
  .modifierDisabled {
    opacity: .45;
  }
  .filterBlock {
    margin-top: 8px;
  }
  .replaceRow {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .replaceInput {
    flex: 1;
    font-size: 12px;
  }
  .filterBlock label {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 3px;
  }
  .filterInput {
    width: 100%;
    font-size: 12px;
  }
  .inlineError {
    margin-top: 5px;
    font-size: 12px;
    color: var(--danger);
  }
  .history {
    margin-top: 6px;
    border: 1px solid var(--secondary);
    border-radius: 4px;
    overflow: hidden;
  }
  .historyRow {
    width: 100%;
    border: 0;
    border-bottom: 1px solid var(--secondary);
    background: transparent;
    color: var(--text);
    padding: 6px 8px;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
  }
  .historyClear {
    color: var(--text-muted);
  }
  .meta {
    padding: 7px 12px;
    font-size: 12px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--secondary);
  }
  .progress {
    height: 2px;
    background: var(--primary);
    animation: globalSearchProgress 1.2s ease-in-out infinite;
    transform-origin: left;
  }
  .resultsWrap {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .results {
    height: 100%;
    overflow: auto;
    padding: 8px 0;
  }
  .dimmed {
    opacity: .45;
  }
  .state {
    padding: 28px 18px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .stateTitle {
    color: var(--text);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .fileGroup {
    border-bottom: 1px solid var(--secondary);
  }
  .fileHeader {
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--text);
    padding: 7px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
  }
  .filePath {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .count {
    color: var(--text-muted);
  }
  .hit {
    width: 100%;
    display: flex;
    gap: 8px;
    border: 0;
    background: transparent;
    color: var(--text);
    padding: 5px 10px 5px 30px;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .hit:hover, .historyRow:hover, .fileHeader:hover {
    background: var(--secondary);
  }
  .hitFlash {
    border-left-color: var(--primary);
  }
  .lineNo {
    color: var(--text-muted);
    min-width: 36px;
  }
  .preview {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .highlight {
    background: var(--primary);
    color: var(--light);
    border-radius: 2px;
    padding: 0 1px;
  }
  .warning {
    margin: 8px 10px;
    padding: 8px;
    border: 1px solid var(--warning);
    color: var(--warning);
    border-radius: 4px;
    font-size: 12px;
  }
  .retryButton {
    margin-left: 8px;
  }
  @keyframes globalSearchProgress {
    0% { transform: scaleX(.15); opacity: .5; }
    50% { transform: scaleX(.75); opacity: 1; }
    100% { transform: scaleX(.15); opacity: .5; }
  }
`

class GlobalSearchPanel {
  constructor (fileManager, editor, opts = {}) {
    this.fileManager = fileManager
    this.editor = editor
    this.mode = opts.mode || 'floating'
    this.onClose = opts.onClose
    this.onStatusChanged = opts.onStatusChanged
    this.query = ''
    this.replacement = ''
    this.showReplace = false
    this.replacePreview = null
    this.lastReplaceUndo = []
    this.includePattern = DEFAULT_INCLUDE_PATTERN
    this.excludePattern = DEFAULT_EXCLUDE_PATTERN
    this.matchCase = false
    this.matchWholeWord = false
    this.useRegex = false
    this.results = []
    this.groups = []
    this.totalMatches = 0
    this.fileMatches = 0
    this.scannedFiles = 0
    this.skippedFiles = 0
    this.warnings = []
    this.error = null
    this.loading = false
    this.longSearch = false
    this.visible = this.mode === 'side'
    this.truncated = false
    this.durationMs = 0
    this.expandedGroups = {}
    this.history = this.loadHistory()
    this.showHistory = false
    this.lastValidState = null
    this.searchTimer = null
    this.longSearchTimer = null
    this.searchRequestId = 0
    this.flashKey = ''
    this._view = null
  }

  render () {
    if (this._view) return this._view
    this._view = yo`
      <div class="${css.globalSearchPanel} ${this.mode === 'floating' ? css.floatingPanel : ''}" data-id="globalSearchPanel" style="display: ${this.visible ? 'flex' : 'none'}">
        ${this.renderHeader()}
        ${this.renderControls()}
        ${this.renderProgress()}
        ${this.renderMeta()}
        ${this.renderResultsArea()}
      </div>
    `
    return this._view
  }

  renderHeader () {
    return yo`
      <div class=${css.searchHeader}>
        <div class=${css.title}>SEARCH IN FILES</div>
        <div class=${css.actions}>
          <button class=${css.actionButton} title="Refresh" data-id="globalSearchRefresh" onclick=${() => this.runSearchNow()}>↻</button>
          <button class=${css.actionButton} title="Collapse" data-id="globalSearchClose" onclick=${() => this.hide()}>⌄</button>
        </div>
      </div>
    `
  }

  renderControls () {
    return yo`
      <div class=${css.searchControls}>
        <div class=${css.inputWrap}>
          <input class="form-control ${css.searchInput}" data-id="globalSearchInput" placeholder="Type to search" value=${this.query} onfocus=${() => this.onInputFocus()} onkeydown=${(event) => this.onInputKeydown(event)} oninput=${(event) => this.onQueryInput(event.target.value)} />
          <div class=${css.modifiers}>
            ${this.renderModifier('Aa', 'Match Case', 'matchCase')}
            ${this.renderModifier('ab', 'Match Whole Word', 'matchWholeWord', this.useRegex)}
            ${this.renderModifier('.*', 'Use Regular Expression', 'useRegex')}
          </div>
        </div>
        <div class=${css.replaceRow}>
          <button class="btn btn-sm btn-secondary" data-id="globalSearchToggleReplace" onclick=${() => this.toggleReplace()}>${this.showReplace ? 'Hide Replace' : 'Replace'}</button>
          ${this.showReplace ? yo`<input class="form-control ${css.replaceInput}" data-id="globalSearchReplaceInput" placeholder="Replace with" value=${this.replacement} oninput=${(event) => this.onReplacementInput(event.target.value)} />` : ''}
          ${this.showReplace ? yo`<button class="btn btn-sm btn-primary" data-id="globalSearchApplyReplace" disabled=${!this.replacePreview || !this.replacePreview.canApply} onclick=${() => this.applyReplace()}>Apply</button>` : ''}
          ${this.showReplace ? yo`<button class="btn btn-sm btn-secondary" data-id="globalSearchUndoReplace" disabled=${!this.lastReplaceUndo.length} onclick=${() => this.undoReplace()}>Undo</button>` : ''}
        </div>
        ${this.showReplace && this.replacePreview ? yo`<div class=${css.meta} data-id="globalSearchReplaceMeta">Replace preview: ${this.replacePreview.totalMatches} matches in ${this.replacePreview.fileMatches} files.</div>` : ''}
        ${this.error && this.error.type === 'regex' ? yo`<div class=${css.inlineError}>⚠ Regex error: ${this.error.message}</div>` : ''}
        ${this.renderHistory()}
        <div class=${css.filterBlock}>
          <label>Files to include</label>
          <input class="form-control ${css.filterInput}" data-id="globalSearchInclude" value=${this.includePattern} oninput=${(event) => this.onFilterInput('includePattern', event.target.value)} />
          ${this.error && this.error.type === 'glob' ? yo`<div class=${css.inlineError}>⚠ Invalid glob pattern</div>` : ''}
        </div>
        <div class=${css.filterBlock}>
          <label>Files to exclude</label>
          <input class="form-control ${css.filterInput}" data-id="globalSearchExclude" value=${this.excludePattern} oninput=${(event) => this.onFilterInput('excludePattern', event.target.value)} />
        </div>
      </div>
    `
  }

  renderModifier (label, title, prop, disabled) {
    const active = this[prop] && !disabled
    const classes = `${css.modifier} ${active ? css.modifierOn : ''} ${disabled ? css.modifierDisabled : ''}`
    if (disabled) {
      return yo`
        <button class=${classes} title=${title} aria-pressed=${active ? 'true' : 'false'} disabled onclick=${() => this.toggleModifier(prop)}>${label}</button>
      `
    }
    return yo`
      <button class=${classes} title=${title} aria-pressed=${active ? 'true' : 'false'} onclick=${() => this.toggleModifier(prop)}>${label}</button>
    `
  }

  renderHistory () {
    if (!this.showHistory || this.query.trim() || !this.history.length) return ''
    return yo`
      <div class=${css.history} data-id="globalSearchHistory">
        ${this.history.map((item) => yo`<button class=${css.historyRow} onclick=${() => this.useHistory(item)}>${item}</button>`)}
        <button class="${css.historyRow} ${css.historyClear}" onclick=${() => this.clearHistory()}>Clear search history</button>
      </div>
    `
  }

  renderProgress () {
    return this.loading ? yo`<div class=${css.progress}></div>` : yo`<div></div>`
  }

  renderMeta () {
    let message = 'Type a keyword to search across workspace files'
    if (this.loading) message = this.longSearch ? 'Still searching…' : 'Searching workspace files…'
    else if (this.error && this.error.type === 'network') message = 'Search failed. Please try again.'
    else if (this.query.trim()) message = `${this.totalMatches}${this.truncated ? '+' : ''} results in ${this.fileMatches}${this.truncated ? '+' : ''} files · ${this.durationMs || 0}ms${this.skippedFiles ? ` · skipped ${this.skippedFiles} files` : ''}`
    return yo`
      <div class=${css.meta} data-id="globalSearchMeta">
        ${message}
        ${this.longSearch ? yo`<button class="btn btn-sm btn-secondary ${css.retryButton}" onclick=${() => this.cancelSearch()}>Cancel</button>` : ''}
      </div>
    `
  }

  renderResultsArea () {
    return yo`
      <div class=${css.resultsWrap}>
        <div class="${css.results} ${this.loading && this.groups.length ? css.dimmed : ''}">
          ${this.renderStateOrResults()}
        </div>
      </div>
    `
  }

  renderStateOrResults () {
    if (!this.query.trim()) {
      return yo`<div class=${css.state}><div class=${css.stateTitle}>Type a keyword to search across workspace files</div><div>Shortcut: Ctrl/Cmd + Shift + F</div>${!this.history.length ? yo`<div style="margin-top:10px">First search — no history yet</div>` : ''}</div>`
    }
    if (this.error && this.error.type === 'network') {
      return yo`<div class=${css.state}><div class=${css.stateTitle}>Search failed. Please try again.</div><button class="btn btn-sm btn-primary" onclick=${() => this.runSearchNow()}>Retry</button></div>`
    }
    if (this.error && this.error.type === 'glob') {
      return yo`<div class=${css.state}><div class=${css.stateTitle}>Invalid glob pattern</div><div>Adjust Include / Exclude and search again.</div></div>`
    }
    if (this.groups.length) {
      return yo`<div>${this.groups.map((group) => this.renderGroup(group))}${this.renderWarnings()}</div>`
    }
    if (this.loading) {
      return yo`<div class=${css.state}><div class=${css.stateTitle}>Searching workspace files…</div><div>${this.history.length ? 'Previous results will remain while searching.' : 'First search — no history yet'}</div></div>`
    }
    if (this.scannedFiles === 0 && !this.error) {
      return yo`<div class=${css.state}><div class=${css.stateTitle}>No searchable files in current Workspace</div><button class="btn btn-sm btn-primary">Import project</button></div>`
    }
    return yo`<div class=${css.state}><div class=${css.stateTitle}>No results matched "${this.query}"</div><div>Try adjusting Include / Exclude, or turn off Match Case.</div></div>`
  }

  renderWarnings () {
    return yo`
      <div>
        ${this.truncated ? yo`<div class=${css.warning}>⚠ Results truncated to first <b>1,000</b> hits / <b>200</b> files. Narrow your search.</div>` : ''}
        ${this.warnings.map((warning) => yo`<div class=${css.warning}>${warning}</div>`)}
      </div>
    `
  }

  renderGroup (group) {
    const expanded = this.expandedGroups[group.path] !== false
    return yo`
      <div class=${css.fileGroup}>
        <button class=${css.fileHeader} onclick=${() => this.toggleGroup(group.path)}>
          <span>${expanded ? '▼' : '▶'}</span><span>📄</span><span class=${css.filePath}>${group.path}</span><span class=${css.count}>${group.matchCount}</span>
        </button>
        ${expanded ? yo`<div>${group.matches.map((result) => this.renderHit(result))}</div>` : ''}
      </div>
    `
  }

  renderHit (result) {
    const key = `${result.path}:${result.line}:${result.column}`
    return yo`
      <button class="${css.hit} ${this.flashKey === key ? css.hitFlash : ''}" data-id="globalSearchResultItem" onclick=${() => this.openResult(result)}>
        <span class=${css.lineNo}>L${result.line}</span>
        <span class=${css.preview}>${this.renderHighlightedPreview(result)}</span>
      </button>
    `
  }

  renderHighlightedPreview (result) {
    const preview = result.preview || ''
    const query = this.query.trim()
    if (!query) return preview
    // Highlight the specific occurrence this result was split from, using the
    // per-match offset computed at search time. Each match on the same line is
    // a separate result, so each must highlight its own match — not the first
    // occurrence found by indexOf, which would highlight match #1 for every row.
    const previewMatch = result.previewMatch
    let index
    let length
    if (previewMatch && previewMatch.length > 0) {
      index = previewMatch.start
      length = previewMatch.length
    } else {
      if (this.useRegex) return preview
      const haystack = this.matchCase ? preview : preview.toLowerCase()
      const needle = this.matchCase ? query : query.toLowerCase()
      index = haystack.indexOf(needle)
      length = query.length
    }
    if (index < 0 || index > preview.length) return preview
    return yo`<span>${preview.slice(0, index)}<span class=${css.highlight}>${preview.slice(index, index + length)}</span>${preview.slice(index + length)}</span>`
  }

  show () {
    this.visible = true
    this.render().style.display = 'flex'
    this.focusInput()
  }

  hide () {
    this.visible = false
    if (this.mode === 'floating') this.render().style.display = 'none'
    if (this.onClose) this.onClose()
  }

  toggle () {
    if (this.visible) this.hide()
    else this.show()
  }

  focusInput () {
    window.setTimeout(() => {
      const input = this.render().querySelector('[data-id="globalSearchInput"]')
      if (input) input.focus()
    }, 0)
  }

  onInputFocus () {
    this.showHistory = true
    this.update()
  }

  onInputKeydown (event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.runSearchNow()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (this.query) this.onQueryInput('')
      else if (this.editor && this.editor.focus) this.editor.focus()
    }
  }

  onQueryInput (query) {
    this.query = query
    this.showHistory = !query.trim()
    if (!query.trim()) {
      this.cancelSearch()
      this.updateState({ groups: [], results: [], totalMatches: 0, fileMatches: 0, scannedFiles: 0, skippedFiles: 0, warnings: [], error: null, loading: false, truncated: false })
      return
    }
    this.scheduleSearch()
  }

  onFilterInput (prop, value) {
    this[prop] = value
    if (this.query.trim()) this.scheduleSearch()
    else this.update()
  }

  toggleModifier (prop) {
    this[prop] = !this[prop]
    if (prop === 'useRegex' && this.useRegex) this.matchWholeWord = false
    if (this.query.trim()) this.runSearchNow()
    else this.update()
  }

  toggleReplace () {
    this.showReplace = !this.showReplace
    if (!this.showReplace) this.replacePreview = null
    if (this.showReplace && this.query.trim()) this.runSearchNow()
    else this.update()
  }

  onReplacementInput (replacement) {
    this.replacement = replacement
    if (this.showReplace && this.query.trim()) this.runSearchNow()
    else this.update()
  }

  toggleGroup (path) {
    this.expandedGroups[path] = this.expandedGroups[path] === false
    this.update()
  }

  scheduleSearch () {
    window.clearTimeout(this.searchTimer)
    this.searchTimer = window.setTimeout(() => this.runSearchNow(), 300)
    this.update()
  }

  async runSearchNow () {
    window.clearTimeout(this.searchTimer)
    const query = this.query.trim()
    if (!query) {
      this.updateState({ groups: [], results: [], totalMatches: 0, fileMatches: 0, scannedFiles: 0, warnings: [], error: null, loading: false, truncated: false })
      return
    }

    const requestId = ++this.searchRequestId
    this.longSearch = false
    this.updateState({ loading: true, error: null, warnings: [] })
    window.clearTimeout(this.longSearchTimer)
    this.longSearchTimer = window.setTimeout(() => {
      if (this.loading && requestId === this.searchRequestId) {
        this.longSearch = true
        this.update()
      }
    }, LONG_SEARCH_MS)

    try {
      const files = await this.collectWorkspaceFiles()
      if (requestId !== this.searchRequestId) return
      const searchResult = searchWorkspaceFiles(files, {
        query,
        includePattern: this.includePattern,
        excludePattern: this.excludePattern,
        matchCase: this.matchCase,
        matchWholeWord: this.matchWholeWord,
        useRegex: this.useRegex,
        limits: DEFAULT_LIMITS
      })
      if (requestId !== this.searchRequestId) return
      if (searchResult.error && searchResult.error.type === 'regex' && this.lastValidState) {
        this.restoreLastValidWithError(searchResult.error)
      } else {
        this.applySearchResult(searchResult)
      }
      if (this.showReplace) this.refreshReplacePreview(files, query)
      if (!searchResult.error) this.saveHistory(query)
    } catch (error) {
      if (requestId !== this.searchRequestId) return
      this.updateState({ error: { type: 'network', message: error.message || String(error) }, loading: false, longSearch: false })
    } finally {
      if (requestId === this.searchRequestId) window.clearTimeout(this.longSearchTimer)
    }
  }

  applySearchResult (searchResult) {
    const state = Object.assign({}, searchResult, { loading: false, longSearch: false })
    this.updateState(state)
    if (!searchResult.error) this.lastValidState = state
  }

  restoreLastValidWithError (error) {
    this.updateState(Object.assign({}, this.lastValidState, { error, loading: false, longSearch: false }))
  }

  cancelSearch () {
    window.clearTimeout(this.searchTimer)
    window.clearTimeout(this.longSearchTimer)
    this.searchRequestId++
    this.loading = false
    this.longSearch = false
    this.update()
  }

  updateState (state) {
    Object.assign(this, state)
    this.notifyStatus()
    this.update()
  }

  update () {
    if (!this._view) return
    yo.update(this._view.children[0], this.renderHeader())
    yo.update(this._view.children[1], this.renderControls())
    yo.update(this._view.children[2], this.renderProgress())
    yo.update(this._view.children[3], this.renderMeta())
    yo.update(this._view.children[4], this.renderResultsArea())
  }

  notifyStatus () {
    if (this.onStatusChanged) this.onStatusChanged(this.getBadge())
  }

  getBadge () {
    if (!this.query.trim() || !this.totalMatches) return ''
    if (this.truncated || this.fileMatches >= 200 || this.totalMatches >= 1000) return '200+'
    return String(this.totalMatches)
  }

  async collectWorkspaceFiles () {
    const files = []
    await this.collectFilesFromPath('', files)
    return files
  }

  refreshReplacePreview (files, query) {
    this.replacePreview = createWorkspaceReplacePreview(files, {
      query,
      includePattern: this.includePattern,
      excludePattern: this.excludePattern,
      matchCase: this.matchCase,
      matchWholeWord: this.matchWholeWord,
      useRegex: this.useRegex,
      limits: DEFAULT_LIMITS
    }, this.replacement)
    this.update()
  }

  async applyReplace () {
    if (!this.replacePreview || !this.replacePreview.canApply) return
    const updates = this.replacePreview.updates || []
    const ok = window.confirm(`Replace ${this.replacePreview.totalMatches} matches in ${updates.length} files?`)
    if (!ok) return
    const undo = updates.map((update) => ({ path: update.path, content: update.previousContent }))
    for (const update of updates) {
      await this.fileManager.writeFile(update.path, update.content)
    }
    this.lastReplaceUndo = undo
    await this.runSearchNow()
  }

  async undoReplace () {
    if (!this.lastReplaceUndo.length) return
    const undo = this.lastReplaceUndo.slice()
    for (const update of undo) {
      await this.fileManager.writeFile(update.path, update.content)
    }
    this.lastReplaceUndo = []
    await this.runSearchNow()
  }

  async collectFilesFromPath (dir, files) {
    if (files.length >= DEFAULT_LIMITS.maxFiles) return
    const entries = await this.fileManager.readdir(dir || '/')
    const names = Object.keys(entries || {}).sort()
    for (const name of names) {
      if (files.length >= DEFAULT_LIMITS.maxFiles) return
      const entry = entries[name]
      const path = entry.path || name
      if (entry.isDirectory) {
        await this.collectFilesFromPath(path, files)
      } else if (this.isSearchableFile(path)) {
        try {
          const content = await this.fileManager.readFile(path)
          files.push({ path, content })
        } catch (error) {
          this.skippedFiles++
          this.warnings.push(`Skipped ${path}: ${error.message || error}`)
        }
      }
    }
  }

  isSearchableFile (path) {
    return /\.(sol|js|ts|tsx|json|md|txt|yul|move|rs|py|css|html)$/i.test(path)
  }

  async openResult (result) {
    await this.fileManager.open(result.path)
    this.editor.gotoLine(result.line - 1, result.column)
    if (this.editor.focus) this.editor.focus()
    const key = `${result.path}:${result.line}:${result.column}`
    this.flashKey = key
    this.update()
    window.setTimeout(() => {
      if (this.flashKey === key) {
        this.flashKey = ''
        this.update()
      }
    }, 200)
  }

  useHistory (query) {
    this.query = query
    this.showHistory = false
    this.runSearchNow()
  }

  saveHistory (query) {
    this.history = [query].concat(this.history.filter((item) => item !== query)).slice(0, 5)
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)) } catch (error) { logGlobalSearchStorageError('save', error) }
  }

  loadHistory () {
    try {
      const history = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]')
      return Array.isArray(history) ? history.filter((item) => typeof item === 'string').slice(0, 5) : []
    } catch (error) {
      logGlobalSearchStorageError('load', error)
      return []
    }
  }

  clearHistory () {
    this.history = []
    try { window.localStorage.removeItem(HISTORY_KEY) } catch (error) { logGlobalSearchStorageError('clear', error) }
    this.update()
  }
}

module.exports = GlobalSearchPanel
