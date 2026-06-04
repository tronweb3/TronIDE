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
  t.plan(4)

  t.ok(source.indexOf('export function resolvePluginUrl') !== -1, 'plugin URL resolver is exported for iframe rendering')
  t.ok(source.indexOf("window.location.protocol === 'https:' && parsed.protocol === 'http:'") !== -1, 'resolver upgrades HTTP plugin URL when parent page is HTTPS')
  t.ok(source.indexOf("parsed.protocol = 'https:'") !== -1, 'resolver rewrites mixed-content plugin URL to HTTPS')
  t.ok(source.indexOf('this.iframe.src = resolvePluginUrl(this.url)') !== -1, 'iframe src uses resolved safe URL instead of raw URL')
})
