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
import { NightwatchBrowser } from 'nightwatch'

const connectedAccount = 'TCRD7qT1uDUs8pDCmZbDfy3ixj4UtPpprk'
const nileGenesisBlock = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const appUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:8080'

declare global {
  interface Window {
    __tronLinkRequestCalls?: string[]
    tronLink: any
    tronWeb: any
  }
}

function appTargetUrl (): string {
  return appUrl
}

function installTronLinkMock (browser: NightwatchBrowser, source: string, done: VoidFunction): void {
  browser.chrome.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', { source }).then(() => done())
}

function resetPage (browser: NightwatchBrowser): NightwatchBrowser {
  return browser
    .url(appTargetUrl())
    .pause(5000)
    .switchBrowserTab(0)
    .execute(function () {
      const skip = document.querySelector('[id="remixTourSkipbtn"]') as HTMLElement
      if (skip) skip.click()
      const modal = document.querySelector('#modal-dialog')
      if (modal && modal.parentElement) modal.parentElement.removeChild(modal)
      document.querySelectorAll('.modal-backdrop').forEach((el) => el.parentElement && el.parentElement.removeChild(el))
    })
    .fullscreenWindow()
    .clickIfPresent('remix-tabs remix-tab#home')
    .waitForElementVisible('*[data-id="landingPageHomeContainer"]', 15000)
}

function successMockSource (): string {
  return `
    window['__tronLinkRequestCalls'] = [];
    window['tronWeb'] = {
      defaultAddress: { base58: '' },
      fullNode: { host: 'https://api.nileex.io', headers: {}, request: function () { return Promise.resolve({}); } },
      trx: {
        getBlock: function () { return Promise.resolve({ blockID: '${nileGenesisBlock}' }); },
        getCurrentBlock: function () { return Promise.resolve({ block_header: { raw_data: { number: 1 } } }); },
        getBalance: function () { return Promise.resolve(1000000000); }
      },
      setHeader: function () {}
    };
    window['tronLink'] = {
      ready: false,
      request: function (args) {
        var method = args.method;
        window['__tronLinkRequestCalls'].push(method);
        if (method === 'tron_requestAccounts') {
          window['tronLink'].ready = true;
          window['tronWeb'].defaultAddress.base58 = '${connectedAccount}';
          return Promise.resolve({ code: 200 });
        }
        return Promise.resolve({ code: 200 });
      }
    };
  `
}

function rejectedMockSource (): string {
  return `
    window['__tronLinkRequestCalls'] = [];
    window['tronWeb'] = {
      defaultAddress: { base58: '' },
      fullNode: { host: 'https://api.nileex.io', headers: {}, request: function () { return Promise.resolve({}); } },
      trx: {
        getBlock: function () { return Promise.resolve({ blockID: '${nileGenesisBlock}' }); },
        getCurrentBlock: function () { return Promise.resolve({ block_header: { raw_data: { number: 1 } } }); },
        getBalance: function () { return Promise.resolve(1000000000); }
      },
      setHeader: function () {}
    };
    window['tronLink'] = {
      ready: false,
      request: function (args) {
        window['__tronLinkRequestCalls'].push(args.method);
        return Promise.reject({ code: 4001, message: 'User rejected the request.' });
      }
    };
  `
}

function slowSuccessMockSource (): string {
  return `
    window['__tronLinkRequestCalls'] = [];
    window['tronWeb'] = {
      defaultAddress: { base58: '' },
      fullNode: { host: 'https://api.nileex.io', headers: {}, request: function () { return Promise.resolve({}); } },
      trx: {
        getBlock: function () { return Promise.resolve({ blockID: '${nileGenesisBlock}' }); },
        getCurrentBlock: function () { return Promise.resolve({ block_header: { raw_data: { number: 1 } } }); },
        getBalance: function () { return Promise.resolve(1000000000); }
      },
      setHeader: function () {}
    };
    window['tronLink'] = {
      ready: false,
      request: function (args) {
        var method = args.method;
        window['__tronLinkRequestCalls'].push(method);
        return new Promise(function (resolve) {
          setTimeout(function () {
            window['tronLink'].ready = true;
            window['tronWeb'].defaultAddress.base58 = '${connectedAccount}';
            resolve({ code: 200 });
          }, 800);
        });
      }
    };
  `
}

function waitForInjectedConnection (browser: NightwatchBrowser): NightwatchBrowser {
  return browser
    .waitForElementContainsText('h6[data-id="sidePanelSwapitTitle"]', 'DEPLOY & RUN TRANSACTIONS', 20000)
    .executeAsync(function (done) {
      const startedAt = Date.now()
      const state = () => ({
        provider: (document.querySelector('#selectExEnvOptions') as HTMLSelectElement | null)?.value,
        network: (document.querySelector('*[data-id="settingsNetworkEnv"]') as HTMLElement | null)?.textContent || '',
        account: (document.querySelector('#txorigin') as HTMLElement | null)?.textContent || '',
        requests: window.__tronLinkRequestCalls || []
      })
      const check = () => {
        const current = state()
        const connected = Boolean(
          current.provider === 'injected' &&
          current.network.toLowerCase().includes('nile') &&
          current.account.includes('TCRD7') &&
          current.requests.includes('tron_requestAccounts')
        )
        if (connected) return done({ connected: true, ...current })
        if (Date.now() - startedAt > 20000) return done({ connected: false, ...current })
        setTimeout(check, 200)
      }
      check()
    }, [], function (result) {
      const value = result.value as { connected: boolean, provider: string, network: string, account: string, requests: string[] }
      browser.assert.equal(value.connected, true)
      browser.assert.equal(value.provider, 'injected')
      browser.assert.ok(value.network.toLowerCase().includes('nile'), 'Nile network was detected')
      browser.assert.ok(value.account.includes('TCRD7'), 'connected account was populated')
      browser.assert.ok(value.requests.includes('tron_requestAccounts'), 'TronLink account request was triggered')
    })
}

module.exports = {
  'Connect TronLink header action switches to injected and requests accounts': function (browser: NightwatchBrowser) {
    return browser
      .url('about:blank')
      .perform((done) => installTronLinkMock(browser, successMockSource(), done))
      .perform(() => resetPage(browser))
      .waitForElementVisible('*[data-id="headerWalletConnect"]', 10000)
      .click('*[data-id="headerWalletConnect"]')
      .perform(() => waitForInjectedConnection(browser))
  },

  'Injected TronLink disconnect clears the account list': function (browser: NightwatchBrowser) {
    return browser
      .url('about:blank')
      .perform((done) => installTronLinkMock(browser, successMockSource(), done))
      .perform(() => resetPage(browser))
      .click('*[data-id="headerWalletConnect"]')
      .perform(() => waitForInjectedConnection(browser))
      .execute(function () {
        window.tronWeb.defaultAddress.base58 = ''
        window.tronLink.ready = false
        return true
      })
      .executeAsync(function (done) {
        const startedAt = Date.now()
        const check = () => {
          const account = document.querySelector('#txorigin') as HTMLSelectElement | null
          const options = account ? account.options.length : -1
          if (account && options === 0) return done(true)
          if (Date.now() - startedAt > 20000) return done(false)
          setTimeout(check, 200)
        }
        check()
      }, [], function (result) {
        browser.assert.equal(result.value, true)
      })
  },

  'Rejected TronLink connection shows stable message and does not loop': function (browser: NightwatchBrowser) {
    return browser
      .url('about:blank')
      .perform((done) => installTronLinkMock(browser, rejectedMockSource(), done))
      .perform(() => resetPage(browser))
      .click('*[data-id="headerWalletConnect"]')
      .executeAsync(function (done) {
        const startedAt = Date.now()
        const check = () => {
          const bodyText = document.body.textContent || ''
          const requests = window.__tronLinkRequestCalls || []
          if (bodyText.includes('Connection request was rejected.') || bodyText.includes('Wallet connection was rejected')) return done({ rejected: true, requests })
          if (Date.now() - startedAt > 10000) return done({ rejected: false, requests, bodyText })
          setTimeout(check, 200)
        }
        check()
      }, [], function (result) {
        const value = result.value as { rejected: boolean, requests: string[] }
        browser.assert.equal(value.rejected, true)
        browser.assert.equal(value.requests.length, 1, 'Rejected connect produced exactly one wallet request')
      })
      .pause(1000)
      .execute(function () {
        return window.__tronLinkRequestCalls || []
      }, [], function (result) {
        const requests = result.value as string[]
        browser.assert.equal(requests.length, 1, 'Rejected connect did not loop after rejection')
      })
  },

  'Repeated Connect TronLink clicks share one pending wallet request': function (browser: NightwatchBrowser) {
    return browser
      .url('about:blank')
      .perform((done) => installTronLinkMock(browser, slowSuccessMockSource(), done))
      .perform(() => resetPage(browser))
      .execute(function () {
        const button = document.querySelector('*[data-id="headerWalletConnect"]') as HTMLElement
        button.click()
        button.click()
        button.click()
      })
      .perform(() => waitForInjectedConnection(browser))
      .execute(function () {
        return window.__tronLinkRequestCalls || []
      }, [], function (result) {
        const requests = result.value as string[]
        browser.assert.equal(requests.length, 1, 'Repeated clicks produced exactly one pending wallet request')
      })
      .end()
  }
}
