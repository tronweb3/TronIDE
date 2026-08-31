/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var enginePromise = import('../src/remixEngine.js')

test('Remix engine gives Solidity unit tests the AI runtime timeout budget', async function (t) {
  var module = await enginePromise
  var engine = new module.RemixEngine()

  t.equal(engine.setPluginOption({ name: 'udapp' }).queueTimeout, 310000, 'wallet writes keep the plugin call alive through a five-minute TronLink prompt')
  t.equal(engine.setPluginOption({ name: 'solidityUnitTesting' }).queueTimeout, 120000, 'compile/deploy/assert runs may use the full two-minute budget')
  t.equal(engine.setPluginOption({ name: 'ordinaryPlugin' }).queueTimeout, 10000, 'ordinary plugin calls keep the bounded default')
  t.end()
})
