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

var modal = require('./modaldialog.js')
var yo = require('yo-yo')
var css = require('./styles/modal-dialog-custom-styles')
const { BN } = require('@tvmjs/util')
const helper = require('../../lib/helper.js')
const remixLib = require('@remix-project/remix-lib')

module.exports = {
  alert: function (title, text) {
    if (text) return modal(title, yo`<div>${text}</div>`, null, { label: null })
    return modal('Alert', yo`<div>${title}</div>`, null, { label: null })
  },
  prompt: function (title, text, inputValue, ok, cancel, focus) {
    return prompt(title, text, false, inputValue, ok, cancel, focus)
  },
  promptPassphrase: function (title, text, inputValue, ok, cancel) {
    return prompt(title, text, true, inputValue, ok, cancel)
  },
  promptPassphraseCreation: function (ok, cancel) {
    var text = 'Please provide a Passphrase for the account creation'
    var input = yo`
      <div>
        <input id="prompt1" type="password" name='prompt_text' class="${css.prompt_text}" oninput="${(e) => validateInput(e)}">
        <br>
        <br>
        <input id="prompt2" type="password" name='prompt_text' class="${css.prompt_text}" oninput="${(e) => validateInput(e)}">
      </div>
    `
    return modal(null, yo`<div>${text}<div>${input}</div></div>`,
      {
        fn: () => {
          if (typeof ok === 'function') {
            if (input.querySelector('#prompt1').value === input.querySelector('#prompt2').value) {
              ok(null, input.querySelector('#prompt1').value)
            } else {
              ok('Passphase does not match')
            }
          }
        }
      },
      {
        fn: () => {
          if (typeof cancel === 'function') cancel()
        }
      }
    )
  },
  promptTRC10Creation: function (address, tokens, vm, cb) {
    var text = `Set TRC10 balance to ${helper.shortenAddress(remixLib.util.addressToBase58(address))}`
    var tokensHeaderEl = yo`<div class="${css.prompt_token_row}">
      <div class="${css.prompt_token_id}">
        Token ID
      </div>
      <div class="${css.prompt_token_val}">
        Token Balance
      </div>
    </div>`

    var tokensEl = []
    Object.keys(tokens).forEach(_ => {
      tokensEl.push(yo`
        <div id="promptTokenId${_}" class="${css.prompt_token_row}">
          <div class="${css.prompt_token_id}">
            ${_}
          </div>
          <div class="${css.prompt_token_val}">
            ${tokens[_].toString()}
          </div>
        </div>
      `)
    })

    var tokenCtrl = yo`
      <div class="${css.prompt_token_row_set}">
        <div class="${css.prompt_token_id}">
          <input
            type="number"
            min="1000001"
            pattern="^[0-9]"
            step="1"
            id="promptTokenId"
            name='prompt_text'
            class="${css.prompt_text}"
          >
        </div>
        <div class="${css.prompt_token_val}">
          <input
            type="number"
            min="0"
            pattern="^[0-9]"
            step="1"
            id="promptTokenVal"
            name='prompt_text'
            class="${css.prompt_text}"
          >
        </div>
        <div class="${css.prompt_token_set}">
          <button id="promptTokenSet" name='prompt_text' class="${css.prompt_text}" onclick=${() => setTokenBalance(address, vm, cb)}>
            Set
          </button>
        </div>
      </div>
    `
    return modal(null, yo`
    <div>
      ${text}
      <div class="${css.prompt_tokens}">
        ${tokensHeaderEl}
          <div id="promptTokens">
            ${tokensEl.map(_ => _)}
          </div>
        ${tokenCtrl}
      </div>
    </div>`,
    {
      fn: () => {}
    },
    {
      label: ''
    }
    )
  },
  promptMulti: function ({ title, text, inputValue }, ok, cancel) {
    if (!inputValue) inputValue = ''
    const input = yo`
      <textarea
        id="prompt_text"
        data-id="modalDialogCustomPromptText"
        class=${css.prompt_text}
        rows="4"
        cols="50"
        oninput="${(e) => validateInput(e)}"
      ></textarea>
    `
    return modal(title, yo`<div>${text}<div>${input}</div></div>`,
      {
        fn: () => { if (typeof ok === 'function') ok(document.getElementById('prompt_text').value) }
      },
      {
        fn: () => { if (typeof cancel === 'function') cancel() }
      }
    )
  },
  confirm: function (title, text, ok, cancel) {
    return modal(title, yo`<div>${text}</div>`,
      {
        fn: () => { if (typeof ok === 'function') ok() }
      },
      {
        fn: () => { if (typeof cancel === 'function') cancel() }
      }
    )
  }
}

const setTokenBalance = (address, vm, cb) => {
  const tokenId = document.querySelector('#promptTokenId').value
  const tokenValue = document.querySelector('#promptTokenVal').value

  const numReg = /^[\d]+$/
  if (!numReg.test(tokenId)) {
    return cb && cb('Token ID must be a positive number')
  }
  if (!numReg.test(tokenValue)) {
    return cb && cb('Token value must be a positive number')
  }
  if (new BN(tokenId, 10).lt(new BN('1000001', 10))) {
    return cb && cb('Token ID must be > 1000000')
  }

  vm.setTRC10Balance(address, tokenId, tokenValue, (error) => {
    if (error) {
      return cb(error)
    }

    const curTokenEl = document.querySelector(`#promptTokenId${tokenId}`)
    if (curTokenEl) {
      curTokenEl.children[1].textContent = tokenValue
    } else {
      const curTokens = document.querySelector('#promptTokens')
      curTokens.appendChild(yo`
        <div id="promptTokenId${tokenId}" class="${css.prompt_token_row}">
          <div class="${css.prompt_token_id}">
            ${tokenId}
          </div>
          <div class="${css.prompt_token_val}">
            ${tokenValue}
          </div>
        </div>
      `)
    }
  })
}

const validateInput = (e) => {
  if (!document.getElementById('modal-footer-ok')) return

  if (e.target.value === '') {
    document.getElementById('modal-footer-ok').classList.add('disabled')
    document.getElementById('modal-footer-ok').style.pointerEvents = 'none'
  } else {
    document.getElementById('modal-footer-ok').classList.remove('disabled')
    document.getElementById('modal-footer-ok').style.pointerEvents = 'auto'
  }
}

function prompt (title, text, hidden, inputValue, ok, cancel, focus) {
  if (!inputValue) inputValue = ''
  var type = hidden ? 'password' : 'text'
  var input = yo`
    <input
      type=${type}
      name='prompt_text'
      id='prompt_text'
      class="${css.prompt_text} form-control"
      value='${inputValue}'
      data-id="modalDialogCustomPromptText"
      oninput="${(e) => validateInput(e)}"
    >
  `

  modal(title, yo`<div>${text}<div>${input}</div></div>`,
    {
      fn: () => { if (typeof ok === 'function') ok(document.getElementById('prompt_text').value) }
    },
    {
      fn: () => { if (typeof cancel === 'function') cancel() }
    },
    focus ? '#prompt_text' : undefined
  )
}
