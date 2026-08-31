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

// Register before anything else so injected wallet extensions (MetaMask, …)
// that throw their own uncaught errors don't surface in the runtime-error
// overlay and get filed as IDE bugs. See suppress-extension-errors.js.
const { installExtensionErrorSuppressor } = require('./lib/suppress-extension-errors')
const { isReleaseNotesPage } = require('./lib/release-notes-link')
const { bootstrapWorkspaceStorage } = require('./lib/workspace-storage/bootstrap')
installExtensionErrorSuppressor(window)

function setInitialStatus (message, isError = false) {
  const splash = document.getElementById('tronide-initial-splash')
  const status = document.getElementById('tronide-initial-status')
  if (status) status.textContent = message
  if (splash) splash.classList.toggle('tronide-splash-error', isError)
}

function showStorageStartupError (error) {
  const splash = document.getElementById('tronide-initial-splash')
  const detail = error && error.code === 'TRONIDE_WORKSPACE_ALREADY_OPEN'
    ? 'TRON IDE is already open in another tab. Close that tab, then retry.'
    : 'TRON IDE could not open its local workspace safely. Your previous browser data was not deleted.'
  setInitialStatus(detail, true)
  if (!splash || splash.querySelector('[data-id="workspaceStorageRetry"]')) return
  const actions = document.createElement('div')
  actions.className = 'tronide-splash-actions'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.dataset.id = 'workspaceStorageRetry'
  retry.textContent = 'Retry'
  retry.addEventListener('click', () => window.location.reload())
  actions.appendChild(retry)
  splash.appendChild(actions)
}

function installUnloadProtection (storageService) {
  if (!storageService) return
  window.addEventListener('beforeunload', (event) => {
    if (!storageService.shouldWarnBeforeUnload()) return
    event.preventDefault()
    event.returnValue = ''
  })
}

function installRuntimeStorageStatus (storageService) {
  if (!storageService || document.getElementById('tronide-workspace-storage-status')) return
  const container = document.createElement('div')
  container.id = 'tronide-workspace-storage-status'
  container.className = 'tronide-storage-status'
  container.hidden = true
  container.setAttribute('role', 'status')
  container.setAttribute('aria-live', 'polite')

  const message = document.createElement('span')
  message.dataset.id = 'workspaceStorageStatusMessage'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.dataset.id = 'workspaceStorageStatusRetry'
  retry.textContent = 'Retry local save'
  retry.hidden = true
  const protect = document.createElement('button')
  protect.type = 'button'
  protect.dataset.id = 'workspaceStoragePersist'
  protect.textContent = 'Protect local workspaces'
  protect.hidden = true
  container.append(message, retry, protect)
  document.body.appendChild(container)

  let hideTimer
  let observedSaving = false
  const show = (text, state, { retryable = false, protectable = false, hideAfter = 0 } = {}) => {
    window.clearTimeout(hideTimer)
    message.textContent = text
    container.dataset.state = state
    container.hidden = false
    retry.hidden = !retryable
    protect.hidden = !protectable
    if (hideAfter) hideTimer = window.setTimeout(() => { container.hidden = true }, hideAfter)
  }

  retry.addEventListener('click', async () => {
    retry.disabled = true
    show('Retrying local save…', 'saving')
    try {
      await storageService.retry()
    } catch (error) {
      show('Local save failed. Editing is paused to protect your files.', 'failed', { retryable: true })
    } finally {
      retry.disabled = false
    }
  })

  protect.addEventListener('click', async () => {
    protect.disabled = true
    try {
      const granted = await storageService.requestPersistentStorage()
      show(granted
        ? 'Browser storage protection enabled.'
        : 'Storage protection was not granted. Export important workspaces regularly.', granted ? 'saved' : 'warning', { hideAfter: 6000 })
    } catch (error) {
      show('Storage protection was not granted. Export important workspaces regularly.', 'warning', { hideAfter: 6000 })
    } finally {
      protect.disabled = false
    }
  })

  if (storageService.mode === 'legacy-localstorage' && storageService.fallbackError) {
    show('Using legacy browser storage because the workspace upgrade failed. Your existing files were left unchanged.', 'warning')
    return
  }

  storageService.subscribe((status) => {
    if (status.state === 'saving') {
      observedSaving = true
      show('Saving locally…', 'saving')
    } else if (status.state === 'failed') {
      show('Local save failed. Editing is paused to protect your files.', 'failed', { retryable: true })
    } else if (observedSaving) {
      observedSaving = false
      show('Saved locally.', 'saved', { hideAfter: 1800 })
    }
  })

  // Persistent storage must be requested from a user gesture. Offer a small,
  // time-limited action rather than triggering a browser permission flow while
  // the workbench is loading.
  Promise.resolve(storageService.isPersistentStorage()).then((persistent) => {
    if (!persistent && storageService.getStatus().state === 'idle') {
      show('Workspaces are saved in this browser.', 'info', { protectable: true, hideAfter: 12000 })
    }
  }).catch(() => {})
}

window.onload = async () => {
  // Release Notes is a real standalone document rather than an IDE workbench
  // tab. Reuse the bundled release renderer, but deliberately skip BrowserFS
  // and the full plugin engine so the link opens quickly and cannot disturb
  // the active workspace in the original tab.
  if (isReleaseNotesPage(window.location.pathname)) {
    const root = document.getElementById('release-notes-root')
    if (!root) return
    const { ReleaseNotes } = require('./app/ui/release-notes/release-notes')
    root.replaceChildren(new ReleaseNotes({ standalone: true }).render())
    return
  }

  try {
    const storageService = await bootstrapWorkspaceStorage({
      browserFS: BrowserFS,
      targetWindow: window,
      navigatorObject: window.navigator,
      storage: window.localStorage,
      cryptoObject: window.crypto,
      envValue: process.env.TRONIDE_INDEXEDDB_WORKSPACES,
      onProgress: ({ message }) => { if (message) setInitialStatus(message) }
    })
    installUnloadProtection(storageService)
    installRuntimeStorageStatus(storageService)
    require('./index')
  } catch (error) {
    console.error('Workspace storage startup failed:', error)
    showStorageStartupError(error)
  }
}
