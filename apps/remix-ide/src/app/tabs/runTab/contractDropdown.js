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

import publishToStorage from '../../../publishToStorage'
const yo = require('yo-yo')
const ethJSUtil = require('@tvmjs/util')
const css = require('../styles/run-tab-styles')
const modalDialogCustom = require('../../ui/modal-dialog-custom')
const remixLib = require('@remix-project/remix-lib')
const EventManager = remixLib.EventManager
const confirmDialog = require('../../ui/confirmDialog')
const modalDialog = require('../../ui/modaldialog')
const MultiParamManager = require('../../ui/multiParamManager')
const helper = require('../../../lib/helper')
const QueryParams = require('../../../lib/query-params')
const addTooltip = require('../../ui/tooltip')
const {
  abiSignature,
  createProxyContract,
  createUpgradeCall,
  createVersionCall,
  encodeInitializerCall,
  getInitializers,
  isEnabledURLFlag,
  isModernUpgradeResponse,
  isUUPSContract,
  normalizeContractAddress,
  proxyConstructorArguments,
  validateConstructorArguments
} = require('./model/uups-proxy')
const _paq = window._paq = window._paq || []

class ContractDropdownUI {
  constructor (blockchain, dropdownLogic, logCallback, runView) {
    this.blockchain = blockchain
    this.dropdownLogic = dropdownLogic
    this.logCallback = logCallback
    this.runView = runView
    this.event = new EventManager()

    this.listenToEvents()
    this.exEnvironment = blockchain.getProvider()
    this.listenToContextChange()
    this.loadType = 'other'
    this.proxyPreferences = new Map()
    this.proxyDeploymentInProgress = false
    const queryParams = (new QueryParams()).get()
    this.deployProxyRequested = isEnabledURLFlag(queryParams.deployProxy)
    this.upgradeProxyRequested = isEnabledURLFlag(queryParams.upgradeProxy)
  }

  setCompFailsVisible (visible) {
    if (!this.compFails) return
    this.compFails.style.display = visible ? 'inline-block' : 'none'
    if (visible) {
      this.compFails.setAttribute('title', 'No contract compiled yet or compilation failed. Please check the compile tab for more information.')
      this.compFails.setAttribute('aria-label', 'No contract compiled yet or compilation failed. Please check the compile tab for more information.')
    } else {
      this.compFails.removeAttribute('title')
      this.compFails.removeAttribute('aria-label')
    }
  }

  listenToEvents () {
    this.dropdownLogic.event.register('newlyCompiled', (success, data, source, compiler, compilerFullName, file) => {
      this.updateCompiledContracts(success, compiler, compilerFullName)
    })
  }

  updateCompiledContracts (success, compiler, compilerFullName) {
    if (!this.selectContractNames) return
    this.selectContractNames.innerHTML = ''
    if (success && compiler) {
      this.dropdownLogic.getCompiledContracts(compiler, compilerFullName).forEach((contract) => {
        this.selectContractNames.appendChild(yo`<option value="${contract.name}" compiler="${compilerFullName}">${contract.name} - ${contract.file}</option>`)
      })
    }
    this.enableAtAddress(success)
    this.enableContractNames(success)
    this.setInputParamsPlaceHolder()

    this.setCompFailsVisible(!success)
  }

  syncLastCompilation () {
    const compiler = this.dropdownLogic && this.dropdownLogic.compilersArtefacts && this.dropdownLogic.compilersArtefacts.__last
    if (!compiler) return
    // M3: only reuse the cached __last compilation when it actually corresponds
    // to the file currently open in the editor. Otherwise a fast file switch
    // would briefly render the previous file's contract list against this file.
    if (!this.lastCompilationMatchesCurrentFile(compiler)) return
    const compilerFullName = Object.keys(this.dropdownLogic.compilersArtefacts).find((name) => name !== '__last' && this.dropdownLogic.compilersArtefacts[name] === compiler)
    this.updateCompiledContracts(true, compiler, compilerFullName)
  }

  lastCompilationMatchesCurrentFile (compiler) {
    const config = this.dropdownLogic && this.dropdownLogic.config
    if (!config || typeof config.get !== 'function') return true
    const currentFile = config.get('currentFile')
    // No file open yet: nothing to mismatch against, keep prior behaviour.
    if (!currentFile) return true
    // An .abi file uses the At Address flow, not the cached .sol compilation.
    if (/.(.abi)$/.exec(currentFile)) return false
    const source = compiler && typeof compiler.getSourceCode === 'function' ? compiler.getSourceCode() : null
    const compiledFile = source && source.target
    // If we can't determine which file the cached compilation came from, fall
    // back to the legacy behaviour rather than hiding a valid contract list.
    if (!compiledFile) return true
    return compiledFile === currentFile
  }

  listenToContextChange () {
    this.blockchain.event.register('networkStatus', ({ error, network }) => {
      if (error) {
        console.log('can\'t detect network')
        return
      }
      this.exEnvironment = this.blockchain.getProvider()
      this.networkName = network.name
    })
  }

  enableContractNames (enable) {
    if (enable) {
      if (this.selectContractNames.value === '') return
      this.selectContractNames.removeAttribute('disabled')
      this.selectContractNames.setAttribute('title', 'Select contract for Deploy or At Address.')
    } else {
      this.selectContractNames.setAttribute('disabled', true)
      if (this.loadType === 'sol') {
        this.selectContractNames.setAttribute('title', '⚠ Select and compile *.sol file to deploy or access a contract.')
      } else {
        this.selectContractNames.setAttribute('title', '⚠ Selected *.abi file allows accessing contracts, select and compile *.sol file to deploy and access one.')
      }
    }
  }

  enableAtAddress (enable) {
    const buttonToModify = this.actualAtAddressButton || this.atAddress
    if (!buttonToModify || typeof buttonToModify.removeAttribute !== 'function') return

    if (enable) {
      let address = this.atAddressButtonInput.value
      try {
        const addressHex = remixLib.util.addressToHex(address)
        if (address !== addressHex) {
          address = ethJSUtil.toChecksumAddress(addressHex)
        }
      } catch (error) {
        this.enableAtAddress(false)
        return
      }
      if (!address || !ethJSUtil.isValidAddress(address)) {
        this.enableAtAddress(false)
        return
      }
      buttonToModify.removeAttribute('disabled')
      // this.atAddress.removeAttribute('disabled')
      // this.atAddress.setAttribute('title', 'Interact with the given contract.')
    } else {
      buttonToModify.setAttribute('disabled', true)
      // this.atAddress.setAttribute('disabled', true)
      if (this.atAddressButtonInput.value === '') {
        // this.atAddress.setAttribute('title', '⚠ Compile *.sol file or select *.abi file & then enter the address of deployed contract.')
      } else {
        // this.atAddress.setAttribute('title', '⚠ Compile *.sol file or select *.abi file.')
      }
    }
  }

  render () {
    this.compFails = yo`<i class="m-2 ml-3 fas fa-times-circle ${css.errorIcon}" aria-hidden="true"></i>`

    const buttonText = 'At Address'
    const tooltipText = 'Interact with the deployed contract - requires the .abi file or compiled .sol file tobe selected in the editor (with the same compiler configuration)'
    const atAddressButtonWithTooltip = yo`
      <div class="${css.tooltipContainer}" style="position: relative; display: inline-block;">
        <button 
          class="${css.atAddress} btn btn-sm btn-info" 
          id="runAndDeployAtAdressButton" 
          onclick=${this.loadFromAddress.bind(this)}
        >
          ${buttonText}
        </button>
        <span class="${css.tooltipTextCss}">${tooltipText}</span>
      </div>
    `

    this.atAddressButtonInput = yo`<input class="${css.input} ${css.ataddressinput} ataddressinput form-control" placeholder="Load contract from Address" title="address of contract" oninput=${this.atAddressChanged.bind(this)} />`
    this.selectContractNames = yo`<select class="${css.contractNames} custom-select" disabled title="Please compile *.sol file to deploy or access a contract"></select>`
    this.abiLabel = yo`<span class="py-1">ABI file selected</span>`
    if (this.exEnvironment === 'vm') this.networkName = 'JavaScript VM (Tron)'
    // this.enableAtAddress(false)
    this.abiLabel.style.display = 'none'

    this.createPanel = yo`<div class="${css.deployDropdown}"></div>`
    this.orLabel = yo`<div class="${css.orLabel} mt-2">or</div>`

    const contractNamesContainer = yo`
      <div class="${css.container}" data-id="contractDropdownContainer">
        <label class="${css.settingsLabel}">Contract</label>
        <div class="${css.subcontainer}">
          ${this.selectContractNames} ${this.compFails}
          ${this.abiLabel}
        </div>
        <div>
          ${this.createPanel}
          ${this.orLabel}
          <div class="${css.button} ${css.atAddressSect}">
            ${atAddressButtonWithTooltip}
            ${this.atAddressButtonInput}
          </div>
        </div>
      </div>
    `
    this.selectContractNames.addEventListener('change', this.setInputParamsPlaceHolder.bind(this))
    this.setInputParamsPlaceHolder()
    if (!this.contractNamesContainer) {
      this.contractNamesContainer = contractNamesContainer
    }

    const actualButton = atAddressButtonWithTooltip.querySelector('button')
    this.actualAtAddressButton = actualButton
    this.enableAtAddress(false)
    this.setCompFailsVisible(false)
    this.syncLastCompilation()
    return contractNamesContainer
  }

  atAddressChanged (event) {
    if (!this.atAddressButtonInput.value) {
      this.enableAtAddress(false)
    } else {
      if ((this.selectContractNames && !this.selectContractNames.getAttribute('disabled') && this.loadType === 'sol') ||
        this.loadType === 'abi') {
        this.enableAtAddress(true)
      } else {
        this.enableAtAddress(false)
      }
    }
  }

  changeCurrentFile (currentFile) {
    if (!this.selectContractNames) return
    if (/.(.abi)$/.exec(currentFile)) {
      this.createPanel.style.display = 'none'
      this.orLabel.style.display = 'none'
      this.setCompFailsVisible(false)
      this.loadType = 'abi'
      this.contractNamesContainer.style.display = 'block'
      this.abiLabel.style.display = 'block'
      this.abiLabel.textContent = currentFile
      this.selectContractNames.style.display = 'none'
      this.enableContractNames(true)
    } else if (/.(.sol)$/.exec(currentFile) ||
        /.(.vy)$/.exec(currentFile) || // vyper
        /.(.lex)$/.exec(currentFile) || // lexon
        /.(.contract)$/.exec(currentFile)) {
      this.createPanel.style.display = 'block'
      this.orLabel.style.display = 'block'
      this.contractNamesContainer.style.display = 'block'
      this.loadType = 'sol'
      this.selectContractNames.style.display = 'block'
      this.abiLabel.style.display = 'none'
    } else {
      this.loadType = 'other'
      this.createPanel.style.display = 'none'
      this.orLabel.style.display = 'none'
      this.setCompFailsVisible(false)
      this.contractNamesContainer.style.display = 'none'
      this.abiLabel.style.display = 'none'
    }
    // M3: the file (and therefore loadType / the available compilation) just
    // changed, so re-evaluate the At Address button against the *new* file's
    // context instead of leaving it enabled from the previous file. Routing
    // through atAddressChanged() keeps a single source of truth for the gating
    // (empty input, sol-needs-compiled-contract, abi-always-allowed).
    this.atAddressChanged()
  }

  setInputParamsPlaceHolder () {
    this.createPanel.innerHTML = ''
    if (this.selectContractNames.selectedIndex < 0 || this.selectContractNames.children.length <= 0) {
      this.createPanel.innerHTML = 'No compiled contracts'
      return
    }

    const selectedContract = this.getSelectedContract()
    const clickCallback = async (valArray, inputsValues) => {
      var selectedContract = this.getSelectedContract()
      this.createInstance(selectedContract, inputsValues)
      window?.gtag('event', 'click', { event_category: 'deploy_user_action', event_label: 'deploy' })
    }
    const createConstructorInstance = new MultiParamManager(
      0,
      selectedContract.getConstructorInterface(),
      clickCallback,
      selectedContract.getConstructorInputs(),
      'Deploy',
      selectedContract.bytecodeObject,
      true
    )
    const standardDeployment = createConstructorInstance.render()

    if (!isUUPSContract(selectedContract)) {
      this.createPanel.appendChild(standardDeployment)
      return
    }

    const initializers = getInitializers(selectedContract.abi)
    const preferenceKey = `${selectedContract.contract.file}:${selectedContract.name}`
    const defaultMode = this.proxyPreferences.has(preferenceKey)
      ? this.proxyPreferences.get(preferenceKey)
      : (this.deployProxyRequested && initializers.length > 0
        ? 'deploy'
        : (this.upgradeProxyRequested ? 'upgrade' : 'standard'))
    const proxyToggle = yo`<input type="checkbox" class="mr-2" data-id="uupsDeployProxyToggle">`
    const upgradeToggle = yo`<input type="checkbox" class="mr-2" data-id="uupsUpgradeProxyToggle">`
    proxyToggle.checked = defaultMode === 'deploy' && initializers.length > 0
    upgradeToggle.checked = defaultMode === 'upgrade'
    const proxyPanel = yo`<div class="mt-2" data-id="uupsProxyDeploymentPanel"></div>`
    const upgradePanel = yo`<div class="mt-2" data-id="uupsProxyUpgradePanel"></div>`
    const proxyNotice = initializers.length > 0
      ? yo`<small class="d-block text-muted mt-1">Deploys the implementation, then an ERC1967 proxy initialized in a second transaction.</small>`
      : yo`<small class="d-block text-warning mt-1" data-id="uupsMissingInitializer">Proxy deployment is unavailable because this contract has no initialize(...) function.</small>`
    const proxyControls = yo`
      <div class="mt-2 p-2 border rounded" data-id="uupsProxyControls">
        <label class="mb-0 d-flex align-items-center">
          ${proxyToggle}
          <span>Deploy with ERC1967 Proxy</span>
        </label>
        ${proxyNotice}
        ${proxyPanel}
        <label class="mb-0 mt-2 d-flex align-items-center">
          ${upgradeToggle}
          <span>Upgrade existing ERC1967 Proxy</span>
        </label>
        <small class="d-block text-muted mt-1">Deploys this implementation, then upgrades the supplied proxy in a second transaction.</small>
        ${upgradePanel}
      </div>
    `

    if (initializers.length === 0) proxyToggle.setAttribute('disabled', true)

    const constructorABI = selectedContract.getConstructorInterface()
    let constructorArgsInput = null
    if (constructorABI.inputs && constructorABI.inputs.length > 0) {
      constructorArgsInput = yo`
        <input class="form-control mt-2" data-id="uupsImplementationConstructorArgs"
          placeholder="${selectedContract.getConstructorInputs()}"
          title="Implementation constructor arguments">
      `
      proxyPanel.appendChild(yo`
        <div>
          <label class="mb-1">Implementation constructor arguments</label>
          ${constructorArgsInput}
        </div>
      `)
    }

    let initializerSelect = null
    const initializerHost = yo`<div data-id="uupsInitializerArguments"></div>`
    if (initializers.length > 1) {
      initializerSelect = yo`<select class="custom-select mt-2" data-id="uupsInitializerSelect"></select>`
      initializers.forEach((initializer, index) => {
        initializerSelect.appendChild(yo`<option value="${index}">${abiSignature(initializer)}</option>`)
      })
      proxyPanel.appendChild(yo`<div><label class="mb-1 mt-2">Initializer</label>${initializerSelect}</div>`)
    }
    proxyPanel.appendChild(initializerHost)

    const renderInitializer = () => {
      initializerHost.innerHTML = ''
      if (initializers.length === 0) return
      const initializerABI = initializers[initializerSelect ? Number(initializerSelect.value) : 0]
      const proxyClickCallback = async (valArray, inputsValues) => {
        const currentContract = this.getSelectedContract()
        this.createProxyInstance(
          currentContract,
          constructorArgsInput ? constructorArgsInput.value : '',
          initializerABI,
          inputsValues
        )
        window?.gtag('event', 'click', { event_category: 'deploy_user_action', event_label: 'deploy_proxy' })
      }
      const initializeInstance = new MultiParamManager(
        0,
        initializerABI,
        proxyClickCallback,
        this.blockchain.getInputs(initializerABI),
        'Deploy with Proxy',
        null,
        true
      )
      initializerHost.appendChild(initializeInstance.render())
    }
    if (initializerSelect) initializerSelect.addEventListener('change', renderInitializer)
    renderInitializer()

    const proxyAddressInput = yo`
      <input class="form-control mt-2" data-id="uupsProxyAddress"
        placeholder="Existing proxy address" title="Existing ERC1967 proxy address">
    `
    const upgradeClickCallback = async (valArray, inputsValues) => {
      const currentContract = this.getSelectedContract()
      this.createUpgradeInstance(currentContract, inputsValues, proxyAddressInput.value)
      window?.gtag('event', 'click', { event_category: 'deploy_user_action', event_label: 'upgrade_proxy' })
    }
    const upgradeInstance = new MultiParamManager(
      0,
      constructorABI,
      upgradeClickCallback,
      selectedContract.getConstructorInputs(),
      'Upgrade Proxy',
      null,
      true
    )
    upgradePanel.appendChild(proxyAddressInput)
    upgradePanel.appendChild(yo`<small class="d-block text-warning mt-1">Verify storage-layout compatibility before upgrading. TronIDE does not prove upgrade safety.</small>`)
    upgradePanel.appendChild(upgradeInstance.render())

    const syncProxyMode = (changedMode) => {
      if (changedMode === 'deploy' && proxyToggle.checked) upgradeToggle.checked = false
      if (changedMode === 'upgrade' && upgradeToggle.checked) proxyToggle.checked = false
      const deployEnabled = proxyToggle.checked && initializers.length > 0
      const upgradeEnabled = upgradeToggle.checked
      const mode = deployEnabled ? 'deploy' : (upgradeEnabled ? 'upgrade' : 'standard')
      this.proxyPreferences.set(preferenceKey, mode)
      standardDeployment.style.display = mode === 'standard' ? 'block' : 'none'
      proxyPanel.style.display = deployEnabled ? 'block' : 'none'
      upgradePanel.style.display = upgradeEnabled ? 'block' : 'none'
    }
    proxyToggle.addEventListener('change', () => syncProxyMode('deploy'))
    upgradeToggle.addEventListener('change', () => syncProxyMode('upgrade'))

    this.createPanel.appendChild(proxyControls)
    this.createPanel.appendChild(standardDeployment)
    syncProxyMode()
  }

  getSelectedContract () {
    var contract = this.selectContractNames.children[this.selectContractNames.selectedIndex]
    var contractName = contract.getAttribute('value')
    var compilerAtributeName = contract.getAttribute('compiler')

    return this.dropdownLogic.getSelectedContract(contractName, compilerAtributeName)
  }

  createProxyInstance (selectedContract, constructorArgs, initializerABI, initializerArgs) {
    if (this.proxyDeploymentInProgress) {
      return modalDialogCustom.alert('A proxy deployment is already in progress. Wait for both transactions to finish before starting another one.')
    }

    let initializerData
    try {
      validateConstructorArguments(selectedContract, constructorArgs)
      initializerData = encodeInitializerCall(initializerABI, initializerArgs)
    } catch (error) {
      return modalDialogCustom.alert('Invalid proxy deployment arguments', error.message || String(error))
    }

    modalDialog('Deploy implementation and proxy', yo`
      <div>
        <p>This flow sends two transactions: first the ${selectedContract.name} implementation, then an ERC1967 proxy that calls ${abiSignature(initializerABI)}.</p>
        <p class="mb-0">Your wallet may request two confirmations. If the proxy transaction fails, the implementation remains deployed and the proxy step can be retried.</p>
      </div>
    `, {
      label: 'Proceed',
      fn: () => {
        this.proxyDeploymentInProgress = true
        this.createInstance(selectedContract, constructorArgs, { type: 'deploy', initializerABI, initializerArgs, initializerData })
      }
    }, {
      label: 'Cancel',
      fn: () => {}
    })
  }

  createUpgradeInstance (selectedContract, constructorArgs, proxyAddress) {
    if (this.proxyDeploymentInProgress) {
      return modalDialogCustom.alert('A proxy operation is already in progress. Wait for both transactions to finish before starting another one.')
    }

    let normalizedProxyAddress
    try {
      validateConstructorArguments(selectedContract, constructorArgs)
      normalizedProxyAddress = normalizeContractAddress(proxyAddress)
    } catch (error) {
      return modalDialogCustom.alert('Invalid proxy upgrade arguments', error.message || String(error))
    }

    modalDialog('Deploy implementation and upgrade proxy', yo`
      <div>
        <p>This flow sends two transactions: first the new ${selectedContract.name} implementation, then an upgrade call to ${normalizedProxyAddress}.</p>
        <p class="text-warning">TronIDE cannot prove storage-layout compatibility. Verify the new implementation against the current proxy before proceeding.</p>
        <p class="mb-0">Your wallet may request two confirmations. If the upgrade transaction fails, the new implementation remains deployed and the upgrade step can be retried.</p>
      </div>
    `, {
      label: 'Proceed',
      fn: () => {
        this.proxyDeploymentInProgress = true
        this.createInstance(selectedContract, constructorArgs, { type: 'upgrade', proxyAddress: normalizedProxyAddress })
      }
    }, {
      label: 'Cancel',
      fn: () => {}
    })
  }

  registerContractInstance (contractObject, address, displayName) {
    this.event.trigger('clearInstance')
    this.event.trigger('newContractInstanceAdded', [contractObject, address, displayName || contractObject.name])
    const data = this.runView.compilersArtefacts.getCompilerAbstract(contractObject.contract.file)
    let resolvedAddress
    try { resolvedAddress = normalizeContractAddress(address) } catch (e) { resolvedAddress = helper.addressToString(address) }
    this.runView.compilersArtefacts.addResolvedContract(resolvedAddress, data)
  }

  deployUUPSProxy (implementationContract, implementationAddress, proxyPlan, callbacks, confirmationCb) {
    let proxyContract
    let proxyArgs
    try {
      proxyContract = createProxyContract(implementationContract)
      proxyArgs = proxyConstructorArguments(implementationAddress, proxyPlan.initializerData)
    } catch (error) {
      this.proxyDeploymentInProgress = false
      return modalDialogCustom.alert('Unable to prepare proxy deployment', error.message || String(error))
    }

    const operation = `creation of ERC1967Proxy for ${implementationContract.name}`
    const attemptContext = {
      operation,
      walletRequest: this.blockchain.getProvider() === 'injected',
      retry: () => this.deployUUPSProxy(implementationContract, implementationAddress, proxyPlan, callbacks, confirmationCb)
    }
    const proxyStatusCb = (msg, context) => this.logCallback(msg, Object.assign({}, attemptContext, context))
    const proxyFinalCb = (error, contractObject, proxyAddress) => {
      this.proxyDeploymentInProgress = false
      if (error) return

      try {
        const proxyInstance = Object.assign({}, implementationContract, {
          implementationAddress: normalizeContractAddress(implementationAddress),
          proxyAddress: normalizeContractAddress(proxyAddress),
          proxyType: 'ERC1967'
        })
        this.registerContractInstance(proxyInstance, proxyAddress, `${implementationContract.name} (ERC1967Proxy)`)
        _paq.push(['trackEvent', 'udapp', 'DeployWithProxy', this.networkName])
      } catch (registrationError) {
        console.error('[uups-proxy] proxy deployed but instance registration failed:', registrationError)
        modalDialogCustom.alert('Proxy deployed', 'The proxy transaction succeeded, but the deployed instance could not be added to the panel. Check the terminal for its address.')
      }
    }

    proxyStatusCb(`deploying ERC1967 ${proxyContract.proxyVersion} proxy for ${implementationContract.name}...`)
    this.blockchain.deployContractAndLibraries(
      proxyContract,
      proxyArgs,
      null,
      {},
      {
        continueCb: callbacks.continueCb,
        promptCb: callbacks.promptCb,
        statusCb: proxyStatusCb,
        finalCb: proxyFinalCb
      },
      confirmationCb
    )
  }

  upgradeUUPSProxy (implementationContract, implementationAddress, proxyPlan, callbacks, confirmationCb) {
    let proxyAddress
    let newImplementationAddress
    try {
      proxyAddress = normalizeContractAddress(proxyPlan.proxyAddress)
      newImplementationAddress = normalizeContractAddress(implementationAddress)
    } catch (error) {
      this.proxyDeploymentInProgress = false
      return modalDialogCustom.alert('Unable to prepare proxy upgrade', error.message || String(error))
    }

    const operation = `upgrade of ERC1967Proxy to ${implementationContract.name}`
    const attemptContext = {
      operation,
      walletRequest: this.blockchain.getProvider() === 'injected',
      retry: () => this.upgradeUUPSProxy(implementationContract, implementationAddress, proxyPlan, callbacks, confirmationCb)
    }
    const upgradeStatusCb = (msg, context) => this.logCallback(msg, Object.assign({}, attemptContext, context))

    const runUpgrade = (modern) => {
      let upgradeCall
      try { upgradeCall = createUpgradeCall(newImplementationAddress, modern) } catch (error) {
        this.proxyDeploymentInProgress = false
        return modalDialogCustom.alert('Unable to encode proxy upgrade', error.message || String(error))
      }

      const data = {
        contractABI: implementationContract.abi,
        contract: implementationContract.object,
        contractName: 'ERC1967Proxy',
        dataHex: upgradeCall.dataHex,
        funAbi: upgradeCall.abi,
        funArgs: upgradeCall.args,
        linkReferences: {}
      }
      upgradeStatusCb(`upgrade of ERC1967 ${modern ? '5.x' : '4.x'} proxy pending...`, { phase: 'pending' })
      this.blockchain.runTx(
        { to: proxyAddress, data, useCall: false, value: '0', tokenId: '0', tokenValue: '0' },
        confirmationCb,
        callbacks.continueCb,
        callbacks.promptCb,
        (error, txResult) => {
          this.proxyDeploymentInProgress = false
          if (error) {
            upgradeStatusCb(`upgrade of ERC1967Proxy errored: ${error.message || error}`, { phase: 'error', error, txResult })
            return
          }

          upgradeStatusCb('upgrade of ERC1967Proxy succeeded.', { phase: 'success', txResult })
          try {
            const proxyInstance = Object.assign({}, implementationContract, {
              implementationAddress: newImplementationAddress,
              proxyAddress,
              proxyType: 'ERC1967'
            })
            this.registerContractInstance(proxyInstance, proxyAddress, `${implementationContract.name} (Upgraded ERC1967Proxy)`)
            _paq.push(['trackEvent', 'udapp', 'UpgradeProxy', this.networkName])
          } catch (registrationError) {
            console.error('[uups-proxy] proxy upgraded but instance registration failed:', registrationError)
            modalDialogCustom.alert('Proxy upgraded', 'The upgrade transaction succeeded, but the upgraded instance could not be added to the panel. Check the terminal for its address.')
          }
        }
      )
    }

    // OpenZeppelin 5.x removes upgradeTo(address), while 4.x does not expose
    // UPGRADE_INTERFACE_VERSION(). Probe the CURRENT implementation through
    // the proxy; if the call is absent or malformed, fall back to the legacy
    // upgrade function. A guard prevents a slow provider from starting both.
    const versionCall = createVersionCall()
    const versionData = {
      contractABI: [versionCall.abi],
      contractName: 'ERC1967Proxy',
      dataHex: versionCall.dataHex,
      funAbi: versionCall.abi,
      funArgs: [],
      linkReferences: {}
    }
    let versionSettled = false
    const finishVersionProbe = (modern) => {
      if (versionSettled) return
      versionSettled = true
      clearTimeout(versionTimer)
      upgradeStatusCb(`using ERC1967 ${modern ? '5.x upgradeToAndCall' : '4.x upgradeTo'} for the proxy upgrade...`)
      runUpgrade(modern)
    }
    const failVersionProbe = () => {
      if (versionSettled) return
      versionSettled = true
      this.proxyDeploymentInProgress = false
      const error = new Error('Timed out while detecting the proxy upgrade interface. No upgrade transaction was sent.')
      upgradeStatusCb(error.message, { phase: 'error', error })
      modalDialogCustom.alert('Proxy upgrade not sent', 'TronIDE could not determine whether this proxy uses the OpenZeppelin 4.x or 5.x upgrade interface. Check the provider connection and retry; no upgrade transaction was sent.')
    }
    // A slow provider is ambiguous: guessing the legacy function could send a
    // doomed transaction to an OpenZeppelin 5.x proxy after its implementation
    // has already been deployed. Fail closed instead of guessing on timeout.
    const versionTimer = setTimeout(failVersionProbe, 10000)
    const silentContinueCb = (error, continueTxExecution, cancelCb) => {
      if (!error) return continueTxExecution()
      if (cancelCb) cancelCb()
      finishVersionProbe(false)
    }
    const silentPromptCb = (okCb, cancelCb) => cancelCb()
    const silentConfirmationCb = (network, tx, gasEstimation, continueTxExecution) => continueTxExecution()
    try {
      this.blockchain.runTx(
        { to: proxyAddress, data: versionData, useCall: true, value: '0', tokenId: '0', tokenValue: '0' },
        silentConfirmationCb,
        silentContinueCb,
        silentPromptCb,
        (error, txResult, address, returnValue) => finishVersionProbe(!error && isModernUpgradeResponse(returnValue))
      )
    } catch (error) {
      finishVersionProbe(false)
    }
  }

  async createInstance (selectedContract, args, proxyPlan) {
    if (selectedContract.bytecodeObject.length === 0) {
      this.proxyDeploymentInProgress = false
      return modalDialogCustom.alert('This contract may be abstract, not implement an abstract parent\'s methods completely or not invoke an inherited contract\'s constructor correctly.')
    }

    var continueCb = (error, continueTxExecution, cancelCb) => {
      if (error) {
        var msg = typeof error !== 'string' ? error.message : error
        modalDialog('Gas estimation failed', yo`<div>Gas estimation errored with the following message (see below).
        The transaction execution will likely fail. Do you want to force sending? <br>
        ${msg}
        </div>`,
        {
          label: 'Send Transaction',
          fn: () => {
            continueTxExecution()
          }
        }, {
          label: 'Cancel Transaction',
          fn: () => {
            cancelCb()
          }
        })
      } else {
        continueTxExecution()
      }
    }

    const self = this

    var promptCb = (okCb, cancelCb) => {
      modalDialogCustom.promptPassphrase('Passphrase requested', 'Personal mode is enabled. Please provide passphrase of account', '', okCb, cancelCb)
    }

    const operation = proxyPlan
      ? `${proxyPlan.type === 'upgrade' ? 'upgrade' : 'deployment'} of ${selectedContract.name} with ERC1967 proxy`
      : `creation of ${selectedContract.name}`
    const attemptContext = {
      operation,
      walletRequest: this.blockchain.getProvider() === 'injected',
      retry: () => this.createInstance(selectedContract, args, proxyPlan)
    }
    var statusCb = (msg, context) => {
      return this.logCallback(msg, Object.assign({}, attemptContext, context))
    }

    var finalCb = (error, contractObject, address) => {
      // createContract reports both error and success through statusCb so the
      // terminal can close the exact Attempt card. Avoid logging the same error
      // a second time here.
      if (error) {
        self.proxyDeploymentInProgress = false
        return
      }
      self.registerContractInstance(contractObject, address, contractObject.name)
      if (self.ipfsCheckedState) {
        _paq.push(['trackEvent', 'udapp', 'DeployAndPublish', this.networkName])
        publishToStorage('ipfs', self.runView.fileProvider, self.runView.fileManager, selectedContract)
      } else {
        _paq.push(['trackEvent', 'udapp', 'DeployOnly', this.networkName])
      }

      if (proxyPlan && proxyPlan.type === 'upgrade') {
        self.upgradeUUPSProxy(selectedContract, address, proxyPlan, { continueCb, promptCb }, confirmationCb)
      } else if (proxyPlan) {
        self.deployUUPSProxy(selectedContract, address, proxyPlan, { continueCb, promptCb }, confirmationCb)
      }
    }

    let contractMetadata
    try {
      contractMetadata = await this.runView.call('compilerMetadata', 'deployMetadataOf', selectedContract.name, selectedContract.contract.file)
    } catch (error) {
      this.proxyDeploymentInProgress = false
      return statusCb(`creation of ${selectedContract.name} errored: ` + (error.message ? error.message : error))
    }

    const compilerContracts = this.dropdownLogic.getCompilerContracts()
    const confirmationCb = this.getConfirmationCb(modalDialog, confirmDialog)

    if (selectedContract.isOverSizeLimit()) {
      return modalDialog('Contract code size over limit', yo`<div>Contract creation initialization returns data with length of more than 24576 bytes. The deployment will likely fails. <br>
      More info: <a href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-170.md" target="_blank" rel="noopener noreferrer">eip-170</a>
      </div>`,
      {
        label: 'Force Send',
        fn: () => {
          this.deployContract(selectedContract, args, contractMetadata, compilerContracts, { continueCb, promptCb, statusCb, finalCb }, confirmationCb)
        }
      }, {
        label: 'Cancel',
        fn: () => {
          this.proxyDeploymentInProgress = false
          this.logCallback(`creation of ${selectedContract.name} canceled by user.`)
        }
      })
    }
    this.deployContract(selectedContract, args, contractMetadata, compilerContracts, { continueCb, promptCb, statusCb, finalCb }, confirmationCb)
  }

  deployContract (selectedContract, args, contractMetadata, compilerContracts, callbacks, confirmationCb) {
    _paq.push(['trackEvent', 'udapp', 'DeployContractTo', this.networkName])
    const { statusCb } = callbacks
    if (!contractMetadata || (contractMetadata && contractMetadata.autoDeployLib)) {
      return this.blockchain.deployContractAndLibraries(selectedContract, args, contractMetadata, compilerContracts, callbacks, confirmationCb)
    }
    if (Object.keys(selectedContract.bytecodeLinkReferences).length) statusCb(`linking ${JSON.stringify(selectedContract.bytecodeLinkReferences, null, '\t')} using ${JSON.stringify(contractMetadata.linkReferences, null, '\t')}`)
    this.blockchain.deployContractWithLibrary(selectedContract, args, contractMetadata, compilerContracts, callbacks, confirmationCb)
  }

  getConfirmationCb (modalDialog, confirmDialog) {
    // this code is the same as in recorder.js. TODO need to be refactored out
    const confirmationCb = (network, tx, gasEstimation, continueTxExecution, cancelCb) => {
      if (network.name !== 'Main') {
        return continueTxExecution(null)
      }
      const amount = this.blockchain.fromWei(tx.value, true, 'ether')
      const content = confirmDialog(tx, network, amount, gasEstimation, this.blockchain.determineGasFees(tx), this.blockchain.determineGasPrice.bind(this.blockchain))

      modalDialog('Confirm transaction', content,
        {
          label: 'Confirm',
          fn: () => {
            this.blockchain.config.setUnpersistedProperty('doNotShowTransactionConfirmationAgain', content.querySelector('input#confirmsetting').checked)
            // TODO: check if this is check is still valid given the refactor
            if (!content.gasPriceStatus) {
              cancelCb('Given transaction fee is not correct')
            } else {
              continueTxExecution(content.txFee)
            }
          }
        }, {
          label: 'Cancel',
          fn: () => {
            return cancelCb('Transaction canceled by user.')
          }
        }
      )
    }

    return confirmationCb
  }

  loadFromAddress () {
    this.event.trigger('clearInstance')

    let address = this.atAddressButtonInput.value
    try {
      const addressHex = remixLib.util.addressToHex(address)
      if (address !== addressHex) {
        address = ethJSUtil.toChecksumAddress(addressHex)
      }
    } catch (error) {
      return
    }

    if (!ethJSUtil.isValidChecksumAddress(address)) {
      addTooltip(yo`
        <span>
          It seems you are not using a checksumed address.
          <br>A checksummed address is an address that contains uppercase letters, as specified in <a href="https://eips.ethereum.org/EIPS/eip-55" target="_blank" rel="noopener noreferrer">EIP-55</a>.
          <br>Checksummed addresses are meant to help prevent users from sending transactions to the wrong address.
        </span>`)
      address = ethJSUtil.toChecksumAddress(address)
    }
    this.dropdownLogic.loadContractFromAddress(address,
      (cb) => {
        modalDialogCustom.confirm('At Address', `Do you really want to interact with ${address} using the current ABI definition?`, cb)
      },
      (error, loadType, abi) => {
        if (error) {
          return modalDialogCustom.alert(error)
        }
        if (loadType === 'abi') {
          return this.event.trigger('newContractABIAdded', [abi, address])
        }
        var selectedContract = this.getSelectedContract()
        this.event.trigger('newContractInstanceAdded', [selectedContract.object, address, this.selectContractNames.value])
      }
    )
  }
}

module.exports = ContractDropdownUI
