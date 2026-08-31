/*
 * Local WebSocket plugin connector with a bounded activation handshake.
 *
 * @remixproject/engine-web's WebsocketPlugin starts the socket from connect()
 * but returns no promise. PluginConnector therefore marks the plugin active
 * before the socket is open or the handshake has completed. Keep the upstream
 * reconnect behavior, but make the initial activation fail closed and bound
 * both socket errors and a silent local daemon.
 */

'use strict'

import { WebsocketPlugin } from '@remixproject/engine-web'

const PLUGIN_CONNECT_TIMEOUT_MS = 20000

/**
 * Add a daemon-issued session token to a local remixd websocket URL.
 *
 * Only the built-in localhost services use this helper. Remote websocket
 * plugins must keep their original URL and authentication flow.
 */
export async function requestLocalSessionUrl (url) {
  const target = new URL(url, window.location.origin)
  if (!['ws:', 'wss:'].includes(target.protocol) || !['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('Local remixd websocket URL is required.')
  }
  const endpointProtocol = target.protocol === 'wss:' ? 'https:' : 'http:'
  const endpoint = `${endpointProtocol}//${target.host}/remixd-token`
  const response = await window.fetch(endpoint, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit'
  })
  if (!response.ok) throw new Error(`Remixd token endpoint returned HTTP ${response.status}.`)
  const payload = await response.json()
  if (!payload || typeof payload.token !== 'string' || !/^[0-9a-f]{32}$/i.test(payload.token)) {
    throw new Error('Remixd returned an invalid session token.')
  }
  target.searchParams.set('remixdToken', payload.token)
  return target.toString()
}

export class SecureWebsocketPlugin extends WebsocketPlugin {
  constructor (profile, options) {
    super(profile, options)
    this._manualDisconnect = false
    this._socketHandlers = null
  }

  _openSocket (waitForHandshake) {
    const socket = new WebSocket(this.url)
    this.socket = socket

    let settled = !waitForHandshake
    let connectionReady = false
    let timer = null
    let resolveConnect
    let rejectConnect
    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) {
        try { socket.close() } catch (e) {}
        rejectConnect(error)
      } else {
        resolveConnect()
      }
    }
    const onOpen = async () => {
      try {
        socket.addEventListener(...this.listeners.message)
        await this.handshake()
        connectionReady = true
        finish()
      } catch (error) {
        if (waitForHandshake) finish(error)
        else {
          try { socket.close() } catch (e) {}
        }
      }
    }
    const onError = () => {
      if (waitForHandshake) finish(new Error(`${this.name} plugin WebSocket connection failed.`))
      else {
        try { socket.close() } catch (e) {}
      }
    }
    const onClose = (event) => {
      if (!settled) {
        finish(new Error(`${this.name} plugin WebSocket closed before handshake.`))
      } else if (!this._manualDisconnect && (!waitForHandshake || connectionReady)) {
        this.onclose(event)
      }
    }

    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onError)
    socket.addEventListener('close', onClose)
    this._socketHandlers = { socket, onOpen, onError, onClose }

    if (!waitForHandshake) return undefined
    return new Promise((resolve, reject) => {
      resolveConnect = resolve
      rejectConnect = reject
      timer = setTimeout(() => {
        finish(new Error(`${this.name} plugin did not finish loading. Check the local WebSocket URL and daemon.`))
      }, PLUGIN_CONNECT_TIMEOUT_MS)
    })
  }

  connect (url) {
    this.url = url
    this._manualDisconnect = false
    return this._openSocket(true)
  }

  open () {
    return this._openSocket(false)
  }

  async disconnect () {
    this._manualDisconnect = true
    const handlers = this._socketHandlers
    this._socketHandlers = null
    if (!handlers) return
    const { socket, onOpen, onError, onClose } = handlers
    try { socket.removeEventListener('open', onOpen) } catch (e) {}
    try { socket.removeEventListener('error', onError) } catch (e) {}
    try { socket.removeEventListener('close', onClose) } catch (e) {}
    try { socket.removeEventListener(...this.listeners.message) } catch (e) {}
    try { socket.close() } catch (e) {}
  }
}
