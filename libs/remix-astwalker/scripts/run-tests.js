/*
 * Run the TypeScript Tape suite without a shell pipeline.
 *
 * The previous `nyc tape | tap-spec; nyc report` command discarded failures
 * from nyc/tape and always continued to the coverage report. Capturing the TAP
 * stream here lets us propagate the real process status and reject an empty
 * suite instead of reporting a false green.
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const testsRoot = path.join(projectRoot, 'tests')
const testFiles = fs.readdirSync(testsRoot)
  .filter(file => file.endsWith('.ts') && fs.statSync(path.join(testsRoot, file)).isFile())
  .sort()
  .map(file => path.join('tests', file))

if (testFiles.length === 0) {
  console.error('remix-astwalker: no TypeScript test files were found')
  process.exit(1)
}

const nycBin = require.resolve('nyc/bin/nyc.js')
const tapeBin = require.resolve('tape/bin/tape')
const testRun = spawnSync(process.execPath, [
  nycBin,
  '--reporter=lcov',
  // The suite validates runtime behavior; project type-checking remains a
  // separate Nx/lint concern and should not prevent Tape from executing.
  '--require', 'ts-node/register/transpile-only',
  '--require', 'tsconfig-paths/register',
  tapeBin,
  ...testFiles
], {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024
})

process.stdout.write(testRun.stdout || '')
process.stderr.write(testRun.stderr || '')

if (testRun.error) {
  console.error(`remix-astwalker: unable to run tests: ${testRun.error.message}`)
  process.exit(1)
}
if (testRun.status !== 0) process.exit(testRun.status || 1)

const summaries = [...(testRun.stdout || '').matchAll(/^# tests\s+(\d+)\s*$/gm)]
const assertionCount = summaries.length ? Number(summaries[summaries.length - 1][1]) : 0
if (assertionCount === 0) {
  console.error('remix-astwalker: Tape completed without executing any assertions')
  process.exit(1)
}

console.log(`remix-astwalker: verified ${assertionCount} assertions`)
const coverageRun = spawnSync(process.execPath, [
  nycBin,
  'report',
  '--reporter=text'
], {
  cwd: projectRoot,
  stdio: 'inherit'
})

if (coverageRun.error) {
  console.error(`remix-astwalker: unable to report coverage: ${coverageRun.error.message}`)
  process.exit(1)
}
process.exit(coverageRun.status === 0 ? 0 : (coverageRun.status || 1))
