/*
 * Keep the app bootstrap's instance-level permission wiring executable. Most
 * of these plugins live in UI-heavy modules, so this test combines a precise
 * source wiring assertion with a DOM-free authorization-path regression.
 */

'use strict'

var Module = require('module')
var fs = require('fs')
var path = require('path')
var test = require('tape')
var permissionSecurity = require('../src/app/ui/permission-security')
var trustSecurity = require('../src/lib/plugin-trust-security')

var appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8')

function loadWithStubs (relativePath, stubs) {
  var originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  var babelRegister = require('@babel/register')
  babelRegister({ extensions: ['.js'], cache: false })
  var modulePath = require.resolve(relativePath)
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function loadRemixAppManager () {
  class PluginManager {
    constructor () {
      this.profiles = {}
    }
  }

  return loadWithStubs('../src/remixAppManager', {
    '@remixproject/engine': { PluginManager: PluginManager },
    './app/components/secure-iframe-plugin': { SecureIframePlugin: function () {} },
    './lib/query-params': function () {},
    './lib/url-param-security': { filterUrlPluginNames: function (names) { return names } },
    './app/ui/persmission-handler': { PermissionHandler: function () {} }
  }).RemixAppManager
}

function normalizeEntries (source) {
  return source
    .split(',')
    .map(function (entry) { return entry.replace(/\/\/[^\n]*/g, '').trim() })
    .filter(Boolean)
}

function arrayBefore (source, suffix, searchFrom) {
  var marker = source.indexOf(suffix, searchFrom || 0)
  if (marker < 0) throw new Error('Cannot find app wiring suffix: ' + suffix)
  var end = source.lastIndexOf(']', marker)
  if (end < 0) throw new Error('Cannot find app wiring array before: ' + suffix)
  var start = source.lastIndexOf(';[', end)
  if (start < 0) throw new Error('Cannot find app wiring array before: ' + suffix)
  return normalizeEntries(source.slice(start + 2, end))
}

test('app bootstrap gates every sensitive core and bundled target instance', function (t) {
  var constructorGates = [
    ['editor', 'Editor'],
    ['contentImport', 'CompilerImports'],
    ['compilerMetadataGenerator', 'CompilerMetadata'],
    ['compilersArtefacts', 'CompilerArtefacts'],
    ['fetchAndCompile', 'FetchAndCompile'],
    ['offsetToLineColumnConverter', 'OffsetToLineColumnConverter'],
    ['aiPanel', 'AiPanel']
  ]

  constructorGates.forEach(function (entry) {
    var assignment = new RegExp(
      'const\\s+' + entry[0] + '\\s*=\\s*installPermissionedCallPluginMethod\\(\\s*new\\s+' + entry[1] + '\\b'
    )
    t.ok(assignment.test(appSource), entry[0] + ' is wrapped at construction before registration')
  })

  var gatedBundledTargets = arrayBefore(
    appSource,
    '.forEach((plugin) => installPermissionedCallPluginMethod',
    appSource.indexOf('// These bundled tools can otherwise become confused deputies')
  )
  t.deepEqual(gatedBundledTargets, [
    'compileTab.compileTabLogic',
    'analysis',
    'debug',
    'contractVerification',
    'gitPanel',
    'solidityUml',
    'test',
    'filePanel.remixdHandle',
    'filePanel.gitHandle'
  ], 'the complete confused-deputy target list is wrapped, including solidity-logic')

  var trustedBundledTargets = arrayBefore(
    appSource,
    '.forEach((plugin) => markTrustedPluginProfile',
    appSource.indexOf('// Mark only the bundled extension instances created by this host')
  )
  t.deepEqual(trustedBundledTargets, [
    'compileTab',
    'compileTab.compileTabLogic',
    'analysis',
    'debug',
    'test',
    'contractVerification',
    'gitPanel',
    'solidityUml',
    'filePanel.remixdHandle'
  ], 'every bundled privileged extension is provenance-marked before engine registration')

  var registerPosition = appSource.indexOf('engine.register([', appSource.indexOf('// Mark only the bundled extension instances created by this host'))
  var logicGatePosition = appSource.indexOf('compileTab.compileTabLogic', appSource.indexOf('// These bundled tools can otherwise become confused deputies'))
  var logicTrustPosition = appSource.indexOf('compileTab.compileTabLogic', appSource.indexOf('// Mark only the bundled extension instances created by this host'))
  t.ok(logicGatePosition >= 0 && logicGatePosition < registerPosition, 'solidity-logic is gated before engine registration')
  t.ok(logicTrustPosition >= 0 && logicTrustPosition < registerPosition, 'solidity-logic is trusted before engine registration')

  var homeConstructionPosition = appSource.indexOf('const landingPage = new LandingPage')
  var homeTrustPosition = appSource.indexOf('markTrustedPluginProfile(landingPage.profile)', homeConstructionPosition)
  var systemViewRegistrationPosition = appSource.indexOf('engine.register([', homeTrustPosition)
  t.ok(trustSecurity.trustedExtensionPluginNames.includes('home'), 'Home is a reserved bundled extension name')
  t.ok(homeTrustPosition > homeConstructionPosition && homeTrustPosition < systemViewRegistrationPosition, 'Home receives instance-bound trust before engine registration')
  t.end()
})

test('trusted solidity-logic import calls bypass the user prompt but still use the target gate', async function (t) {
  var previousWindow = global.window
  global.window = { _paq: [] }
  var RemixAppManager
  try {
    RemixAppManager = loadRemixAppManager()
  } finally {
    global.window = previousWindow
  }

  t.ok(
    trustSecurity.trustedExtensionPluginNames.includes('solidity-logic'),
    'solidity-logic is a reserved bundled extension name'
  )

  var logicProfile = {
    name: 'solidity-logic',
    methods: ['getCompilerState']
  }
  trustSecurity.markTrustedPluginProfile(logicProfile)
  var storedLogicProfile = { ...logicProfile }
  t.equal(
    trustSecurity.isTrustedHostPluginProfile(storedLogicProfile),
    true,
    'the non-JSON provenance marker survives the manager profile clone'
  )

  var dispatches = 0
  var contentImport = {
    profile: {
      name: 'contentImport',
      methods: ['resolveAndSave']
    },
    currentRequest: { from: 'solidity-logic' },
    callPluginMethod: function (method, args) {
      dispatches++
      return this[method](...(args || []))
    },
    resolveAndSave: function (url) {
      return 'resolved:' + url
    }
  }
  permissionSecurity.installPermissionedCallPluginMethod(
    contentImport,
    function (method) { return 'use compiler import capability ' + method }
  )

  var manager = Object.create(RemixAppManager.prototype)
  var userPrompts = 0
  manager.permissionHandler = {
    askPermission: async function () {
      userPrompts++
      return false
    }
  }
  manager.profiles = {
    'solidity-logic': storedLogicProfile,
    contentImport: contentImport.profile
  }
  // During askUserPermission the target is making the nested manager.canCall
  // request on behalf of the original solidity-logic caller.
  manager.currentRequest = { from: 'contentImport' }
  contentImport.askUserPermission = function (method, message) {
    return manager.canCall(this.currentRequest.from, this.profile.name, method, message)
  }

  var imported = await contentImport.callPluginMethod('resolveAndSave', ['@openzeppelin/contracts/Token.sol'])
  t.equal(imported, 'resolved:@openzeppelin/contracts/Token.sol', 'the normal compiler import path reaches contentImport')
  t.equal(dispatches, 1, 'the gated target dispatches the native import exactly once')
  t.equal(userPrompts, 0, 'the trusted native compiler path does not open a permission prompt')

  manager.profiles['solidity-logic'] = {
    name: 'solidity-logic',
    methods: ['getCompilerState']
  }
  var unmarkedAllowed = await manager.canCall(
    'solidity-logic',
    'contentImport',
    'resolveAndSave',
    'use compiler import capability resolveAndSave'
  )
  t.equal(unmarkedAllowed, false, 'an unmarked connector cannot gain the same native-name bypass')
  t.equal(userPrompts, 1, 'an unmarked caller is routed through explicit user authorization')
  t.end()
})
