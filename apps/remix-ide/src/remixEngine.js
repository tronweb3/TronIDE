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
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Engine } from '@remixproject/engine'
import { EventEmitter } from 'events'
import { listenEvent } from '@remixproject/plugin-utils'
import permissionSecurity from './app/ui/permission-security.js'
import pluginTrustSecurity from './lib/plugin-trust-security.js'

const { installPermissionCallerProfileResolver, isSafePermissionKey } = permissionSecurity
const { isTrustedHostPluginProfile } = pluginTrustSecurity

export class RemixEngine extends Engine {
  constructor () {
    super()
    this.event = new EventEmitter()
    this.pendingEventPermissions = new Map()
  }

  _profile (name) {
    const profiles = this.manager && this.manager.profiles
    if (!profiles || !Object.prototype.hasOwnProperty.call(profiles, name)) return null
    return profiles[name]
  }

  _isTrustedNativeListener (name, profile) {
    return Boolean(profile && profile.name === name && isTrustedHostPluginProfile(profile))
  }

  _isDeclaredEvent (profile, event) {
    return Boolean(profile && Array.isArray(profile.events) && profile.events.includes(event))
  }

  _eventPermissionKey (listener, emitter, event) {
    return JSON.stringify([listener, emitter, event])
  }

  _isSafeEventSubscription (listener, emitter, event, cb) {
    return isSafePermissionKey(listener) && isSafePermissionKey(emitter) &&
      isSafePermissionKey(event) && event.length <= 200 && typeof cb === 'function'
  }

  /**
   * Sensitive plugins publish data on the engine event bus as well as through
   * methods. External connectors therefore need the same explicit permission
   * before their callback is attached. Native listeners keep the engine's
   * original synchronous registration path so activation ordering is unchanged.
   */
  addListener (listener, emitter, event, cb) {
    if (!this._isSafeEventSubscription(listener, emitter, event, cb)) return false

    const emitterProfile = this._profile(emitter)
    const listenerProfile = this._profile(listener)
    if (this._isTrustedNativeListener(listener, listenerProfile)) {
      return super.addListener(listener, emitter, event, cb)
    }
    // Do not let an external connector pre-subscribe to a trusted name before
    // that emitter (or even the connector profile itself) has been registered.
    if (!emitterProfile || !listenerProfile) return false
    // Engine's base implementation accepts arbitrary event names. A raw
    // connector could otherwise listen to internal/undeclared events (for
    // example editor breakpoints or tab file paths) that normal plugin clients
    // never expose. Treat the emitter profile as the public event allowlist.
    if (!this._isDeclaredEvent(emitterProfile, event)) return false
    if (emitterProfile.permission !== true) return super.addListener(listener, emitter, event, cb)

    const permissionHandler = this.manager && this.manager.permissionHandler
    if (!listenerProfile || !permissionHandler || typeof permissionHandler.askPermission !== 'function' ||
      !this.manager || typeof this.manager.isActive !== 'function') return false

    const key = this._eventPermissionKey(listener, emitter, event)
    let pending = this.pendingEventPermissions.get(key)
    if (!pending) {
      // Engine keeps one callback per listener/emitter/event. Preserve that
      // first-listener behavior while a prompt is pending instead of allowing
      // repeated connector messages to grow an unbounded callback array.
      pending = { callback: cb, cancelled: false, promise: null }
      this.pendingEventPermissions.set(key, pending)
      pending.promise = Promise.resolve()
        .then(() => permissionHandler.askPermission(
          listenerProfile,
          emitterProfile,
          `event:${event}`,
          `subscribe to the ${event} event`
        ))
        .then((allowed) => {
          if (!allowed || pending.cancelled) return false
          return Promise.resolve(this.manager.isActive(listener))
            .catch(() => false)
            .then((active) => {
              if (!active || pending.cancelled) return false
              if (!pending.callback) return false
              super.addListener(listener, emitter, event, pending.callback)
              return true
            })
        })
        // Decline rejects in PermissionHandler. Event registration is a
        // fire-and-forget connector message, so consume it and fail closed.
        .catch(() => false)
        .finally(() => {
          if (this.pendingEventPermissions.get(key) === pending) {
            this.pendingEventPermissions.delete(key)
          }
        })
    }
    return pending.promise
  }

  removeListener (listener, emitter, event) {
    if (!isSafePermissionKey(listener) || !isSafePermissionKey(emitter) ||
      !isSafePermissionKey(event) || event.length > 200) return false

    const key = this._eventPermissionKey(listener, emitter, event)
    const pending = this.pendingEventPermissions.get(key)
    if (pending) {
      pending.cancelled = true
      pending.callback = null
      this.pendingEventPermissions.delete(key)
    }

    const eventName = listenEvent(emitter, event)
    if (!Array.isArray(this.listeners[eventName]) || !this.events[listener]) {
      if (this.events[listener]) delete this.events[listener][eventName]
      return false
    }
    return super.removeListener(listener, emitter, event)
  }

  broadcast (emitter, event, ...payload) {
    if (!isSafePermissionKey(emitter) || !isSafePermissionKey(event) || event.length > 200) return false
    return super.broadcast(emitter, event, ...payload)
  }

  setPluginOption ({ name, kind }) {
    if (kind === 'provider') return { queueTimeout: 60000 * 2 }
    // Injected-wallet writes pause while the user reviews and signs in
    // TronLink. The plugin engine's ordinary ten-second queue deadline used to
    // reject aiDeploy/aiCallMethod long before the wallet flow completed,
    // leaving the task uncertain while the still-live wallet popup could later
    // broadcast. Keep the queue slightly longer than udapp's five-minute
    // wallet safety timeout so the method, not the transport, owns the result.
    if (name === 'udapp') return { queueTimeout: 5 * 60 * 1000 + 10000 }
    // A real Solidity unit-test run compiles, deploys, and executes assertions
    // on the VM. Ten seconds is routinely too short and used to make the AI
    // runtime report a plugin TIMEOUT even though its own run_tests policy
    // correctly allows two minutes.
    if (name === 'solidityUnitTesting') return { queueTimeout: 60000 * 2 }
    if (name === 'LearnEth') return { queueTimeout: 60000 }
    if (name === 'slither') return { queueTimeout: 60000 * 4 } // Requires when a solc version is installed
    return { queueTimeout: 10000 }
  }

  onRegistration (plugin) {
    installPermissionCallerProfileResolver(plugin, (name) => this._profile(name))
    this.event.emit('onRegistration', plugin)
  }
}
