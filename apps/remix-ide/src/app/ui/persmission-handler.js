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
  if (!isPlainObject(permissions)) return {}

  const sanitizedPermissions = {}

  Object.keys(permissions).forEach((toName) => {
    const methods = permissions[toName]
    if (!isPlainObject(methods)) return

    const sanitizedMethods = {}

    Object.keys(methods).forEach((methodName) => {
      const fromPlugins = methods[methodName]
      if (!isPlainObject(fromPlugins)) return

      const sanitizedFromPlugins = {}

      Object.keys(fromPlugins).forEach((fromName) => {
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
    this.permissions = this._getFromLocal()
    this.currentVersion = 1
    // here we remove the old permissions saved before adding 'permissionVersion'
    // since with v1 the structure has been changed because of new engine ^0.2.0-alpha.6 changes
    if (!localStorage.getItem('permissionVersion')) {
      localStorage.setItem('plugins/permissions', '')
      localStorage.setItem('permissionVersion', this.currentVersion)
    }
  }

  _getFromLocal () {
    const permission = localStorage.getItem('plugins/permissions')
    if (!permission) return {}

    try {
      return sanitizePermissions(JSON.parse(permission))
    } catch (e) {
      return {}
    }
  }

  persistPermissions () {
    const permissions = JSON.stringify(this.permissions)
    localStorage.setItem('plugins/permissions', permissions)
  }

  clear () {
    localStorage.removeItem('plugins/permissions')
    addTooltip('All Permissions have been reset')
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
      modalDialog(
        `Permission needed for ${to.displayName || to.name}`,
        this.form(from, to, method, message),
        {
          label: 'Accept',
          fn: () => {
            if (this.permissions[to.name][method][from.name]) {
              this.permissions[to.name][method][from.name] = {
                allow: true,
                hash: from.hash
              }
              this.persistPermissions()
            }
            resolve(true)
          }
        },
        {
          label: 'Decline',
          fn: () => {
            if (this.permissions[to.name][method][from.name]) {
              this.permissions[to.name][method][from.name] = {
                allow: false,
                hash: from.hash
              }
              this.persistPermissions()
            }
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
  async askPermission (from, to, method, message) {
    try {
      this.permissions = this._getFromLocal()
      if (!this.permissions[to.name]) this.permissions[to.name] = {}
      if (!this.permissions[to.name][method]) this.permissions[to.name][method] = {}
      if (!this.permissions[to.name][method][from.name]) return this.openPermission(from, to, method, message)

      const { allow, hash } = this.permissions[to.name][method][from.name]
      if (!allow) {
        const warning = notAllowWarning(from, to, method)
        addTooltip(warning)
        return false
      }
      return hash === from.hash
        ? true // Allow
        : this.openPermission(from, to, method, message) // New version of a plugin
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

    const switchMode = (e) => {
      e.target.checked
        ? this.permissions[to.name][method][from.name] = {}
        : delete this.permissions[to.name][method][from.name]
    }
    const rememberSwitch = remember
      ? yo`<input type="checkbox" onchange="${switchMode}" checkbox class="form-check-input" id="remember" data-id="permissionHandlerRememberChecked">`
      : yo`<input type="checkbox" onchange="${switchMode}" class="form-check-input" id="remember" data-id="permissionHandlerRememberUnchecked">`
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
          <button class="btn btn-sm" onclick="${_ => this.clear()}">Reset all Permissions</button>
        </article>
      </section>
    `
  }
}
