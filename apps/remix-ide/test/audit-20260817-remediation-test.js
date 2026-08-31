/*
 * Regression coverage for the 2026-08-17 extract-zip advisory remediation.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('the vulnerable Cypress extract-zip toolchain remains absent', function (t) {
  var packageJson = JSON.parse(readRoot('package.json'))
  var debuggerProject = JSON.parse(readRoot('apps/debugger/project.json'))
  var lockfile = readRoot('pnpm-lock.yaml')

  t.equal(packageJson.devDependencies['@nrwl/web'], undefined, 'the unused Nx web package cannot restore the Cypress dependency chain')
  t.equal(debuggerProject.targets.serve.executor, '@nrwl/webpack:dev-server', 'the debugger uses the maintained workspace dev-server executor')
  t.notOk(lockfile.includes('@nrwl/cypress@'), 'the Nx Cypress package is absent from the lockfile')
  t.notOk(lockfile.includes('cypress@'), 'Cypress is absent from the lockfile')
  t.notOk(lockfile.includes('extract-zip@'), 'the vulnerable extract-zip package is absent from the lockfile')
  t.end()
})
