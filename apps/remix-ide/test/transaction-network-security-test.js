/*
 * Regression coverage for the udapp plugin transaction network allowlist.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var networkSecurity = require('../src/blockchain/transaction-network-security')

async function rejection (value) {
  try {
    await value
    return null
  } catch (error) {
    return error
  }
}

test('plugin transactions fail closed outside VM and TRON test networks', async function (t) {
  var allowed = networkSecurity.isPluginTransactionNetworkAllowed

  t.equal(allowed({ name: 'JavaScript VM (Tron)', id: '-' }), true, 'JavaScript VM is allowed')
  t.equal(allowed({ name: 'TRON', id: 'nile' }), true, 'Nile is allowed')
  t.equal(allowed({ name: 'TRON', id: 'shasta' }), true, 'Shasta is allowed')
  t.equal(allowed({ name: 'TRON', id: 'main' }), false, 'TRON mainnet is denied')
  t.equal(allowed({ name: 'Custom', id: 'Unknown' }), false, 'custom networks are denied')
  t.equal(allowed({ name: 'Unknown', id: 'Unknown' }), false, 'unknown networks are denied')
  t.equal(allowed({ name: 'Main', id: '1' }), false, 'the obsolete Ethereum-shaped mainnet tuple is denied')
  t.equal(allowed(null), false, 'missing network data is denied')

  var forged = { externalPluginTransaction: true }
  t.equal(networkSecurity.isExternalPluginTransaction(forged), false, 'a string-keyed connector payload cannot forge provenance')
  var marked = networkSecurity.markExternalPluginTransaction({})
  t.equal(networkSecurity.isExternalPluginTransaction(marked), true, 'host code can mark untrusted transaction provenance')
  t.deepEqual(Object.keys(marked), [], 'the module-private marker is not connector-visible data')
  var inherited = networkSecurity.inheritExternalPluginTransaction(marked, {})
  t.equal(networkSecurity.isExternalPluginTransaction(inherited), true, 'provenance can be explicitly carried to a derived transaction')

  var commits = 0
  var probes = 0
  var initialNetwork = await networkSecurity.verifyPluginTransactionNetwork(function (callback) {
    callback(null, { name: 'TRON', id: 'nile' })
  })
  t.equal(initialNetwork.id, 'nile', 'the initial external API check allows Nile')
  var switchedError = await rejection(networkSecurity.guardPluginTransactionCommit(marked, function (callback) {
    probes++
    callback(null, { name: 'TRON', id: 'main' })
  }, function () {
    commits++
  }))
  t.ok(switchedError && /allowed only on JavaScript VM, Nile, or Shasta/.test(switchedError.message), 'commit-time guard catches a switch from Nile to mainnet')
  t.equal(probes, 1, 'commit-time guard probes the live network again')
  t.equal(commits, 0, 'network switch is denied before commit/rawRun')

  var probeError = await rejection(networkSecurity.guardPluginTransactionCommit(marked, function (callback) {
    callback(new Error('offline'))
  }, function () {
    commits++
  }))
  t.ok(probeError && /Could not verify the active network/.test(probeError.message), 'network probe errors fail closed')
  t.equal(commits, 0, 'probe errors cannot reach commit/rawRun')

  var staleError = await rejection(networkSecurity.verifyPluginTransactionNetwork(function (callback) {
    callback(null, { name: 'TRON', id: 'nile', stale: true })
  }))
  t.ok(staleError && /Could not verify the active network/.test(staleError.message), 'stale cached status cannot authorize a transaction')

  var unrestrictedProbes = 0
  await networkSecurity.guardPluginTransactionCommit({}, function () { unrestrictedProbes++ }, function () { commits++ })
  t.equal(unrestrictedProbes, 0, 'manual/native transactions do not receive the external probe')
  t.equal(commits, 1, 'manual/native transaction behavior is preserved')

  var batchNetworks = [{ name: 'TRON', id: 'shasta' }, { name: 'Custom', id: 'Unknown' }]
  var batchCommits = 0
  var batchProbes = 0
  for (const network of batchNetworks) {
    var batchTx = networkSecurity.markExternalPluginTransaction({})
    await rejection(networkSecurity.guardPluginTransactionCommit(batchTx, function (callback) {
      batchProbes++
      callback(null, network)
    }, function () { batchCommits++ }))
  }
  t.equal(batchProbes, 2, 'a batch replay probes every individual transaction')
  t.equal(batchCommits, 1, 'the batch stops committing when a later network becomes disallowed')

  var blockchainSource = fs.readFileSync(path.join(__dirname, '../src/blockchain/blockchain.js'), 'utf8')
  var runTabSource = fs.readFileSync(path.join(__dirname, '../src/app/udapp/run-tab.js'), 'utf8')
  var recorderSource = fs.readFileSync(path.join(__dirname, '../src/app/tabs/runTab/model/recorder.js'), 'utf8')
  t.ok(blockchainSource.includes('guardPluginTransactionCommit('), 'Blockchain.runTx wraps commit/rawRun in the centralized guard')
  t.ok(blockchainSource.includes('verifyPluginTransactionNetwork((callback) => this.executionContext.detectNetwork(callback))'), 'legacy sendTransaction uses the same centralized verifier')
  t.ok(runTabSource.includes('markExternalPluginTransaction(txMeta)'), 'RunTab marks deploy/write provenance after caller verification')
  t.ok(recorderSource.includes('inheritExternalPluginTransaction(securityContext, record)'), 'every replay record inherits untrusted provenance')
  t.end()
})
