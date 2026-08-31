/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const STORAGE_UNAVAILABLE = 'TRONIDE_STORAGE_UNAVAILABLE'

function storageError (value) {
  const error = value instanceof Error ? value : new Error(String(value || 'IndexedDB persistence failed.'))
  if (!error.code) error.code = STORAGE_UNAVAILABLE
  return error
}

class DurableMirrorController {
  constructor (asyncFileSystem) {
    if (!asyncFileSystem) throw new Error('A persistent file system is required.')
    this._async = asyncFileSystem
    this._queue = []
    this._running = false
    this._sequence = 0
    this._durableSequence = 0
    this._failure = null
    this._waiters = []
    this._listeners = new Set()
    this._mirror = null
    this._nativeEnqueue = null
  }

  install (mirror) {
    if (!mirror || typeof mirror.enqueueOp !== 'function') throw new Error('A BrowserFS AsyncMirror instance is required.')
    if (this._mirror) throw new Error('The durable mirror controller is already installed.')
    // Installation happens immediately after AsyncMirror hydration and before
    // the IDE starts. Refuse to replace an already-active native queue because
    // doing so could silently lose an operation owned by BrowserFS.
    if ((Array.isArray(mirror._queue) && mirror._queue.length) || mirror._queueRunning) {
      throw new Error('Cannot install durability tracking while AsyncMirror is busy.')
    }
    this._mirror = mirror
    this._nativeEnqueue = mirror.enqueueOp
    mirror.enqueueOp = (operation) => this.enqueue(operation)
    this._emit()
    return this
  }

  enqueue (operation) {
    if (!operation || typeof operation.apiMethod !== 'string' || !Array.isArray(operation.arguments)) {
      throw new Error('Invalid BrowserFS persistence operation.')
    }
    if (typeof this._async[operation.apiMethod] !== 'function') {
      throw new Error(`IndexedDB file system does not support ${operation.apiMethod}.`)
    }
    const entry = {
      sequence: ++this._sequence,
      apiMethod: operation.apiMethod,
      arguments: operation.arguments.slice()
    }
    this._queue.push(entry)
    this._emit()
    this._drain()
    return entry.sequence
  }

  checkpoint () {
    return this._sequence
  }

  getStatus () {
    return Object.freeze({
      state: this._failure ? 'failed' : (this._queue.length || this._running ? 'saving' : 'idle'),
      sequence: this._sequence,
      durableSequence: this._durableSequence,
      pending: this._queue.length,
      error: this._failure
    })
  }

  subscribe (listener) {
    if (typeof listener !== 'function') throw new Error('A storage status listener must be a function.')
    this._listeners.add(listener)
    listener(this.getStatus())
    return () => this._listeners.delete(listener)
  }

  assertWritable () {
    if (!this._failure) return true
    const error = storageError(this._failure)
    error.code = STORAGE_UNAVAILABLE
    throw error
  }

  whenDurable (sequence = this._sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this._sequence) {
      return Promise.reject(new Error('Invalid storage durability checkpoint.'))
    }
    if (sequence <= this._durableSequence) return Promise.resolve(sequence)
    if (this._failure) return Promise.reject(this._failure)
    return new Promise((resolve, reject) => {
      this._waiters.push({ sequence, resolve, reject })
    })
  }

  whenIdle () {
    return this.whenDurable(this._sequence)
  }

  retry () {
    if (!this._failure) return this.whenIdle()
    this._failure = null
    this._emit()
    this._drain()
    return this.whenIdle()
  }

  _drain () {
    if (this._running || this._failure || this._queue.length === 0) return
    const entry = this._queue[0]
    this._running = true
    this._emit()
    let settled = false
    const done = (error) => {
      if (settled) return
      settled = true
      this._running = false
      if (error) {
        this._failure = storageError(error)
        this._rejectWaiters(this._failure)
        this._emit()
        return
      }
      this._queue.shift()
      this._durableSequence = entry.sequence
      this._resolveWaiters()
      this._emit()
      this._drain()
    }

    try {
      this._async[entry.apiMethod].apply(this._async, entry.arguments.concat(done))
    } catch (error) {
      done(error)
    }
  }

  _resolveWaiters () {
    const pending = []
    for (const waiter of this._waiters) {
      if (waiter.sequence <= this._durableSequence) waiter.resolve(waiter.sequence)
      else pending.push(waiter)
    }
    this._waiters = pending
  }

  _rejectWaiters (error) {
    const waiters = this._waiters.splice(0)
    waiters.forEach((waiter) => waiter.reject(error))
  }

  _emit () {
    const status = this.getStatus()
    this._listeners.forEach((listener) => {
      try { listener(status) } catch (error) { console.warn('Workspace storage listener failed:', error) }
    })
  }
}

module.exports = {
  STORAGE_UNAVAILABLE,
  DurableMirrorController
}
