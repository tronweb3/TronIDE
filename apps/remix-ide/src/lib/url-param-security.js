/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

'use strict'

// URL fragments are untrusted input. Keep deep links for ordinary IDE panels,
// but never let a link start a local bridge, a hidden code runner, or an
// arbitrary locally registered plugin.
const URL_PLUGIN_ALLOWLIST = new Set([
  'home',
  'filePanel',
  'solidity',
  'udapp',
  'debugger',
  'solidityStaticAnalysis',
  'solidityUnitTesting',
  'contractVerification',
  'gitPanel',
  'solidityUml',
  'pluginManager',
  'settings',
  'aiPanel'
])

// Preserve the documented "open this workspace file" deep link. It only
// changes the visible editor tab; every mutating/native RPC method is denied.
const URL_CALL_ALLOWLIST = {
  fileManager: new Set(['open'])
}

// Import-by-URL is a useful GitHub deep-link feature (including the 404.html
// rewrite), but an unrestricted URL turns the browser into a localhost/private
// network probe. These hosts cover GitHub source and Gist links without
// admitting arbitrary public or local-network endpoints.
const URL_IMPORT_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com'
])

// QueryParams intentionally preserves raw fragment values so encoded `&` and
// `=` characters survive parsing. Decode exactly once at each validated
// consumer instead of weakening that parser-wide round trip guarantee.
function decodeUrlParameter (raw, maxLength = 4096) {
  if (typeof raw !== 'string' || raw.length > maxLength) return null
  try { return decodeURIComponent(raw) } catch (e) { return null }
}

function filterUrlPluginNames (raw) {
  const value = decodeUrlParameter(raw, 1024)
  if (value === null) return []
  const seen = new Set()
  return value.split(',')
    .map((name) => name.trim())
    .filter((name) => {
      if (!URL_PLUGIN_ALLOWLIST.has(name) || seen.has(name)) return false
      seen.add(name)
      return true
    })
}

function isSafeWorkspacePath (raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return false
  if (raw.indexOf('\0') !== -1 || raw.indexOf('\\') !== -1 || raw.startsWith('/')) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return false
  return !raw.split('/').some((part) => part === '..')
}

function parseUrlPluginCall (raw) {
  const value = decodeUrlParameter(raw, 2048)
  if (!value) return null
  const details = value.split('//')
  if (details.length !== 3) return null
  const plugin = details[0]
  const method = details[1]
  if (!URL_CALL_ALLOWLIST[plugin] || !URL_CALL_ALLOWLIST[plugin].has(method)) return null
  if (!isSafeWorkspacePath(details[2])) return null
  return details
}

function normalizeUrlImport (raw) {
  const value = decodeUrlParameter(raw, 4096)
  if (!value) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch (e) {
    return null
  }
  const hostname = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null
  if (!URL_IMPORT_HOSTS.has(hostname)) return null
  return parsed.href
}

module.exports = {
  decodeUrlParameter,
  filterUrlPluginNames,
  isSafeWorkspacePath,
  normalizeUrlImport,
  parseUrlPluginCall
}
