/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var chatSetPath = path.resolve(__dirname, '../../../libs/remix-code-reader/src/components/Chat/ChatSet/index.js')

test('Anthropic model catalog tracks compatible gateway model IDs', function (t) {
  var source = fs.readFileSync(chatSetPath, 'utf8')

  t.notOk(source.includes('claude-sonnet-4-5'), 'retired Claude Sonnet 4.5 is not selectable or label-mapped')
  t.ok(source.includes("value:'claude-opus-5'"), 'Claude Opus 5 is selectable for compatible gateways')
  t.ok(source.includes("label:'Claude Opus 5'"), 'Claude Opus 5 has a display label')
  t.ok(source.includes("value:'claude-sonnet-5'"), 'Claude Sonnet 5 remains selectable for compatible gateways')
  t.ok(source.includes("label:'Claude Sonnet 5'"), 'Claude Sonnet 5 has a display label')
  t.ok(source.includes("value:'claude-opus-4-8'"), 'Claude Opus 4.8 remains available')
  t.ok(source.includes("value:'claude-sonnet-4-6'"), 'Claude Sonnet 4.6 remains available')
  t.ok(source.includes("value:'claude-haiku-4-5-20251001'"), 'Claude Haiku 4.5 remains available for entry-level testing')
  t.end()
})
