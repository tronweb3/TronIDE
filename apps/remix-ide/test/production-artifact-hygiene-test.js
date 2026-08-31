/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var os = require('os')
var path = require('path')
var spawnSync = require('child_process').spawnSync
var test = require('tape')

var root = path.resolve(__dirname, '../../..')
var checker = path.join(root, 'scripts/check-production-artifact-hygiene.cjs')
var version = require(path.join(root, 'package.json')).version

function artifact (files) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tronide-artifact-hygiene-'))
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'assets/version.json'), JSON.stringify({ version: version, mode: 'production' }))
  Object.keys(files).forEach(function (name) {
    var target = path.join(directory, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, files[name])
  })
  return directory
}

function runChecker (directory, extraEnv) {
  return spawnSync(process.execPath, [checker, directory], {
    cwd: root,
    env: Object.assign({}, process.env, extraEnv),
    encoding: 'utf8'
  })
}

test('production artifact hygiene ignores upstream fixture paths but rejects this build workspace', function (t) {
  var safeArtifact = artifact({
    'assets/plugins/scriptRunner/script-runner.js': [
      '/home/yann/Remix/remix-script-runner',
      '/Users/jquense/open-source/package',
      '/applewebkit/browser/source',
      'src/app/components/example.js',
      './app/components/example.js'
    ].join('\n')
  })
  var leakedArtifact = artifact({
    'main.js': 'sourceURL=/app/apps/remix-ide/src/main.js'
  })

  try {
    // GitLab invokes the checker in a container mounted at /app. The boundary
    // is important: /applewebkit must not be mistaken for the /app/ workspace.
    var safe = runChecker(safeArtifact, { BUILD_WORKSPACE_DIRECTORY: '/app' })
    t.equal(safe.status, 0, 'historical third-party author paths do not fail the release gate')

    var leaked = runChecker(leakedArtifact, { BUILD_WORKSPACE_DIRECTORY: '/app' })
    t.notEqual(leaked.status, 0, 'a path under the active /app/ build workspace is rejected')
    t.ok(/current build-machine path found/.test(leaked.stderr), 'the failure identifies build-machine path leakage')
  } finally {
    fs.rmSync(safeArtifact, { recursive: true, force: true })
    fs.rmSync(leakedArtifact, { recursive: true, force: true })
  }
  t.end()
})


test('production artifact hygiene enforces the compressed main.js cold-start budget', function (t) {
  var oversizedArtifact = artifact({
    // Reuse real source text so gzip still has enough entropy to exceed the
    // intentionally tiny test budget without allocating a multi-megabyte file.
    'main.js': fs.readFileSync(checker)
  })

  try {
    var result = runChecker(oversizedArtifact, { TRONIDE_MAIN_GZIP_BUDGET_BYTES: '100' })
    t.notEqual(result.status, 0, 'an oversized compressed entry bundle blocks the release gate')
    t.ok(/main\.js gzip size .* exceeds/.test(result.stderr), 'the failure reports the compressed bundle and budget')
  } finally {
    fs.rmSync(oversizedArtifact, { recursive: true, force: true })
  }
  t.end()
})

test('production artifact hygiene keeps the optimized default budget at 4.2 MB', function (t) {
  var smallArtifact = artifact({ 'main.js': 'console.log("small entry")' })

  try {
    var result = runChecker(smallArtifact)
    t.equal(result.status, 0, 'a small production entry passes the default budget')
    t.ok(/budget 4200000/.test(result.stdout), 'the default budget preserves headroom above the optimized bundle')
  } finally {
    fs.rmSync(smallArtifact, { recursive: true, force: true })
  }
  t.end()
})
