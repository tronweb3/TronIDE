/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var security = require('../src/lib/url-param-security')

test('URL plugin activation keeps ordinary panels and blocks sensitive plugins', function (t) {
  t.deepEqual(
    security.filterUrlPluginNames('solidity,udapp,solidity'),
    ['solidity', 'udapp'],
    'safe panels are retained and deduplicated'
  )
  t.deepEqual(
    security.filterUrlPluginNames('solidity%2Cudapp'),
    ['solidity', 'udapp'],
    'URLSearchParams-encoded commas are decoded once'
  )
  t.deepEqual(
    security.filterUrlPluginNames('remixd,scriptRunner,git,attackerPlugin'),
    [],
    'local bridges, hidden runners, and unknown plugins are blocked'
  )
  t.end()
})

test('URL plugin calls only allow opening a safe workspace-relative file', function (t) {
  t.deepEqual(
    security.parseUrlPluginCall('fileManager//open//contracts/Token.sol'),
    ['fileManager', 'open', 'contracts/Token.sol'],
    'legacy open-file deep links remain supported'
  )
  t.deepEqual(
    security.parseUrlPluginCall(encodeURIComponent('fileManager//open//contracts/My Token.sol')),
    ['fileManager', 'open', 'contracts/My Token.sol'],
    'percent-encoded safe calls remain supported'
  )
  ;[
    'fileManager//writeFile//contracts/EVIL.sol//owned',
    'fileManager//remove//contracts/Token.sol',
    'contentImport//resolve//github.com/owner/repo/blob/main/file.sol',
    'scriptRunner//execute//alert(1)',
    'fileManager//open//../secrets.txt',
    'fileManager//open//https:example.com'
  ].forEach(function (call) {
    t.equal(security.parseUrlPluginCall(call), null, 'blocked: ' + call)
  })
  t.end()
})

test('URL imports retain GitHub source links and reject arbitrary/private targets', function (t) {
  var github = 'https://github.com/owner/repo/blob/main/contracts/Token.sol'
  var githubWww = 'https://www.github.com/owner/repo/blob/main/contracts/Token.sol'
  var raw = 'https://raw.githubusercontent.com/owner/repo/main/contracts/Token.sol'
  t.equal(security.normalizeUrlImport(github), github, 'GitHub blob link is allowed')
  t.equal(security.normalizeUrlImport(githubWww), githubWww, 'legacy www GitHub links remain allowed')
  t.equal(security.normalizeUrlImport(raw), raw, 'GitHub raw link is allowed')
  t.equal(security.normalizeUrlImport(encodeURIComponent(github)), github, 'percent-encoded GitHub URLs are decoded once')
  ;[
    'http://localhost:8545',
    'http://127.0.0.1:3000',
    'https://ipinfo.io/json',
    'https://github.com.attacker.example/owner/repo/file.sol',
    'https://user:pass@github.com/owner/repo/file.sol',
    '%E0%A4%A'
  ].forEach(function (url) {
    t.equal(security.normalizeUrlImport(url), null, 'blocked: ' + url)
  })
  t.end()
})
