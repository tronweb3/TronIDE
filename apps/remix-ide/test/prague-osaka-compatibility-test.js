/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var compatibility = require('../src/app/lib/prague-osaka-compatibility')
var root = path.join(__dirname, '..', '..', '..')

test('Prague and Osaka capability snapshots distinguish active, inactive and unsupported nodes', function (t) {
  var active = compatibility.createProtocolCapabilitySnapshot({
    provider: 'injected',
    chainParameters: {
      chainParameter: [
        { key: 'getAllowTvmPrague', value: 1 },
        { key: 'getAllowTvmOsaka', value: 1 }
      ]
    }
  })
  var mixed = compatibility.createProtocolCapabilitySnapshot({
    provider: 'injected',
    chainParameters: [
      { key: 'getAllowTvmPrague' }
    ]
  })
  var failed = compatibility.createProtocolCapabilitySnapshot({ provider: 'injected', error: new Error('node offline') })
  var vm = compatibility.createProtocolCapabilitySnapshot({ provider: 'vm' })

  t.equal(active.prague.status, 'active', 'raw node response wrappers and value 1 activate Prague')
  t.equal(active.osaka.status, 'active', 'value 1 activates Osaka')
  t.equal(mixed.prague.status, 'inactive', 'an exposed parameter with an omitted value is inactive')
  t.equal(mixed.osaka.status, 'unsupported', 'a missing parameter is unsupported rather than guessed')
  t.equal(failed.prague.status, 'unknown', 'provider errors preserve uncertainty')
  t.equal(vm.osaka.status, 'unsupported', 'the JavaScript VM does not pretend to expose chain parameters')
  t.end()
})

test('bytecode scanner ignores PUSH data and detects Prague and Osaka dependencies', function (t) {
  var historyAddress = '0000f90827f1c53a10cb7a02335b175320002935'
  var creation = '601e5f1e' +
    '60006000600060006101005afa' +
    '600060006000600073' + historyAddress + '5afa' +
    '600060006000600060055afa'
  var scan = compatibility.scanCompilationArtifacts({ creationBytecode: creation, runtimeBytecode: '00' })
  var ids = scan.dependencies.map(function (dependency) { return dependency.id })
  var clzMatches = scan.dependencies.find(function (dependency) { return dependency.id === 'clz' }).matches

  t.deepEqual(ids, ['clz', 'p256', 'history', 'modexp'], 'all four static dependencies are reported in stable order')
  t.equal(clzMatches.length, 1, '0x1e inside PUSH1 data is not interpreted as CLZ')
  t.equal(scan.dependencies.find(function (dependency) { return dependency.id === 'p256' }).matches[0].target, '0x100', 'P-256 target is identified from the call stack')
  t.equal(scan.dependencies.find(function (dependency) { return dependency.id === 'history' }).upgrade, 'prague', 'history contract maps to Prague')
  t.equal(scan.dependencies.find(function (dependency) { return dependency.id === 'modexp' }).blocking, false, 'MODEXP semantic drift is warning-only')
  t.end()
})

test('deployment compatibility blocks hard dependencies and warns on MODEXP semantics', function (t) {
  var scan = compatibility.scanCompilationArtifacts({
    creationBytecode: '5f1e60006000600060006101005afa600060006000600060055afa'
  })
  var unsupported = compatibility.createProtocolCapabilitySnapshot({ provider: 'vm' })
  var active = compatibility.createProtocolCapabilitySnapshot({
    provider: 'injected',
    chainParameters: [
      { key: 'getAllowTvmPrague', value: 1 },
      { key: 'getAllowTvmOsaka', value: 1 }
    ]
  })
  var blocked = compatibility.evaluateDeploymentCompatibility(scan, unsupported)
  var allowed = compatibility.evaluateDeploymentCompatibility(scan, active)

  t.equal(blocked.compatible, false, 'hard Osaka dependencies fail closed on an unsupported environment')
  t.equal(blocked.blockers.length, 2, 'CLZ and P-256 each explain why deployment is blocked')
  t.equal(blocked.warnings.length, 1, 'MODEXP reports a semantic compatibility warning')
  t.ok(compatibility.formatDeploymentCompatibilityMessage(blocked).startsWith('Deployment blocked:'), 'blocking errors use a stable user-facing prefix')
  t.equal(allowed.compatible, true, 'active Osaka allows the same bytecode')
  t.equal(allowed.warnings.length, 0, 'active Osaka removes the MODEXP warning')
  t.end()
})

test('Solidity CBOR metadata is excluded from opcode scanning', function (t) {
  // 00 FE | A1 61 78 41 1E | 00 05
  var scan = compatibility.scanBytecode('00fea16178411e0005', 'runtime')

  t.equal(scan.strippedMetadata, true, 'well-formed trailing metadata is stripped')
  t.equal(scan.matches.length, 0, 'metadata bytes cannot create a false CLZ match')
  t.end()
})

test('Deploy & Run invokes compatibility validation before transaction preparation', function (t) {
  var runTab = fs.readFileSync(path.join(root, 'apps/remix-ide/src/app/udapp/run-tab.js'), 'utf8')
  var blockchain = fs.readFileSync(path.join(root, 'apps/remix-ide/src/blockchain/blockchain.js'), 'utf8')
  var guardIndex = blockchain.indexOf('function validateDeploymentCompatibility (next)')
  var gasIndex = blockchain.indexOf('function getGasLimit (next)', guardIndex)

  t.ok(runTab.includes('data-id="protocolCapabilitiesCard"'), 'Deploy & Run exposes the capability card')
  t.ok(runTab.includes('validateDeploymentCompatibility: (data, cb)'), 'RunTab supplies the central validation callback')
  t.ok(guardIndex !== -1 && guardIndex < gasIndex, 'deployment validation runs before gas, account, signing and broadcast work')
  t.ok(blockchain.includes('data.deployedBytecode = selectedContract.deployedBytecode'), 'runtime bytecode reaches the deployment scanner')
  t.end()
})
