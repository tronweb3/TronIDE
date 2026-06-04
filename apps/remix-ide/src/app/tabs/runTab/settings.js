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

import { BN } from 'ethereumjs-util'
const $ = require('jquery')
const yo = require('yo-yo')
const remixLib = require('@remix-project/remix-lib')
const txIntegerUtils = remixLib.execution.txIntegerUtils
const EventManager = remixLib.EventManager
const css = require('../styles/run-tab-styles')
const copyToClipboard = require('../../ui/copy-to-clipboard')
const modalDialogCustom = require('../../ui/modal-dialog-custom')
const modalDialog = require('../../ui/modaldialog')
const addTooltip = require('../../ui/tooltip')
const helper = require('../../../lib/helper.js')
const { hashPersonalMessage } = require('../../../lib/helper')
const globalRegistry = require('../../../global/registry')

const ZERO = new BN('0', 10)
const SAFE_INTEGER_MAX = new BN(Number.MAX_SAFE_INTEGER.toString(), 10)
const TRC10_MIN_TOKEN_ID = new BN(txIntegerUtils.TRC10_MIN_TOKEN_ID.toString(), 10)
const TRX_TO_SUN = new BN('1000000', 10)
const INSUFFICIENT_TRX_ERROR = 'Insufficient TRX'
const ACCOUNT_BALANCE_POLL_INTERVAL = 30000
const BALANCE_RATE_LIMIT_BACKOFF = 60000

class SettingsUI {
  constructor (blockchain, networkModule) {
    this.blockchain = blockchain
    this.event = new EventManager()
    this._components = {}
    this._intervals = []
    this._timeouts = []
    this._blockchainEventHandlers = []
    this._selectExEnvChangeHandler = null
    this._destroyed = false

    this._onTransactionExecuted = (error, from, to, data, lookupOnly, txResult) => {
      if (this._destroyed) return
      if (!lookupOnly && this.el) {
        this.el.querySelector('#value').value = 0
        this.el.querySelector('#tokenId').value = 0
        this.el.querySelector('#tokenValue').value = 0
        this.setFieldValidationError('value')
        this.setFieldValidationError('tokenId')
        this.setFieldValidationError('tokenValue')
      }
      if (error) return
      this.updateAccountBalances()
    }
    this._registerBlockchainEvent('transactionExecuted', this._onTransactionExecuted)
    this._components = {
      registry: globalRegistry,
      networkModule: networkModule
    }
    this._components.registry = globalRegistry
    this._deps = {
      config: this._components.registry.get('config').api
    }

    this._onPersonalModeChanged = this.onPersonalChange.bind(this)
    this._deps.config.events.on('settings/personal-mode_changed', this._onPersonalModeChanged)

    this._accountBalanceInterval = setInterval(() => {
      this.updateAccountBalances()
    }, ACCOUNT_BALANCE_POLL_INTERVAL)
    this._intervals.push(this._accountBalanceInterval)
    this._lastBalanceRateLimitAt = 0

    this.accountListCallId = 0
    this.loadedAccounts = {}
    this.loadedAccountsProvider = null
    this.pendingAccountsProvider = null
    this.lastAccountListError = null
  }

  _registerBlockchainEvent (eventName, handler) {
    this._blockchainEventHandlers.push({ eventName, handler })
    this.blockchain.event.register(eventName, handler)
  }

  _isDestroyed () {
    return this._destroyed
  }

  _isRateLimitError (err) {
    if (!err) return false
    const status = err.status || err.statusCode || err.code
    const message = String(err.message || err.toString ? err.toString() : err).toLowerCase()
    return status === 429 || message.includes('429') || message.includes('too many requests') || message.includes('rate limit')
  }

  updateAccountBalances () {
    if (this._destroyed) return
    if (!this.el) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (Date.now() - this._lastBalanceRateLimitAt < BALANCE_RATE_LIMIT_BACKOFF) return
    var accounts = $(this.el.querySelector('#txorigin')).children('option')
    accounts.each((index, account) => {
      this.blockchain.getBalanceInEther(account.value, (err, balance) => {
        if (this._destroyed) return
        if (err) {
          if (this._isRateLimitError(err)) this._lastBalanceRateLimitAt = Date.now()
          return
        }
        const updated = helper.shortenAddress(account.value, balance)
        if (updated !== account.innerText) { // check if the balance has been updated and update UI accordingly.
          account.innerText = updated
        }
      })
    })
  }

  isZeroOnlyValue (value = '') {
    return /^0*$/.test(value)
  }

  normalizeIntegerInput (id) {
    const valueEl = this.el.querySelector(`#${id}`)
    if (!valueEl.value) {
      valueEl.value = 0
      return ZERO
    }

    try {
      const value = new BN(valueEl.value, 10)
      if (value.lt(ZERO)) {
        valueEl.value = 0
        return ZERO
      }

      valueEl.value = value.toString(10)
      return value
    } catch (e) {
      valueEl.value = 0
      return ZERO
    }
  }

  // Chromium's native spinner auto-repeats on press-and-hold and keeps firing
  // while the cursor is dragged out of the button (v2.2.0 runaway bug). We
  // intercept mousedown in the right-edge spinner zone, fire exactly one
  // stepUp/stepDown, and call preventDefault so the browser never starts
  // its repeat timer or drag-scrub.
  handleSpinnerMousedown (e) {
    const inputEl = e.currentTarget
    if (!inputEl || inputEl.disabled || inputEl.readOnly) return
    const rect = inputEl.getBoundingClientRect()
    if (e.clientX < rect.right - 18) return
    e.preventDefault()
    try {
      if (e.clientY < rect.top + rect.height / 2) inputEl.stepUp()
      else inputEl.stepDown()
    } catch (err) {
      console.debug('[runTabSettings] numeric spinner step failed', err)
    }
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    inputEl.dispatchEvent(new Event('change', { bubbles: true }))
  }

  getFieldLabel (id) {
    switch (id) {
      case 'value':
        return 'Transaction value'
      case 'gasLimit':
        return 'Fee limit'
      case 'tokenId':
        return 'Token ID'
      case 'tokenValue':
        return 'Token value'
      case 'userFeePer':
        return 'User fee percentage'
      case 'originEnergy':
        return 'Origin energy limit'
      default:
        return id
    }
  }

  getValueUnitMultiplier () {
    const unitEl = this.el.querySelector('#unit')
    const option = unitEl?.options?.[unitEl.selectedIndex]
    return option?.dataset?.unit === 'mwei' ? TRX_TO_SUN : new BN('1', 10)
  }

  getValueInSunBN () {
    const valueEl = this.el.querySelector('#value')
    const value = new BN(valueEl.value || '0', 10)
    return value.mul(this.getValueUnitMultiplier())
  }

  getFieldValidationError (id) {
    const valueEl = this.el.querySelector(`#${id}`)
    if (!valueEl || valueEl.value === '') return ''

    let value
    try {
      value = new BN(valueEl.value, 10)
    } catch (e) {
      return `${this.getFieldLabel(id)} must be a non-negative integer.`
    }

    if (value.lt(ZERO)) {
      return `${this.getFieldLabel(id)} must be a non-negative integer.`
    }

    if (id === 'value') {
      value = value.mul(this.getValueUnitMultiplier())
    }

    if (['value', 'gasLimit', 'tokenId', 'tokenValue'].includes(id) && value.gt(SAFE_INTEGER_MAX)) {
      return txIntegerUtils.formatSafeIntegerRangeError(this.getFieldLabel(id))
    }

    if (id === 'tokenId' && value.gt(ZERO) && value.lt(TRC10_MIN_TOKEN_ID)) {
      return `Token ID must be 0 or greater than ${txIntegerUtils.TRC10_MIN_TOKEN_ID}.`
    }

    return ''
  }

  async validateTrxBalance () {
    const rangeError = this.validateValue()
    if (rangeError) return rangeError

    const value = this.getValueInSunBN()
    if (value.isZero()) return ''

    try {
      const account = this.getSelectedAccount()
      const balance = await new Promise((resolve, reject) => {
        this.blockchain.getBalanceInEther(account, (err, balance) => {
          if (err) return reject(err)
          resolve(balance)
        })
      })
      const balanceInSun = new BN(this.blockchain.toWei(String(balance), 'mwei'), 10)
      const message = value.gt(balanceInSun) ? INSUFFICIENT_TRX_ERROR : ''
      this.setFieldValidationError('value', message)
      return message
    } catch (e) {
      console.warn(`Unable to validate TRX balance: ${e.message || e}`)
      return ''
    }
  }

  setFieldValidationError (id, message = '') {
    const inputEl = this.el.querySelector(`#${id}`)
    const errorEl = this.el.querySelector(`#${id}Error`)

    if (inputEl) {
      inputEl.classList.toggle('is-invalid', Boolean(message))
      inputEl.style.backgroundImage = message ? 'none' : ''
      inputEl.style.paddingRight = message ? '0.75rem' : ''
    }
    if (errorEl) errorEl.innerText = message
  }

  validateInputRange (id) {
    const message = this.getFieldValidationError(id)
    this.setFieldValidationError(id, message)
    return message
  }

  validateInputKey (e) {
    // preventing not numeric keys
    // preventing 000 case
    if (!helper.isNumeric(e.key) ||
      (e.key === '0' && this.isZeroOnlyValue(this.el.querySelector('#value').value) && this.el.querySelector('#value').value.length > 0)) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  validateValue () {
    this.normalizeIntegerInput('value')
    return this.validateInputRange('value')
  }

  validateInputKeyExtend (e, id) {
    const qs = `#${id}`
    // preventing not numeric keys
    // preventing 000 case
    if (!helper.isNumeric(e.key) ||
      (e.key === '0' && this.isZeroOnlyValue(this.el.querySelector(qs).value) && this.el.querySelector(qs).value.length > 0)) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  validateValueExtend (id) {
    const valueEl = this.el.querySelector(`#${id}`)
    const v = this.normalizeIntegerInput(id)

    if (id === 'userFeePer') {
      if (v.gtn(100)) valueEl.value = 100
    }
    if (id === 'originEnergy') {
      if (v.gtn(10000000)) valueEl.value = 10000000
    }

    return this.validateInputRange(id)
  }

  async validateTrc10Fields () {
    let validationError = this.validateValueExtend('tokenId')
    if (validationError) {
      this.setFieldValidationError('tokenValue')
      return validationError
    }

    validationError = this.validateValueExtend('tokenValue')
    if (validationError) return validationError

    const tokenId = new BN(String(this.el.querySelector('#tokenId').value || '0'), 10)
    const tokenValue = new BN(String(this.el.querySelector('#tokenValue').value || '0'), 10)
    validationError = await this.validateTrc10Transfer(tokenId, tokenValue)
    this.setFieldValidationError('tokenValue', validationError)
    return validationError
  }

  async validateTrc10Transfer (tokenId, tokenValue) {
    const validationError = txIntegerUtils.validateTrc10Inputs(tokenId, tokenValue)
    if (validationError) return validationError

    if (tokenValue.lten(0)) return ''

    try {
      const tokenBalance = await this.blockchain.getTokenBalance(this.getSelectedAccount(), tokenId.toString(10))
      if (tokenBalance.lt(tokenValue)) return 'No asset'
    } catch (e) {
      const provider = this.blockchain.getProvider()
      const shouldBlockTransfer = provider === 'vm' || provider === 'injected'
      console.warn(`Unable to validate TRC10 balance for token ${tokenId.toString(10)} on ${provider}: ${e.message || e}`)
      if (shouldBlockTransfer) return 'No asset'
    }

    return ''
  }

  getAddress () {
    const address = document.querySelector('#runTabView #txorigin').value
    return remixLib.util.addressToBase58(address)
  }

  render () {
    this.netUI = yo`<span class="${css.network} badge badge-secondary"></span>`

    var environmentEl = yo`
      <div class="${css.crow}">
        <label id="selectExEnv" class="${css.settingsLabel}">
          Environment
        </label>
        <div class="${css.environment}">
          <select id="selectExEnvOptions" data-id="settingsSelectEnvOptions" class="form-control ${css.select} custom-select">
            <option id="vm-mode-tron" data-id="settingsVMLondonMode"
              title="Execution environment does not connect to any node, everything is local and in memory only."
              value="vm-tron" name="executionContext" fork="tron"> JavaScript VM (Tron)
            </option>
            <option id="injected-mode" data-id="settingsInjectedMode"
              title="Execution environment has been provided by TronLink or similar provider."
              value="injected" name="executionContext"> Injected TronWeb
            </option>
          </select>
        </div>
      </div>
    `
    const networkEl = yo`
    <div class="${css.crow}">
        <div class="${css.settingsLabel}">
        </div>
        <div class="${css.environment}" data-id="settingsNetworkEnv">
          ${this.netUI}
        </div>
      </div>
    `
    const accountEl = yo`
      <div class="${css.crow}">
        <label class="${css.settingsLabel}">
          Account
          <span id="remixRunPlusWrapper" onload=${this.updatePlusButton.bind(this)}>
            <i id="remixRunPlus" class="fas fa-plus-circle ${css.icon} tooltip-above ta-add" aria-hidden="true" onclick=${this.newAccount.bind(this)}" data-title="Create a new account"></i>
          </span>
        </label>
        <div class="${css.account}">
          <select data-id="runTabSelectAccount" name="txorigin" class="form-control ${css.select} custom-select pr-4" id="txorigin" onchange=${() => { this.validateTrxBalance(); this.validateTrc10Fields() }}></select>
          <div style="margin-left: -5px;">${copyToClipboard(this.getAddress)}</div>
          <i id="remixRunSignMsg" data-id="settingsRemixRunSignMsg" class="mx-1 fas fa-edit ${css.icon} tooltip-above ta-right" aria-hidden="true" onclick=${this.signMessage.bind(this)} data-title="Sign using this account"></i>
        </div>
      </div>
    `

    const gasPriceEl = yo`
      <div class="${css.crow}">
        <label class="${css.settingsLabel}">Fee limit</label>
        <input
          type="number"
          min="0"
          pattern="^[0-9]"
          step="1"
          class="form-control ${css.gasNval} ${css.col2}"
          id="gasLimit"
          value="400000000"
          title="Enter the fee limit"
          onmousedown=${(e) => this.handleSpinnerMousedown(e)}
          onkeypress=${(e) => this.validateInputKeyExtend(e, 'gasLimit')}
          oninput=${() => this.validateInputRange('gasLimit')}
          onchange=${() => this.validateValueExtend('gasLimit')}
        >
        <div id="gasLimitError" class="${css.inputError}"></div>
      </div>
    `

    const valueEl = yo`
      <div class="${css.crow}">
        <label class="${css.settingsLabel}" data-id="remixDRValueLabel">Value</label>
        <div class="${css.gasValueContainer}">
          <input
            type="number"
            min="0"
            pattern="^[0-9]"
            step="1"
            class="form-control ${css.gasNval} ${css.col2}"
            id="value"
            data-id="dandrValue"
            value="0"
            title="Enter the value and choose the unit"
            onmousedown=${(e) => this.handleSpinnerMousedown(e)}
            onkeypress=${(e) => this.validateInputKey(e)}
            oninput=${() => this.validateInputRange('value')}
            onchange=${() => this.validateTrxBalance()}
          >
          <select name="unit" class="form-control ${css.gasNvalUnit} ${css.col2_2} custom-select" id="unit" onchange=${() => this.validateTrxBalance()}>
            <option data-unit="wei">sun</option>
            <option data-unit="mwei">trx</option>
          </select>
        </div>
        <div id="valueError" class="${css.inputError}"></div>
      </div>
    `

    const extendEl = yo`
      <div class="${css.crow}">
        <div class="${css.gasValueContainer}">
          <div class="${css.gasNTid}">
            <label class="${css.settingsLabel}" data-id="remixDRTokenIdLabel">
            Token ID
            <span id="remixTokenPlusWrapper" title="Add a trc10 token" onload=${this.updateTokenPlusButton.bind(this)}>
              <i id="remixTokenPlus" class="fas fa-plus-circle ${css.icon}" aria-hidden="true" onclick=${this.newToken.bind(this)}"></i>
            </span>
          </label>
            <input
              type="number"
              min="1000001"
              pattern="^[0-9]"
              step="1"
              class="form-control ${css.col2}"
              id="tokenId"
              data-id="dandrTokenId"
              value="0"
              title="Enter the trc10 id"
              onmousedown=${(e) => this.handleSpinnerMousedown(e)}
              onkeypress=${(e) => this.validateInputKeyExtend(e, 'tokenId')}
              oninput=${() => this.validateInputRange('tokenId')}
              onchange=${() => this.validateTrc10Fields()}
            >
            <div id="tokenIdError" class="${css.inputError}"></div>
          </div>
          <div class="${css.gasNTval}">
            <label class="${css.settingsLabel}" data-id="remixDRTokenValueLabel">Token value</label>
            <input
              type="number"
              min="0"
              pattern="^[0-9]"
              step="1"
              class="form-control ${css.col2}"
              id="tokenValue"
              data-id="dandrTokenValue"
              value="0"
              title="Enter the trc10 value"
              onmousedown=${(e) => this.handleSpinnerMousedown(e)}
              onkeypress=${(e) => this.validateInputKeyExtend(e, 'tokenValue')}
              oninput=${() => this.validateInputRange('tokenValue')}
              onchange=${() => this.validateTrc10Fields()}
            >
            <div id="tokenValueError" class="${css.inputError}"></div>
          </div>
        </div>
      </div>
      <div id="userFeePerWrapper" class="${css.crow}">
        <label class="${css.settingsLabel}" data-id="remixDRFeePerLabel">User Fee Percentage</label>
        <div class="${css.gasValueContainer}">
          <input
            type="number"
            min="0"
            pattern="^[0-9]"
            step="1"
            class="form-control ${css.gasNval} ${css.col2}"
            id="userFeePer"
            data-id="dandrFeePerValue"
            value="100"
            title="Enter the user fee percentage"
            onkeypress=${(e) => this.validateInputKeyExtend(e, 'userFeePer')}
            onchange=${() => this.validateValueExtend('userFeePer')}
          >
        </div>
      </div>
      <div id="originEnergyWrapper" class="${css.crow}">
        <label class="${css.settingsLabel}" data-id="remixDROriginEnergyLabel">Origin Energy Limit</label>
        <div class="${css.gasValueContainer}">
          <input
            type="number"
            min="0"
            pattern="^[0-9]"
            step="1"
            class="form-control ${css.gasNval} ${css.col2}"
            id="originEnergy"
            data-id="dandrOriginEnergyValue"
            value="10000000"
            title="Enter the origin energy limit"
            onkeypress=${(e) => this.validateInputKeyExtend(e, 'originEnergy')}
            onchange=${() => this.validateValueExtend('originEnergy')}
          >
        </div>
      </div>
    `

    const extendWrapperEl = yo`
      <div>
        <div id="extendwrapper" class="${css.extendWrapper}">
          ${extendEl}
        </div>
        <p class="${css.extendBtn}" onclick="${() => showExtend()}">
          <i id="extendbtn" class="fas fa-angle-down"></i>
        </p>
      </div>
    `

    const el = yo`
      <div class="${css.settings}">
        ${environmentEl}
        ${networkEl}
        ${accountEl}
        ${gasPriceEl}
        ${valueEl}
        ${extendWrapperEl}
      </div>
    `

    var showExtend = () => {
      var extendBtn = extendWrapperEl.querySelector('#extendbtn')
      var extendWrapper = extendWrapperEl.querySelector('#extendwrapper')

      if (extendBtn.classList) {
        extendBtn.classList.toggle('fa-angle-up')
        var down = extendBtn.classList.toggle('fa-angle-down')
        if (down) $(extendWrapper).hide()
        else $(extendWrapper).show()
      }
    }

    var selectExEnv = environmentEl.querySelector('#selectExEnvOptions')
    this.setDropdown(selectExEnv)

    this._onContextChanged = (context, silent) => {
      if (this._isDestroyed()) return
      this.setFinalContext()
    }
    this._registerBlockchainEvent('contextChanged', this._onContextChanged)

    this._onNetworkStatus = ({ error, network }) => {
      if (this._isDestroyed()) return
      if (error) {
        this.netUI.textContent = 'can\'t detect network '
        return
      }
      const networkProvider = this._components.networkModule.getNetworkProvider.bind(this._components.networkModule)
      this.netUI.textContent = (networkProvider() === 'vm') ? network.name : `${network.name} (${network.id || '-'}) network`
    }
    this._registerBlockchainEvent('networkStatus', this._onNetworkStatus)

    this._accountListInterval = setInterval(() => {
      this.fillAccountsList()
    }, 1000)
    this._intervals.push(this._accountListInterval)

    this.el = el

    this.fillAccountsList()
    this.setFinalContextAfterLoad()
    return el
  }

  setDropdown (selectExEnv) {
    this.selectExEnv = selectExEnv

    const addProvider = (network) => {
      if (this._isDestroyed()) return
      selectExEnv.appendChild(yo`<option
        title="provider name: ${network.name}"
        value="${network.name}"
        name="executionContext"
      >
        ${network.name}
      </option>`)
      addTooltip(yo`<span><b>${network.name}</b> provider added</span>`)
    }

    const removeProvider = (name) => {
      if (this._isDestroyed()) return
      var env = selectExEnv.querySelector(`option[value="${name}"]`)
      if (env) {
        selectExEnv.removeChild(env)
        addTooltip(yo`<span><b>${name}</b> provider removed</span>`)
      }
    }
    this._onProviderAdded = provider => addProvider(provider)
    this._onProviderRemoved = name => removeProvider(name)
    this._registerBlockchainEvent('addProvider', this._onProviderAdded)
    this._registerBlockchainEvent('removeProvider', this._onProviderRemoved)

    this._selectExEnvChangeHandler = (event) => {
      if (this._destroyed || !this.el) return
      const provider = selectExEnv.options[selectExEnv.selectedIndex]
      const fork = provider.getAttribute('fork') // can be undefined if connected to an external source (web3 provider / injected)
      let context = provider.value
      context = context.startsWith('vm') ? 'vm' : context // context has to be 'vm', 'web3' or 'injected'
      if (this.loadedAccountsProvider && this.loadedAccountsProvider !== context) {
        this.clearAccountsList()
      }
      this.pendingAccountsProvider = context
      this.loadedAccountsProvider = context
      this.setExecutionContext({ context, fork })
    }
    selectExEnv.addEventListener('change', this._selectExEnvChangeHandler)

    selectExEnv.value = this._getProviderDropdownValue()
  }

  setExecutionContext (context, done) {
    if (this._isDestroyed()) {
      if (done) done('UI destroyed')
      return
    }
    let completed = false
    const finish = (error) => {
      if (completed) return
      completed = true
      if (done) done(error)
    }
    this.blockchain.changeExecutionContext(context, () => {
      modalDialogCustom.prompt('External node request', this.web3ProviderDialogBody(), 'http://127.0.0.1:8545', (target) => {
        this.blockchain.setProviderFromEndpoint(target, context, (alertMsg) => {
          if (this._isDestroyed()) return finish('UI destroyed')
          if (alertMsg) addTooltip(alertMsg)
          this.setFinalContext()
          finish(alertMsg)
        })
      }, () => {
        if (this._isDestroyed()) return finish('UI destroyed')
        this.setFinalContext()
        finish('Canceled by user.')
      })
    }, (alertMsg) => {
      if (this._isDestroyed()) return finish('UI destroyed')
      addTooltip(alertMsg)
      finish(alertMsg)
    }, () => {
      if (this._isDestroyed()) return finish('UI destroyed')
      this.setFinalContext()
      finish()
    })
  }

  web3ProviderDialogBody () {
    const thePath = '<path/to/local/folder/for/test/chain>'

    return yo`
      <div class="">
        Note: To use Geth & https://remix.ethereum.org, configure it to allow requests from Remix:(see <a href="https://geth.ethereum.org/docs/rpc/server" target="_blank" rel="noopener noreferrer">Geth Docs on rpc server</a>)
        <div class="border p-1">geth --http --http.corsdomain https://remix.ethereum.org</div>
        <br>
        To run Remix & a local Geth test node, use this command: (see <a href="https://geth.ethereum.org/getting-started/dev-mode" target="_blank" rel="noopener noreferrer">Geth Docs on Dev mode</a>)
        <div class="border p-1">geth --http --http.corsdomain="${window.origin}" --http.api web3,eth,debug,personal,net --vmdebug --datadir ${thePath} --dev console</div>
        <br>
        <br>
        <b>WARNING:</b> It is not safe to use the --http.corsdomain flag with a wildcard: <b>--http.corsdomain *</b>
        <br>
        <br>For more info: <a href="https://remix-ide.readthedocs.io/en/latest/run.html#more-about-web3-provider" target="_blank" rel="noopener noreferrer">Remix Docs on Web3 Provider</a>
        <br>
        <br>
        Web3 Provider Endpoint
      </div>
    `
  }

  /**
   * generate a value used by the env dropdown list.
   * @return {String} - can return 'vm-berlin, 'vm-london', 'injected' or 'web3'
   */
  _getProviderDropdownValue () {
    const provider = this.blockchain.getProvider()
    const fork = this.blockchain.getCurrentFork()
    return provider === 'vm' ? provider + '-' + fork : provider
  }

  setFinalContext () {
    if (this._isDestroyed()) return
    // set the final context. Cause it is possible that this is not the one we've originaly selected
    this.selectExEnv.value = this._getProviderDropdownValue()
    this.event.trigger('clearInstance', [])
    this.updatePlusButton()
    this.updateTokenPlusButton()
  }

  setFinalContextAfterLoad () {
    if (this._destroyed) return
    if (document.getElementById('remixRunPlus')) {
      if (!this.selectExEnv) return
      this.selectExEnv.value = this._getProviderDropdownValue()
      this.updatePlusButton()
      this.updateTokenPlusButton()
    } else {
      if (this._finalContextTimeout) clearTimeout(this._finalContextTimeout)
      this._finalContextTimeout = setTimeout(() => {
        this._finalContextTimeout = null
        this.setFinalContextAfterLoad()
      }, 100)
    }
  }

  destroy () {
    if (this._destroyed) return
    this._destroyed = true
    this._intervals.forEach((intervalId) => clearInterval(intervalId))
    this._intervals = []
    if (this._finalContextTimeout) {
      clearTimeout(this._finalContextTimeout)
      this._finalContextTimeout = null
    }
    this._timeouts.forEach((timeoutId) => clearTimeout(timeoutId))
    this._timeouts = []
    if (this.blockchain && this.blockchain.event && this.blockchain.event.unregister) {
      this._blockchainEventHandlers.forEach(({ eventName, handler }) => {
        this.blockchain.event.unregister(eventName, handler)
      })
    }
    this._blockchainEventHandlers = []
    if (this.selectExEnv && this._selectExEnvChangeHandler) {
      this.selectExEnv.removeEventListener('change', this._selectExEnvChangeHandler)
      this._selectExEnvChangeHandler = null
    }
    if (this._deps && this._deps.config && this._deps.config.events && this._deps.config.events.removeListener) {
      this._deps.config.events.removeListener('settings/personal-mode_changed', this._onPersonalModeChanged)
    }
    this.el = null
  }

  clearAccountsList () {
    const txOrigin = this.el && this.el.querySelector('#txorigin')
    if (txOrigin) txOrigin.innerHTML = ''
    this.loadedAccounts = {}
  }

  updatePlusButton () {
    if (this._isDestroyed()) return
    // enable/disable + button
    const plusBtn = document.getElementById('remixRunPlus')
    const plusTitle = document.getElementById('remixRunPlusWrapper')
    const value = this.selectExEnv.value.split('-')[0]
    switch (value) {
      case 'injected':
        plusBtn.classList.add(css.disableMouseEvents)
        plusTitle.title = "Unfortunately it's not possible to create an account using injected TronWeb. Please create the account directly from your provider (i.e TronLink or other of the same type)."

        break
      case 'vm':
        plusBtn.classList.remove(css.disableMouseEvents)
        plusTitle.title = 'Create a new account'

        break
      case 'web3':
        this.onPersonalChange()

        break
      default: {
        plusBtn.classList.add(css.disableMouseEvents)
        plusTitle.title = `Unfortunately it's not possible to create an account using an external wallet (${this.selectExEnv.value}).`
      }
    }
  }

  updateTokenPlusButton () {
    if (this._isDestroyed()) return
    // enable/disable + button
    const plusBtn = document.getElementById('remixTokenPlus')
    const plusTitle = document.getElementById('remixTokenPlusWrapper')
    const userFeeEl = document.getElementById('userFeePerWrapper')
    const originEnergyEl = document.getElementById('originEnergyWrapper')

    const value = this.selectExEnv.value.split('-')[0]
    switch (value) {
      case 'injected':
        plusBtn.classList.add(css.disableMouseEvents)
        plusTitle.title = 'Do not support adding a trc10 token'

        userFeeEl.style.display = 'block'
        originEnergyEl.style.display = 'block'

        break
      case 'vm':
        plusBtn.classList.remove(css.disableMouseEvents)
        plusTitle.title = 'Add a trc10 token'

        userFeeEl.style.display = 'none'
        originEnergyEl.style.display = 'none'

        break
      default: {
        plusBtn.classList.add(css.disableMouseEvents)
        plusTitle.title = `Unfortunately it's not possible to set TRC10 balance using an external wallet (${this.selectExEnv.value}).`

        userFeeEl.style.display = 'block'
        originEnergyEl.style.display = 'block'
      }
    }
  }

  onPersonalChange () {
    if (this._isDestroyed()) return
    const plusBtn = document.getElementById('remixRunPlus')
    const plusTitle = document.getElementById('remixRunPlusWrapper')
    if (!this._deps.config.get('settings/personal-mode')) {
      plusBtn.classList.add(css.disableMouseEvents)
      plusTitle.title = 'Creating an account is possible only in Personal mode. Please go to Settings to enable it.'
    } else {
      plusBtn.classList.remove(css.disableMouseEvents)
      plusTitle.title = 'Create a new account'
    }
  }

  newAccount () {
    this.blockchain.newAccount(
      '',
      (cb) => {
        modalDialogCustom.promptPassphraseCreation((error, passphrase) => {
          if (error) {
            return modalDialogCustom.alert(error)
          }
          cb(passphrase)
        }, () => { })
      },
      (error, address) => {
        if (error) {
          return addTooltip('Cannot create an account: ' + error)
        }
        addTooltip(`account ${remixLib.util.addressToBase58(address)} created`)
      }
    )
  }

  newToken () {
    const provider = this.blockchain.getProvider()
    if (provider !== 'vm') return

    const address = document.querySelector('#runTabView #txorigin').value
    const curProvider = this.blockchain.getCurrentProvider()
    curProvider.getAccount(address, (error, account) => {
      if (error) {
        return modalDialogCustom.alert(error)
      }
      modalDialogCustom.promptTRC10Creation(address, account.asset, curProvider, (error) => {
        if (error) {
          return addTooltip(error)
        }
      })
    })
  }

  getSelectedAccount () {
    return this.el.querySelector('#txorigin').selectedOptions[0].value
  }

  getEnvironment () {
    return this.blockchain.getProvider()
  }

  getSignMessageContext (account) {
    return {
      provider: this.blockchain.getProvider(),
      network: this.netUI ? this.netUI.innerText : '',
      account
    }
  }

  assertSignMessageContextUnchanged (expectedContext) {
    const txOrigin = this.el.querySelector('#txorigin')
    const currentAccount = txOrigin && txOrigin.selectedOptions[0] ? txOrigin.selectedOptions[0].value : ''
    const currentContext = this.getSignMessageContext(currentAccount)
    return currentContext.provider === expectedContext.provider &&
      currentContext.network === expectedContext.network &&
      currentContext.account === expectedContext.account
  }

  showSignMessageConfirmation (context, message, messageHash, okCb, cancelCb) {
    return modalDialog('Confirm message signature', yo`
      <div>
        <div><b>Provider</b>: <span>${context.provider}</span></div>
        <div><b>Network</b>: <span>${context.network || 'Unknown'}</span></div>
        <div><b>Account</b>: <span>${context.account}</span></div>
        <div><b>Message</b>: <pre style="white-space: pre-wrap; word-break: break-word;">${message}</pre></div>
        <div><b>Message hash</b>: <span>${messageHash}</span></div>
      </div>
    `, { label: 'Sign', fn: okCb }, { label: 'Cancel', fn: cancelCb })
  }

  signMessage () {
    this.blockchain.getAccounts((err, accounts) => {
      if (err) {
        return addTooltip(`Cannot get account list: ${err}`)
      }

      var signMessageDialog = { title: 'Sign a message', text: 'Enter a message to sign', inputvalue: 'Message to sign' }
      var $txOrigin = this.el.querySelector('#txorigin')
      if (!$txOrigin.selectedOptions[0] && (this.blockchain.isInjectedWeb3() || this.blockchain.isWeb3Provider())) {
        return addTooltip('Account list is empty, please make sure the current provider is properly connected to remix')
      }

      var account = $txOrigin.selectedOptions[0].value

      var promptCb = (passphrase) => {
        const modal = modalDialogCustom.promptMulti(signMessageDialog, (message) => {
          const context = this.getSignMessageContext(account)
          const expectedHash = '0x' + hashPersonalMessage(Buffer.from(message)).toString('hex')
          this.showSignMessageConfirmation(context, message, expectedHash, () => {
            if (!this.assertSignMessageContextUnchanged(context)) {
              return addTooltip('Account, provider, or network changed before signing. Please retry.')
            }
            this.blockchain.signMessage(message, account, passphrase, (err, msgHash, signedData) => {
              if (err) {
                return addTooltip(err)
              }
              modal.hide()
              modalDialogCustom.alert(yo`
                <div>
                  <b>hash:</b><br>
                  <span id="remixRunSignMsgHash" data-id="settingsRemixRunSignMsgHash">${msgHash}</span>
                  <br><b>signature:</b><br>
                  <span id="remixRunSignMsgSignature" data-id="settingsRemixRunSignMsgSignature">${signedData}</span>
                </div>
              `)
            })
          }, () => {})
        }, false)
      }

      if (this.blockchain.isWeb3Provider()) {
        return modalDialogCustom.promptPassphrase(
          'Passphrase to sign a message',
          'Enter your passphrase for this account to sign the message',
          '',
          promptCb,
          false
        )
      }
      promptCb()
    })
  }

  // TODO: unclear what's the goal of accountListCallId, feels like it can be simplified
  async fillAccountsList () {
    if (this._isDestroyed()) return
    this.accountListCallId++
    const callid = this.accountListCallId
    const txOrigin = this.el.querySelector('#txorigin')
    if (!txOrigin) return
    const provider = this.blockchain.getProvider()
    if (this.pendingAccountsProvider && provider !== this.pendingAccountsProvider) return
    this.pendingAccountsProvider = null
    let accounts = []
    try {
      accounts = await this.blockchain.getAccounts()
      if (this._isDestroyed()) return
      this.lastAccountListError = null
    } catch (e) {
      const message = `Cannot get account list: ${e}`
      if (message !== this.lastAccountListError) {
        addTooltip(message)
        this.lastAccountListError = message
      }
      if (provider !== 'vm') {
        this.clearAccountsList()
        this.loadedAccountsProvider = provider
        return
      }
      if (this._isDestroyed()) return
      if (this.loadedAccountsProvider !== provider) {
        accounts = []
      } else {
        return
      }
    }
    if (this.loadedAccountsProvider !== provider) {
      this.clearAccountsList()
      this.loadedAccountsProvider = provider
    }
    if (this.accountListCallId > callid) return
    this.accountListCallId++
    if (!accounts || !accounts.length || (accounts.length === 1 && !accounts[0])) accounts = []
    if (!accounts.length && provider !== 'vm') {
      this.clearAccountsList()
      this.loadedAccountsProvider = provider
      return
    }
    for (const loadedaddress in this.loadedAccounts) {
      if (accounts.indexOf(loadedaddress) === -1) {
        const optionToRemove = txOrigin.querySelector('option[value="' + loadedaddress + '"]')
        if (optionToRemove) {
          txOrigin.removeChild(optionToRemove)
          delete this.loadedAccounts[loadedaddress]
        }
      }
    }
    for (const i in accounts) {
      const address = accounts[i]
      const addressBase58 = remixLib.util.addressToBase58(address)
      if (!this.loadedAccounts[address]) {
        txOrigin.appendChild(yo`<option value="${address}" >${addressBase58}</option>`)
        this.loadedAccounts[address] = 1
      }
    }
    txOrigin.setAttribute('value', accounts[0])
  }
}

module.exports = SettingsUI
