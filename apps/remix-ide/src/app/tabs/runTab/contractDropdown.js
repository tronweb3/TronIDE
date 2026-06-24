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
const addTooltip = require('../../ui/tooltip')
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
    this.createPanel.appendChild(createConstructorInstance.render())
  }

  getSelectedContract () {
    var contract = this.selectContractNames.children[this.selectContractNames.selectedIndex]
    var contractName = contract.getAttribute('value')
    var compilerAtributeName = contract.getAttribute('compiler')

    return this.dropdownLogic.getSelectedContract(contractName, compilerAtributeName)
  }

  async createInstance (selectedContract, args) {
    if (selectedContract.bytecodeObject.length === 0) {
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

    var statusCb = (msg) => {
      return this.logCallback(msg)
    }

    var finalCb = (error, contractObject, address) => {
      self.event.trigger('clearInstance')

      if (error) {
        return this.logCallback(error)
      }
      self.event.trigger('newContractInstanceAdded', [contractObject, address, contractObject.name])

      const data = self.runView.compilersArtefacts.getCompilerAbstract(contractObject.contract.file)
      self.runView.compilersArtefacts.addResolvedContract(helper.addressToString(address), data)
      if (self.ipfsCheckedState) {
        _paq.push(['trackEvent', 'udapp', 'DeployAndPublish', this.networkName])
        publishToStorage('ipfs', self.runView.fileProvider, self.runView.fileManager, selectedContract)
      } else {
        _paq.push(['trackEvent', 'udapp', 'DeployOnly', this.networkName])
      }
    }

    let contractMetadata
    try {
      contractMetadata = await this.runView.call('compilerMetadata', 'deployMetadataOf', selectedContract.name, selectedContract.contract.file)
    } catch (error) {
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
