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
import * as packageJson from '../../../package.json'
import { basicLogo } from './app/ui/svgLogo'

import { RunTab, makeUdapp } from './app/udapp'

import PanelsResize from './lib/panels-resize'
import { RemixEngine } from './remixEngine'
import { RemixAppManager } from './remixAppManager'
import { FramingService } from './framingService'
import { MainView } from './app/panels/main-view'
import { ThemeModule } from './app/tabs/theme-module'
import { NetworkModule } from './app/tabs/network-module'
import { Web3ProviderModule } from './app/tabs/web3-provider'
import { SidePanel } from './app/components/side-panel'
import { HiddenPanel } from './app/components/hidden-panel'
import { VerticalIcons } from './app/components/vertical-icons'
import { LandingPage } from './app/ui/landing-page/landing-page'
import { MainPanel } from './app/components/main-panel'
import { AiPanel } from './app/components/ai-panel'
import { HeaderPanel } from './app/components/header-panel'

import { OffsetToLineColumnConverter, CompilerMetadata, CompilerArtefacts, FetchAndCompile, CompilerImports } from '@remix-project/core-plugin'

import migrateFileSystem from './migrateFileSystem'

const isElectron = require('is-electron')
const csjs = require('csjs-inject')
const yo = require('yo-yo')
const remixLib = require('@remix-project/remix-lib')
const registry = require('./global/registry')

const QueryParams = require('./lib/query-params')
const Storage = remixLib.Storage
const RemixDProvider = require('./app/files/remixDProvider')
const Config = require('./config')
const modalDialog = require('./app/ui/modaldialog')
const FileManager = require('./app/files/fileManager')
const FileProvider = require('./app/files/fileProvider')
const DGitProvider = require('./app/files/dgitProvider')
const WorkspaceFileProvider = require('./app/files/workspaceFileProvider')
const toolTip = require('./app/ui/tooltip')

const Blockchain = require('./blockchain/blockchain.js')

const PluginManagerComponent = require('./app/components/plugin-manager-component')

const CompileTab = require('./app/tabs/compile-tab')
const SettingsTab = require('./app/tabs/settings-tab')
const AnalysisTab = require('./app/tabs/analysis-tab')
const { DebuggerTab } = require('./app/tabs/debugger-tab')
const { ContractVerificationTab } = require('./app/tabs/contract-verification-tab')
const TestTab = require('./app/tabs/test-tab')
const FilePanel = require('./app/panels/file-panel')
const Editor = require('./app/editor/editor')
const Terminal = require('./app/panels/terminal')
const ContextualListener = require('./app/editor/contextualListener')
const _paq = window._paq = window._paq || []

const css = csjs`
  html { box-sizing: border-box; }
  *, *:before, *:after { box-sizing: inherit; }
  body                 {
    /* font: 14px/1.5 Lato, "Helvetica Neue", Helvetica, Arial, sans-serif; */
    font-size          : .8rem;
  }
  pre {
    overflow-x: auto;
  }
  .remixIDE            {
    width              : 100vw;
    height             : 100vh;
    overflow           : hidden;
  }
  .content-wrapper{
    flex-direction     : row;
    display            : flex;
    height: calc(100% - 46px);
  }  
  .mainpanel           {
    display            : flex;
    flex-direction     : column;
    overflow           : hidden;
    flex               : 1;
  }
  .iconpanel           {
    display            : flex;
    flex-direction     : column;
    overflow           : hidden;
    width              : 50px;
    user-select        : none;
  }
  .sidepanel           {
    display            : flex;
    flex-direction     : row-reverse;
    width              : 320px;
  }
  .aipanel           {
    display            : flex;
    width              : 320px;
    position: relative;
  }
  .highlightcode       {
    position           : absolute;
    z-index            : 20;
    background-color   : var(--info);
  }
  .highlightcode_fullLine {
    position           : absolute;
    z-index            : 20;
    background-color   : var(--info);
    opacity            : 0.5;
  }
  .centered {
    position           : fixed;
    top                : 20%;
    left               : 50%;
    transform          : translateX(-50%);
    width              : auto;
    height             : auto;
  }
  .centered svg rect {
    fill: var(--secondary);
  }
  .centered svg circle {
    fill: var(--secondary);
  }
  .centered svg path {
    fill: var(--secondary);
  }
  .centered svg polygon {
    fill              : var(--secondary);
  }
  .onboarding {
    color             : var(--text-info);
    background-color  : var(--info);
  }
  .matomoBtn {
    width              : 100px;
  }
  .a-icon {
    width: 1em;
    height: 1em;
    vertical-align: -0.15em;
    fill: currentColor;
    overflow: hidden;
  }
`

class App {
  constructor (api = {}, events = {}, opts = {}) {
    var self = this
    self.appManager = new RemixAppManager({})
    self._components = {}
    self._view = {}
    self._view.splashScreen = yo`
      <div class=${css.centered}>
        ${basicLogo()}
      </div>
    `
    document.body.appendChild(self._view.splashScreen)

    // setup storage
    const configStorage = new Storage('config-v0.8:')

    // load app config
    const config = new Config(configStorage)
    registry.put({ api: config, name: 'config' })

    // load file system
    self._components.filesProviders = {}
    self._components.filesProviders.browser = new FileProvider('browser')
    registry.put({ api: self._components.filesProviders.browser, name: 'fileproviders/browser' })
    self._components.filesProviders.localhost = new RemixDProvider(self.appManager)
    registry.put({ api: self._components.filesProviders.localhost, name: 'fileproviders/localhost' })
    self._components.filesProviders.workspace = new WorkspaceFileProvider()
    registry.put({ api: self._components.filesProviders.workspace, name: 'fileproviders/workspace' })

    registry.put({ api: self._components.filesProviders, name: 'fileproviders' })

    migrateFileSystem(self._components.filesProviders.browser)
  }

  init () {
    var self = this
    run.apply(self)
  }

  render () {
    var self = this
    if (self._view.el) return self._view.el

    self._view.headerpanel = yo`
      <div id="header-panel" data-id="headerPanel" class="${css.headerpanel}">
      ${''}
      </div>
    `

    // not resizable
    self._view.iconpanel = yo`
      <div id="icon-panel" data-id="remixIdeIconPanel" class="${css.iconpanel} bg-light">
      ${''}
      </div>
    `

    // center panel, resizable
    self._view.sidepanel = yo`
      <div id="side-panel" data-id="remixIdeSidePanel" style="min-width: 320px;" class="${css.sidepanel} border-right border-left">
        ${''}
      </div>
    `

    self._view.aipanel = yo`
    <div id="ai-panel" data-id="remixIdeAiPanel" style="min-width: 340px;" class="${css.aipanel} border-right border-left">
      ${''}
    </div>
  `

    // handle the editor + terminal
    self._view.mainpanel = yo`
      <div id="main-panel" data-id="remixIdeMainPanel" class=${css.mainpanel}>
        ${''}
      </div>
    `

    self._components.resizeFeature = new PanelsResize(self._view.sidepanel)
    self._components.resizeFeatureAi = new PanelsResize(self._view.aipanel, 'right')

    self._view.el = yo`
      <div style="visibility:hidden" class=${css.remixIDE} data-id="remixIDE">
        ${self._view.headerpanel}
        <div class=${css['content-wrapper']} >
          ${self._view.iconpanel}
          ${self._view.sidepanel}
          ${self._components.resizeFeature.render()}
          ${self._view.mainpanel}
          ${self._components.resizeFeatureAi.render()}
          ${self._view.aipanel}
        </div>
      </div>
    `
    return self._view.el
  }
}

module.exports = App

async function run () {
  var self = this

  // check the origin and warn message
  if (window.location.protocol.indexOf('https') === 0) {
    // toolTip('You are using an `https` connection. Please switch to `http` if you are using Remix against an `http Web3 provider` or allow Mixed Content in your browser.')
  }

  const hosts = ['127.0.0.1:8080', '192.168.0.101:8080', 'localhost:8080']
  // workaround for Electron support
  if (!isElectron() && !hosts.includes(window.location.host)) {
    // Oops! Accidentally trigger refresh or bookmark.
    window.onbeforeunload = function () {
      return 'Are you sure you want to leave?'
    }
  }

  // APP_MANAGER
  const appManager = self.appManager
  const pluginLoader = appManager.pluginLoader
  const workspace = pluginLoader.get()
  const engine = new RemixEngine()
  engine.register(appManager)

  // SERVICES
  // ----------------- theme service ---------------------------------
  const themeModule = new ThemeModule(registry)
  registry.put({ api: themeModule, name: 'themeModule' })
  themeModule.initTheme(() => {
    setTimeout(() => {
      if (self._view.splashScreen && self._view.splashScreen.parentNode === document.body) {
        document.body.removeChild(self._view.splashScreen)
      }
      self._view.el.style.visibility = 'visible'
    }, 1500)
  })
  setTimeout(() => {
    if (self._view.el && self._view.el.style.visibility !== 'visible') {
      if (self._view.splashScreen && self._view.splashScreen.parentNode === document.body) {
        document.body.removeChild(self._view.splashScreen)
      }
      self._view.el.style.visibility = 'visible'
    }
  }, 4000)
  // ----------------- editor service ----------------------------
  const editor = new Editor({}, themeModule) // wrapper around ace editor
  registry.put({ api: editor, name: 'editor' })
  editor.event.register('requiringToSaveCurrentfile', () => fileManager.saveCurrentFile())

  // ----------------- fileManager service ----------------------------
  const fileManager = new FileManager(editor, appManager)
  registry.put({ api: fileManager, name: 'filemanager' })
  // ----------------- dGit provider ---------------------------------
  const dGitProvider = new DGitProvider()

  // ----------------- import content service ------------------------
  const contentImport = new CompilerImports()

  const blockchain = new Blockchain(registry.get('config').api)

  // ----------------- compilation metadata generation service ---------
  const compilerMetadataGenerator = new CompilerMetadata()
  // ----------------- compilation result service (can keep track of compilation results) ----------------------------
  const compilersArtefacts = new CompilerArtefacts() // store all the compilation results (key represent a compiler name)
  registry.put({ api: compilersArtefacts, name: 'compilersartefacts' })

  // service which fetch contract artifacts from sourve-verify, put artifacts in remix and compile it
  const fetchAndCompile = new FetchAndCompile()
  // ----------------- network service (resolve network id / name) -----
  const networkModule = new NetworkModule(blockchain)
  // ----------------- represent the current selected web3 provider ----
  const web3Provider = new Web3ProviderModule(blockchain)
  // ----------------- convert offset to line/column service -----------
  const offsetToLineColumnConverter = new OffsetToLineColumnConverter()
  registry.put({ api: offsetToLineColumnConverter, name: 'offsettolinecolumnconverter' })

  // -------------------Terminal----------------------------------------

  const terminal = new Terminal(
    { appManager, blockchain },
    {
      getPosition: (event) => {
        var limitUp = 36
        var limitDown = 20
        var height = window.innerHeight
        var newpos = (event.pageY < limitUp) ? limitUp : event.pageY
        newpos = (newpos < height - limitDown) ? newpos : height - limitDown
        return height - newpos
      }
    }
  )
  makeUdapp(blockchain, compilersArtefacts, (domEl) => terminal.logHtml(domEl))

  const contextualListener = new ContextualListener({ editor })

  engine.register([
    contentImport,
    themeModule,
    editor,
    fileManager,
    compilerMetadataGenerator,
    compilersArtefacts,
    networkModule,
    offsetToLineColumnConverter,
    contextualListener,
    terminal,
    web3Provider,
    fetchAndCompile,
    dGitProvider
  ])

  // LAYOUT & SYSTEM VIEWS
  const appPanel = new MainPanel()
  const mainview = new MainView(contextualListener, editor, appPanel, fileManager, appManager, terminal)
  registry.put({ api: mainview, name: 'mainview' })

  engine.register([
    appPanel,
    mainview.tabProxy
  ])

  // those views depend on app_manager
  const menuicons = new VerticalIcons(appManager)
  const sidePanel = new SidePanel(appManager, menuicons)
  const aiPanel = new AiPanel(appManager, registry.get('config').api)
  const headerPanel = new HeaderPanel(appManager, mainview)
  const hiddenPanel = new HiddenPanel()
  const pluginManagerComponent = new PluginManagerComponent(appManager, engine)
  const filePanel = new FilePanel(appManager)
  const landingPage = new LandingPage(appManager, menuicons, fileManager, filePanel)
  const settings = new SettingsTab(
    registry.get('config').api,
    editor,
    appManager
  )

  // adding Views to the DOM
  self._view.headerpanel.appendChild(headerPanel.render())
  self._view.mainpanel.appendChild(mainview.render())
  self._view.iconpanel.appendChild(menuicons.render())
  self._view.sidepanel.appendChild(sidePanel.render())
  self._view.aipanel.appendChild(aiPanel.render())
  document.body.appendChild(hiddenPanel.render()) // Hidden Panel is display none, it can be directly on body

  engine.register([
    menuicons,
    landingPage,
    hiddenPanel,
    sidePanel,
    aiPanel,
    headerPanel,
    pluginManagerComponent,
    filePanel,
    settings
  ])

  const queryParams = new QueryParams()
  const params = queryParams.get()

  const onAcceptMatomo = () => {
    _paq.push(['forgetUserOptOut'])
    // @TODO remove next line when https://github.com/matomo-org/matomo/commit/9e10a150585522ca30ecdd275007a882a70c6df5 is used
    document.cookie = 'mtm_consent_removed=; expires=Thu, 01 Jan 1970 00:00:01 GMT;'
    settings.updateMatomoAnalyticsChoice(true)
    const el = document.getElementById('modal-dialog')
    el.parentElement.removeChild(el)
  }
  const onDeclineMatomo = () => {
    settings.updateMatomoAnalyticsChoice(false)
    _paq.push(['optUserOut'])
    const el = document.getElementById('modal-dialog')
    el.parentElement.removeChild(el)
  }

  // Ask to opt in to Matomo for remix, remix-alpha and remix-beta
  const matomoDomains = {
    'remix-alpha.ethereum.org': 27,
    'remix-beta.ethereum.org': 25,
    'remix.ethereum.org': 23
  }
  if (matomoDomains[window.location.hostname] && !registry.get('config').api.exists('settings/matomo-analytics')) {
    modalDialog(
      'Help us to improve Remix IDE',
      yo`
      <div>
        <p>An Opt-in version of <a href="https://matomo.org" target="_blank" rel="noopener noreferrer">Matomo</a>, an open source data analytics platform is being used to improve Remix IDE.</p>
        <p>We realize that our users have sensitive information in their code and that their privacy - your privacy - must be protected.</p>
        <p>All data collected through Matomo is stored on our own server - no data is ever given to third parties.  Our analytics reports are public: <a href="https://matomo.ethereum.org/index.php?module=MultiSites&action=index&idSite=23&period=day&date=yesterday" target="_blank" rel="noopener noreferrer">take a look</a>.</p>
        <p>We do not collect nor store any personally identifiable information (PII).</p>
        <p>For more info, see: <a href="https://medium.com/p/66ef69e14931/" target="_blank" rel="noopener noreferrer">Matomo Analyitcs on Remix iDE</a>.</p>
        <p>You can change your choice in the Settings panel anytime.</p>
        <div class="d-flex justify-content-around pt-3 border-top">
          <button class="btn btn-primary ${css.matomoBtn}" onclick=${() => onAcceptMatomo()}>Sure</button>
          <button class="btn btn-secondary ${css.matomoBtn}" onclick=${() => onDeclineMatomo()}>Decline</button>
        </div>
      </div>`,
      {
        label: '',
        fn: null
      },
      {
        label: '',
        fn: null
      }
    )
  }

  // CONTENT VIEWS & DEFAULT PLUGINS
  const compileTab = new CompileTab(
    editor,
    registry.get('config').api,
    registry.get('fileproviders/browser').api,
    registry.get('filemanager').api,
    contentImport
  )
  const run = new RunTab(
    blockchain,
    registry.get('config').api,
    registry.get('filemanager').api,
    registry.get('editor').api,
    filePanel,
    registry.get('compilersartefacts').api,
    networkModule,
    mainview,
    registry.get('fileproviders/browser').api
  )
  const analysis = new AnalysisTab(registry)
  const debug = new DebuggerTab()
  const contractVerification = new ContractVerificationTab()
  const test = new TestTab(
    registry.get('filemanager').api,
    registry.get('offsettolinecolumnconverter').api,
    filePanel,
    compileTab,
    appManager,
    contentImport
  )

  engine.register([
    compileTab,
    compileTab.compileTabLogic,
    run,
    analysis,
    debug,
    contractVerification,
    filePanel.remixdHandle,
    filePanel.gitHandle
  ])

  if (isElectron()) {
    appManager.activatePlugin('remixd')
  }

  try {
    engine.register(await appManager.registeredPlugins())
  } catch (e) {
    console.log('couldn\'t register iframe plugins', e.message)
  }

  await appManager.activatePlugin(['theme', 'editor', 'fileManager', 'compilerMetadata', 'compilerArtefacts', 'network', 'web3Provider', 'offsetToLineColumnConverter'])
  await appManager.activatePlugin(['mainPanel', 'menuicons', 'tabs'])
  await appManager.activatePlugin(['sidePanel', 'headerPanel']) // activating  host plugin separately
  const globalSearchPanel = mainview.getGlobalSearchPanel()
  const globalSearchProfile = {
    name: 'globalSearch',
    displayName: 'Search in Files',
    description: 'Search across workspace files',
    version: packageJson.version,
    kind: 'fileexplorer',
    icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
    tooltip: `Search (${navigator.platform && /Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}+Shift+F)`
  }
  sidePanel.addView(globalSearchProfile, globalSearchPanel.render(), { skipStatusListener: true })
  globalSearchPanel.onClose = () => menuicons.select('filePanel')
  globalSearchPanel.onStatusChanged = (badge) => menuicons.setIconStatus('globalSearch', badge ? { key: badge, type: 'info', title: `${badge} search results` } : { key: 'none' })
  mainview.setGlobalSearchOpener((from) => {
    menuicons.select('globalSearch')
    globalSearchPanel.show()
    if (from === 'shortcut') gtag('event', 'search_entry_shortcut', { from: 'shortcut' })
  })
  await appManager.activatePlugin(['aiPanel'])
  await appManager.activatePlugin(['home'])
  await appManager.activatePlugin(['settings'])
  await appManager.activatePlugin(['hiddenPanel', 'pluginManager', 'filePanel', 'contextualListener', 'terminal', 'fetchAndCompile', 'contentImport'])

  // Set workspace after initial activation
  if (Array.isArray(workspace) && workspace.length > 0) {
    appManager.activatePlugin(workspace).then(async () => {
      try {
        if (params.deactivate) {
          await appManager.deactivatePlugin(params.deactivate.split(','))
        }
      } catch (e) {
        console.log(e)
      }

      // If plugins are loaded from the URL params, we focus on the last one.
      if (pluginLoader.current === 'queryParams' && workspace.length > 0) menuicons.select(workspace[workspace.length - 1])

      if (params.call) {
        const callDetails = params.call.split('//')
        if (callDetails.length > 1) {
          toolTip(`initiating ${callDetails[0]} ...`)
          // @todo(remove the timeout when activatePlugin is on 0.3.0)
          appManager.call(...callDetails).catch(console.error)
        }
      }
    }).catch(console.error)
  } else {
    // activate solidity plugin
    await appManager.activatePlugin(['solidity', 'udapp'])
  }

  // Load and start the service who manager layout and frame
  const framingService = new FramingService(sidePanel, menuicons, mainview, this._components.resizeFeature)

  if (params.embed) framingService.embed()
  framingService.start(params)
}
