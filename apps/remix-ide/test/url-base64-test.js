/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var base64 = require('../src/lib/url-base64')
var DEEP_LINK_LIMITS = base64.DEEP_LINK_LIMITS
var decodeBase64Utf8 = base64.decodeBase64Utf8
var decodeUrlBase64 = base64.decodeUrlBase64
var encodeBase64Utf8 = base64.encodeBase64Utf8

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

test('generic Base64 helpers round-trip Unicode GitHub files', function (t) {
  var source = '// héllo 日本語 🌍\n'.repeat(5000)
  var encoded = encodeBase64Utf8(source)
  t.equal(encoded, encodeUtf8(source), 'encoder matches UTF-8 Base64')
  t.equal(decodeBase64Utf8(encoded), source, 'decoder preserves Unicode and large files')
  t.end()
})

test('URL Base64 decoder rejects malformed payloads with actionable errors', function (t) {
  t.throws(function () { decodeUrlBase64('%E0%A4%A') }, /invalid percent encoding/)
  t.throws(function () { decodeUrlBase64('not base64!') }, /not valid Base64/)
  t.end()
})

test('URL Base64 decoder enforces contract source deep-link limits', function (t) {
  var sourceAtLimit = 'a'.repeat(DEEP_LINK_LIMITS.code.maxDecodedBytes)
  t.equal(
    decodeUrlBase64(encodeUtf8(sourceAtLimit), DEEP_LINK_LIMITS.code),
    sourceAtLimit,
    '32 KiB decoded source is accepted'
  )

  var sourceOverLimit = sourceAtLimit + 'a'
  t.throws(
    function () { decodeUrlBase64(encodeUtf8(sourceOverLimit), DEEP_LINK_LIMITS.code) },
    /up to 32 KiB.*GitHub or GitHub Gist/,
    'decoded source above 32 KiB is rejected with import guidance'
  )

  var rawParameterOverLimit = '%41'.repeat(Math.floor(DEEP_LINK_LIMITS.code.maxParameterChars / 3) + 1)
  t.throws(
    function () { decodeUrlBase64(rawParameterOverLimit, DEEP_LINK_LIMITS.code) },
    /64 KiB code parameter/,
    'oversized raw parameters are rejected before URL and Base64 decoding'
  )
  t.end()
})

test('URL Base64 decoder enforces remappings deep-link limits', function (t) {
  var remappingsAtLimit = 'a'.repeat(DEEP_LINK_LIMITS.remaps.maxDecodedBytes)
  t.equal(
    decodeUrlBase64(encodeUtf8(remappingsAtLimit), DEEP_LINK_LIMITS.remaps),
    remappingsAtLimit,
    '8 KiB decoded remappings are accepted'
  )
  t.throws(
    function () { decodeUrlBase64(encodeUtf8(remappingsAtLimit + 'a'), DEEP_LINK_LIMITS.remaps) },
    /up to 8 KiB.*GitHub or GitHub Gist/,
    'decoded remappings above 8 KiB are rejected with import guidance'
  )
  t.end()
})
