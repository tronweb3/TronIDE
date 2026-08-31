/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const yo = require('yo-yo')
const css = require('../tabs/styles/run-tab-styles')

const RETRY_SAFE_WALLET_ERROR = /transaction signature (?:timed out|was rejected)|signature (?:timed out|was rejected)|stopped before signing/i

function transactionMessage (message, context = {}) {
  const text = String(message && message.message ? message.message : message || '').trim()
  const explicitPhase = context && context.phase
  const explicitOperation = context && context.operation
  if (explicitPhase && explicitOperation) {
    return { text, phase: explicitPhase, operation: explicitOperation }
  }

  let match = text.match(/^(.*?)\s+pending\s*\.{3}\s*$/i)
  if (match) return { text, phase: 'pending', operation: match[1].trim() }
  match = text.match(/^(.*?)\s+errored:\s*(.*)$/i)
  if (match) return { text, phase: 'error', operation: match[1].trim(), detail: match[2].trim() }
  match = text.match(/^(.*?)\s+succeeded\.?\s*$/i)
  if (match) return { text, phase: 'success', operation: match[1].trim() }
  match = text.match(/^(.*?)\s+canceled by user\.?\s*$/i)
  if (match) return { text, phase: 'canceled', operation: match[1].trim() }
  return null
}

function transactionHash (context) {
  const result = context && (context.txResult || context.transactionResult)
  const receipt = result && (result.receipt || result)
  return (result && (result.transactionHash || result.txID || result.txid)) ||
    (receipt && (receipt.transactionHash || receipt.txID || receipt.txid)) || ''
}

class TransactionAttemptLogger {
  constructor (appendHtml) {
    this.appendHtml = appendHtml
    this.attempts = []
    this.sequence = 0
    this.retrySource = null
  }

  log (message, context = {}) {
    const parsed = transactionMessage(message, context)
    if (!parsed) {
      this.appendHtml(yo`<pre>${String(message && message.message ? message.message : message || '')}</pre>`)
      return null
    }

    let attempt = parsed.phase === 'pending'
      ? this._startAttempt(parsed.operation, context)
      : this._latestWaitingAttempt(parsed.operation)

    if (!attempt) attempt = this._startAttempt(parsed.operation, context, parsed.phase)
    attempt.context = Object.assign({}, attempt.context, context)

    if (parsed.phase === 'pending') {
      this._appendEvent(attempt, context.walletRequest ? 'Waiting for TronLink approval.' : parsed.text, 'pending')
      return attempt
    }

    if (parsed.phase === 'success') {
      const hash = transactionHash(context)
      this._appendEvent(attempt, hash ? `Succeeded · ${hash}` : 'Succeeded.', 'success')
      this._setStatus(attempt, 'success', 'Succeeded')
      return attempt
    }

    if (parsed.phase === 'canceled') {
      this._appendEvent(attempt, 'Canceled by user.', 'canceled')
      this._setStatus(attempt, 'canceled', 'Canceled')
      return attempt
    }

    const detail = parsed.detail || parsed.text
    this._appendEvent(attempt, detail, 'error')
    this._setStatus(attempt, 'error', /timed out/i.test(detail) ? 'Timed out' : 'Failed')
    if (typeof attempt.context.retry === 'function' && RETRY_SAFE_WALLET_ERROR.test(detail)) {
      this._renderRetry(attempt)
    }
    return attempt
  }

  _startAttempt (operation, context, initialPhase = 'pending') {
    const number = ++this.sequence
    const retryOf = this.retrySource
    const statusText = initialPhase === 'pending' ? 'Waiting' : 'Started'
    const root = yo`
      <section class=${css.transactionAttempt} data-id="transactionAttemptGroup" data-attempt="${number}" data-status="${initialPhase}">
        <div class=${css.transactionAttemptHeader}>
          <strong>Attempt ${number}</strong>
          <span class=${css.transactionAttemptOperation}>${operation}</span>
          <span class=${css.transactionAttemptStatus} data-id="transactionAttemptStatus">${statusText}</span>
        </div>
        <ol class=${css.transactionAttemptEvents} data-id="transactionAttemptEvents"></ol>
        <div class=${css.transactionAttemptActions} data-id="transactionAttemptActions"></div>
      </section>
    `
    const attempt = { number, operation, context, root, status: initialPhase }
    this.attempts.push(attempt)
    this.appendHtml(root)
    if (retryOf) {
      this._appendEvent(retryOf, `Retry continued as Attempt ${number}.`, 'retry')
      this._appendEvent(attempt, `Retry of Attempt ${retryOf.number}.`, 'retry')
      this.retrySource = null
    }
    return attempt
  }

  _latestWaitingAttempt (operation) {
    for (let index = this.attempts.length - 1; index >= 0; index--) {
      const attempt = this.attempts[index]
      if (attempt.operation === operation && (attempt.status === 'pending' || attempt.status === 'waiting')) return attempt
    }
    return null
  }

  _appendEvent (attempt, text, phase) {
    const list = attempt.root.querySelector('[data-id="transactionAttemptEvents"]')
    if (!list) return
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    list.appendChild(yo`<li data-phase="${phase}"><time>${time}</time><span>${text}</span></li>`)
  }

  _setStatus (attempt, status, label) {
    attempt.status = status
    attempt.root.setAttribute('data-status', status)
    const badge = attempt.root.querySelector('[data-id="transactionAttemptStatus"]')
    if (badge) badge.textContent = label
  }

  _renderRetry (attempt) {
    const actions = attempt.root.querySelector('[data-id="transactionAttemptActions"]')
    if (!actions || actions.querySelector('[data-id="transactionAttemptRetry"]')) return
    const retry = yo`<button type="button" data-id="transactionAttemptRetry">Retry this attempt</button>`
    retry.addEventListener('click', () => {
      retry.disabled = true
      retry.textContent = 'Retrying…'
      this.retrySource = attempt
      this._appendEvent(attempt, 'Retry requested. A new attempt will be logged separately.', 'retry')
      try {
        Promise.resolve(attempt.context.retry()).catch((error) => {
          this.retrySource = null
          this._appendEvent(attempt, `Retry could not start: ${error && error.message ? error.message : error}`, 'error')
          retry.disabled = false
          retry.textContent = 'Retry this attempt'
        })
      } catch (error) {
        this.retrySource = null
        this._appendEvent(attempt, `Retry could not start: ${error && error.message ? error.message : error}`, 'error')
        retry.disabled = false
        retry.textContent = 'Retry this attempt'
      }
    })
    actions.appendChild(retry)
  }
}

module.exports = { TransactionAttemptLogger, transactionMessage, RETRY_SAFE_WALLET_ERROR }
