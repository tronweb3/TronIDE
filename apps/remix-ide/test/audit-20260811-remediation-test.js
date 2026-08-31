/*
 * Regression coverage for the 2026-08-11 dependency audit remediation.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('newly disclosed dependency advisories remain remediated', function (t) {
  var packageJson = JSON.parse(readRoot('package.json'))
  var overrides = packageJson.pnpm && packageJson.pnpm.overrides ? packageJson.pnpm.overrides : {}
  var lockfile = readRoot('pnpm-lock.yaml')

  t.equal(packageJson.dependencies.dompurify, '3.4.13', 'DOMPurify is pinned to the release containing the detached-subtree XSS fix')
  t.equal(overrides.dompurify, '3.4.13', 'transitive DOMPurify consumers use the patched release')
  t.equal(overrides.nanoid, '3.3.18', 'Nano ID is pinned past both infinite-loop advisories')
  t.equal(overrides.less, '4.8.1', 'the Nx Less toolchain uses the image-size-free release')
  t.ok(/\n {2}dompurify@3\.4\.13:/.test(lockfile), 'lockfile resolves DOMPurify 3.4.13')
  t.ok(/\n {2}nanoid@3\.3\.18:/.test(lockfile), 'lockfile resolves Nano ID 3.3.18')
  t.ok(/\n {2}less@4\.8\.1:/.test(lockfile), 'lockfile resolves Less 4.8.1')
  t.notOk(/\n {2}image-size@/.test(lockfile), 'the vulnerable image-size package is absent from the lockfile')
  t.notOk(/\n {6}image-size:/.test(lockfile), 'no dependency edge can reinstall vulnerable image-size releases')
  t.end()
})
