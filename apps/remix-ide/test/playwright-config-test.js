/*
 * Modifications Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

'use strict'

const tape = require('tape')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../../..')

tape('Playwright smoke config uses a dedicated port and never reuses arbitrary local services', function (t) {
  const source = fs.readFileSync(path.join(root, 'apps/remix-ide-pw/playwright.config.ts'), 'utf8')

  t.ok(/http:\/\/localhost:18080/.test(source), 'default Playwright base URL uses the dedicated 18080 port')
  t.ok(/--port=\$\{serverPort\}/.test(source), 'dev-server command follows the configured base URL port')
  t.ok(/reuseExistingServer:\s*false/.test(source), 'webServer does not silently reuse an existing listener')
  t.ok(/TRONIDE_PW_REUSE_SERVER\s*===\s*'1'/.test(source), 'external server reuse requires explicit opt-in')
  t.notOk(/http:\/\/localhost:8080/.test(source), 'config does not default to the commonly occupied 8080 port')
  t.end()
})

