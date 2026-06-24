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

/**
 * Browser wallet extensions (MetaMask, OKX, …) inject their own `inpage.js`
 * into every page and can throw unhandled rejections of their own accord —
 * the classic "Failed to connect to MetaMask" raised by MetaMask's inpage
 * script on page reload / extension update. TronIDE uses TronLink, never
 * touches `window.ethereum`, and these failures are entirely external and
 * benign. But because they surface as *uncaught* errors they bubble up to the
 * dev-server/runtime error overlay and get filed as a P0 against the IDE.
 *
 * Swallow only the errors that genuinely originate from an injected extension
 * script (chrome-/moz-extension origin, or an "inpage" script frame) — real
 * application errors (from our own bundle) are left untouched so they still
 * surface during development. We log the suppressed ones to the console.
 */

const EXTENSION_SOURCE = /(chrome-extension|moz-extension|extension):\/\/|\binpage\.js\b/i
// last-resort message match for cases where the stack is stripped/minified
const KNOWN_WALLET_MESSAGES = /failed to connect to metamask|lost connection to metamask|metamask extension not found|could not establish connection\. receiving end does not exist/i

function fromExtension (text) {
  return !!text && (EXTENSION_SOURCE.test(text) || KNOWN_WALLET_MESSAGES.test(text))
}

function describe (value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return [value.message, value.stack, value.fileName, value.filename].filter(Boolean).join('\n')
}

// The dev-server runtime-error overlay (webpack-dev-server, dev only) is a
// persistent iframe whose listeners we cannot fully out-race or configure
// through the nx executor. When we suppress an extension error, also hide any
// overlay it may have raised. The element only exists under the dev server, so
// this is a no-op in production.
function hideDevOverlay (doc) {
  try {
    const overlay = doc && doc.getElementById && doc.getElementById('webpack-dev-server-client-overlay')
    if (overlay) overlay.style.display = 'none'
  } catch (e) { /* ignore */ }
}

export function installExtensionErrorSuppressor (scope) {
  const target = scope || (typeof window !== 'undefined' ? window : undefined)
  if (!target || target.__tronideExtensionErrorSuppressor) return
  target.__tronideExtensionErrorSuppressor = true
  const doc = target.document

  const suppress = (event, what, value) => {
    event.preventDefault()
    if (event.stopImmediatePropagation) event.stopImmediatePropagation()
    console.warn(`[TronIDE] Suppressed a wallet-extension ${what} (not an IDE error):`, value)
    // the overlay may already have been raised by a listener that ran before
    // us; hide it on this and the next frame to cover both orderings
    hideDevOverlay(doc)
    if (target.requestAnimationFrame) target.requestAnimationFrame(() => hideDevOverlay(doc))
    else target.setTimeout(() => hideDevOverlay(doc), 0)
  }

  const onRejection = (event) => {
    const reason = event && (event.reason !== undefined ? event.reason : event.detail && event.detail.reason)
    if (fromExtension(describe(reason))) suppress(event, 'promise rejection', reason)
  }

  const onError = (event) => {
    // error events expose the source file in `filename`; the Error in `error`
    const source = describe(event && event.error) || (event && event.filename) || ''
    if (fromExtension(source)) suppress(event, 'error', (event && (event.error || event.message)))
  }

  // capture phase so we run before the dev-server / overlay listeners
  target.addEventListener('unhandledrejection', onRejection, true)
  target.addEventListener('error', onError, true)
}
