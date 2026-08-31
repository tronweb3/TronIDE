/*
 * Regression coverage for authorization metadata copied into the plugin
 * manager. A connector must not retain a mutable reference to canActivate.
 */

'use strict'

var test = require('tape')
var fs = require('fs')
var path = require('path')
var profileSecurity = require('../src/lib/plugin-profile-security')
var trustSecurity = require('../src/lib/plugin-trust-security')

test('plugin manager copies canActivate authorization metadata', function (t) {
  var connectorProfile = {
    name: 'externalPlugin',
    methods: ['ping'],
    events: ['ready'],
    canActivate: ['theme']
  }
  var managerProfile = profileSecurity.clonePluginProfile(connectorProfile)

  connectorProfile.canActivate.push('fileManager')

  t.notEqual(managerProfile.canActivate, connectorProfile.canActivate, 'manager and connector do not share the capability array')
  t.deepEqual(managerProfile.canActivate, ['theme'], 'connector mutation cannot add an activation capability')
  t.end()
})

test('bundled Solidity retains native trust without reserving an exploitable name', function (t) {
  var untrusted = { name: 'solidity', methods: ['compile'] }
  t.equal(trustSecurity.isTrustedExtensionPluginName('solidity'), true, 'Solidity is a host-trusted bundled extension')
  t.equal(trustSecurity.isNativePluginName('solidity'), true, 'Solidity may activate its bundled compiler-logic dependency')
  t.throws(function () {
    trustSecurity.assertAllowedPluginProfile(profileSecurity.clonePluginProfile(untrusted))
  }, /reserved for a bundled TronIDE plugin/, 'an unmarked connector cannot register as Solidity')

  var bundled = trustSecurity.markTrustedPluginProfile({ name: 'solidity', methods: ['compile'] })
  var managerCopy = profileSecurity.clonePluginProfile(bundled)
  t.doesNotThrow(function () {
    trustSecurity.assertAllowedPluginProfile(managerCopy)
  }, 'the host marker survives the manager defensive clone')
  t.equal(trustSecurity.isTrustedPluginProfile(managerCopy), true, 'the cloned bundled Solidity profile remains trusted')

  var appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8')
  t.ok(appSource.includes(';[compileTab, compileTab.compileTabLogic') && appSource.includes('markTrustedPluginProfile(plugin.profile)'), 'app.js marks the concrete bundled Solidity instances before registration')
  t.end()
})
