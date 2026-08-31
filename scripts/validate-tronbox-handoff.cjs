#!/usr/bin/env node
/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const fixtureRoot = path.join(root, 'apps/remix-ide/test/fixtures/tronbox-handoff')
const compatibility = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'compatibility.json'), 'utf8'))
const scenario = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.fixture), 'utf8'))
const expectedMetadata = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.metadataFixture), 'utf8'))
const exporter = require(path.join(root, 'apps/remix-ide/src/app/tabs/runTab/model/tronbox-export.js'))

const fail = (message) => {
  console.error(`[tronbox-handoff] FAIL: ${message}`)
  process.exitCode = 1
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...(options.env || {}) }
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout || ''}${result.stderr || ''}` : ''
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}.${detail}`)
  }
  return `${result.stdout || ''}${result.stderr || ''}`
}

const resolveTronBox = () => {
  if (process.env.TRONBOX_BIN) return { command: process.env.TRONBOX_BIN, prefix: [] }
  const local = spawnSync('tronbox', ['version'], { encoding: 'utf8' })
  if (!local.error && local.status === 0 && local.stdout.includes(`TronBox v${compatibility.tronboxVersion}`)) {
    return { command: 'tronbox', prefix: [] }
  }
  return { command: 'pnpm', prefix: ['dlx', `${compatibility.tronboxPackage}@${compatibility.tronboxVersion}`] }
}

const write = (target, content) => {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

const prepareProject = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tronide-tronbox-handoff-'))
  const source = fs.readFileSync(path.join(fixtureRoot, 'contracts/Storage.sol'), 'utf8')
  write(path.join(dir, 'contracts/Storage.sol'), source)
  write(path.join(dir, 'contracts/Migrations.sol'), exporter.MIGRATIONS_SOL)
  write(path.join(dir, 'migrations/1_initial_migration.js'), exporter.INITIAL_MIGRATION)
  write(path.join(dir, 'migrations/2_deploy_contracts.js'), exporter.scenarioToMigration(scenario))
  write(path.join(dir, 'tronbox-config.js'), exporter.tronboxConfig(compatibility.solcVersion))
  write(path.join(dir, 'tronide-export.json'), JSON.stringify(exporter.createTronideExportMetadata({
    tronideVersion: '2.3.3',
    solcVersion: compatibility.solcVersion,
    solcSource: 'scenario',
    network: { source: 'scenario', provider: 'vm', name: 'JavaScript VM (Tron)', id: null },
    scenarioSource: { type: 'workspace-file', path: compatibility.fixture, schemaVersion: scenario.schemaVersion, transactionCount: scenario.transactions.length }
  }), null, 2) + '\n')
  write(path.join(dir, 'README.md'), exporter.README)
  write(path.join(dir, 'sample-env'), exporter.SAMPLE_ENV)
  return dir
}

const validateGeneratedProject = (dir) => {
  const migrationPath = path.join(dir, 'migrations/2_deploy_contracts.js')
  const migration = fs.readFileSync(migrationPath, 'utf8')
  const config = fs.readFileSync(path.join(dir, 'tronbox-config.js'), 'utf8')
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'tronide-export.json'), 'utf8'))
  if (!migration.includes("artifacts.require('Storage')")) throw new Error('generated migration does not require Storage')
  if (!migration.includes('await deployer.deploy(Storage)')) throw new Error('generated migration does not deploy Storage')
  if (!migration.includes('.store("42")')) throw new Error('generated migration does not preserve the recorded call')
  if (migration.includes('TODO')) throw new Error('the runnable fixture unexpectedly contains a TODO')
  if (!config.includes(`version: '${compatibility.solcVersion}'`)) throw new Error('generated config does not pin the fixture compiler')
  const metadataValidation = exporter.validateTronideExportMetadata(metadata)
  if (!metadataValidation.ok) throw new Error(`generated metadata failed schema validation: ${metadataValidation.errors.join('; ')}`)
  if (JSON.stringify(metadata) !== JSON.stringify(expectedMetadata)) throw new Error('generated tronide-export.json does not match the shared fixture')
  if (metadata.solc.version !== compatibility.solcVersion) throw new Error('metadata compiler does not match tronbox-config.js')
  if (metadata.compatibility.testedTronbox.version !== compatibility.tronboxVersion) throw new Error('metadata tested TronBox version drifted from the compatibility baseline')
  run(process.execPath, ['--check', migrationPath])
  run(process.execPath, ['--check', path.join(dir, 'migrations/1_initial_migration.js')])
}

const dryRunMigrations = async (dir) => {
  const calls = []
  const instances = new Map()
  global.artifacts = {
    require: (name) => {
      const contractName = String(name).replace(/\.sol$/, '')
      const artifact = {
        contractName,
        deployed: async () => {
          if (!instances.has(contractName)) {
            instances.set(contractName, {
              address: `TDRY${contractName}`,
              store: async (value) => { calls.push({ type: 'call', contract: contractName, method: 'store', args: [String(value)] }) }
            })
          }
          return instances.get(contractName)
        }
      }
      return artifact
    }
  }
  const deployer = {
    deploy: async (artifact) => {
      calls.push({ type: 'deploy', contract: artifact.contractName })
      await artifact.deployed()
    },
    link: async (library, target) => calls.push({ type: 'link', library: library.contractName, target: target.contractName })
  }
  try {
    const first = require(path.join(dir, 'migrations/1_initial_migration.js'))
    const second = require(path.join(dir, 'migrations/2_deploy_contracts.js'))
    await first(deployer)
    await second(deployer)
  } finally {
    delete global.artifacts
  }
  if (!calls.some((call) => call.type === 'deploy' && call.contract === 'Migrations')) throw new Error('initial migration did not deploy Migrations')
  if (!calls.some((call) => call.type === 'deploy' && call.contract === 'Storage')) throw new Error('scenario migration did not deploy Storage')
  if (!calls.some((call) => call.type === 'call' && call.contract === 'Storage' && call.method === 'store' && call.args[0] === '42')) throw new Error('scenario migration did not replay Storage.store(42)')
  return calls
}

const compileWithPinnedTronBox = (dir) => {
  if (process.env.TRONBOX_HANDOFF_SKIP_COMPILE === '1') return { skipped: true, versionOutput: '' }
  const binary = resolveTronBox()
  const versionOutput = run(binary.command, [...binary.prefix, 'version'], { capture: true })
  if (!versionOutput.includes(`TronBox v${compatibility.tronboxVersion}`)) {
    throw new Error(`expected TronBox v${compatibility.tronboxVersion}, got: ${versionOutput.trim()}`)
  }
  run(binary.command, [...binary.prefix, 'compile', '--all'], { cwd: dir })
  for (const artifact of ['Migrations.json', 'Storage.json']) {
    const target = path.join(dir, 'build/contracts', artifact)
    if (!fs.existsSync(target)) throw new Error(`TronBox compile did not create ${artifact}`)
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (!parsed.abi || !parsed.bytecode) throw new Error(`${artifact} is missing ABI or bytecode`)
  }
  return { skipped: false, versionOutput: versionOutput.trim() }
}

;(async () => {
  const startedAt = Date.now()
  const dir = prepareProject()
  try {
    validateGeneratedProject(dir)
    const calls = await dryRunMigrations(dir)
    const compiled = compileWithPinnedTronBox(dir)
    console.log(JSON.stringify({
      ok: true,
      schemaVersion: compatibility.schemaVersion,
      tronboxVersion: compatibility.tronboxVersion,
      solcVersion: compatibility.solcVersion,
      gates: {
        exportMatchesFixture: 'passed',
        metadataSchema: 'passed',
        migrationSyntax: 'passed',
        migrationDryRun: 'passed',
        tronboxCompile: compiled.skipped ? 'skipped' : 'passed'
      },
      dryRunCalls: calls,
      durationMs: Date.now() - startedAt,
      tempProject: dir
    }, null, 2))
  } catch (error) {
    fail(error && error.stack ? error.stack : error)
  } finally {
    if (process.env.TRONBOX_HANDOFF_KEEP_TEMP !== '1') fs.rmSync(dir, { recursive: true, force: true })
  }
})()
