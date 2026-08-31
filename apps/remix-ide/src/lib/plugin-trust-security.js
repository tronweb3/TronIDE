/*
 * Host-controlled plugin names. Keep this list separate from connector
 * metadata so a local plugin cannot become trusted merely by self-reporting a
 * familiar name.
 */

'use strict'

const requiredPluginNames = [
  'manager', 'compilerArtefacts', 'compilerMetadata', 'contextualListener', 'editor', 'offsetToLineColumnConverter', 'network', 'theme',
  'fileManager', 'contentImport', 'web3Provider', 'scriptRunner', 'fetchAndCompile', 'mainPanel', 'hiddenPanel', 'sidePanel', 'menuicons',
  'filePanel', 'terminal', 'settings', 'pluginManager', 'tabs', 'udapp', 'dGitProvider', 'aiPanel', 'headerPanel'
]

// These extensions are registered by app.js as bundled host plugins. Do not
// reserve names for optional/unregistered plugins: an empty trusted name is a
// privilege-escalation slot for a local connector.
const trustedExtensionPluginNames = [
  'debugger', 'remixd', 'solidity', 'solidity-logic', 'solidityStaticAnalysis', 'solidityUnitTesting',
  'contractVerification', 'gitPanel', 'solidityUml', 'home'
]

const reservedPluginNames = new Set([...requiredPluginNames, ...trustedExtensionPluginNames])
const requiredNames = new Set(requiredPluginNames)
const trustedExtensionNames = new Set(trustedExtensionPluginNames)
const trustedProfileMarker = Symbol('tronideTrustedPluginProfile')

function isNativePluginName (name) {
  return typeof name === 'string' && reservedPluginNames.has(name)
}

function isLocalPluginProfile (profile) {
  return Boolean(profile && typeof profile.hash === 'string' && profile.hash.startsWith('local:'))
}

function isTrustedExtensionPluginName (name) {
  return typeof name === 'string' && trustedExtensionNames.has(name)
}

function markTrustedPluginProfile (profile) {
  if (!profile || typeof profile !== 'object') throw new Error('A trusted plugin must have a profile.')
  // An enumerable Symbol survives the manager's defensive object spread but
  // cannot be self-reported through JSON, iframe, or websocket metadata.
  profile[trustedProfileMarker] = true
  return profile
}

function isTrustedPluginProfile (profile) {
  return Boolean(profile && profile[trustedProfileMarker] === true)
}

function isTrustedHostPluginProfile (profile) {
  if (!profile || typeof profile.name !== 'string' || isLocalPluginProfile(profile)) return false
  return requiredNames.has(profile.name) ||
    (trustedExtensionNames.has(profile.name) && isTrustedPluginProfile(profile))
}

function assertAllowedPluginProfile (profile) {
  if (!profile || typeof profile !== 'object' || typeof profile.name !== 'string') {
    throw new Error('A plugin must have a named profile.')
  }
  if (isNativePluginName(profile.name) && isLocalPluginProfile(profile)) {
    throw new Error(`Local plugins cannot use reserved name "${profile.name}".`)
  }
  if (isTrustedExtensionPluginName(profile.name) && !isTrustedPluginProfile(profile)) {
    throw new Error(`Plugin name "${profile.name}" is reserved for a bundled TronIDE plugin.`)
  }
  return profile
}

module.exports = {
  assertAllowedPluginProfile,
  isLocalPluginProfile,
  isNativePluginName,
  isTrustedExtensionPluginName,
  isTrustedHostPluginProfile,
  isTrustedPluginProfile,
  markTrustedPluginProfile,
  requiredPluginNames,
  trustedExtensionPluginNames
}
