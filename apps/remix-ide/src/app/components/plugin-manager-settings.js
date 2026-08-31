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

const yo = require('yo-yo')
const csjs = require('csjs-inject')
const modalDialog = require('../ui/modaldialog')
const { sanitizePermissions } = require('../ui/persmission-handler')
const { createPermissionMap, hasOwnPermission, isSafePermissionKey } = require('../ui/permission-security')

const css = csjs` 
.permissions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 5px 20px;
}
.permissions button {
  padding: 2px 5px;
  cursor: pointer;
}
.permissionForm h4 {
  font-size: 1.3rem;
  text-align: center;
}
.permissionForm h6 {
  font-size: 1.1rem;
}
.permissionForm hr {
  width: 80%;
}
.permissionKey {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.permissionKey i {
  cursor: pointer;
}
.checkbox {
  display: flex;
  align-items: center;
}
.checkbox label {
  margin: 0;
  font-size: 1rem;
}
`

export class PluginManagerSettings {
  _getFromLocal () {
    const fromLocal = window.localStorage.getItem('plugins/permissions')
    try {
      return sanitizePermissions(JSON.parse(fromLocal || '{}'))
    } catch (e) {
      return createPermissionMap()
    }
  }

  _applyMutation (permissions, mutation) {
    const { type, to, method, from } = mutation
    if (!isSafePermissionKey(to)) return permissions

    if (type === 'clearTarget') {
      delete permissions[to]
      return permissions
    }

    if (!isSafePermissionKey(method) || !isSafePermissionKey(from)) return permissions
    if (type === 'set') {
      if (!hasOwnPermission(permissions, to)) permissions[to] = createPermissionMap()
      if (!hasOwnPermission(permissions[to], method)) permissions[to][method] = createPermissionMap()
      permissions[to][method][from] = { allow: mutation.allow, hash: mutation.hash }
      return permissions
    }

    if (type === 'clear' && hasOwnPermission(permissions, to) && hasOwnPermission(permissions[to], method)) {
      delete permissions[to][method][from]
      if (!Object.keys(permissions[to][method]).length) delete permissions[to][method]
      if (!Object.keys(permissions[to]).length) delete permissions[to]
    }
    return permissions
  }

  _latestWithPendingMutations () {
    const permissions = this._getFromLocal()
    for (const mutation of (this.pendingPermissionMutations || [])) this._applyMutation(permissions, mutation)
    return permissions
  }

  _queueMutation (mutation) {
    // Rebase the modal's edits on the latest sanitized storage snapshot every
    // time. This keeps unrelated grants created in another tab/modal alive.
    if (!Array.isArray(this.pendingPermissionMutations)) this.pendingPermissionMutations = []
    this.permissions = this._latestWithPendingMutations()
    this.pendingPermissionMutations.push(mutation)
    this._applyMutation(this.permissions, mutation)
  }

  openDialog () {
    this.pendingPermissionMutations = []
    this.permissions = this._getFromLocal()
    this.currentSetting = this.settings()
    modalDialog('Plugin Manager Permissions', this.currentSetting,
      { fn: () => this.onValidation() }
    )
  }

  onValidation () {
    this.permissions = this._latestWithPendingMutations()
    const permissions = JSON.stringify(this.permissions)
    window.localStorage.setItem('plugins/permissions', permissions)
    this.pendingPermissionMutations = []
  }

  /** Toggle one remembered decision without replacing unrelated grants. */
  togglePermission (to, method, from) {
    this.permissions = this._latestWithPendingMutations()
    if (!hasOwnPermission(this.permissions, to) ||
      !hasOwnPermission(this.permissions[to], method) ||
      !hasOwnPermission(this.permissions[to][method], from)) return
    const current = this.permissions[to][method][from]
    this._queueMutation({ type: 'set', to, method, from, allow: !current.allow, hash: current.hash })
  }

  /** Clear one permission from a plugin */
  clearPersmission (from, to, method) {
    this._queueMutation({ type: 'clear', to, method, from })
    yo.update(this.currentSetting, this.settings())
  }

  /** Clear all persmissions from a plugin */
  clearAllPersmission (to) {
    this.permissions = this._latestWithPendingMutations()
    if (!hasOwnPermission(this.permissions, to)) return
    this._queueMutation({ type: 'clearTarget', to })
    yo.update(this.currentSetting, this.settings())
  }

  settings () {
    const permissionByToPlugin = (toPlugin, funcObj) => {
      const permissionByMethod = (methodName, fromPlugins) => {
        return Object.keys(fromPlugins).map(fromName => {
          const fromPluginPermission = fromPlugins[fromName]
          const checkbox = fromPluginPermission.allow
            ? yo`<input onchange=${() => this.togglePermission(toPlugin, methodName, fromName)} class="mr-2" type="checkbox" checked id="permission-checkbox-${toPlugin}-${methodName}-${fromName}" aria-describedby="module ${fromName} asks permission for ${methodName}" />`
            : yo`<input onchange=${() => this.togglePermission(toPlugin, methodName, fromName)} class="mr-2" type="checkbox" id="permission-checkbox-${toPlugin}-${methodName}-${fromName}" aria-describedby="module ${fromName} asks permission for ${methodName}" />`
          return yo`
            <div class="form-group ${css.permissionKey}">
              <div class="${css.checkbox}">
                ${checkbox}
                <label for="permission-checkbox-${toPlugin}-${methodName}-${fromName}" data-id="permission-label-${toPlugin}-${methodName}-${fromName}">Allow <u>${fromName}</u> to call <u>${methodName}</u></label>
              </div>
              <i onclick="${() => this.clearPersmission(fromName, toPlugin, methodName)}" class="fa fa-trash-alt" data-id="pluginManagerSettingsRemovePermission-${toPlugin}-${methodName}-${fromName}"></i>
            </div>
          `
        })
      }

      const permissionsByFunctions = Object
        .keys(funcObj)
        .map(methodName => permissionByMethod(methodName, funcObj[methodName]))

      return yo`
      <div border p-2>
        <div class="pb-2 ${css.permissionKey}">
          <h3>${toPlugin} permissions:</h3>
          <i onclick="${() => this.clearAllPersmission(toPlugin)}" class="far fa-trash-alt" data-id="pluginManagerSettingsClearAllPermission-${toPlugin}"></i>
        </div>
        ${permissionsByFunctions}
      </div>`
    }

    const byToPlugin = Object
      .keys(this.permissions)
      .map(toPlugin => permissionByToPlugin(toPlugin, this.permissions[toPlugin]))

    const title = byToPlugin.length === 0
      ? yo`<h4>No Permission requested yet.</h4>`
      : yo`<h4>Current Permission settings</h4>`

    return yo`<form class="${css.permissionForm}" data-id="pluginManagerSettingsPermissionForm">
      ${title}
      <hr/>
      ${byToPlugin}
    </form>`
  }

  render () {
    return yo`
    <footer class="bg-light ${css.permissions} remix-bg-opacity">
      <button onclick="${() => this.openDialog()}" class="btn btn-primary settings-button" data-id="pluginManagerPermissionsButton">Permissions</button>
    </footer>`
  }
}
