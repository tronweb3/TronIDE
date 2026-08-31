/*
 * Regression pins for the v2.3.2 Jira follow-ups TRONIDE-138/140.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('TRONIDE-138 bundled restore permissions use a content-bound profile hash', function (t) {
  var source = read('apps/remix-ide/src/remixAppManager.js')
  var profileStart = source.indexOf("name: 'restorebackupzip'")
  var profileEnd = source.indexOf('return plugins.map', profileStart)
  var profileSource = source.slice(profileStart, profileEnd)
  var pluginRoot = path.join(root, 'apps/remix-ide/src/assets/plugins/restorebackupzip')
  var hash = crypto.createHash('sha256')
  ;['index.html', 'bundle.js'].forEach(function (fileName) {
    hash.update(fileName)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(pluginRoot, fileName)))
    hash.update('\0')
  })
  var fingerprint = 'sha256:' + hash.digest('hex')

  t.ok(profileStart !== -1 && profileEnd !== -1, 'the bundled restore profile is registered')
  t.ok(profileSource.indexOf("url: '/assets/plugins/restorebackupzip/index.html'") !== -1, 'the profile points to the hashed bundled entry point')
  t.ok(profileSource.indexOf("hash: '" + fingerprint + "'") !== -1, 'the profile hash changes when executable plugin content changes')
  t.end()
})

test('TRONIDE-140 verification status copy stays in normal document flow', function (t) {
  var source = read('apps/remix-ide/src/app/tabs/contract-verification-tab.js')
  var statusRule = source.slice(source.indexOf('  .status {'), source.indexOf('  .status[data-status="ready"]'))

  t.equal(statusRule.indexOf('position: sticky'), -1, 'status copy cannot float over later form controls')
  t.equal(statusRule.indexOf('z-index:'), -1, 'status copy does not create an overlapping layer')
  t.end()
})
