/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var decodeUrlBase64 = require('../src/lib/url-base64').decodeUrlBase64

function encodeUtf8 (value) {
  return Buffer.from(value, 'utf8').toString('base64')
}

test('URL Base64 decoder preserves existing ASCII payloads', function (t) {
  var source = '// SPDX-License-Identifier: MIT\ncontract T {}\n'
  t.equal(decodeUrlBase64(encodeUtf8(source)), source)
  t.end()
})

test('URL Base64 decoder accepts percent-encoded Base64', function (t) {
  // These bytes deliberately produce both `+` and `/` in standard Base64.
  var encoded = Buffer.from([251, 255, 254]).toString('base64')
  t.ok(encoded.includes('+'), 'fixture contains +')
  t.ok(encoded.includes('/'), 'fixture contains /')
  t.equal(
    decodeUrlBase64(encodeURIComponent(encoded)),
    new TextDecoder().decode(Buffer.from([251, 255, 254])),
    'percent-encoded payload is decoded before Base64'
  )
  t.end()
})

test('URL Base64 decoder reconstructs UTF-8 source text', function (t) {
  var source = 'string public name = unicode"héllo 日本語 🌍";'
  t.equal(decodeUrlBase64(encodeUtf8(source)), source)
  t.end()
})

test('URL Base64 decoder rejects malformed payloads with actionable errors', function (t) {
  t.throws(function () { decodeUrlBase64('%E0%A4%A') }, /invalid percent encoding/)
  t.throws(function () { decodeUrlBase64('not base64!') }, /not valid Base64/)
  t.end()
})
