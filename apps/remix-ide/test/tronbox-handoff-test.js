/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var childProcess = require('child_process')
var test = require('tape')
var root = path.resolve(__dirname, '../../..')
var fixtureRoot = path.join(root, 'apps/remix-ide/test/fixtures/tronbox-handoff')
var exporter = require('../src/app/tabs/runTab/model/tronbox-export.js')

test('TronBox handoff compatibility fixture pins the published toolchain', function (t) {
  var compatibility = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'compatibility.json'), 'utf8'))
  var scenario = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.fixture), 'utf8'))
  var metadata = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.metadataFixture), 'utf8'))
  var metadataSchema = JSON.parse(fs.readFileSync(path.resolve(fixtureRoot, compatibility.metadataSchema), 'utf8'))

  t.equal(compatibility.schemaVersion, 1, 'compatibility contract is versioned')
  t.equal(compatibility.tronboxVersion, '4.8.0', 'one published TronBox version is pinned')
  t.equal(compatibility.nodeVersion, '20.19.2', 'CI and compatibility fixture use the project Node version')
  t.equal(compatibility.solcVersion, scenario.compilerVersion, 'export compiler matches the recorded fixture')
  t.deepEqual(compatibility.requiredGates, ['export_matches_fixture', 'metadata_schema', 'migration_syntax', 'migration_dry_run', 'tronbox_compile'], 'all compatibility gates are explicit')
  t.equal(metadataSchema.properties.schemaVersion.const, 1, 'the public metadata JSON Schema pins v1')
  t.equal(metadata.schemaVersion, exporter.TRONIDE_EXPORT_SCHEMA_VERSION, 'the shared metadata fixture uses the exporter schema version')
  t.deepEqual(metadata.compatibility.testedTronbox, { package: compatibility.tronboxPackage, version: compatibility.tronboxVersion }, 'metadata names the same published compatibility baseline')
  t.end()
})

test('runnable Recorder fixture translates without TODO loss or compiler drift', function (t) {
  var compatibility = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'compatibility.json'), 'utf8'))
  var scenario = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.fixture), 'utf8'))
  var migration = exporter.scenarioToMigration(scenario)
  var config = exporter.tronboxConfig(compatibility.solcVersion)

  t.ok(migration.includes("artifacts.require('Storage')"), 'fixture requires the recorded contract')
  t.ok(migration.includes('await deployer.deploy(Storage)'), 'fixture preserves the deployment')
  t.ok(migration.includes('.store("42")'), 'fixture preserves the recorded interaction')
  t.notOk(migration.includes('TODO'), 'fully convertible fixture has no hidden TODO')
  t.ok(config.includes("version: '0.8.20'"), 'generated TronBox config pins the actual compiler')
  t.ok(exporter.README.includes('tronide-export.json'), 'exported README explains the public metadata file')
  t.ok(exporter.README.includes('tronbox@4.8.0'), 'exported README uses the tested published TronBox baseline')
  t.end()
})

test('TronBox migration generation rejects executable identifier and value injection', function (t) {
  var maliciousValue = {
    transactions: [{
      timestamp: 1,
      record: {
        type: 'constructor',
        contractName: 'Storage',
        parameters: [],
        value: '0, x: require("child_process").execSync("echo PWN")'
      }
    }]
  }
  t.throws(function () { exporter.scenarioToMigration(maliciousValue) }, /callValue must be a non-negative integer/, 'callValue is a numeric literal, not JavaScript source')
  t.throws(function () {
    exporter.scenarioToMigration({ transactions: [{ timestamp: 1, record: { type: 'constructor', contractName: "Safe'); require('child_process').execSync('echo PWN');//", parameters: [] } }] })
  }, /Unsafe contract name/, 'artifact identifiers cannot escape the generated require statement')
  t.throws(function () {
    exporter.scenarioToMigration({
      transactions: [
        { timestamp: 1, record: { type: 'constructor', contractName: 'Storage', parameters: [] } },
        { timestamp: 2, record: { type: 'function', to: 'created{1}', name: 'store; require("child_process")', parameters: [] } }
      ]
    })
  }, /Unsafe method name/, 'method identifiers cannot inject statements into a migration')
  t.end()
})

test('TronBox migration preserves transaction options and fences unsupported metadata', function (t) {
  var payable = exporter.scenarioToMigration({ transactions: [{
    timestamp: 1,
    record: {
      type: 'constructor',
      contractName: 'Payable',
      parameters: [],
      callValue: '100',
      feeLimit: '123',
      userFeePercentage: 5,
      originEnergyLimit: 100
    }
  }] })
  t.ok(payable.includes('await deployer.deploy(Payable, { callValue: 100, feeLimit: 123, userFeePercentage: 5, originEnergyLimit: 100 });'), 'payable deployment keeps call value and fee/resource options')

  var trc10Call = exporter.scenarioToMigration({ transactions: [
    { timestamp: 1, record: { type: 'constructor', contractName: 'Storage', parameters: [] } },
    { timestamp: 2, record: {
      type: 'function',
      to: 'created{1}',
      name: 'pay',
      parameters: ['7'],
      callValue: '3',
      tokenId: '1000001',
      tokenValue: '2',
      feeLimit: '123',
      userFeePercentage: 5,
      originEnergyLimit: 100
    } }
  ] })
  t.ok(trc10Call.includes('await storage.pay("7", { callValue: 3, feeLimit: 123, userFeePercentage: 5, originEnergyLimit: 100, tokenId: 1000001, tokenValue: 2 });'), 'function calls keep TRX, TRC10 and resource options')

  var trc10Constructor = exporter.scenarioToMigration({ transactions: [{
    timestamp: 1,
    record: { type: 'constructor', contractName: 'Token', parameters: [], tokenId: '1000001', tokenValue: '2' }
  }] })
  t.ok(trc10Constructor.includes('TODO: TRON IDE recorded deployment metadata'), 'unsupported constructor metadata is disclosed')
  t.ok(trc10Constructor.includes('// await deployer.deploy(Token);'), 'unsupported deployment is fenced instead of silently downgraded')
  t.notOk(trc10Constructor.includes('.deployed()'), 'unsupported deployment does not pretend an instance was created')

  var unsafeCallValue = exporter.scenarioToMigration({ transactions: [{
    timestamp: 1,
    record: { type: 'constructor', contractName: 'BigValue', parameters: [], callValue: '9007199254740993' }
  }] })
  t.ok(unsafeCallValue.includes('callValue=9007199254740993 exceeds JavaScript safe-integer range'), 'unsafe call value is disclosed with its exact amount')
  t.ok(unsafeCallValue.includes('// await deployer.deploy(BigValue);'), 'unsafe call value fences the deployment instead of rounding it')
  t.notOk(unsafeCallValue.includes('callValue: 9007199254740993'), 'unsafe call value is never emitted as a lossy JavaScript literal')

  t.throws(function () {
    exporter.scenarioToMigration({ transactions: [{ timestamp: 1, record: { type: 'constructor', contractName: 'Payable', parameters: [], userFeePercentage: 101 } }] })
  }, /between 0 and 100/, 'invalid fee percentage is rejected')
  t.end()
})

test('TronBox migration uses collision-safe instance bindings', function (t) {
  var migration = exporter.scenarioToMigration({ transactions: [
    { timestamp: 1, record: { type: 'constructor', contractName: 'Class', parameters: [] } },
    { timestamp: 2, record: { type: 'constructor', contractName: 'Storage', parameters: [] } },
    { timestamp: 3, record: { type: 'constructor', contractName: 'storage', parameters: [] } }
  ] })
  t.ok(migration.includes('const instanceClass = await Class.deployed();'), 'reserved lower-case keyword is escaped')
  t.notOk(migration.includes('const class ='), 'reserved keyword is never emitted as a binding')
  t.ok(migration.includes('const storage2 = await Storage.deployed();'), 'instance name avoids a later lower-case artifact binding')
  t.ok(migration.includes('const storage3 = await storage.deployed();'), 'case-insensitive contract names remain distinct')
  t.end()
})

test('tronide-export.json generator is deterministic, versioned, and future-version aware', function (t) {
  var compatibility = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'compatibility.json'), 'utf8'))
  var scenario = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.fixture), 'utf8'))
  var expected = JSON.parse(fs.readFileSync(path.join(fixtureRoot, compatibility.metadataFixture), 'utf8'))
  var metadata = exporter.createTronideExportMetadata({
    tronideVersion: '2.3.3',
    solcVersion: scenario.compilerVersion,
    solcSource: 'scenario',
    network: { source: 'scenario', provider: 'vm', name: 'JavaScript VM (Tron)', id: null },
    scenarioSource: { type: 'workspace-file', path: compatibility.fixture, schemaVersion: scenario.schemaVersion, transactionCount: scenario.transactions.length }
  })

  t.deepEqual(metadata, expected, 'generator matches the architecture-group fixture byte-for-byte after JSON parsing')
  t.deepEqual(exporter.validateTronideExportMetadata(metadata), { ok: true, errors: [] }, 'v1 fixture passes the public contract validator')
  t.equal(metadata.compatibility.apiBoundary, 'generated-project-files', 'interop depends only on public project files')
  t.notOk(Object.prototype.hasOwnProperty.call(metadata, 'privateApi'), 'no TronBox private API is represented')
  t.notOk(JSON.stringify(metadata).includes('TFixtureSender') || JSON.stringify(metadata).includes('"42"'), 'metadata summarizes the scenario without copying accounts or transaction arguments')
  t.equal(exporter.validateTronideExportMetadata({ ...metadata, additiveV1Field: true }).ok, true, 'v1 consumers ignore additive unknown fields')
  var future = { ...metadata, schemaVersion: 2, futureField: true }
  var futureValidation = exporter.validateTronideExportMetadata(future)
  t.equal(futureValidation.ok, false, 'a v1 reader rejects a future schema version instead of guessing')
  t.ok(futureValidation.errors.some(function (error) { return error.includes('unsupported schemaVersion') }), 'future-version failure is explicit')
  t.throws(function () {
    exporter.createTronideExportMetadata({ scenarioSource: { type: 'workspace-file', path: '../private.json' } })
  }, /safe relative path/, 'producer refuses an unsafe scenario source path')
  t.end()
})

test('TronBox handoff gate performs syntax and migration dry validation without network', function (t) {
  var result = childProcess.spawnSync(process.execPath, ['scripts/validate-tronbox-handoff.cjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TRONBOX_HANDOFF_SKIP_COMPILE: '1' }
  })
  t.equal(result.status, 0, `offline compatibility validation exits cleanly: ${result.stderr || ''}`)
  var report = JSON.parse(result.stdout)
  t.equal(report.gates.exportMatchesFixture, 'passed', 'exported files match the runnable fixture')
  t.equal(report.gates.metadataSchema, 'passed', 'versioned handoff metadata matches the public fixture')
  t.equal(report.gates.migrationSyntax, 'passed', 'both migration scripts parse')
  t.equal(report.gates.migrationDryRun, 'passed', 'fake deployer executes the migration in order')
  t.equal(report.gates.tronboxCompile, 'skipped', 'unit test explicitly leaves the external compiler to its required CI job')
  t.deepEqual(report.dryRunCalls.map(function (call) { return `${call.type}:${call.contract}${call.method ? `.${call.method}` : ''}` }), ['deploy:Migrations', 'deploy:Storage', 'call:Storage.store'], 'dry run deploys and interacts in the recorded order')
  t.end()
})

test('CI runs the fixed-version TronBox compatibility gate as blocking work', function (t) {
  var github = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  var packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  t.equal(packageJson.scripts['test:tronbox-handoff'], 'node scripts/validate-tronbox-handoff.cjs', 'package script exposes the same local/CI gate')
  t.ok(github.includes('tronbox-handoff:') && github.includes('pnpm test:tronbox-handoff'), 'GitHub CI has a required compatibility job')
  if (fs.existsSync(path.join(root, '.gitlab-ci.yml'))) {
    var gitlab = fs.readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8')
    var gitlabCoreRunner = fs.readFileSync(path.join(root, 'scripts/run-core-tests-ci.sh'), 'utf8')
    t.ok(gitlabCoreRunner.includes('TRONBOX_HANDOFF_SKIP_COMPILE=1') && gitlab.includes('pnpm test:tronbox-handoff'), 'GitLab runs the offline handoff contract in the fast gate and the real compile in full review')
  } else {
    t.comment('GitLab TronBox assertions skipped in the public mirror')
  }
  t.notOk(github.includes('tronbox-handoff:\n    continue-on-error: true'), 'compatibility job is not allowed to fail')
  t.end()
})
