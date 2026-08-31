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

import isElectron from 'is-electron'
import { SecureWebsocketPlugin, requestLocalSessionUrl } from '../components/secure-websocket-plugin'
import * as packageJson from '../../../../../package.json'
import { version as remixdVersion } from '../../../../../libs/remixd/package.json'
var yo = require('yo-yo')
var modalDialog = require('../ui/modaldialog')
var modalDialogCustom = require('../ui/modal-dialog-custom')
var copyToClipboard = require('../ui/copy-to-clipboard')

var csjs = require('csjs-inject')

var css = csjs`
  .dialog {
    display: flex;
    flex-direction: column;
  }
  .dialogParagraph {
    margin-bottom: 2em;
    word-break: break-word;
  }
`
const LOCALHOST = ' - connect to localhost - '
// A direct Remixd activation can race the workspace selector's initial
// restore. Keep the provider handshake alive while that mutation finishes,
// but still fail closed instead of leaving an apparently-connected plugin
// with no workspace.
const LOCALHOST_WORKSPACE_RETRY_MS = 100
const LOCALHOST_WORKSPACE_WAIT_MS = 15000

const profile = {
  name: 'remixd',
  displayName: 'RemixD',
  url: 'ws://127.0.0.1:65520',
  methods: ['folderIsReadOnly', 'resolveDirectory', 'get', 'exists', 'isFile', 'set', 'rename', 'remove', 'isDirectory', 'list', 'createDir'],
  events: [],
  description: 'Using Remixd daemon, allow to access file system',
  kind: 'other',
  version: packageJson.version
}

export class RemixdHandle extends SecureWebsocketPlugin {
  constructor (localhostProvider, appManager) {
    super(profile)
    this.localhostProvider = localhostProvider
    this.appManager = appManager
    this.connectionMonitor = null
    this._activationGeneration = 0
    this._pendingActivation = false
    this._workspaceActivationRequested = false
    this._providerInitPromise = null
    // PluginManager adds a plugin to `actives` only after its activate hook
    // resolves. Do the provider handshake from the manager's activation event
    // instead of from activate(), otherwise RemixDProvider.init() calls back
    // into manager.call while remixd is still considered inactive and starts a
    // second activation of the same plugin.
    this._onManagerActivated = (activatedProfile) => {
      if (!activatedProfile || activatedProfile.name !== this.name || !this._pendingActivation) return
      this._pendingActivation = false
      const generation = this._activationGeneration
      this._providerInitPromise = this._initialiseProvider(generation)
      // Direct manager activation (Electron or Plugin Manager) does not have
      // a FilePanel.setWorkspace caller waiting for readiness. Consume errors
      // here so they are reported without an unhandled rejection; callers that
      // requested localhost also await the same promise via whenReady().
      this._providerInitPromise.catch(async (error) => {
        if (generation !== this._activationGeneration) return
        await reportConnectionFailure(error)
        if (this.appManager.actives.includes(this.name)) {
          // This is an internal rollback, not a plugin request. Calling the
          // permission-checked API here can be denied when the activation
          // event has no requestFrom; toggleActive is the manager's internal
          // fail-closed path.
          this.appManager.toggleActive(this.name).catch(() => {})
        }
      })
    }
    if (this.appManager.event && typeof this.appManager.event.on === 'function') {
      this.appManager.event.on('activate', this._onManagerActivated)
    }
  }

  async deactivate () {
    this._activationGeneration++
    this._pendingActivation = false
    this._workspaceActivationRequested = false
    this._providerInitPromise = null
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor)
      this.connectionMonitor = null
    }
    if (this.socket) await super.deactivate()
    // this.appManager.deactivatePlugin('git') // plugin call doesn't work.. see issue https://github.com/ethereum/remix-plugin/issues/342
    if (this.appManager.actives.includes('hardhat')) this.appManager.deactivatePlugin('hardhat')
    if (this.appManager.actives.includes('slither')) this.appManager.deactivatePlugin('slither')
    this.localhostProvider.close((error) => {
      if (error) console.log(error)
    })
  }

  activate () {
    return this.connectToLocalhost()
  }

  connect (url) {
    // The per-session token is transport state, not plugin identity. Keeping it
    // out of profile.url lets the manager retain an immutable permission-bound
    // profile while the websocket still connects to the authenticated endpoint.
    return super.connect(this.sessionUrl || url)
  }

  requestWorkspaceActivation () {
    this._workspaceActivationRequested = true
  }

  clearWorkspaceActivationRequest () {
    this._workspaceActivationRequested = false
  }

  async whenReady () {
    if (this._providerInitPromise) await this._providerInitPromise
    if (!this.localhostProvider.isConnected()) throw new Error('Remixd provider is not connected.')
  }

  async canceled () {
    // await this.appManager.deactivatePlugin('git') // plugin call doesn't work.. see issue https://github.com/ethereum/remix-plugin/issues/342
    await this.appManager.deactivatePlugin('remixd')
  }

  /**
    * connect to localhost if no connection and render the explorer
    * disconnect from localhost if connected and remove the explorer
    *
    * @param {String} txHash - hash of the transaction
    */
  async connectToLocalhost () {
    const connection = async () => {
      this.localhostProvider.preInit()
      this.sessionUrl = await requestLocalSessionUrl('ws://127.0.0.1:65520')
      // SecureWebsocketPlugin resolves only after the daemon's plugin handshake.
      await super.activate()
      // The manager marks remixd active only after this hook returns. Provider
      // init must therefore be deferred to _onManagerActivated above; calling
      // localhostProvider.init() here makes its manager.call('remixd', ...)
      // recursively activate the plugin while it is still inactive.
      this._pendingActivation = true
      this.connectionMonitor = setInterval(() => {
        if (!this.socket || this.socket.readyState === 3) {
          clearInterval(this.connectionMonitor)
          this.connectionMonitor = null
          modalDialogCustom.alert(
            'Connection to remixd terminated. ' +
            'Please make sure remixd is still running in the background.'
          )
        }
      }, 3000)
    }

    if (this.localhostProvider.isConnected()) {
      return this.deactivate()
    }

    if (!isElectron()) {
      // warn the user only if he/she is in the browser context
      return new Promise((resolve, reject) => {
        modalDialog(
          'Connect to localhost',
          remixdDialog(),
          {
            label: 'Connect',
            fn: async () => {
              try {
                await connection()
                resolve()
              } catch (error) {
                await reportConnectionFailure(error)
                reject(error)
              }
            }
          },
          {
            label: 'Cancel',
            fn: () => reject(new Error('Remixd connection cancelled.'))
          }
        )
      })
    }

    try {
      await connection()
    } catch (error) {
      await reportConnectionFailure(error)
      throw error
    }
  }

  async _initialiseProvider (generation) {
    await new Promise((resolve, reject) => {
      this.localhostProvider.init((error) => error ? reject(error) : resolve())
    })
    if (generation !== this._activationGeneration) return
    if (!this._workspaceActivationRequested) {
      const deadline = Date.now() + LOCALHOST_WORKSPACE_WAIT_MS
      while (generation === this._activationGeneration) {
        try {
          await this.call('filePanel', 'setWorkspace', { name: LOCALHOST, isLocalhost: true }, true)
          break
        } catch (error) {
          const message = error && error.message ? error.message : String(error)
          if (!message.includes('Another workspace change is already in progress') || Date.now() >= deadline) throw error
          await new Promise(resolve => setTimeout(resolve, LOCALHOST_WORKSPACE_RETRY_MS))
        }
      }
    }
    if (generation !== this._activationGeneration) return
    this.call('manager', 'activatePlugin', 'hardhat').catch(() => {})
    this.call('manager', 'activatePlugin', 'slither').catch(() => {})
  }
}

async function reportConnectionFailure (error) {
  console.log(error)
  modalDialogCustom.alert(
    'Cannot connect to the remixd daemon. ' +
    'Please make sure remixd is running in the background and this site has ' +
    'Local Network Access permission in your browser.'
  )
}

function remixdDialog () {
  const commandText = `remixd -s <path-to-the-shared-folder> -u ${window.location.origin}`
  return yo`
    <div class=${css.dialog}>
      <div class=${css.dialogParagraph}>
        Access your local file system from TronIDE using <a target="_blank" rel="noopener noreferrer" href="https://www.npmjs.com/package/@remix-project/remixd">Remixd NPM package</a>.<br/><br/>
        Remixd needs to be running in the background to load the files in localhost workspace. For more info, please check the <a target="_blank" rel="noopener noreferrer" href="https://remix-ide.readthedocs.io/en/latest/remixd.html">Remixd tutorial</a>.
      </div>
      <div class=${css.dialogParagraph}>
        If you are just looking for the remixd command, here it is:
        <br><br><b>${commandText}</b>
        <span class="">${copyToClipboard(() => commandText)}</span>
      </div>
      <div class=${css.dialogParagraph}>
        When connected, a session will be started between <em>${window.location.origin}</em> and your local file system at <i>ws://127.0.0.1:65520</i>.
         The shared folder will be in the "File Explorers" workspace named "localhost".
        <br/>If your browser asks for Local Network Access, choose <b>Allow</b>. If it was denied earlier, enable it for this site in the browser's site settings and retry.
        <br/>Read more about other <a target="_blank" rel="noopener noreferrer" href="https://remix-ide.readthedocs.io/en/latest/remixd.html#ports-usage">Remixd ports usage</a>
      </div>
      <div class=${css.dialogParagraph}>
        This feature is still in Alpha. We recommend to keep a backup of the shared folder.
      </div>
      <div class=${css.dialogParagraph}>
        <h6 class="text-danger">
          Before using, make sure remixd version is latest i.e. <b>${remixdVersion}</b>
          <br><a target="_blank" rel="noopener noreferrer" href="https://remix-ide.readthedocs.io/en/latest/remixd.html#update-to-the-latest-remixd">Read here how to update it</a>
        </h6>
      </div>
    </div>
  `
}
