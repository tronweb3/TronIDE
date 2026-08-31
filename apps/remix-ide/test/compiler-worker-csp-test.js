/*
 * Regression coverage for integrity-verified compiler loading under the
 * production Content-Security-Policy.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var root = path.join(__dirname, '..', '..', '..')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('verified compiler execution does not require blob scripts', function (t) {
  var worker = readRoot('libs/remix-solidity/src/lib/es-web-worker/compiler-worker.ts')
  var digestIndex = worker.indexOf("subtle.digest('SHA-256', bytes)")
  var evaluateIndex = worker.indexOf('workerScope.eval(source)')

  t.ok(digestIndex !== -1, 'worker verifies the downloaded compiler digest')
  t.ok(evaluateIndex > digestIndex, 'worker executes compiler bytes only after digest verification')
  t.notOk(/createObjectURL\(|importScripts\(blobURL\)/.test(worker), 'verified compiler execution does not depend on blob: in script-src')
  t.end()
})

test('production compiler worker chunks use content-addressed filenames', function (t) {
  var webpackConfig = readRoot('apps/remix-ide/webpack.config.js')

  t.ok(/chunkFilename:[\s\S]*?\[name\]\.\[contenthash:12\]\.js/.test(webpackConfig), 'production async chunks include a content hash')
  t.ok(/config\.mode === 'production'/.test(webpackConfig), 'content-addressed filenames are applied to production builds')
  t.end()
})
