/*
 * Small, DOM-free helpers shared by the plugin permission gates.
 */

'use strict'

const { isTrustedHostPluginProfile } = require('../../lib/plugin-trust-security')

const dangerousPermissionKeys = new Set(['__proto__', 'prototype', 'constructor'])
const permissionedCallPluginMethod = Symbol('permissionedCallPluginMethod')
const internalPermissionedCallPluginMethod = Symbol('internalPermissionedCallPluginMethod')
const permissionCallerProfileResolver = Symbol('permissionCallerProfileResolver')

function createPermissionMap () {
  return Object.create(null)
}

function hasOwnPermission (map, key) {
  return Boolean(map) && Object.prototype.hasOwnProperty.call(map, key)
}

function isSafePermissionKey (key) {
  return typeof key === 'string' && key.length > 0 && !dangerousPermissionKeys.has(key)
}

/**
 * Return a remembered decision only when it belongs to the current executable
 * plugin identity. `null` means that the user must be asked again.
 */
function rememberedPermissionDecision (permission, profileHash) {
  if (!permission || typeof permission.allow !== 'boolean') return null
  if (typeof permission.hash !== 'string' || typeof profileHash !== 'string') return null
  return permission.hash === profileHash ? permission.allow : null
}

/**
 * Require an explicit/remembered grant before an external plugin mutates IDE
 * state. Internal calls have no currentRequest; native external callers are
 * approved by the manager without showing a prompt.
 */
async function hasUserPermission (plugin, method, message) {
  const request = plugin.currentRequest
  if (!request) return true
  // Host-to-host calls are registered and provenance-checked by RemixEngine.
  // Resolve that profile synchronously so a busy manager queue cannot make a
  // native UI action time out while waiting for the nested canCall request.
  // Untrusted callers still use the normal prompt and late-approval guard.
  const resolveCallerProfile = plugin[permissionCallerProfileResolver]
  if (typeof resolveCallerProfile === 'function') {
    let callerProfile = null
    try { callerProfile = resolveCallerProfile(request.from) } catch (error) {}
    if (callerProfile && callerProfile.name === request.from && isTrustedHostPluginProfile(callerProfile)) return true
  }
  const allowed = await plugin.askUserPermission(method, message || '')
  // PluginQueueItem releases currentRequest when its RPC times out or is
  // cancelled, even though a permission modal may still be waiting. Never let
  // a late Accept execute under no caller (or under the next queued caller),
  // because downstream network/provider checks derive trust from this exact
  // request object.
  if (plugin.currentRequest !== request) throw new Error(`Permission request expired ${method}`)
  return Boolean(allowed)
}

function installPermissionCallerProfileResolver (plugin, resolver) {
  if (!plugin || typeof plugin !== 'object' || typeof resolver !== 'function') {
    throw new Error('A permission caller profile resolver requires a plugin and resolver.')
  }
  Object.defineProperty(plugin, permissionCallerProfileResolver, {
    configurable: false,
    enumerable: false,
    value: resolver
  })
  return plugin
}

async function requireUserPermission (plugin, method, message) {
  const allowed = await hasUserPermission(plugin, method, message)
  if (!allowed) throw new Error(`Permission denied ${method}`)
  return true
}

/**
 * Preserve direct/internal return shapes while gating an engine-dispatched
 * external call. This is especially useful from a target's callPluginMethod
 * override, before the exposed implementation reads any state or arguments.
 */
function withUserPermission (plugin, method, message, action) {
  if (!plugin.currentRequest) return action()
  return requireUserPermission(plugin, method, message).then(action)
}

/**
 * Install one target-side gate in front of every engine-dispatched method on a
 * plugin instance. Direct calls do not carry currentRequest and therefore keep
 * the original synchronous/asynchronous return shape. Calling this helper more
 * than once is intentionally a no-op, so composition cannot double-prompt.
 *
 * messageFactory receives only the exposed method name; it must not inspect
 * payload or target state before authorization.
 */
function installPermissionedCallPluginMethod (plugin, messageFactory) {
  if (!plugin || typeof plugin.callPluginMethod !== 'function') {
    throw new Error('A permissioned plugin must implement callPluginMethod.')
  }
  if (plugin[permissionedCallPluginMethod]) return plugin
  if (!plugin.profile || typeof plugin.profile !== 'object') {
    throw new Error('A permissioned plugin must have a profile.')
  }

  plugin.profile = {
    ...plugin.profile,
    ...(Array.isArray(plugin.profile.methods) ? { methods: [...plugin.profile.methods] } : {}),
    ...(Array.isArray(plugin.profile.events) ? { events: [...plugin.profile.events] } : {}),
    ...(Array.isArray(plugin.profile.canActivate) ? { canActivate: [...plugin.profile.canActivate] } : {}),
    permission: true
  }
  const originalCallPluginMethod = plugin.callPluginMethod.bind(plugin)
  Object.defineProperty(plugin, permissionedCallPluginMethod, { value: true })
  Object.defineProperty(plugin, internalPermissionedCallPluginMethod, { value: 0, writable: true })

  // PluginConnector.handshake() calls callPluginMethod('handshake') itself.
  // A websocket can reconnect while an unrelated request still owns
  // currentRequest; without an internal-dispatch marker that transport
  // handshake would be mistaken for an external exposed call and fail (the
  // handshake method is intentionally absent from connector profiles). Keep
  // the marker synchronous so concurrent engine requests cannot inherit it.
  if (typeof plugin.handshake === 'function') {
    const originalHandshake = plugin.handshake
    plugin.handshake = function (...args) {
      this[internalPermissionedCallPluginMethod]++
      try {
        return originalHandshake.apply(this, args)
      } finally {
        this[internalPermissionedCallPluginMethod]--
      }
    }
  }

  plugin.callPluginMethod = function (method, args) {
    if (!this.currentRequest || this[internalPermissionedCallPluginMethod] > 0) {
      return originalCallPluginMethod(method, args)
    }
    const message = typeof messageFactory === 'function' ? messageFactory(method) : (messageFactory || '')
    return withUserPermission(this, method, message, () => originalCallPluginMethod(method, args))
  }
  return plugin
}

class SerialTaskQueue {
  constructor () {
    this.tail = Promise.resolve()
  }

  enqueue (task) {
    const result = this.tail.then(task, task)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

module.exports = {
  createPermissionMap,
  hasUserPermission,
  hasOwnPermission,
  isSafePermissionKey,
  installPermissionCallerProfileResolver,
  installPermissionedCallPluginMethod,
  rememberedPermissionDecision,
  requireUserPermission,
  withUserPermission,
  SerialTaskQueue
}
