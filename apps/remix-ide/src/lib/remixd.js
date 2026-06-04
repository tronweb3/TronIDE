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
var EventManager = require('../lib/events')
var modalDialog = require('../app/ui/modaldialog')
var yo = require('yo-yo')

function createSessionToken () {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return String(Date.now()) + String(Math.random()).slice(2)
}

function isValidRemixdMessage (data) {
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return false
  if (data.type === 'handshake') return typeof data.token === 'string'
  if (data.type === 'reply') return Object.prototype.hasOwnProperty.call(data, 'id')
  if (data.type === 'notification') return typeof data.service === 'string' || typeof data.name === 'string'
  if (data.type === 'system') return true
  return false
}

class Remixd {
  constructor (port) {
    this.event = new EventManager()
    this.port = port
    this.callbacks = {}
    this.callid = 0
    this.socket = null
    this.connected = false
    this.authenticated = false
    this.sessionToken = createSessionToken()
    this.receiveResponse()
  }

  online () {
    return this.socket !== null
  }

  close () {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  start (cb) {
    if (this.socket) {
      try {
        this.socket.close()
      } catch (e) {
        this.event.trigger('diagnostic', [{ source: 'remixd', message: 'Failed to close existing socket', error: e }])
      }
    }
    this.event.trigger('connecting', [])
    this.authenticated = false
    this.sessionToken = createSessionToken()
    this.socket = new WebSocket('ws://localhost:' + this.port + '?remixdToken=' + encodeURIComponent(this.sessionToken), 'echo-protocol') // eslint-disable-line

    this.socket.addEventListener('open', (event) => {
      this.connected = true
      this.event.trigger('connected', [event])
      cb()
    })

    this.socket.addEventListener('message', (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch (e) {
        this.event.trigger('diagnostic', [{ source: 'remixd', message: 'Invalid JSON from remixd socket', error: e }])
        return
      }
      if (!isValidRemixdMessage(data)) {
        this.event.trigger('diagnostic', [{ source: 'remixd', message: 'Invalid remixd message schema', data }])
        return
      }
      if (!this.authenticated) {
        if (data.type === 'handshake' && data.token === this.sessionToken) {
          this.authenticated = true
          this.event.trigger('authenticated', [data])
        } else if (data.type === 'handshake' && data.token !== this.sessionToken) {
          this.event.trigger('diagnostic', [{ source: 'remixd', message: 'Rejected remixd handshake with mismatched token' }])
          this.close()
        } else {
          this.event.trigger('diagnostic', [{ source: 'remixd', message: 'Ignored unauthenticated remixd message', data }])
        }
        return
      }
      if (data.type === 'reply') {
        if (this.callbacks[data.id]) {
          this.callbacks[data.id](data.error, data.result)
          delete this.callbacks[data.id]
        }
        this.event.trigger('replied', [data])
      } else if (data.type === 'notification') {
        this.event.trigger('notified', [data])
      } else if (data.type === 'system') {
        if (data.error) {
          this.event.trigger('system', [{
            error: data.error
          }])
        }
      }
    })

    this.socket.addEventListener('error', (event) => {
      this.errored(event)
      cb(event)
    })

    this.socket.addEventListener('close', (event) => {
      if (event.wasClean) {
        this.connected = false
        this.event.trigger('closed', [event])
      } else {
        this.errored(event)
      }
      this.socket = null
    })
  }

  async receiveResponse (requestId) {
    return new Promise((resolve, reject) => {
      this.event.register('replied', (data) => {
        if (data.id === requestId) {
          if (data.error) reject(data.error)
          else resolve(data.result)
        }
      })
    })
  }

  errored (event) {
    function remixdDialog () {
      return yo`<div>Connection to Remixd closed. Localhost connection not available anymore.</div>`
    }
    if (this.connected) {
      modalDialog('Lost connection to Remixd!', remixdDialog(), {}, { label: '' })
    }
    this.connected = false
    this.authenticated = false
    this.socket = null
    this.event.trigger('errored', [event])
  }

  call (service, fn, args, callback) {
    return new Promise((resolve, reject) => {
      this.ensureSocket((error) => {
        if (error) {
          callback && typeof callback === 'function' && callback(error)
          reject(error)
          return
        }
        if (this.socket && this.socket.readyState === this.socket.OPEN && this.authenticated) {
          var data = this.format(service, fn, args)
          this.callbacks[data.id] = callback
          this.socket.send(JSON.stringify(data))
          resolve(data.id)
        } else {
          callback && typeof callback === 'function' && callback('Socket not ready. state:' + this.socket.readyState)
          reject(new Error('Socket not ready. state:' + this.socket.readyState))
        }
      })
    })
  }

  ensureSocket (cb) {
    if (this.socket) return cb(null, this.socket)
    this.start((error) => {
      if (error) {
        cb(error)
      } else {
        cb(null, this.socket)
      }
    })
  }

  format (service, fn, args) {
    var data = {
      id: this.callid,
      service: service,
      fn: fn,
      args: args
    }
    this.callid++
    return data
  }
}

module.exports = Remixd
