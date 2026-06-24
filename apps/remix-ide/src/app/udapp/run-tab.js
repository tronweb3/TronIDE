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

import { ViewPlugin } from '@remixproject/engine-web'
import * as packageJson from '../../../../../package.json'

const $ = require('jquery')
const yo = require('yo-yo')
const ethJSUtil = require('@tvmjs/util')
const { BN } = require('ethereumjs-util')
const Web3 = require('web3')
const { execution } = require('@remix-project/remix-lib')
const EventManager = require('../../lib/events')
const Card = require('../ui/card')

const css = require('../tabs/styles/run-tab-styles')
const SettingsUI = require('../tabs/runTab/settings.js')
const Recorder = require('../tabs/runTab/model/recorder.js')
const RecorderUI = require('../tabs/runTab/recorder.js')
const DropdownLogic = require('../tabs/runTab/model/dropdownlogic.js')
const ContractDropdownUI = require('../tabs/runTab/contractDropdown.js')
const toaster = require('../ui/tooltip')
const _paq = window._paq = window._paq || []
const walletProviderAdapter = execution.walletProviderAdapter
const walletAdapterManager = execution.walletAdapterManager

const UniversalDAppUI = require('../ui/universal-dapp-ui')

const profile = {
  name: 'udapp',
  displayName: 'Deploy & run transactions',
  icon: 'assets/img/deployAndRun.webp',
  description: 'execute and save transactions',
  kind: 'udapp',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version,
  permission: true,
  events: ['newTransaction'],
  methods: ['connectInjectedTronWeb', 'disconnectInjectedTronWeb', 'createVMAccount', 'sendTransaction', 'getAccounts', 'pendingTransactionsCount', 'getSettings', 'setEnvironmentMode']
}

export class RunTab extends ViewPlugin {
  constructor (blockchain, config, fileManager, editor, filePanel, compilersArtefacts, networkModule, mainView, fileProvider) {
    super(profile)
    this.event = new EventManager()
    this.config = config
    this.blockchain = blockchain
    this.fileManager = fileManager
    this.editor = editor
    this.logCallback = (msg) => { mainView.getTerminal().logHtml(yo`<pre>${msg}</pre>`) }
    this.filePanel = filePanel
    this.compilersArtefacts = compilersArtefacts
    this.networkModule = networkModule
    this.fileProvider = fileProvider
    this._externalEventSubscriptions = []
    this._managerEventSubscriptionsRegistered = false
    this.setupEvents()
  }

  _registerExternalListener (emitter, eventName, handler, scope) {
    if (!emitter || !handler) return
    if (emitter.on) emitter.on(eventName, handler)
    else if (emitter.addListener) emitter.addListener(eventName, handler)
    else return
    this._externalEventSubscriptions.push({ emitter, eventName, handler, scope })
  }

  _removeExternalListeners (filter) {
    const remaining = []
    this._externalEventSubscriptions.forEach((subscription) => {
      const { emitter, eventName, handler } = subscription
      if (filter && !filter(subscription)) {
        remaining.push(subscription)
        return
      }
      if (emitter.removeListener) emitter.removeListener(eventName, handler)
      else if (emitter.off) emitter.off(eventName, handler)
    })
    this._externalEventSubscriptions = remaining
  }

  _clearRenderSubscriptions () {
    this._removeExternalListeners((subscription) => subscription.scope === 'render')
    // @remixproject/engine stores one callback per listener/emitter/event.
    // off() is event-scoped in this engine version; a handler argument would be ignored.
    this._clearManagerEventSubscriptions()
  }

  _clearManagerEventSubscriptions () {
    if (!this._managerEventSubscriptionsRegistered) return
    this.off('manager', 'pluginActivated')
    this.off('manager', 'pluginDeactivated')
    this.off('filePanel', 'setWorkspace')
    this._managerEventSubscriptionsRegistered = false
  }

  setupEvents () {
    this._onNewTransaction = (tx, receipt) => {
      this.emit('newTransaction', tx, receipt)
    }
    this._registerExternalListener(this.blockchain.events, 'newTransaction', this._onNewTransaction)
  }

  getSettings () {
    return new Promise((resolve, reject) => {
      if (!this.container) reject(new Error('UI not ready'))
      else {
        resolve({
          selectedAccount: this.settingsUI.getSelectedAccount(),
          selectedEnvMode: this.blockchain.getProvider(),
          networkEnvironment: this.container.querySelector('*[data-id="settingsNetworkEnv"]').textContent
        }
        )
      }
    })
  }

  async setEnvironmentMode (env) {
    const canCall = await this.askUserPermission('setEnvironmentMode', 'change the environment used')
    if (canCall) {
      toaster(yo`
        <div>
          <i class="fas fa-exclamation-triangle text-danger mr-1"></i>
          <span>
            ${this.currentRequest.from}
            <span class="font-weight-bold text-warning">
              is changing your environment to
            </span> ${env}
          </span>
        </div>
      `, '', { time: 3000 })
      this.settingsUI.setExecutionContext(env)
    }
  }

  async connectInjectedTronWeb () {
    if (!this.settingsUI) throw new Error('Deploy & Run is not ready')
    const hadInjectedAccount = typeof window !== 'undefined' && window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58

    if (this.blockchain.getProvider() === 'injected') {
      try {
        const accounts = await this.blockchain.getAccounts()
        if (accounts && accounts[0]) {
          await this.settingsUI.fillAccountsList()
          toaster('TronLink is already connected.')
          return { connected: true, alreadyConnected: true, account: accounts[0] }
        }
      } catch (e) {
        this.settingsUI.clearAccountsList()
      }
    }

    if (this.blockchain.getProvider() !== 'injected') this.settingsUI.clearAccountsList()
    this.settingsUI.pendingAccountsProvider = 'injected'
    this.settingsUI.loadedAccountsProvider = 'injected'

    const walletState = walletAdapterManager.createWalletAdapterManagerState(window)
    const tronlinkAdapter = walletState.adapters && walletState.adapters.find((adapter) => adapter.kind === 'tronlink')
    if (!tronlinkAdapter || tronlinkAdapter.status === walletProviderAdapter.WALLET_STATUS.unavailable) {
      const error = (tronlinkAdapter && tronlinkAdapter.reason) || walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_UNAVAILABLE
      this.settingsUI.clearAccountsList()
      toaster(`Cannot connect TronLink: ${error}`)
      return { connected: false, error, code: walletProviderAdapter.WALLET_ERROR_CODES.WALLET_UNAVAILABLE }
    }

    try {
      await walletAdapterManager.connectWalletAdapter('tronlink', window)
    } catch (error) {
      const normalized = walletProviderAdapter.normalizeWalletError(error)
      this.settingsUI.clearAccountsList()
      toaster(`Cannot connect TronLink: ${normalized.message}`)
      return { connected: false, error: normalized.message, code: normalized.code }
    }

    return new Promise((resolve) => {
      this.settingsUI.setExecutionContext({ context: 'injected' }, async (error) => {
        if (error) {
          const normalized = walletProviderAdapter.normalizeWalletError(error)
          this.settingsUI.clearAccountsList()
          toaster(`Cannot connect TronLink: ${normalized.message}`)
          return resolve({ connected: false, error: normalized.message, code: normalized.code })
        }

        await this.settingsUI.fillAccountsList()

        try {
          const accounts = await this.blockchain.getAccounts()
          if (accounts && accounts[0]) {
            toaster(hadInjectedAccount ? 'TronLink is already connected.' : 'TronLink connected.')
            return resolve({ connected: true, alreadyConnected: Boolean(hadInjectedAccount), account: accounts[0] })
          }
        } catch (e) {
          const normalized = walletProviderAdapter.normalizeWalletError(e)
          this.settingsUI.clearAccountsList()
          toaster(normalized.message)
          return resolve({ connected: false, error: normalized.message, code: normalized.code })
        }

        const status = walletProviderAdapter.getInjectedWalletStatus(window)
        const message = status === walletProviderAdapter.WALLET_STATUS.locked
          ? walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_LOCKED
          : walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_UNAUTHORIZED
        toaster(message)
        resolve({ connected: false, error: message, status })
      })
    })
  }

  async disconnectInjectedTronWeb () {
    if (!this.settingsUI) return { disconnected: true }
    this.settingsUI.clearAccountsList()
    this.settingsUI.pendingAccountsProvider = 'vm'
    this.settingsUI.loadedAccountsProvider = 'vm'

    return new Promise((resolve) => {
      this.settingsUI.setExecutionContext({ context: 'vm', fork: 'tron' }, (error) => {
        if (error) return resolve({ disconnected: false, error })
        this.settingsUI.clearAccountsList()
        resolve({ disconnected: true })
      })
    })
  }

  createVMAccount (newAccount) {
    return this.blockchain.createVMAccount(newAccount)
  }

  sendTransaction (tx) {
    _paq.push(['trackEvent', 'udapp', 'sendTx'])
    return this.blockchain.sendTransaction(tx)
  }

  getAccounts (cb) {
    return this.blockchain.getAccounts(cb)
  }

  pendingTransactionsCount () {
    return this.blockchain.pendingTransactionsCount()
  }

  renderContainer () {
    this.container = yo`<div class="${css.runTabView} run-tab" id="runTabView" data-id="runTabView"></div>`

    var el = yo`
    <div class="list-group list-group-flush">
      ${this.settingsUI.render()}
      ${this.contractDropdownUI.render()}
      ${this.recorderCard.render()}
      ${this.instanceContainer}
    </div>
    `
    this.container.appendChild(el)
    return this.container
  }

  renderInstanceContainer () {
    this.instanceContainer = yo`<div class="${css.instanceContainer} border-0 list-group-item"></div>`

    const instanceContainerTitle = yo`
      <div class="d-flex justify-content-between align-items-center pl-2 ml-1 mb-2"
        title="Autogenerated generic user interfaces for interaction with deployed contracts">
        Deployed Contracts
        <i class="mr-2 ${css.icon} far fa-trash-alt tooltip-above ta-right ta-clear" data-id="deployAndRunClearInstances" onclick=${() => this.event.trigger('clearInstance', [])}
          data-title="Clear instances list and reset recorder" aria-hidden="true">
        </i>
      </div>`

    this.noInstancesText = yo`
      <span class="mx-2 mt-3 alert alert-warning" data-id="deployAndRunNoInstanceText" role="alert">
        Currently you have no contract instances to interact with.
      </span>`

    this.event.register('clearInstance', () => {
      this.instanceContainer.innerHTML = '' // clear the instances list
      this.instanceContainer.appendChild(instanceContainerTitle)
      this.instanceContainer.appendChild(this.noInstancesText)
    })

    this.instanceContainer.appendChild(instanceContainerTitle)
    this.instanceContainer.appendChild(this.noInstancesText)
  }

  renderSettings () {
    if (this.settingsUI && this.settingsUI.destroy) this.settingsUI.destroy()
    this.settingsUI = new SettingsUI(this.blockchain, this.networkModule)

    this.settingsUI.event.register('clearInstance', () => {
      this.event.trigger('clearInstance', [])
    })
  }

  renderDropdown (udappUI, fileManager, compilersArtefacts, config, editor, logCallback) {
    const dropdownLogic = new DropdownLogic(compilersArtefacts, config, editor, this)
    this.contractDropdownUI = new ContractDropdownUI(this.blockchain, dropdownLogic, logCallback, this)

    this._onCurrentFileChanged = this.contractDropdownUI.changeCurrentFile.bind(this.contractDropdownUI)
    this._registerExternalListener(fileManager.events, 'currentFileChanged', this._onCurrentFileChanged, 'render')

    // When the last file closes, compile-tab resets its artifacts — the Deploy
    // & Run contract list must follow, or it keeps offering a stale compilation
    // the compiler no longer shows (TC-CMP-010 / TC-IX-CMP-002).
    this._onNoFileSelected = () => this.contractDropdownUI.updateCompiledContracts(false)
    this._registerExternalListener(fileManager.events, 'noFileSelected', this._onNoFileSelected, 'render')

    this.contractDropdownUI.event.register('clearInstance', () => {
      const noInstancesText = this.noInstancesText
      if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
    })
    this.contractDropdownUI.event.register('newContractABIAdded', (abi, address) => {
      this.instanceContainer.appendChild(udappUI.renderInstanceFromABI(abi, address, '<at address>'))
    })
    this.contractDropdownUI.event.register('newContractInstanceAdded', (contractObject, address, value) => {
      this.instanceContainer.appendChild(udappUI.renderInstance(contractObject, address, value))
    })
  }

  renderRecorder (udappUI, fileManager, config, logCallback) {
    this.recorderCount = yo`<span>0</span>`

    const recorder = new Recorder(this.blockchain)
    recorder.event.register('recorderCountChange', (count) => {
      this.recorderCount.innerText = count
    })
    this.event.register('clearInstance', recorder.clearAll.bind(recorder))

    this.recorderInterface = new RecorderUI(this.blockchain, fileManager, recorder, logCallback, config)

    this.recorderInterface.event.register('newScenario', (abi, address, contractName) => {
      var noInstancesText = this.noInstancesText
      if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
      this.instanceContainer.appendChild(udappUI.renderInstanceFromABI(abi, address, contractName))
    })

    this.recorderInterface.render()
  }

  renderRecorderCard () {
    const collapsedView = yo`
      <div class="d-flex flex-column">
        <div class="ml-2 badge badge-pill badge-primary" title="The number of recorded transactions">${this.recorderCount}</div>
      </div>`

    const expandedView = yo`
      <div class="d-flex flex-column">
        <div class="${css.recorderDescription} mt-2">
          Transactions created in JavaScript VM (Tron) can be replayed in Injected TronWeb.
          Transactions created in Injected TronWeb cannot be replayed in JavaScript VM (Tron) yet.
        </div>
        <div class="${css.transactionActions}">
          ${this.recorderInterface.recordButton}
          ${this.recorderInterface.runButton}
          </div>
        </div>
      </div>`

    this.recorderCard = new Card({}, {}, { title: 'Transactions recorded', collapsedView: collapsedView })
    this.recorderCard.event.register('expandCollapseCard', (arrow, body, status) => {
      body.innerHTML = ''
      status.innerHTML = ''
      if (arrow === 'down') {
        status.appendChild(collapsedView)
        body.appendChild(expandedView)
      } else if (arrow === 'up') {
        status.appendChild(collapsedView)
      }
    })
  }

  render () {
    this._clearRenderSubscriptions()
    this.udappUI = new UniversalDAppUI(this.blockchain, this.logCallback)
    this.blockchain.resetAndInit(this.config, {
      getAddress: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        ;(async () => {
          const selectedAddress = $('#txorigin').val()
          if (this.blockchain.getProvider() !== 'injected') return cbOnce(null, selectedAddress)

          try {
            const accounts = await this.blockchain.getAccounts()
            if (accounts && accounts[0]) return cbOnce(null, accounts[0])
          } catch (e) {
            this.settingsUI.clearAccountsList()
          }

          this.settingsUI.setExecutionContext({ context: 'injected' }, async (error) => {
            if (error) {
              const normalized = walletProviderAdapter.normalizeWalletError(error)
              return cbOnce(normalized.message)
            }
            await this.settingsUI.fillAccountsList()
            try {
              const accounts = await this.blockchain.getAccounts()
              if (accounts && accounts[0]) return cbOnce(null, accounts[0])
            } catch (e) {
              this.settingsUI.clearAccountsList()
              const normalized = walletProviderAdapter.normalizeWalletError(e)
              return cbOnce(normalized.message)
            }
            cbOnce(walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED)
          })
        })().catch((error) => cbOnce(error))
      },
      getValue: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        ;(async () => {
          try {
            const validationError = await this.settingsUI.validateTrxBalance()
            if (validationError) return cbOnce(validationError)

            const number = document.querySelector('#value').value
            const select = document.getElementById('unit')
            const index = select.selectedIndex
            const selectedUnit = select.querySelectorAll('option')[index].dataset.unit
            let unit = 'mwei' // default
            if (['mwei', 'wei'].indexOf(selectedUnit) >= 0) {
              unit = selectedUnit
            }
            cbOnce(null, Web3.utils.toWei(number, unit))
          } catch (e) {
            cbOnce(e)
          }
        })()
      },
      getGasLimit: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        try {
          const validationError = this.settingsUI.validateValueExtend('gasLimit')
          if (validationError) return cbOnce(validationError)

          cbOnce(null, '0x' + new BN($('#gasLimit').val(), 10).toString(16))
        } catch (e) {
          cbOnce(e.message)
        }
      },
      getExtendValue: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        ;(async () => {
          try {
            let validationError = await this.settingsUI.validateTrc10Fields()
            if (validationError) return cbOnce(validationError)

            this.settingsUI.validateValueExtend('userFeePer')
            this.settingsUI.validateValueExtend('originEnergy')

            const tokenIdValue = new BN(String($('#tokenId').val() || '0'), 10)
            const tokenValueValue = new BN(String($('#tokenValue').val() || '0'), 10)

            const tokenId = '0x' + tokenIdValue.toString(16)
            const tokenValue = '0x' + tokenValueValue.toString(16)
            const userFeePercentage = new BN($('#userFeePer').val(), 10).toNumber()
            const originEnergyLimit = new BN($('#originEnergy').val(), 10).toNumber()

            cbOnce(null, {
              tokenId,
              tokenValue,
              userFeePercentage,
              originEnergyLimit
            })
          } catch (e) {
            cbOnce(e.message)
          }
        })()
      }
    })
    this.renderInstanceContainer()
    this.renderSettings()
    this.renderDropdown(this.udappUI, this.fileManager, this.compilersArtefacts, this.config, this.editor, this.logCallback)
    this.renderRecorder(this.udappUI, this.fileManager, this.config, this.logCallback)
    this.renderRecorderCard()

    const addPluginProvider = (profile) => {
      if (profile.kind === 'provider') {
        ((profile, app) => {
          const web3Provider = {
            async sendAsync (payload, callback) {
              try {
                const result = await app.call(profile.name, 'sendAsync', payload)
                callback(null, result)
              } catch (e) {
                callback(e)
              }
            }
          }
          app.blockchain.addProvider({ name: profile.displayName, provider: web3Provider })
        })(profile, this)
      }
    }
    const removePluginProvider = (profile) => {
      if (profile.kind === 'provider') this.blockchain.removeProvider(profile.displayName)
    }
    this._addPluginProvider = (profile) => addPluginProvider(profile)
    this._removePluginProvider = (profile) => removePluginProvider(profile)
    this.on('manager', 'pluginActivated', this._addPluginProvider)
    this.on('manager', 'pluginDeactivated', this._removePluginProvider)
    // A deployed-instance card is bound to the workspace (and network) it was
    // created in; switching workspace must clear them — otherwise the old
    // workspace's instances stay visible and the user can fire transactions at a
    // stale address/network. Mirrors compile-tab resetting results on switch.
    this.on('filePanel', 'setWorkspace', () => this.event.trigger('clearInstance', []))
    this._managerEventSubscriptionsRegistered = true
    return this.renderContainer()
  }

  onDeactivation () {
    this._clearManagerEventSubscriptions()
    this._removeExternalListeners()
    if (this.settingsUI && this.settingsUI.destroy) this.settingsUI.destroy()
    this._onNewTransaction = null
    this._onCurrentFileChanged = null
    this._addPluginProvider = null
    this._removePluginProvider = null
  }
}
