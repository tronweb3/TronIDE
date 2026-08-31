/*
 * Executable plugin identity helpers. Kept DOM-free so the invariants can be
 * regression-tested without booting the IDE.
 */

'use strict'

function localPluginProfileHash (profile) {
  return `local:${JSON.stringify({
    name: profile.name || '',
    url: profile.url || '',
    version: profile.version || '',
    type: profile.type || ''
  })}`
}

function clonePluginProfile (profile) {
  return {
    ...profile,
    ...(Array.isArray(profile.methods) ? { methods: [...profile.methods] } : {}),
    ...(Array.isArray(profile.events) ? { events: [...profile.events] } : {}),
    ...(Array.isArray(profile.canActivate) ? { canActivate: [...profile.canActivate] } : {})
  }
}

function isStringArray (value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function deepEqual (left, right) {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((entry, index) => deepEqual(entry, right[index]))
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]))
}

/**
 * Runtime handshakes may publish methods/events, but they must not rewrite the
 * identity that remembered grants are bound to (or other trusted metadata).
 * Unchanged fields are accepted for clients that resend their whole profile.
 */
function assertSafeProfileUpdate (currentProfile, update) {
  const hasOwn = Object.prototype.hasOwnProperty
  if (!currentProfile || !update || !hasOwn.call(update, 'name') ||
    typeof update.name !== 'string' || update.name !== currentProfile.name) {
    throw new Error('A plugin can update only its own profile.')
  }

  for (const key of Object.keys(update)) {
    if (key === 'methods' || key === 'events') {
      if (!isStringArray(update[key])) throw new Error(`Profile ${key} must be an array of strings.`)
      continue
    }
    if (!hasOwn.call(currentProfile, key) || !deepEqual(update[key], currentProfile[key])) {
      throw new Error(`Profile field "${key}" cannot be changed at runtime.`)
    }
  }
  return true
}

module.exports = {
  assertSafeProfileUpdate,
  clonePluginProfile,
  localPluginProfileHash
}
