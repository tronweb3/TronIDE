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

var yo = require('yo-yo')
var css = require('./styles/modaldialog-styles')

const modalQueue = []
let activeRequest = null

module.exports = (title, content, ok, cancel, focusSelector, opts) => {
  const request = createRequest(title, content, ok, cancel, focusSelector, opts || {})
  modalQueue.push(request)
  drainQueue()
  return request.controller
}

function createRequest (title, content, ok, cancel, focusSelector, opts) {
  let agreed = true
  let footerIsActive = false
  const container = html(opts)
  const closeDiv = container.querySelector('#modal-close')
  if (opts.hideClose) closeDiv.style.display = 'none'

  const okDiv = container.querySelector('#modal-footer-ok')
  okDiv.textContent = (ok && ok.label !== undefined) ? ok.label : 'OK'
  okDiv.style.display = okDiv.textContent === '' ? 'none' : 'inline-block'

  const cancelDiv = container.querySelector('#modal-footer-cancel')
  cancelDiv.textContent = (cancel && cancel.label !== undefined) ? cancel.label : 'Cancel'
  cancelDiv.style.display = cancelDiv.textContent === '' ? 'none' : 'inline-block'

  const modal = container.querySelector('#modal-body-id')
  const modalTitle = container.querySelector('#modal-title-h6')

  modalTitle.innerHTML = ''
  if (title) modalTitle.innerText = title

  modal.innerHTML = ''
  if (content) modal.appendChild(content)

  let request

  function setFocusOn (btn) {
    if (btn === 'ok') {
      okDiv.className = okDiv.className.replace(/\bbtn-light\b/g, 'btn-dark')
      cancelDiv.className = cancelDiv.className.replace(/\bbtn-dark\b/g, 'btn-light')
    } else {
      cancelDiv.className = cancelDiv.className.replace(/\bbtn-light\b/g, 'btn-dark')
      okDiv.className = okDiv.className.replace(/\bbtn-dark\b/g, 'btn-light')
    }
  }

  function okListener () {
    if (request.state !== 'active') return
    settle(agreed && ok && ok.fn ? ok.fn : null)
  }

  function cancelListener () {
    if (request.state === 'queued') {
      removeQueuedRequest(request)
      request.state = 'settled'
      return
    }
    if (request.state !== 'active') return
    settle(cancel && cancel.fn ? cancel.fn : null)
  }

  function modalKeyEvent (e) {
    if (e.keyCode === 27) { // Esc
      cancelListener()
    } else if (e.keyCode === 13) { // Enter
      // Native buttons already translate Enter into exactly one click. Let that
      // activation choose the focused action; otherwise a focused Cancel button
      // is incorrectly routed through okListener by this legacy modal handler.
      if (e.target === okDiv || e.target === cancelDiv) return
      e.preventDefault()
      okListener()
    } else if (e.keyCode === 37 && footerIsActive) { // Arrow Left
      e.preventDefault()
      agreed = true
      setFocusOn('ok')
    } else if (e.keyCode === 39 && footerIsActive) { // Arrow Right
      e.preventDefault()
      agreed = false
      setFocusOn('cancel')
    }
  }

  function hide () {
    if (request.state === 'queued') {
      removeQueuedRequest(request)
      request.state = 'settled'
      return
    }
    if (request.state === 'active') settle(null)
  }

  function show () {
    container.style.display = 'block'
    if (focusSelector) {
      const focusTarget = container.querySelector(focusSelector)
      if (focusTarget) {
        focusTarget.focus()
        if (typeof focusTarget.setSelectionRange === 'function') {
          focusTarget.setSelectionRange(0, focusTarget.value.length)
        }
      }
    }
  }

  function removeEventListener () {
    okDiv.removeEventListener('click', okListener)
    cancelDiv.removeEventListener('click', cancelListener)
    closeDiv.removeEventListener('click', cancelListener)
    document.removeEventListener('keydown', modalKeyEvent)
    container.removeEventListener('click', modalClickListener)
  }

  function modalClickListener (e) {
    footerIsActive = document.activeElement === container
    if (e.target === container) cancelListener()
  }

  function activate () {
    document.querySelector('body').appendChild(container)
    okDiv.hidden = Boolean(content && content.modalOkHidden)
    setFocusOn('ok')
    okDiv.addEventListener('click', okListener)
    cancelDiv.addEventListener('click', cancelListener)
    closeDiv.addEventListener('click', cancelListener)
    document.addEventListener('keydown', modalKeyEvent)
    container.addEventListener('click', modalClickListener)
    show()
  }

  function settle (callback) {
    if (request.state !== 'active') return
    request.state = 'settling'
    removeEventListener()
    try {
      if (callback) callback()
    } finally {
      container.style.display = 'none'
      if (container.parentElement) container.parentElement.removeChild(container)
      request.state = 'settled'
      if (activeRequest === request) activeRequest = null
      drainQueue()
    }
  }

  request = {
    activate,
    container,
    state: 'queued'
  }
  request.controller = { container, okListener, cancelListener, hide }
  return request
}

function removeQueuedRequest (request) {
  const index = modalQueue.indexOf(request)
  if (index !== -1) modalQueue.splice(index, 1)
}

function drainQueue () {
  if (activeRequest) return
  while (modalQueue.length) {
    const request = modalQueue.shift()
    if (request.state !== 'queued') continue
    activeRequest = request
    request.state = 'active'
    request.activate()
    return
  }
}

function html (opts) {
  return yo`
  <div id="modal-dialog" data-id="modalDialogContainer" data-backdrop="static" data-keyboard="false" class="modal" tabindex="-1" role="dialog">
    <div id="modal-background" class="modal-dialog" role="document">
      <div class="modal-content ${css.modalContent} ${opts.class}">
        <div class="modal-header">
          <h6 id="modal-title-h6" class="modal-title" data-id="modalDialogModalTitle"></h6>
          <span class="modal-close">
            <i id="modal-close" title="Close" class="fas fa-times" aria-hidden="true"></i>
          </span>
        </div>
        <div id="modal-body-id" class="modal-body ${css.modalBody}" data-id="modalDialogModalBody"> - </div>
        <div class="modal-footer" data-id="modalDialogModalFooter" autofocus>
          <button type="button" id="modal-footer-ok" class="${css.modalFooterOk} modal-ok btn btn-sm btn-light" tabindex='5'>OK</button>
          <button type="button" id="modal-footer-cancel" class="${css.modalFooterCancel} modal-cancel btn btn-sm btn-light" tabindex='10' data-dismiss="modal">Cancel</button>
        </div>
      </div>
    </div>
  </div>`
}
