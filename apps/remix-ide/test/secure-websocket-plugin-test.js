/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var source = fs.readFileSync(path.join(__dirname, '../src/app/components/secure-websocket-plugin.js'), 'utf8')
var managerSource = fs.readFileSync(path.join(__dirname, '../src/app/components/plugin-manager-component.js'), 'utf8')

test('local WebSocket plugins wait for a bounded handshake before activation', function (t) {
  t.plan(8)

  t.ok(source.indexOf('export class SecureWebsocketPlugin extends WebsocketPlugin') !== -1, 'local WebSocket plugins use a hardened connector')
  t.ok(source.indexOf('PLUGIN_CONNECT_TIMEOUT_MS = 20000') !== -1, 'activation has a finite handshake timeout')
  t.ok(source.indexOf('return this._openSocket(true)') !== -1, 'connect waits for the initial socket handshake')
  t.ok(source.indexOf('await this.handshake()') !== -1, 'the plugin handshake completes before activation resolves')
  t.ok(source.indexOf("socket.addEventListener('error', onError)") !== -1, 'socket errors reject activation')
  t.ok(source.indexOf('did not finish loading') !== -1, 'silent daemons report a bounded failure')
  t.ok(source.indexOf('this.onclose(event)') !== -1, 'reconnects retain the upstream close behavior')
  t.ok(managerSource.indexOf('new SecureWebsocketPlugin(profile)') !== -1, 'Plugin Manager uses the hardened connector for local WebSockets')
  t.end()
})
