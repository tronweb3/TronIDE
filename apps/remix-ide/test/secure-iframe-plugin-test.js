/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var source = fs.readFileSync(path.join(__dirname, '../src/app/components/secure-iframe-plugin.js'), 'utf8')

test('SecureIframePlugin upgrades plugin iframe URLs on HTTPS pages', function (t) {
  t.plan(9)

  t.ok(source.indexOf('export function resolvePluginUrl') !== -1, 'plugin URL resolver is exported for iframe rendering')
  t.ok(source.indexOf("window.location.protocol === 'https:' && parsed.protocol === 'http:'") !== -1, 'resolver upgrades HTTP plugin URL when parent page is HTTPS')
  t.ok(source.indexOf("parsed.protocol = 'https:'") !== -1, 'resolver rewrites mixed-content plugin URL to HTTPS')
  t.ok(source.indexOf('resolvePluginUrl(this.url, isLocalPluginProfile(this.profile))') !== -1, 'iframe src uses resolved safe URL instead of raw URL')
  t.ok(source.indexOf('Local plugin URL must use localhost, 127.0.0.1, or ::1.') !== -1, 'local plugin profiles are restricted to loopback at render time')
  t.ok(source.indexOf('profile.hash.startsWith(\'local:\')') !== -1, 'local-only enforcement is bound to the persisted local plugin identity')
  t.ok(source.indexOf('PLUGIN_CONNECT_TIMEOUT_MS') !== -1, 'iframe activation has a bounded load/handshake timeout')
  t.ok(source.indexOf('this.resetIframe()') !== -1, 'failed or deactivated plugins replace their detached iframe')
  t.ok(source.indexOf('async disconnect ()') !== -1, 'plugin disconnect resets state before a later reactivation')
})

test('bundled iframe plugins use concrete HTTPS-safe entry files', function (t) {
  var managerSource = fs.readFileSync(path.join(__dirname, '../src/remixAppManager.js'), 'utf8')
  t.ok(managerSource.indexOf("url: '/assets/plugins/restorebackupzip/index.html'") !== -1, 'restore plugin avoids the host slash redirect')
  t.ok(managerSource.indexOf("url: '/assets/plugins/scriptRunner/index.html'") !== -1, 'script runner avoids the same redirect pattern')
  t.equal(managerSource.indexOf('pluginsDirectory'), -1, 'the obsolete remote plugin directory is removed')
  t.equal(managerSource.indexOf("localStorage.getItem('plugins-directory')"), -1, 'the obsolete plugin directory fallback is removed')
  t.equal(managerSource.indexOf("localStorage.setItem('plugins-directory'"), -1, 'bundled profiles are no longer copied into localStorage')
  t.end()
})

test('legacy plugin tab path also rejects non-loopback remote frames', function (t) {
  var source = fs.readFileSync(path.join(__dirname, '../src/app/tabs/plugin-tab.js'), 'utf8')
  t.ok(source.indexOf("const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])") !== -1, 'plugin tab keeps the loopback allowlist')
  t.ok(source.indexOf('parsed.origin !== window.location.origin && !LOOPBACK_HOSTS.has(hostname)') !== -1, 'remote plugin tab origins are rejected')
  t.end()
})
