/*
 * Full-install integration coverage for the remediated Nx Less toolchain.
 * This is intentionally excluded from p0-p1-index.js, whose CI job installs
 * only the small dependency set needed by the core release-contract tests.
 */

'use strict'

var path = require('path')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')

test('Nx webpack can compile Less with the remediated toolchain', function (t) {
  var nxPackage = require.resolve('@nrwl/webpack/package.json', { paths: [root] })
  var lessPath = require.resolve('less', { paths: [path.dirname(nxPackage)] })
  var less = require(lessPath)

  t.deepEqual(less.version, [4, 8, 1], 'Nx resolves the pinned Less release')
  less.render('@tone: #f00; .sample { color: @tone; }').then(function (result) {
    t.ok(/color: #f00;/.test(result.css), 'Less compilation succeeds through the Nx dependency graph')
    t.end()
  }, function (error) {
    t.fail(error && error.message ? error.message : String(error))
    t.end()
  })
})
