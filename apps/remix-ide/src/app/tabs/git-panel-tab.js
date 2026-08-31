/*
 * Copyright © 2026 TronIDE
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

import { ViewPlugin } from '@remixproject/engine-web'
import * as packageJson from '../../../../../package.json'
import * as githubAuth from '../../lib/github-auth'

const yo = require('yo-yo')
const csjs = require('csjs-inject')
const modalDialogCustom = require('../ui/modal-dialog-custom')
const { isStorageQuotaError } = require('../../lib/git-error-messages')
const lastWorkspace = require('../../lib/last-workspace')
const { normalizeGithubRemoteUrl, redactRemoteUrl } = require('../../lib/git-url-security')

// Every dGitProvider call routes through isomorphic-git over BrowserFS. A wedged
// op (a corrupt index, a stuck BrowserFS read) never settles, so the awaiting
// button hangs forever with no feedback — the same zombie-bridge shape the
// wallet adapter solves with its connect timeout. Bound each call against a
// timer that REJECTS so the caller's catch/finally always runs and the busy
// guard releases. Generous: a real slow op (large repo, big diff) must never be
// cut short — only a genuinely dead op trips it. Network ops (clone/pull/push/
// fetch of a real repository over the CORS proxy) legitimately run for minutes,
// so they get a much longer budget than local index ops. NOTE: the timer cannot
// CANCEL the underlying op — a timed-out operation may still complete in the
// background. Checkout/pull therefore keep their editor safety lock and tell
// the user to reload rather than pretending it is safe to resume writes.
const GIT_OP_TIMEOUT_MS = 60000
const GIT_NETWORK_OP_TIMEOUT_MS = 300000
const GIT_NETWORK_OPS = ['clone', 'fetchRemote', 'pullRemote', 'pushRemote']

function withTimeout (promise, ms, label) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error((label || 'Git operation') + ' timed out after ' + Math.round(ms / 1000) + 's')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const icon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23888" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 10.4c0 3-2.4 4.2-5.4 4.2H9"/></svg>'

const profile = {
  name: 'gitPanel',
  displayName: 'Git',
  methods: ['aiClone'],
  events: [],
  icon,
  description: 'Local Git version control for the current workspace.',
  // 'fileexplorer' groups the icon with the workspace tools; vertical-icons
  // only has a fixed set of kind buckets (no 'git' section) and would throw
  // on appendChild for an unknown kind.
  kind: 'fileexplorer',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version
}

const css = csjs`
  .container {
    color: var(--text);
    padding: 0 16px 20px;
  }
  .intro {
    border: 1px solid var(--light);
    border-left: 4px solid #C8302D;
    background: var(--body-bg);
    padding: 10px 12px;
    margin-bottom: 12px;
    line-height: 1.4;
    font-size: 0.85rem;
  }
  .section {
    margin-bottom: 16px;
  }
  .sectionTitle {
    font-weight: 600;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 0.82rem;
  }
  .statusCode {
    font-family: monospace;
    width: 22px;
    flex-shrink: 0;
  }
  .filePath {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .commitBox {
    width: 100%;
    margin-bottom: 6px;
  }
  .logEntry {
    border-left: 2px solid var(--secondary);
    padding: 2px 0 6px 8px;
    margin-bottom: 4px;
    font-size: 0.8rem;
  }
  .logMsg { font-weight: 500; }
  .logMeta { color: var(--text-info); font-size: 0.74rem; }
  .muted { color: var(--text-info); font-size: 0.82rem; }
  .remoteInput {
    width: 100%;
    margin-bottom: 6px;
    font-size: 0.82rem;
  }
  .btnRow {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .remoteUrl {
    font-family: monospace;
    font-size: 0.76rem;
    word-break: break-all;
    color: var(--text-info);
    margin-bottom: 6px;
  }
`

export class GitPanelTab extends ViewPlugin {
  constructor () {
    super(profile)
    this.el = null
    this._refreshGeneration = 0
    this.state = {
      // Every rendered row/button is a snapshot of this exact workspace. Keep
      // it blank until refresh publishes an identity-checked snapshot so a
      // delayed refresh from workspace A can never drive an action in B.
      workspaceIdentity: '',
      initialized: false,
      currentBranch: '',
      branches: [],
      localBranches: [],
      remoteBranches: [],
      hasHead: false,
      unstaged: [],
      staged: [],
      log: [],
      status: '',
      loading: true,
      busy: false,
      remotes: [],
      // Mirrors the commit-message textarea. The panel re-renders on every
      // status/busy change AND on the debounced reactive refresh (editor
      // autosave fires fileSaved every few seconds), and yo-yo's morphdom
      // resets an uncontrolled TEXTAREA to the template's value on each
      // update — without this mirror the user's half-typed message is wiped.
      commitMsg: ''
    }
  }

  // True when this tab has an opaque BFF session. Push/Pull/private-clone need
  // it; we only point users at the existing Connect GitHub flow rather than
  // reimplementing authentication here.
  _hasGithubToken () {
    try { return githubAuth.isConnected() } catch (e) { return false }
  }

  // The first remote's URL (origin if present), or '' if no remote configured.
  _remoteUrl () {
    if (!this.state.remotes.length) return ''
    const origin = this.state.remotes.find((r) => r.remote === 'origin')
    return redactRemoteUrl((origin || this.state.remotes[0]).url || '')
  }

  // Build a GitHub compare/PR URL for the current branch from an https/ssh
  // remote URL. Returns '' if it isn't a github.com remote.
  _prUrl () {
    const url = this._remoteUrl()
    const branch = this.state.currentBranch
    if (!url || !branch || !this.state.hasHead) return ''
    // match git@github.com:owner/repo(.git) or https://github.com/owner/repo(.git)
    const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
    if (!m) return ''
    return `https://github.com/${m[1]}/${m[2]}/compare/${encodeURIComponent(branch)}?expand=1`
  }

  // Single in-flight guard for write ops: disables the action buttons while a
  // call is live and ALWAYS releases in finally (even on error/timeout) so a
  // wedged op can never leave the panel permanently stuck. Returns false if an
  // op is already running so callers can bail without double-firing.
  async _runOp (label, fn) {
    if (this.state.busy) return false
    this.state.busy = true
    this.update()
    try {
      await fn()
      return true
    } catch (e) {
      this.setStatus(label + ' failed: ' + ((e && e.message) || e))
      return false
    } finally {
      this.state.busy = false
      this.update()
    }
  }

  _git (method, ...args) {
    const ms = GIT_NETWORK_OPS.includes(method) ? GIT_NETWORK_OP_TIMEOUT_MS : GIT_OP_TIMEOUT_MS
    return withTimeout(this.call('dGitProvider', method, ...args), ms, 'Git ' + method).catch((error) => {
      if ((method === 'checkout' || method === 'pullRemote') && /timed out/i.test(String((error && error.message) || error))) {
        error.message += ' The underlying operation cannot be cancelled safely; reload TronIDE if the editor remains protected.'
      }
      throw error
    })
  }

  render () {
    try {
      if (this.el) return this.el
      this.el = this.renderComponent()
      return this.el
    } catch (e) {
      console.error('[gitPanel] render failed:', e)
      this.el = yo`<div class="${css.container}">Git panel failed to render.</div>`
      return this.el
    }
  }

  onActivation () {
    // never let panel bootstrapping reject the activation chain
    setTimeout(() => { this.refresh().catch((e) => console.error('[gitPanel] refresh failed:', e)) }, 0)
    // Keep the panel reactive: it was previously only refreshed on activation /
    // after a git op, so an edit saved while the panel was open never showed as
    // dirty, and a workspace switch (incl. a freshly cloned one) showed stale
    // state. Refresh (debounced) on file saves, tree changes, and ws switches.
    const debouncedRefresh = () => {
      if (this._reactiveTimer) clearTimeout(this._reactiveTimer)
      this._reactiveTimer = setTimeout(() => { this.refresh().catch(() => {}) }, 500)
    }
    this.on('fileManager', 'fileSaved', debouncedRefresh)
    // Direct provider overwrites (for example File Explorer upload-overwrite)
    // emit fileChanged -> currentFileChanged rather than fileSaved.
    this.on('fileManager', 'currentFileChanged', debouncedRefresh)
    this.on('fileManager', 'fileAdded', debouncedRefresh)
    this.on('fileManager', 'fileRemoved', debouncedRefresh)
    this.on('fileManager', 'fileRenamed', debouncedRefresh)
    // Git mutations can change only the index or refs and therefore emit no
    // fileManager event. This also covers AI/direct provider calls while the
    // panel is already visible.
    this.on('dGitProvider', 'gitChanged', debouncedRefresh)
    this.on('filePanel', 'setWorkspace', () => {
      // The file-panel event and the provider switch are not atomic. Invalidate
      // the old snapshot immediately, then let the debounce read the new one.
      // Mutation handlers also compare their live context with this identity,
      // so there is no clickable stale-A -> mutate-B window.
      this._refreshGeneration++
      Object.assign(this.state, {
        workspaceIdentity: '',
        initialized: false,
        currentBranch: '',
        branches: [],
        localBranches: [],
        remoteBranches: [],
        hasHead: false,
        unstaged: [],
        staged: [],
        log: [],
        remotes: [],
        // Operation feedback belongs to the workspace where it was produced.
        // Keeping it while the panel already renders another repository makes
        // a stale failure look like a problem in the newly selected workspace.
        status: '',
        loading: true,
        commitMsg: ''
      })
      this.update()
      debouncedRefresh()
    })
  }

  update () {
    if (this.el) yo.update(this.el, this.renderComponent())
  }

  setStatus (msg) {
    this.state.status = msg
    this.update()
  }

  async refresh () {
    const generation = ++this._refreshGeneration
    let workspaceIdentity = ''
    try {
      workspaceIdentity = await this._git('workspaceIdentity')
      let branch = ''
      try {
        branch = await this._git('currentbranch')
      } catch (e) {
        branch = ''
      }
      const initialized = !!branch || await this._hasGit()
      if (!initialized) {
        await this._publishRefresh(generation, workspaceIdentity, {
          initialized: false,
          currentBranch: '',
          unstaged: [],
          staged: [],
          branches: [],
          localBranches: [],
          remoteBranches: [],
          hasHead: false,
          log: [],
          remotes: []
        })
        return
      }
      const currentBranch = branch || ''
      const hasHead = await this._git('resolveref', { ref: 'HEAD' }).then((oid) => !!oid).catch(() => false)
      const localBranches = await this._git('branches').catch(() => [])
      const remotes = await this._git('listRemotes').catch(() => [])
      const origin = remotes.find((remote) => remote.remote === 'origin')
      const remoteName = origin ? origin.remote : (remotes[0] && remotes[0].remote)
      const listedRemoteBranches = remoteName
        ? await this._git('branches', { remote: remoteName }).catch(() => [])
        : []
      const remoteBranches = listedRemoteBranches.filter((name) => name && name !== 'HEAD')
      const branches = [...new Set([...localBranches, ...remoteBranches])]
      const matrix = await this._git('status', {}).catch(() => [])
      const unstaged = []
      const staged = []
      // statusMatrix row: [filepath, head, workdir, stage]. Git semantics: the
      // file has a STAGED part iff index differs from HEAD, and an UNSTAGED
      // part iff workdir differs from index — a file staged and then edited
      // again ([1,2,3]) legitimately appears in BOTH lists (like real git
      // status), so the staged snapshot stays visible and committable.
      for (const row of matrix) {
        const [filepath, head, workdir, stage] = row
        if (head === 1 && workdir === 1 && stage === 1) continue // unmodified
        // Each column describes a different delta. In mixed states such as a
        // staged deletion followed by a recreated worktree file ([1,2,0]), the
        // staged side is D while the unstaged side is A — one shared badge
        // would misrepresent what the next commit actually records.
        if (stage !== head) staged.push({ filepath, code: this._statusCode(head, stage) })
        if (workdir !== stage) unstaged.push({ filepath, code: this._statusCode(stage, workdir) })
      }
      const log = await this._git('log', { depth: 12 }).catch(() => [])
      await this._publishRefresh(generation, workspaceIdentity, {
        initialized: true,
        currentBranch,
        hasHead,
        localBranches,
        remoteBranches,
        branches,
        remotes,
        unstaged,
        staged,
        log
      })
    } catch (e) {
      // A superseded refresh must not replace the status/state of the newer
      // workspace. If this is still current, retain the last safe snapshot;
      // mutation handlers remain bound to its workspace+branch identity.
      if (generation === this._refreshGeneration) {
        this.state.loading = false
        this.setStatus('Git refresh failed: ' + ((e && e.message) || e))
      }
    }
  }

  async _publishRefresh (generation, workspaceIdentity, snapshot) {
    if (generation !== this._refreshGeneration) return false
    let liveWorkspace
    try { liveWorkspace = await this._git('workspaceIdentity') } catch (e) { return false }
    if (generation !== this._refreshGeneration || liveWorkspace !== workspaceIdentity) return false
    Object.assign(this.state, snapshot, { workspaceIdentity, loading: false })
    this.update()
    return true
  }

  async _hasGit () {
    try {
      const files = await this._git('status', {})
      return Array.isArray(files)
    } catch (e) {
      return false
    }
  }

  _statusCode (from, to) {
    if (from === 0 && to !== 0) return 'A'
    if (from !== 0 && to === 0) return 'D'
    if (from !== to) return 'M'
    return '?'
  }

  _isDirtyRow (row) {
    const [, head, workdir, stage] = row
    return stage !== head || workdir !== stage
  }

  async _gitMutationContext () {
    const workspace = await this._git('workspaceIdentity')
    let branch = ''
    try {
      const current = await this._git('currentbranch', {})
      branch = (current && current.name) || (typeof current === 'string' ? current : '')
    } catch (e) { branch = '' }
    let remotes = []
    try { remotes = await this._git('listRemotes') || [] } catch (e) { remotes = [] }
    const remote = remotes.find((entry) => entry && entry.remote === 'origin') || remotes[0]
    return {
      workspace,
      branch,
      remote: remote && remote.remote && remote.url
        ? { name: remote.remote, url: redactRemoteUrl(remote.url) }
        : null
    }
  }

  _withGitContext (cmd, context) {
    return { ...cmd, expectedWorkspace: context.workspace, expectedBranch: context.branch }
  }

  _withGitRemoteContext (cmd, context) {
    return { ...this._withGitContext(cmd, context), expectedRemote: context.remote }
  }

  _requireRenderedGitContext (context, action) {
    const renderedBranch = this.state.currentBranch || ''
    if (context && this.state.workspaceIdentity &&
      context.workspace === this.state.workspaceIdentity &&
      context.branch === renderedBranch) return true

    this.setStatus(`Workspace or branch changed before ${action}. Git was refreshed; nothing was changed.`)
    this.refresh().catch(() => {})
    return false
  }

  async _requireCleanWorktree (action) {
    let matrix
    try {
      await this.call('fileManager', 'saveCurrentFileChecked')
      matrix = await this._git('status', {})
    } catch (e) {
      this.setStatus('Could not verify that the working tree is clean. ' + action + ' cancelled; retry after refreshing Git.')
      return false
    }
    if (matrix.some((row) => this._isDirtyRow(row))) {
      this.setStatus('Commit or discard all changes before ' + action.toLowerCase() + '. Staging alone does not protect changes during this operation.')
      return false
    }
    return true
  }

  async _stageStatusRow (row, context) {
    const [filepath, , workdir, stage] = row
    if (!filepath || workdir === stage) return
    // `git.add` cannot stage a missing worktree path. Removing the index entry
    // is how Git records both a tracked deletion ([1,0,1]) and a staged-new
    // file that was deleted again ([0,0,3]).
    await this._git(workdir === 0 && stage !== 0 ? 'rm' : 'add', this._withGitContext({ filepath }, context))
  }

  async doInit () {
    this.setStatus('Initializing repository…')
    await this._runOp('Init', async () => {
      const context = await this._gitMutationContext().catch(() => null)
      if (!this._requireRenderedGitContext(context, 'initializing')) return
      await this._git('init', context ? this._withGitContext({}, context) : {})
      this.setStatus('Repository initialized.')
      await this.refresh()
    })
  }

  async stage (filepath) {
    await this._runOp('Stage', async () => {
      try {
        const context = await this._gitMutationContext()
        if (!this._requireRenderedGitContext(context, 'staging')) return
        // Ace saves on a debounce. Flush and verify the active buffer first so
        // an immediate Stage click cannot put the previous on-disk version in
        // the index and report a false success.
        await this.call('fileManager', 'saveCurrentFileChecked')
        const matrix = await this._git('status', {})
        const row = matrix.find((entry) => entry[0] === filepath)
        if (row) await this._stageStatusRow(row, context)
      } finally {
        // A raced file change or a failed index update may still have changed
        // status. Never leave the panel showing the pre-click snapshot.
        await this.refresh()
      }
    })
  }

  async unstage (filepath) {
    await this._runOp('Unstage', async () => {
      const context = await this._gitMutationContext()
      if (!this._requireRenderedGitContext(context, 'unstaging')) return
      // resetIndex puts the file's INDEX entry back to HEAD (removes it for a
      // newly-added file) — real unstage semantics. `rm` (git.remove) would
      // delete the index entry even for a tracked modified file, silently
      // staging a DELETION that a later commit+push publishes. Do NOT swallow
      // the error — a failed unstage that silently "refreshes" looks
      // successful to the user; let it propagate so _runOp surfaces it.
      await this._git('resetIndex', this._withGitContext({ filepath }, context))
      await this.refresh()
    })
  }

  async stageAll () {
    await this._runOp('Stage all', async () => {
      try {
        const context = await this._gitMutationContext()
        if (!this._requireRenderedGitContext(context, 'staging')) return
        await this.call('fileManager', 'saveCurrentFileChecked')
        // Use one LIVE matrix rather than cached rows: saves/deletes can land
        // between a render and this click. Only workdir-vs-index changes belong
        // in Stage all; clean and already-staged rows are left untouched.
        const matrix = await this._git('status', {})
        for (const row of matrix.filter((entry) => entry[2] !== entry[3])) {
          await this._stageStatusRow(row, context)
        }
      } finally {
        await this.refresh()
      }
    })
  }

  async doCommit () {
    const box = this.el && this.el.querySelector('[data-id="gitCommitMessage"]')
    const message = ((box && box.value) || this.state.commitMsg || '').trim()
    if (!message) return this.setStatus('Enter a commit message first.')
    await this._runOp('Commit', async () => {
      const context = await this._gitMutationContext()
      if (!this._requireRenderedGitContext(context, 'committing')) return
      if (!this.state.staged.length) return this.setStatus('Stage at least one change before committing.')
      // isomorphic-git requires an author; dGitProvider.getGitConfig supplies
      // only fs+dir, so provide a sensible default here.
      const sha = await this._git('commit', this._withGitContext({
        message,
        author: { name: 'TronIDE', email: 'tronide@localhost' }
      }, context))
      // Verify a commit object was actually created before reporting success.
      if (!sha) throw new Error('no commit was created (see the browser console for the underlying git error)')
      this.state.commitMsg = ''
      this.setStatus('Committed: ' + message)
      await this.refresh()
    })
  }

  async createBranch () {
    if (!this.state.hasHead) return this.setStatus('Create the first commit or check out a remote branch before creating another branch.')
    let context
    try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Branch creation cancelled.') }
    if (!this._requireRenderedGitContext(context, 'branch creation')) return
    modalDialogCustom.prompt('New branch', 'Branch name', '', async (name) => {
      if (!name || !name.trim()) return
      await this._runOp('Branch', async () => {
        // isomorphic-git's standalone checkout rewrites the worktree from the
        // index and can silently erase staged changes. Creating+checking out a
        // ref in one branch operation only moves symbolic HEAD and safely keeps
        // the current index/worktree, matching `git switch -c`.
        await this._git('branch', this._withGitContext({ ref: name.trim(), checkout: true }, context))
        this.setStatus('Created and switched to ' + name.trim())
        await this.refresh()
      })
    })
  }

  async switchBranch (ref) {
    if (!ref || (ref === this.state.currentBranch && this.state.hasHead)) return
    let context
    try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Branch switch cancelled.') }
    if (!this._requireRenderedGitContext(context, 'switching branches')) return
    // Do not offer a dangerous "continue anyway" path. isomorphic-git 1.36
    // protects some unstaged edits, but silently overwrites staged changes and
    // unstaged deletions during checkout. With no stash UI, clean-only is the
    // only data-safe branch-switch policy.
    if (!await this._requireCleanWorktree('Switch branch')) return
    const doSwitch = async () => {
      const ok = await this._runOp('Checkout', async () => {
        await this._git('checkout', this._withGitContext({ ref }, context))
        this.setStatus('Switched to ' + ref)
        await this.refresh()
      })
      // re-sync the panel after a failed/timed-out checkout so the branch
      // select reflects the real (unchanged) HEAD rather than the picked option
      if (!ok) await this.refresh().catch(() => {})
    }
    await doSwitch()
  }

  // --- Remote (GitHub) operations -------------------------------------------
  // All route through _git() so the timeout + busy guard apply, and surface
  // failures via setStatus rather than hanging silently.

  _repoNameFromUrl (url) {
    const base = String(url).trim().replace(/\.git$/i, '').replace(/\/+$/, '').split('/').pop() || 'cloned-repo'
    return base.replace(/[^A-Za-z0-9_-]/g, '-') || 'cloned-repo'
  }

  async _uniqueWorkspaceName (base) {
    let list = []
    try { list = await this.call('filePanel', 'getWorkspaces') } catch (e) { list = [] }
    const names = (Array.isArray(list) ? list : []).map((w) => (w && (w.name || w)) || '')
    if (!names.includes(base)) return base
    let i = 2
    while (names.includes(`${base}-${i}`)) i++
    return `${base}-${i}`
  }

  // Validate a clone URL (https only). Returns the trimmed url or throws with a
  // user-facing message — shared by the UI and the AI tool.
  _validateCloneUrl (raw) {
    try { return normalizeGithubRemoteUrl(String(raw || '')) } catch (e) {
      if (!String(raw || '').trim()) throw new Error('Enter a repository URL to clone.')
      throw e
    }
  }

  // Core clone: create a fresh empty workspace, clone into it, and roll back
  // to the previous workspace on failure. Returns the new workspace name, or
  // throws with an actionable message. Shared by doClone (UI) and aiClone.
  async _cloneUrl (url) {
    const isPrivateHint = !this._hasGithubToken()
    // Remix auto-git-inits every workspace, so we can't clone into the current
    // (non-empty, already-initialized) one. Mirror upstream Remix: clone into a
    // fresh EMPTY workspace — createWorkspace(name, false) seeds no files — and
    // switch to it, then clone into that now-current dir.
    let previous = null
    try { previous = await this.call('filePanel', 'getCurrentWorkspace') } catch (e) { previous = null }
    const name = await this._uniqueWorkspaceName(this._repoNameFromUrl(url))
    this.setStatus(`Cloning ${url} into workspace "${name}"…${isPrivateHint ? ' (private repos need "Connect to GitHub" first)' : ''}`)
    // The clone target is PROVISIONAL until the clone succeeds: mute the
    // restore-on-boot stamp that createWorkspace->setWorkspace would write,
    // so a tab closed mid-clone (network clones may run for minutes) or a
    // failed clone can never make the half-created workspace the boot
    // target — regardless of whether the catch below ever runs.
    await lastWorkspace.suspendWhile(() => this.call('filePanel', 'createWorkspace', name, false))
    let targetWorkspace = ''
    try {
      // Shallow objects, but keep every remote branch ref (dGitProvider.clone).
      const context = await this._gitMutationContext()
      targetWorkspace = context.workspace
      await this._git('clone', this._withGitContext({ url }, context))
    } catch (e) {
      // Don't leave the user stranded in the workspace the failed clone
      // created. setWorkspace only drives the REAL (component) switch with
      // syncComponent=true — the bare call is plugin bookkeeping and left
      // the user stuck while the status claimed "switched back". Verify the
      // switch actually took before claiming it in the message.
      let restored = false
      let targetStillActive = false
      try {
        const current = await this.call('filePanel', 'getCurrentWorkspace')
        targetStillActive = !!(current && current.name === name && (!targetWorkspace || current.absolutePath === targetWorkspace))
      } catch (e0) { targetStillActive = false }
      if (targetStillActive && previous && previous.name) {
        for (let attempt = 0; attempt < 3 && !restored; attempt++) {
          try { await this.call('filePanel', 'setWorkspace', previous.name, true, true) } catch (e2) { /* verify below, retry */ }
          await new Promise((resolve) => setTimeout(resolve, 700))
          try {
            const cur = await this.call('filePanel', 'getCurrentWorkspace')
            restored = !!(cur && cur.name === previous.name)
          } catch (e3) { restored = false }
        }
        // No marker repair needed here: the createWorkspace stamp was muted
        // above, so the boot marker never left the previous workspace. The
        // switch-back (when it lands) re-stamps it through setWorkspace.
      }
      const raw = String((e && e.message) || e)
      // a raw QuotaExceededError reads like gibberish; say what actually
      // happened and what to do about it — but ONLY for a real storage
      // quota (see git-error-messages): a server-side error mentioning
      // "quota" must not advise the user to delete their workspaces
      const quota = isStorageQuotaError(e, raw)
        ? 'Browser storage is full — this repository does not fit in the workspace store (~5MB per site; binary files inflate further). Delete unused workspaces or clone a smaller repository. Details: '
        : ''
      throw new Error(quota + raw + (restored
        ? ` — switched back to your previous workspace; the empty workspace "${name}" can be deleted from the workspace list.`
        : ` — could not switch back automatically: pick your workspace from the list and delete the empty "${name}".`))
    }
    // Only now may the clone workspace own the restore-on-boot marker (its
    // creation-time stamp was muted while the clone outcome was unknown). A
    // user can switch workspaces while the network request is in flight; never
    // force that choice back to the clone when it completes in the background.
    let targetStillActive = false
    try {
      const current = await this.call('filePanel', 'getCurrentWorkspace')
      targetStillActive = !!(current && current.name === name)
    } catch (e) { targetStillActive = false }
    if (targetStillActive) {
      lastWorkspace.set(name)
      this.setStatus(`Cloned ${url} into "${name}"`)
    } else {
      this.setStatus(`Cloned ${url} into workspace "${name}"; your current workspace was left unchanged.`)
    }
    await this.refresh()
    return name
  }

  async doClone () {
    const input = this.el && this.el.querySelector('[data-id="gitCloneUrl"]')
    let url
    // Validate the URL BEFORE creating any workspace: a typo must not strand
    // the user in a junk empty workspace.
    try { url = this._validateCloneUrl(input ? input.value : '') } catch (e) { return this.setStatus((e && e.message) || String(e)) }
    await this._runOp('Clone', async () => { await this._cloneUrl(url) })
  }

  // Programmatic clone for the AI assistant. Validates the URL, then runs the
  // same workspace-create → clone → rollback flow as the panel button.
  async aiClone ({ url } = {}) {
    let clean
    try { clean = this._validateCloneUrl(url) } catch (e) { return { ok: false, message: (e && e.message) || String(e) } }
    if (this.state.busy) return { ok: false, message: 'A git operation is already running — wait for it to finish.' }
    this.state.busy = true
    this.update()
    try {
      const name = await this._cloneUrl(clean)
      return { ok: true, workspace: name }
    } catch (e) {
      return { ok: false, message: (e && e.message) || String(e) }
    } finally {
      this.state.busy = false
      this.update()
    }
  }

  async doAddRemote () {
    const input = this.el && this.el.querySelector('[data-id="gitAddRemoteUrl"]')
    let url
    try { url = normalizeGithubRemoteUrl(input ? input.value : '') } catch (e) { return this.setStatus((e && e.message) || String(e)) }
    let context
    try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Add remote cancelled.') }
    if (!this._requireRenderedGitContext(context, 'adding a remote')) return
    await this._runOp('Add remote', async () => {
      await this._git('addRemote', this._withGitContext({ name: 'origin', url }, context))
      this.setStatus('Remote "origin" added. Fetching branches…')
      let fetchError = null
      try {
        const remoteContext = await this._gitMutationContext()
        await this._git('fetchRemote', this._withGitRemoteContext({ remote: 'origin' }, remoteContext))
      } catch (e) {
        fetchError = e
      }
      await this.refresh()
      if (fetchError) {
        this.setStatus('Remote "origin" added, but fetching branches failed: ' + ((fetchError && fetchError.message) || fetchError) + '. Use Fetch to retry.')
      } else {
        this.setStatus('Remote "origin" added and branches fetched.')
      }
    })
  }

  async doFetch () {
    let context
    try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Fetch cancelled.') }
    if (!this._requireRenderedGitContext(context, 'fetching')) return
    await this._runOp('Fetch', async () => {
      await this._git('fetchRemote', this._withGitRemoteContext({ remote: 'origin' }, context))
      this.setStatus('Fetched all branches from remote.')
      await this.refresh()
    })
  }

  async doPull () {
    if (!this.state.hasHead) return this.setStatus('Check out a remote branch or create the first commit before pulling.')
    if (!this._hasGithubToken()) return this.setStatus('Connect to GitHub first (use the "Connect to GitHub" button) to pull.')
    let context
    try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Pull cancelled.') }
    if (!this._requireRenderedGitContext(context, 'pulling')) return
    if (!await this._requireCleanWorktree('Pull')) return
    await this._runOp('Pull', async () => {
      await this._git('pullRemote', this._withGitRemoteContext({ branch: context.branch }, context))
      this.setStatus('Pulled from remote.')
      await this.refresh()
    })
  }

  async doPush (force, branch = null, approvedContext = null) {
    if (!this.state.hasHead) return this.setStatus('Check out a remote branch or create the first commit before pushing.')
    if (!this._hasGithubToken()) return this.setStatus('Connect to GitHub first (use the "Connect to GitHub" button) to push.')
    let context = approvedContext
    if (!context) {
      try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Push cancelled.') }
    }
    if (!this._requireRenderedGitContext(context, 'pushing')) return
    const targetBranch = branch || context.branch
    await this._runOp('Push', async () => {
      await this._git('pushRemote', this._withGitRemoteContext({ branch: targetBranch, force: !!force }, context))
      this.setStatus('Pushed ' + targetBranch + ' to remote.')
      await this.refresh()
    })
  }

  async confirmForcePush () {
    if (!this.state.hasHead) return this.setStatus('Check out a remote branch or create the first commit before force pushing.')
    let context
    try { context = await this._gitMutationContext() } catch (e) { return this.setStatus('Could not identify the Git workspace. Force push cancelled.') }
    if (!this._requireRenderedGitContext(context, 'force pushing')) return
    const branch = context.branch
    const branchLabel = branch || 'current branch'
    const remoteUrl = this._remoteUrl()
    modalDialogCustom.confirm(
      'Force push "' + branchLabel + '"?',
      'Force pushing can overwrite commits on the remote and disrupt collaborators. This action cannot be undone from TronIDE. Continue?',
      () => {
        // Approval is for this exact branch/remote pair. An async refresh or
        // branch switch while the modal is open must not redirect a destructive
        // force push to a target the user never approved.
        if (this.state.currentBranch !== branch || this._remoteUrl() !== remoteUrl) {
          return this.setStatus('Branch or remote changed while force-push confirmation was open. Force push cancelled.')
        }
        return this.doPush(true, branch, context)
      },
      () => {}
    )
  }

  openPR () {
    const url = this._prUrl()
    if (!url) return this.setStatus('No GitHub remote configured for a pull request.')
    try { window.open(url, '_blank', 'noopener') } catch (e) { this.setStatus('Could not open PR page: ' + ((e && e.message) || e)) }
  }

  renderRemoteSection () {
    const s = this.state
    const remoteUrl = this._remoteUrl()
    const connected = this._hasGithubToken()
    const prUrl = this._prUrl()
    const needsHead = !s.hasHead
    const syncDisabled = s.busy || needsHead
    return yo`
      <div class="${css.section}" data-id="gitRemoteSection">
        <div class="${css.sectionTitle}"><span>Remote</span></div>
        ${!connected ? yo`<div class="${css.muted}" data-id="gitRemoteAuthHint">Not connected to GitHub. Use the "Connect to GitHub" button on the Home tab for push/pull or private clone.</div>` : ''}
        ${remoteUrl
          ? yo`
            <div class="${css.remoteUrl}" data-id="gitRemoteUrl" title="${remoteUrl}">${remoteUrl}</div>
            <div class="${css.btnRow}">
              <button class="btn btn-sm btn-primary py-0" data-id="gitPush" ${syncDisabled ? 'disabled' : ''} title="${needsHead ? 'Check out a branch or create the first commit before pushing.' : ''}" onclick=${() => this.doPush(false)}>Push</button>
              <button class="btn btn-sm btn-outline-secondary py-0" data-id="gitPull" ${syncDisabled ? 'disabled' : ''} title="${needsHead ? 'Check out a branch or create the first commit before pulling.' : ''}" onclick=${() => this.doPull()}>Pull</button>
              <button class="btn btn-sm btn-outline-secondary py-0" data-id="gitFetch" ${s.busy ? 'disabled' : ''} onclick=${() => this.doFetch()}>Fetch</button>
              <button class="btn btn-sm btn-outline-warning py-0" data-id="gitForcePush" ${syncDisabled ? 'disabled' : ''} title="${needsHead ? 'Check out a branch or create the first commit before force pushing.' : ''}" onclick=${() => this.confirmForcePush()}>Force push</button>
              ${prUrl ? yo`<a class="btn btn-sm btn-link py-0" data-id="gitOpenPR" href="${prUrl}" target="_blank" rel="noopener">Open PR</a>` : ''}
            </div>`
          : yo`
            <div class="${css.muted}" data-id="gitNoRemote">No remote configured. Add one to push/pull, or clone a repository.</div>
            <input class="form-control ${css.remoteInput}" type="text" placeholder="https://github.com/owner/repo.git" data-id="gitAddRemoteUrl" />
            <div class="${css.btnRow}">
              <button class="btn btn-sm btn-outline-primary py-0" data-id="gitAddRemote" ${s.busy ? 'disabled' : ''} onclick=${() => this.doAddRemote()}>Add remote</button>
            </div>`}
      </div>`
  }

  renderComponent () {
    const s = this.state

    if (!s.initialized) {
      return yo`
        <div class="${css.container}" data-id="gitPanel">
          <div class="${css.intro}">Local Git for this workspace, plus Clone / Push / Pull with a remote GitHub repository. Track changes, commit, switch branches, and sync — in the browser.</div>
          ${this.renderCloneSection()}
          <button class="btn btn-sm btn-outline-secondary" data-id="gitInit" ${s.busy || s.loading ? 'disabled' : ''} onclick=${() => this.doInit()}>${s.busy ? 'Working…' : (s.loading ? 'Loading Git…' : 'Initialize empty Git repository')}</button>
          ${s.status ? yo`<div class="${css.muted} mt-2" data-id="gitStatus">${s.status}</div>` : ''}
        </div>`
    }

    return this.renderInitialized()
  }

  // Clone is reachable in BOTH states: every Remix workspace is auto-git-inited,
  // so a "clone only when uninitialized" affordance would never appear. Cloning
  // always targets a fresh workspace (see doClone), so it is safe to offer here.
  renderCloneSection () {
    const s = this.state
    const cloneConnected = this._hasGithubToken()
    return yo`
      <div class="${css.section}">
        <div class="${css.sectionTitle}"><span>Clone a repository</span></div>
        <input class="form-control ${css.remoteInput}" type="text" placeholder="https://github.com/owner/repo.git" data-id="gitCloneUrl" />
        ${!cloneConnected ? yo`<div class="${css.muted}" data-id="gitCloneAuthHint">Clones into a new workspace. Public repos clone as-is; for private repos, use "Connect to GitHub" on the Home tab first.</div>` : ''}
        <div class="${css.btnRow}">
          <button class="btn btn-sm btn-primary" data-id="gitClone" ${s.busy || s.loading ? 'disabled' : ''} onclick=${() => this.doClone()}>${s.busy ? 'Working…' : (s.loading ? 'Loading…' : 'Clone')}</button>
        </div>
      </div>`
  }

  renderInitialized () {
    const s = this.state
    const branchPlaceholder = s.remoteBranches.length ? 'Select a remote branch…' : 'No branches yet'

    const fileRow = (f, action, actionLabel, actionId) => yo`
      <div class="${css.row}" data-id="gitFileRow">
        <span class="${css.statusCode} badge badge-secondary">${f.code}</span>
        <span class="${css.filePath}" title="${f.filepath}">${f.filepath}</span>
        <button class="btn btn-sm btn-link p-0" data-id="${actionId}" ${s.busy ? 'disabled' : ''} onclick=${() => action(f.filepath)}>${actionLabel}</button>
      </div>`

    return yo`
      <div class="${css.container}" data-id="gitPanel">
        <div class="${css.section}">
          <div class="${css.sectionTitle}">
            <span>Branch</span>
            <button class="btn btn-sm btn-outline-secondary py-0" data-id="gitNewBranch" ${s.busy || !s.hasHead ? 'disabled' : ''} title="${!s.hasHead ? 'Create the first commit or check out a remote branch first.' : ''}" onclick=${() => this.createBranch()}>+ New</button>
          </div>
          <select class="form-control custom-select" data-id="gitBranchSelect" ${s.busy || !s.branches.length ? 'disabled' : ''} onchange=${(e) => this.switchBranch(e.target.value)}>
            ${!s.hasHead ? yo`<option value="" selected disabled>${branchPlaceholder}</option>` : ''}
            ${s.branches.map((b) => yo`<option value="${b}" ${s.hasHead && b === s.currentBranch ? 'selected' : ''}>${b}</option>`)}
          </select>
          ${!s.hasHead ? yo`<div class="${css.muted} mt-1" data-id="gitBranchHint">${s.remoteBranches.length ? 'Select a remote branch to check it out.' : 'Create the first commit before creating another branch.'}</div>` : ''}
        </div>

        ${this.renderRemoteSection()}

        ${this.renderCloneSection()}

        <div class="${css.section}">
          <div class="${css.sectionTitle}">
            <span>Changes (${s.unstaged.length})</span>
            ${s.unstaged.length ? yo`<button class="btn btn-sm btn-link p-0" data-id="gitStageAll" ${s.busy ? 'disabled' : ''} onclick=${() => this.stageAll()}>Stage all</button>` : ''}
          </div>
          ${s.unstaged.length ? s.unstaged.map((f) => fileRow(f, (p) => this.stage(p), 'Stage', 'gitStageFile')) : yo`<div class="${css.muted}">No unstaged changes.</div>`}
        </div>

        <div class="${css.section}">
          <div class="${css.sectionTitle}"><span>Staged (${s.staged.length})</span></div>
          ${s.staged.length ? s.staged.map((f) => fileRow(f, (p) => this.unstage(p), 'Unstage', 'gitUnstageFile')) : yo`<div class="${css.muted}">Nothing staged.</div>`}
          <textarea class="form-control ${css.commitBox} mt-2" rows="2" placeholder="Commit message" data-id="gitCommitMessage" oninput=${(e) => { this.state.commitMsg = e.target.value }}>${s.commitMsg || ''}</textarea>
          <button class="btn btn-sm btn-primary" data-id="gitCommit" ${s.busy ? 'disabled' : ''} onclick=${() => this.doCommit()}>${s.busy ? 'Working…' : 'Commit'}</button>
        </div>

        <div class="${css.section}">
          <div class="${css.sectionTitle}"><span>History</span></div>
          ${s.log.length ? s.log.map((c) => yo`
            <div class="${css.logEntry}" data-id="gitLogEntry">
              <div class="${css.logMsg}">${(c.commit && c.commit.message ? c.commit.message : '').trim() || '(no message)'}</div>
              <div class="${css.logMeta}">${(c.oid || '').slice(0, 7)} · ${c.commit && c.commit.author ? c.commit.author.name : ''}</div>
            </div>`) : yo`<div class="${css.muted}">No commits yet.</div>`}
        </div>

        ${s.busy ? yo`<div class="${css.muted}" data-id="gitBusy">Git operation in progress…</div>` : ''}
        ${s.status ? yo`<div class="${css.muted}" data-id="gitStatus">${s.status}</div>` : ''}
      </div>`
  }
}
