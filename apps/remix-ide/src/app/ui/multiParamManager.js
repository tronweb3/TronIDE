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

'use strict'

var yo = require('yo-yo')
var css = require('../../universal-dapp-styles')
var copyToClipboard = require('./copy-to-clipboard')
var modalDialogCustom = require('./modal-dialog-custom')
var remixLib = require('@remix-project/remix-lib')
var txFormat = remixLib.execution.txFormat
var txIntegerUtils = remixLib.execution.txIntegerUtils

class MultiParamManager {
  /**
    *
    * @param {bool} lookupOnly
    * @param {Object} funABI
    * @param {Function} clickMultiCallBack
    * @param {string} inputs
    * @param {string} title
    * @param {string} evmBC
    *
    */
  constructor (lookupOnly, funABI, clickCallBack, inputs, title, evmBC, isDeploy) {
    this.lookupOnly = lookupOnly
    this.funABI = funABI
    this.clickCallBack = clickCallBack
    this.inputs = inputs
    this.title = title
    this.evmBC = evmBC
    this.basicInputField = null
    this.multiFields = null
    this.isDeploy = isDeploy
  }

  switchMethodViewOn () {
    this.contractActionsContainerSingle.style.display = 'none'
    this.contractActionsContainerMulti.style.display = 'flex'
    this.makeMultiVal()
  }

  switchMethodViewOff () {
    this.contractActionsContainerSingle.style.display = 'flex'
    this.contractActionsContainerMulti.style.display = 'none'
    var multiValString = this.getMultiValsString()
    if (multiValString) this.basicInputField.value = multiValString
  }

  getValue (item, index) {
    var valStr = item.value.join('')
    return valStr
  }

  getMultiValsString () {
    var valArray = this.multiFields.querySelectorAll('input')
    var ret = ''
    var valArrayTest = []

    for (var j = 0; j < valArray.length; j++) {
      if (ret !== '') ret += ','
      var elVal = valArray[j].value
      valArrayTest.push(elVal)
      elVal = elVal.replace(/(^|,\s+|,)(\d+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted number by quoted number
      elVal = elVal.replace(/(^|,\s+|,)(0[xX][0-9a-fA-F]+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted hex string by quoted hex string
      try {
        JSON.parse(elVal)
      } catch (e) {
        elVal = '"' + elVal + '"'
      }
      ret += elVal
    }
    var valStringTest = valArrayTest.join('')
    if (valStringTest) {
      return ret
    } else {
      return ''
    }
  }

  emptyInputs () {
    var valArray = this.multiFields.querySelectorAll('input')
    for (var k = 0; k < valArray.length; k++) {
      valArray[k].value = ''
    }
    this.basicInputField.value = ''
  }

  makeMultiVal () {
    var inputString = this.basicInputField.value
    if (inputString) {
      // inputString = inputString.replace(/(^|,\s+|,)(\d+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted number by quoted number
      // inputString = inputString.replace(/(^|,\s+|,)(0[xX][0-9a-fA-F]+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted hex string by quoted hex string
      // var inputJSON = JSON.parse('[' + inputString + ']')
      var inputJSON = txFormat?.parseFunctionParams(inputString)
      var multiInputs = this.multiFields.querySelectorAll('input')
      for (var k = 0; k < multiInputs.length; k++) {
        if (inputJSON[k]) {
          multiInputs[k].value = JSON.stringify(inputJSON[k])
        }
      }
    }
  }

  showUnsafeIntegerAlert (findings) {
    const items = findings.map((finding) => {
      const label = finding.name || `Argument ${finding.index + 1}`
      return yo`<li>${label}: <code>${finding.value}</code></li>`
    })
    const firstFinding = findings[0]
    const firstLabel = firstFinding.name || `Argument ${firstFinding.index + 1}`
    const message = findings.length === 1
      ? txIntegerUtils.formatSafeIntegerRangeError(firstLabel)
      : txIntegerUtils.formatSafeIntegerRangeError('Multiple inputs')

    modalDialogCustom.alert('Unsafe integer input', yo`
      <div>
        <div>${message}</div>
        <ul class="mt-2 mb-0">
          ${items}
        </ul>
      </div>
    `)
  }

  validateSingleInputUnsafeIntegers () {
    if (!this.basicInputField?.value) return true
    const findings = txFormat.findUnsafeIntegerLiteralParams(this.basicInputField.value, this.funABI.inputs || [])
    if (!findings.length) return true

    this.showUnsafeIntegerAlert(findings)
    return false
  }

  validateExpandedInputUnsafeIntegers () {
    if (!this.funABI.inputs || !this.multiFields) return true

    const findings = []
    const multiInputs = this.multiFields.querySelectorAll('input')
    for (let i = 0; i < multiInputs.length; i++) {
      const inputAbi = this.funABI.inputs[i]
      const rawValue = multiInputs[i].value
      if (!rawValue) continue

      const inputFindings = txFormat.findUnsafeIntegerLiteralParams(rawValue, [inputAbi])
      if (inputFindings.length > 0) {
        findings.push({
          ...inputFindings[0],
          index: i,
          name: inputAbi?.name || inputFindings[0].name
        })
      }
    }

    if (!findings.length) return true

    this.showUnsafeIntegerAlert(findings)
    return false
  }

  createMultiFields () {
    if (this.funABI.inputs) {
      return yo`<div>
        ${this.funABI.inputs.map(function (inp) {
          return yo`<div class="${css.multiArg}"><label for="${inp.name}"> ${inp.name}: </label><input class="form-control" placeholder="${inp.type}" title="${inp.name}" data-id="multiParamManagerInput${inp.name}"></div>`
        })}
      </div>`
    }
  }

  render () {
    var title
    if (this.title) {
      title = this.title
    } else if (this.funABI.name) {
      title = this.funABI.name
    } else {
      title = this.funABI.type === 'receive' ? '(receive)' : '(fallback)'
    }

    this.basicInputField = yo`<input class="form-control" data-id="multiParamManagerBasicInputField"></input>`
    this.basicInputField.setAttribute('placeholder', this.inputs)
    this.basicInputField.setAttribute('title', this.inputs)
    this.basicInputField.setAttribute('data-id', this.inputs)

    var onClick = () => {
      if (!this.validateSingleInputUnsafeIntegers()) return
      this.clickCallBack(this.funABI.inputs, this.basicInputField.value)
    }
    const width = this.isDeploy ? '' : 'w-50'
    const funcButton = yo`<button onclick=${() => onClick()} class="${css.instanceButton} ${width} btn btn-sm" data-id="multiParamManagerFuncButton">${title}</button>`
    this.contractActionsContainerSingle = yo`
    <div class="${css.contractActionsContainerSingle} pt-2">
      ${funcButton}
      ${this.basicInputField}
      <i class="fas fa-angle-down ${css.methCaret}" onclick=${() => this.switchMethodViewOn()} title=${title} ></i>
    </div>`

    this.multiFields = this.createMultiFields()

    var multiOnClick = () => {
      if (!this.validateExpandedInputUnsafeIntegers()) return
      var valsString = this.getMultiValsString()
      if (valsString) {
        this.clickCallBack(this.funABI.inputs, valsString)
      } else {
        this.clickCallBack(this.funABI.inputs, '')
      }
    }

    var expandedButton = yo`<button onclick=${() => { multiOnClick() }} class="${css.instanceButton}" data-id="multiParamManagerExpandedButton"></button>`

    this.contractActionsContainerMulti = yo`<div class="${css.contractActionsContainerMulti}" >
      <div class="${css.contractActionsContainerMultiInner} text-dark" >
        <div onclick=${() => { this.switchMethodViewOff() }} class="${css.multiHeader}">
          <div class="${css.multiTitle} run-instance-multi-title">${title}</div>
          <i class='fas fa-angle-up ${css.methCaret}'></i>
        </div>
        ${this.multiFields}
        <div class="${css.group} ${css.multiArg}" >
          ${copyToClipboard(
            () => {
              var multiString = this.getMultiValsString()
              var multiJSON = JSON.parse('[' + multiString + ']')
              var encodeObj
              if (this.evmBC) {
                encodeObj = txFormat.encodeData(this.funABI, multiJSON, this.evmBC)
              } else {
                encodeObj = txFormat.encodeData(this.funABI, multiJSON)
              }
              if (encodeObj.error) {
                throw new Error(encodeObj.error)
              } else {
                return encodeObj.data
              }
            }, 'Encode values of input fields & copy to clipboard', 'fa-clipboard')}
            ${expandedButton}
        </div>
      </div>
    </div>`

    var contractProperty = yo`
      <div class="${css.contractProperty}">
        ${this.contractActionsContainerSingle} ${this.contractActionsContainerMulti}
      </div>
    `
    if (this.lookupOnly) {
      // call. stateMutability is either pure or view
      expandedButton.setAttribute('title', (title + ' - call'))
      expandedButton.innerHTML = 'call'
      expandedButton.classList.add('btn-info')
      expandedButton.setAttribute('data-id', (title + ' - call'))
      funcButton.setAttribute('title', (title + ' - call'))
      funcButton.classList.add('btn-info')
      funcButton.setAttribute('data-id', (title + ' - call'))
    } else if (this.funABI.stateMutability === 'payable' || this.funABI.payable) {
      // transact. stateMutability = payable
      expandedButton.setAttribute('title', (title + ' - transact (payable)'))
      expandedButton.innerHTML = 'transact'
      expandedButton.classList.add('btn-danger')
      expandedButton.setAttribute('data-id', (title + ' - transact (payable)'))
      funcButton.setAttribute('title', (title + ' - transact (payable)'))
      funcButton.classList.add('btn-danger')
      funcButton.setAttribute('data-id', (title + ' - transact (payable)'))
    } else {
      // transact. stateMutability = nonpayable
      expandedButton.setAttribute('title', (title + ' - transact (not payable)'))
      expandedButton.innerHTML = 'transact'
      expandedButton.classList.add('btn-warning')
      expandedButton.setAttribute('data-id', (title + ' - transact (not payable)'))
      funcButton.classList.add('btn-warning')
      funcButton.setAttribute('title', (title + ' - transact (not payable)'))
      funcButton.setAttribute('data-id', (title + ' - transact (not payable)'))
    }

    if (this.funABI.inputs && this.funABI.inputs.length > 0) {
      contractProperty.classList.add(css.hasArgs)
    } else if (this.funABI.type === 'fallback' || this.funABI.type === 'receive') {
      contractProperty.classList.add(css.hasArgs)
      this.basicInputField.setAttribute('title', `'(${this.funABI.type}')`) // probably should pass name instead
      this.contractActionsContainerSingle.querySelector('i').style.visibility = 'hidden'
      this.basicInputField.setAttribute('data-id', `'(${this.funABI.type}')`)
    } else {
      this.contractActionsContainerSingle.querySelector('i').style.visibility = 'hidden'
      this.basicInputField.style.visibility = 'hidden'
    }

    return contractProperty
  }
}

module.exports = MultiParamManager
