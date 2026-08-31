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

/* global localStorage */
const yo = require('yo-yo')
const csjs = require('csjs-inject')
const addTooltip = require('./tooltip')
const modalDialog = require('./modaldialog')
const globalRegistry = require('../../global/registry')
const {
  createPermissionMap,
  hasOwnPermission,
  isSafePermissionKey,
  rememberedPermissionDecision,
  SerialTaskQueue
} = require('./permission-security')

const css = csjs`
.permission h4 {
  text-transform: uppercase;
  text-align: center;
}
.permission h6 {
  text-transform: uppercase;
}
.remember {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.images {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px;
}
.images img {
  width: 40px;
  height: 40px;
}
.images i {
  margin: 0 20px;
}
`

function isPlainObject (value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizePermissions (permissions) {
  if (!isPlainObject(permissions)) return createPermissionMap()

  const sanitizedPermissions = createPermissionMap()

  Object.keys(permissions).forEach((toName) => {
    if (!isSafePermissionKey(toName)) return
    const methods = permissions[toName]
    if (!isPlainObject(methods)) return

    const sanitizedMethods = createPermissionMap()

    Object.keys(methods).forEach((methodName) => {
      if (!isSafePermissionKey(methodName)) return
      const fromPlugins = methods[methodName]
      if (!isPlainObject(fromPlugins)) return

      const sanitizedFromPlugins = createPermissionMap()

      Object.keys(fromPlugins).forEach((fromName) => {
        if (!isSafePermissionKey(fromName)) return
        const permission = fromPlugins[fromName]
        if (!isPlainObject(permission)) return
        if (typeof permission.allow !== 'boolean') return
        if (typeof permission.hash !== 'string') return

        sanitizedFromPlugins[fromName] = {
          allow: permission.allow,
          hash: permission.hash
        }
      })

      if (Object.keys(sanitizedFromPlugins).length) {
        sanitizedMethods[methodName] = sanitizedFromPlugins
      }
    })

    if (Object.keys(sanitizedMethods).length) {
      sanitizedPermissions[toName] = sanitizedMethods
    }
  })

  return sanitizedPermissions
}

function notAllowWarning (from, to, method) {
  return `${from.displayName || from.name} is not allowed to call ${method} method of ${to.displayName || to.name}.`
}

export class PermissionHandler {
  constructor () {
    this.currentVersion = 1
    // here we remove the old permissions saved before adding 'permissionVersion'
    // since with v1 the structure has been changed because of new engine ^0.2.0-alpha.6 changes
    if (!localStorage.getItem('permissionVersion')) {
      localStorage.setItem('plugins/permissions', '')
      localStorage.setItem('permissionVersion', this.currentVersion)
    }
    this.permissions = this._getFromLocal()
    this.permissionRequests = new SerialTaskQueue()
  }

  _getFromLocal () {
    const permission = localStorage.getItem('plugins/permissions')
    if (!permission) return createPermissionMap()

    try {
      return sanitizePermissions(JSON.parse(permission))
    } catch (e) {
      return createPermissionMap()
    }
  }

  persistPermissions () {
    const permissions = JSON.stringify(this.permissions)
    localStorage.setItem('plugins/permissions', permissions)
  }

  clear (rememberSwitch) {
    this.permissions = createPermissionMap()
    localStorage.removeItem('plugins/permissions')
    if (rememberSwitch) rememberSwitch.checked = false
    addTooltip('All Permissions have been reset')
  }

  updatePermission (from, to, method, allow, remember) {
    if (!from || !to || !isSafePermissionKey(from.name) || !isSafePermissionKey(to.name) || !isSafePermissionKey(method)) {
      throw new Error('Invalid permission key.')
    }

    // A permission modal may have waited behind another modal, and another tab
    // may have changed grants while it was open. Merge only this decision into
    // the latest persisted map so an old snapshot cannot resurrect or erase
    // unrelated grants.
    this.permissions = this._getFromLocal()
    if (remember) {
      if (!hasOwnPermission(this.permissions, to.name)) this.permissions[to.name] = createPermissionMap()
      if (!hasOwnPermission(this.permissions[to.name], method)) this.permissions[to.name][method] = createPermissionMap()
      this.permissions[to.name][method][from.name] = { allow, hash: from.hash }
    } else if (hasOwnPermission(this.permissions, to.name) && hasOwnPermission(this.permissions[to.name], method)) {
      delete this.permissions[to.name][method][from.name]
      if (!Object.keys(this.permissions[to.name][method]).length) delete this.permissions[to.name][method]
      if (!Object.keys(this.permissions[to.name]).length) delete this.permissions[to.name]
    }
    this.persistPermissions()
  }

  /**
   * Show a message to ask the user for a permission
   * @param {PluginProfile} from The name and hash of the plugin that make the call
   * @param {ModuleProfile} to The name of the plugin that receive the call
   * @param {string} method The name of the function to be called
   * @param {string} message from the caller plugin to add more details if needed
   * @returns {Promise<{ allow: boolean; remember: boolean }} Answer from the user to the permission
   */
  async openPermission (from, to, method, message) {
    return new Promise((resolve, reject) => {
      const form = this.form(from, to, method, message)
      const rememberSwitch = form.querySelector('#remember')
      modalDialog(
        `Permission needed for ${to.displayName || to.name}`,
        form,
        {
          label: 'Accept',
          fn: () => {
            this.updatePermission(from, to, method, true, Boolean(rememberSwitch && rememberSwitch.checked))
            resolve(true)
          }
        },
        {
          label: 'Decline',
          fn: () => {
            this.updatePermission(from, to, method, false, Boolean(rememberSwitch && rememberSwitch.checked))
            reject(notAllowWarning(from, to, method))
          }
        }
      )
    })
  }

  /**
   * Check if a plugin has the permission to call another plugin and askPermission if needed
   * @param {PluginProfile} from the profile of the plugin that make the call
   * @param {ModuleProfile} to The profile of the module that receive the call
   * @param {string} method The name of the function to be called
   * @param {string} message from the caller plugin to add more details if needed
   * @returns {Promise<boolean>}
   */
  askPermission (from, to, method, message) {
    return this.permissionRequests.enqueue(() => this._askPermission(from, to, method, message))
  }

  async _askPermission (from, to, method, message) {
    try {
      if (!from || !to || !isSafePermissionKey(from.name) || !isSafePermissionKey(to.name) || !isSafePermissionKey(method)) {
        return false
      }
      this.permissions = this._getFromLocal()
      if (!hasOwnPermission(this.permissions, to.name)) this.permissions[to.name] = createPermissionMap()
      if (!hasOwnPermission(this.permissions[to.name], method)) this.permissions[to.name][method] = createPermissionMap()
      if (!hasOwnPermission(this.permissions[to.name][method], from.name)) return this.openPermission(from, to, method, message)

      const decision = rememberedPermissionDecision(this.permissions[to.name][method][from.name], from.hash)
      if (decision === null) return this.openPermission(from, to, method, message)
      if (!decision) {
        const warning = notAllowWarning(from, to, method)
        addTooltip(warning)
        return false
      }
      return true
    } catch (err) {
      throw new Error(err)
    }
  }

  /**
   * The permission form
   * @param {PluginProfile} from The name and hash of the plugin that make the call
   * @param {ModuleProfile} to The name of the plugin that receive the call
   * @param {string} method The name of te methode to be called
   * @param {string} message from the caller plugin to add more details if needed
   */
  form (from, to, method, message) {
    const fromName = from.displayName || from.name
    const toName = to.displayName || to.name
    const remember = this.permissions[to.name][method][from.name]
    const rememberSwitch = remember
      ? yo`<input type="checkbox" checked class="form-check-input" id="remember" data-id="permissionHandlerRememberChecked">`
      : yo`<input type="checkbox" class="form-check-input" id="remember" data-id="permissionHandlerRememberUnchecked">`
    const text = `"${fromName}" ${(remember ? 'has changed and' : '')} would like to access to "${method}" of "${toName}"`
    const imgFrom = yo`<img id="permissionModalImagesFrom" src="${from.icon}" />`
    const imgTo = yo`<img id="permissionModalImagesTo" src="${to.icon}" />`
    const pluginsImages = yo`
      <article class="${css.images}">
        ${imgFrom}
        <i class="fas fa-arrow-right"></i>
        ${imgTo}
      </article>
    `

    globalRegistry.get('themeModule').api.fixInvert(imgFrom)
    globalRegistry.get('themeModule').api.fixInvert(imgTo)

    const pluginMessage = message ? yo`
      <div>
        <h6>Description</h6>
        <p>${message}</p>
      </div>
    ` : ''
    return yo`
      <section class="${css.permission}">
        ${pluginsImages}
        <article>
          <h4 data-id="permissionHandlerMessage">${text} :</h4>
          <h6>${fromName}</h6>
          <p>${from.description || yo`<i>No description Provided</i>`}</p>
          <h6>${toName} :</p>
          <p>${to.description || yo`<i>No description Provided</i>`}</p>
          ${pluginMessage}
        </article>

        <article class="${css.remember}">
          <div class="form-check">
            ${rememberSwitch}
            <label class="form-check-label" for="remember" data-id="permissionHandlerRememberChoice">Remember this choice</label>
          </div>
          <button class="btn btn-sm" onclick="${_ => this.clear(rememberSwitch)}">Reset all Permissions</button>
        </article>
      </section>
    `
  }
}
