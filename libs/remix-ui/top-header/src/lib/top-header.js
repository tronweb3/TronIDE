/*
 * Copyright 2022 [TronIDE]
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

import React, { useEffect, useRef, useState } from 'react' // eslint-disable-line
import './top-header.css'
import { BasicLogo } from './svgLogo'
import { Tooltip } from 'antd'
import JSZip from 'jszip'

const LOCALHOST_WORKSPACE = ' - connect to localhost - '
const NO_WORKSPACE = ' - none - '
const WALLET_ERROR_MESSAGES = {
  WALLET_CONNECTION_REJECTED: 'Wallet connection was rejected',
  WALLET_LOCKED: 'Please unlock TronLink and try again',
  WALLET_UNAUTHORIZED: 'Please connect TronLink to this site',
  WALLET_REQUEST_TIMEOUT: 'Wallet request timed out. Please try again',
  WALLET_UNAVAILABLE: 'TronLink is not available in this browser',
  WALLET_DISCONNECTED: 'Wallet disconnected. Please reconnect TronLink',
  WALLET_CAPABILITY_MISSING: 'TronLink cannot request accounts. Please update TronLink',
  WALLET_UNKNOWN_ERROR: 'TronLink connection failed. Please try again'
}

const WALLET_STATUS_POLL_INTERVAL = 3000
const TRON_GENESIS_NETWORKS = {
  '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc': 'Mainnet',
  '0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e': 'Shasta',
  '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc': 'Nile'
}

const normalizeTronLinkErrorMessage = (error) => {
  const rawMessage = error && (error.message || error.toString())
  const message = String(rawMessage || '').toLowerCase()
  const code = error && String(error.code || '')

  if (code === '4001' || /reject|declin|denied|cancel/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_CONNECTION_REJECTED
  if (/unlock|locked/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_LOCKED
  if (/unauthorized|not authorized|connect tronlink/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_UNAUTHORIZED
  if (/timeout|timed out/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_REQUEST_TIMEOUT
  if (/disconnect|disconnected/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED
  if (/unsupported|not supported|method not found/.test(message) || code === '4200') return WALLET_ERROR_MESSAGES.WALLET_CAPABILITY_MISSING
  if (/tronlink is not installed|tronlink is not available|provider not found|no injected provider/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_UNAVAILABLE
  if (/metamask/.test(message)) return WALLET_ERROR_MESSAGES.WALLET_UNKNOWN_ERROR

  return rawMessage || WALLET_ERROR_MESSAGES.WALLET_UNKNOWN_ERROR
}

export const TopHeader = ({ plugin, _deps }) => {
  const [version, setVersion] = useState('')
  const [aiPluginClosed, setAiPluginClosed] = useState(false)
  const [walletState, setWalletState] = useState({ status: 'disconnected', account: '', network: '', message: 'Connect Wallet' })
  const [walletConnectInFlight, setWalletConnectInFlight] = useState(false)
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaces, setWorkspaces] = useState([])
  const [currentWorkspace, setCurrentWorkspace] = useState('default_workspace')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const walletConnectInFlightRef = useRef(false)
  const walletStateRef = useRef(walletState)
  const walletRefreshIdRef = useRef(0)
  const walletNetworkCacheRef = useRef({ key: '', label: '' })
  const walletManuallyDisconnectedRef = useRef(false)
  const walletListenerCleanupRef = useRef(null)
  const workspaceMenuRef = useRef(null)
  const walletMenuRef = useRef(null)
  const notificationsRef = useRef(null)

  useEffect(() => {
    async function fetchVersion () {
      const latestVersion = await plugin.getLatestVersion()
      setVersion(latestVersion)
    }
    fetchVersion()
  }, [])

  useEffect(() => {
    plugin?.events?.on('aiPluginClosed', (profile) => {
      setAiPluginClosed(profile)
    })
  }, [])

  useEffect(() => {
    walletStateRef.current = walletState
  }, [walletState])

  useEffect(() => {
    const refresh = () => refreshWorkspaceState()
    plugin?.events?.on('workspaceChanged', refresh)
    plugin?.events?.on('workspaceListChanged', refresh)
    refresh()
    return () => {
      plugin?.events?.removeListener?.('workspaceChanged', refresh)
      plugin?.events?.removeListener?.('workspaceListChanged', refresh)
    }
  }, [])

  useEffect(() => {
    const close = (event) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target)) setWorkspaceMenuOpen(false)
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target)) setWalletMenuOpen(false)
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    const refresh = () => refreshNotifications()
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('tronideHomeNotificationsChanged', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('tronideHomeNotificationsChanged', refresh)
    }
  }, [])

  useEffect(() => {
    const themeModule = _deps?.themeModule
    if (!themeModule) return
    const apply = () => {
      const el = document.getElementById('tronIdeLogo')
      if (el && typeof themeModule.fixInvert === 'function') themeModule.fixInvert(el)
    }
    apply()
    themeModule.events?.on?.('themeChanged', apply)
    return () => themeModule.events?.removeListener?.('themeChanged', apply)
  }, [])

  const onHome = async () => {
    await plugin.appManager.activatePlugin('home')
    plugin.call('tabs', 'focus', 'home')
  }

  const connectGithub = async () => {
    await onHome()
    window.setTimeout(() => {
      const advancedToggle = document.querySelector('[data-id="landingAdvancedToolsToggle"]')
      const advancedContent = document.querySelector('[data-id="landingAdvancedToolsContent"]')
      if (!advancedContent && advancedToggle && typeof advancedToggle.click === 'function') advancedToggle.click()
    }, 80)
    window.setTimeout(() => {
      const target = document.querySelector('[data-id="landingGithubTokenPanel"]')
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const connectButton = document.querySelector('[data-id="landingGithubTokenConnect"]')
      if (connectButton && typeof connectButton.click === 'function') connectButton.click()
    }, 180)
  }

  const showAiPopup = async () => {
    plugin.call('aiPanel', 'hide')
    gtag('event', 'click', { event_category: 'ai_user_action', event_label: 'show_ai' })
  }

  const settingsHandler = () => {
    plugin.call('menuicons', 'toggle', 'settings')
    gtag('event', 'click', { event_category: 'settings_user_action', event_label: 'settings' })
  }

  const toggleSidePanel = () => {
    const panel = document.getElementById('side-panel')
    if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none'
  }

  const toggleBottomPanel = () => {
    const mainview = _deps && _deps.mainview
    if (mainview && typeof mainview.minimizeTerminal === 'function') mainview.minimizeTerminal()
  }

  const toggleAiPanel = () => {
    plugin.call('aiPanel', 'hide')
  }

  const refreshWorkspaceState = async () => {
    try {
      const [workspaceList, workspace] = await Promise.all([
        plugin.call('filePanel', 'getWorkspaces').catch(() => []),
        plugin.call('filePanel', 'getCurrentWorkspace').catch(() => null)
      ])
      setWorkspaces(Array.isArray(workspaceList) ? workspaceList : [])
      if (workspace && workspace.name) setCurrentWorkspace(workspace.name)
    } catch (error) {
      console.debug('[topHeader] failed to refresh workspace state', error)
    }
  }

  const runWorkspaceAction = async (action) => {
    if (workspaceBusy) return
    setWorkspaceBusy(true)
    try {
      await action()
      await refreshWorkspaceState()
    } catch (error) {
      window.alert(error && error.message ? error.message : error)
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const createWorkspace = async () => {
    const workspaceName = window.prompt('Create workspace', `workspace_${Date.now()}`)
    if (!workspaceName) return
    await runWorkspaceAction(async () => {
      await plugin.call('filePanel', 'createWorkspace', workspaceName.trim())
      setWorkspaceMenuOpen(false)
    })
  }

  const setWorkspace = async (workspaceName) => {
    await runWorkspaceAction(async () => {
      await plugin.call('filePanel', 'setWorkspace', { name: workspaceName, isLocalhost: workspaceName === LOCALHOST_WORKSPACE }, true, true)
      setCurrentWorkspace(workspaceName)
      setWorkspaceMenuOpen(false)
    })
  }

  const openRestoreBackup = async () => {
    await runWorkspaceAction(async () => {
      if (await plugin.appManager.isActive('restorebackupzip')) await plugin.call('tabs', 'focus', 'restorebackupzip')
      else await plugin.appManager.activatePlugin('restorebackupzip')
      setWorkspaceMenuOpen(false)
    })
  }

  const saveAs = (blob, name) => {
    const node = document.createElement('a')
    node.download = name
    node.rel = 'noopener'
    node.href = URL.createObjectURL(blob)
    setTimeout(() => URL.revokeObjectURL(node.href), 40000)
    node.dispatchEvent(new MouseEvent('click'))
  }

  const backupWorkspace = async () => {
    await runWorkspaceAction(async () => {
      const zip = new JSZip()
      const fileProviders = _deps && _deps.fileProviders
      const browserProvider = fileProviders && fileProviders.browser
      if (!browserProvider) throw new Error('File provider is not ready')
      await browserProvider.copyFolderToJson('/', ({ path, content }) => {
        zip.file(`tronideBackup${path}`, content)
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, 'tronideBackup.zip')
      setWorkspaceMenuOpen(false)
    })
  }

  const renderWorkspaceLabel = () => {
    if (currentWorkspace === LOCALHOST_WORKSPACE) return 'localhost'
    if (currentWorkspace === NO_WORKSPACE) return 'No workspace'
    return currentWorkspace || 'default_workspace'
  }

  const refreshNotifications = () => {
    try {
      const items = JSON.parse(window.localStorage.getItem('tronide.home.notifications') || '[]')
      setNotifications(Array.isArray(items) ? items.slice(0, 8) : [])
    } catch (error) {
      setNotifications([])
    }
  }

  const toggleNotifications = () => {
    refreshNotifications()
    setNotificationsOpen(!notificationsOpen)
  }

  const clearNotifications = () => {
    try { window.localStorage.setItem('tronide.home.notifications', '[]') } catch (error) { console.debug('[topHeader] failed to clear persisted notifications', error) }
    setNotifications([])
    window.dispatchEvent(new CustomEvent('tronideHomeNotificationsChanged'))
  }

  const shortenTronAddress = (address) => {
    if (!address || address.length <= 14) return address || ''
    return `${address.slice(0, 6)}…${address.slice(-6)}`
  }

  const getInjectedWallet = () => ({
    tronLink: window.tronLink || null,
    tronWeb: window.tronWeb || null
  })

  const getInjectedWalletAccount = () => {
    const injected = getInjectedWallet()
    return injected.tronWeb && injected.tronWeb.defaultAddress && injected.tronWeb.defaultAddress.base58
  }

  const getInjectedWalletNetworkHostLabel = () => {
    const injected = getInjectedWallet()
    const host = injected.tronWeb && injected.tronWeb.fullNode && injected.tronWeb.fullNode.host
    if (!host) return 'Unknown network'
    if (/nile/i.test(host)) return 'Nile'
    if (/shasta/i.test(host)) return 'Shasta'
    if (/trongrid|api\.tronstack|api\.trongrid/i.test(host)) return 'Mainnet'
    return 'Custom node'
  }

  const getInjectedWalletNetworkKey = () => {
    const injected = getInjectedWallet()
    const fullNode = injected.tronWeb && injected.tronWeb.fullNode
    const host = fullNode && fullNode.host ? String(fullNode.host) : ''
    return host
  }

  const getNetworkFromGenesisBlock = async (tronWeb) => {
    if (!tronWeb || !tronWeb.trx || !tronWeb.trx.getBlock) return ''
    const block = await tronWeb.trx.getBlock(0)
    const blockID = block && block.blockID
    return TRON_GENESIS_NETWORKS[blockID] || (blockID ? 'Custom node' : '')
  }

  const getInjectedWalletNetwork = async () => {
    const injected = getInjectedWallet()
    const key = getInjectedWalletNetworkKey()
    if (walletNetworkCacheRef.current.key === key && walletNetworkCacheRef.current.label) {
      return walletNetworkCacheRef.current.label
    }
    try {
      const genesisLabel = await getNetworkFromGenesisBlock(injected.tronWeb)
      if (genesisLabel) {
        walletNetworkCacheRef.current = { key, label: genesisLabel }
        return genesisLabel
      }
    } catch (error) {
      console.debug('[topHeader] genesis network detection failed; falling back to host label', error)
    }
    const fallbackLabel = getInjectedWalletNetworkHostLabel()
    walletNetworkCacheRef.current = { key, label: fallbackLabel }
    return fallbackLabel
  }

  const updateWalletStateFromProvider = async (reason = 'refresh') => {
    const refreshId = ++walletRefreshIdRef.current
    const injected = getInjectedWallet()
    if (!injected.tronLink || !injected.tronWeb) {
      walletNetworkCacheRef.current = { key: '', label: '' }
      if (refreshId === walletRefreshIdRef.current) {
        setWalletState({ status: 'error', account: '', network: '', message: 'TronLink is not installed' })
      }
      return
    }

    const account = getInjectedWalletAccount()
    if (!account) {
      walletNetworkCacheRef.current = { key: '', label: '' }
      if (refreshId === walletRefreshIdRef.current) {
        const disconnectedMessage = reason === 'disconnect' ? WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED : 'Please unlock TronLink and try again'
        setWalletState({ status: reason === 'disconnect' ? 'disconnected' : 'error', account: '', network: '', message: disconnectedMessage })
      }
      return
    }

    const network = await getInjectedWalletNetwork()
    if (refreshId === walletRefreshIdRef.current) {
      setWalletState({ status: 'connected', account, network, message: reason === 'network' ? 'Network updated' : 'Connected' })
    }
  }

  const scheduleWalletStateRefresh = (reason = 'refresh') => {
    if (walletStateRef.current.status !== 'connected' && reason !== 'connect') return
    updateWalletStateFromProvider(reason).catch((error) => {
      console.debug('[topHeader] failed to refresh wallet state', error)
    })
  }

  const onWalletAccountsChanged = (accounts) => {
    if (walletManuallyDisconnectedRef.current) return
    const nextAccount = Array.isArray(accounts)
      ? accounts[0]
      : (accounts && typeof accounts === 'object' ? accounts.account || accounts.address || accounts.base58 : accounts)
    if (accounts === undefined || accounts === null) {
      window.setTimeout(() => scheduleWalletStateRefresh('account'), 100)
      return
    }
    if (!nextAccount) {
      setWalletState({ status: 'disconnected', account: '', network: '', message: WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED })
      return
    }
    setWalletState((current) => current.status === 'connected' ? Object.assign({}, current, { account: nextAccount, message: 'Account updated' }) : current)
    window.setTimeout(() => scheduleWalletStateRefresh('account'), 100)
  }

  const onWalletNetworkChanged = () => {
    if (walletManuallyDisconnectedRef.current) return
    walletNetworkCacheRef.current = { key: '', label: '' }
    window.setTimeout(() => scheduleWalletStateRefresh('network'), 100)
  }

  const onWalletMessage = (event) => {
    const data = event && event.data ? event.data : event
    const action = data && (data.action || data.type || data.method)
    if (!action) return
    if (/accounts?Changed|setAccount|accountChanged|addressChanged/i.test(action)) onWalletAccountsChanged(data.accounts || data.account || data.address)
    if (/chainChanged|networkChanged|setNode|nodeChanged|connect|disconnect/i.test(action)) onWalletNetworkChanged()
  }

  const attachWalletEmitterListener = (emitter, eventName, handler, removers) => {
    if (!emitter || !eventName || !handler) return
    if (typeof emitter.on === 'function') {
      emitter.on(eventName, handler)
      removers.push(() => emitter.off ? emitter.off(eventName, handler) : emitter.removeListener?.(eventName, handler))
    } else if (typeof emitter.addListener === 'function') {
      emitter.addListener(eventName, handler)
      removers.push(() => emitter.removeListener?.(eventName, handler))
    }
  }

  const bindWalletProviderListeners = () => {
    if (walletListenerCleanupRef.current) walletListenerCleanupRef.current()
    const removers = []
    const injected = getInjectedWallet()
    const emitters = [injected.tronLink, injected.tronWeb].filter(Boolean)

    emitters.forEach((emitter) => {
      ;['accountsChanged', 'accountChanged', 'setAccount', 'addressChanged'].forEach((eventName) => {
        attachWalletEmitterListener(emitter, eventName, onWalletAccountsChanged, removers)
      })
      ;['chainChanged', 'networkChanged', 'setNode', 'nodeChanged', 'connect', 'disconnect'].forEach((eventName) => {
        attachWalletEmitterListener(emitter, eventName, onWalletNetworkChanged, removers)
      })
    })

    walletListenerCleanupRef.current = () => {
      removers.forEach((remove) => remove())
      walletListenerCleanupRef.current = null
    }
  }

  const disconnectWallet = async () => {
    walletManuallyDisconnectedRef.current = true
    walletNetworkCacheRef.current = { key: '', label: '' }
    setWalletMenuOpen(false)
    setWalletState({ status: 'disconnected', account: '', network: '', message: 'Connect Wallet' })
    try {
      const injected = getInjectedWallet()
      if (injected.tronLink && typeof injected.tronLink.request === 'function') {
        try {
          await injected.tronLink.request({ method: 'tron_disconnect' })
        } catch (error) {
          console.debug('[topHeader] TronLink disconnect request was ignored by provider', error)
        }
      }
      if (plugin.appManager && await plugin.appManager.isActive('udapp')) {
        await plugin.call('udapp', 'disconnectInjectedTronWeb')
      }
    } catch (error) {
      console.debug('[topHeader] failed to switch Deploy & Run after wallet disconnect', error)
    }
  }

  const renderWalletLabel = () => {
    if (walletConnectInFlight) return 'Connecting Wallet…'
    if (walletState.status === 'connected') return `Wallet ${shortenTronAddress(walletState.account)} · ${walletState.network}`
    if (walletState.status === 'error' && walletState.message) return `Connect Wallet · ${walletState.message}`
    return 'Connect Wallet'
  }

  const connectWallet = async () => {
    if (walletConnectInFlightRef.current) return
    walletManuallyDisconnectedRef.current = false
    setWalletMenuOpen(false)
    bindWalletProviderListeners()
    const injected = getInjectedWallet()
    if (!injected.tronLink || !injected.tronWeb) {
      setWalletState({ status: 'error', account: '', network: '', message: 'TronLink is not installed' })
      return
    }
    walletConnectInFlightRef.current = true
    setWalletConnectInFlight(true)
    setWalletState({ status: 'connecting', account: '', network: '', message: 'Connecting Wallet…' })
    try {
      if (!injected.tronLink.request) throw Object.assign(new Error(WALLET_ERROR_MESSAGES.WALLET_CAPABILITY_MISSING), { code: 'WALLET_CAPABILITY_MISSING' })
      await injected.tronLink.request({ method: 'tron_requestAccounts' })
      if (plugin.appManager && !await plugin.appManager.isActive('udapp')) {
        await plugin.appManager.activatePlugin('udapp')
      }
      await plugin.call('menuicons', 'select', 'udapp')
      const result = await plugin.call('udapp', 'connectInjectedTronWeb')
      if (result && result.connected === false) {
        // result.error may be missing; fall back to a known message so normalizeTronLinkErrorMessage
        // never has to stringify a bare object into "[object Object]".
        throw result.error || new Error(WALLET_ERROR_MESSAGES.WALLET_UNKNOWN_ERROR)
      }

      let account = result && result.account
      if (!account) {
        try {
          const accounts = await plugin.call('udapp', 'getAccounts')
          account = accounts && accounts[0]
        } catch (error) {
          account = getInjectedWalletAccount()
        }
      }
      if (!account) throw Object.assign(new Error(WALLET_ERROR_MESSAGES.WALLET_UNAUTHORIZED), { code: 'WALLET_UNAUTHORIZED' })
      const network = await getInjectedWalletNetwork()
      setWalletState({ status: 'connected', account, network, message: 'Connected' })
    } catch (error) {
      setWalletState({ status: 'error', account: '', network: '', message: normalizeTronLinkErrorMessage(error) })
    } finally {
      walletConnectInFlightRef.current = false
      setWalletConnectInFlight(false)
    }
  }

  const reconnectWallet = async () => {
    await connectWallet()
  }

  useEffect(() => {
    bindWalletProviderListeners()

    const onFocusRefresh = () => scheduleWalletStateRefresh('focus')
    window.addEventListener('message', onWalletMessage)
    window.addEventListener('focus', onFocusRefresh)
    const intervalId = window.setInterval(() => {
      if (!walletManuallyDisconnectedRef.current && walletStateRef.current.status === 'connected') {
        scheduleWalletStateRefresh('poll')
      }
    }, WALLET_STATUS_POLL_INTERVAL)

    return () => {
      if (walletListenerCleanupRef.current) walletListenerCleanupRef.current()
      window.removeEventListener('message', onWalletMessage)
      window.removeEventListener('focus', onFocusRefresh)
      window.clearInterval(intervalId)
    }
  }, [])

  return (
    <div className='top-header-wrapper'>
      <div className='d-flex align-items-center'>
        <div className='homeIcon' onClick={onHome}>
          <BasicLogo />
        </div>
        <div className='header-version'>
          v{version}
        </div>
      </div>
      <div className='header-workspace-menu' ref={workspaceMenuRef} data-id='headerWorkspaceMenu'>
        <button
          type='button'
          className='header-workspace-trigger'
          data-id='headerWorkspaceDropdown'
          onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
          aria-haspopup='menu'
          aria-expanded={workspaceMenuOpen}
          title={renderWorkspaceLabel()}
        >
          <span className='workspace-name'>{renderWorkspaceLabel()}</span>
          <i className={`fas fa-chevron-${workspaceMenuOpen ? 'up' : 'down'}`} aria-hidden='true'></i>
        </button>
        {workspaceMenuOpen &&
          <div className='header-workspace-dropdown' role='menu'>
            <div className='workspace-menu-title'>{renderWorkspaceLabel()}</div>
            <button type='button' className='workspace-menu-primary' data-id='headerCreateWorkspace' onClick={createWorkspace} disabled={workspaceBusy}>
              <i className='fas fa-plus'></i><span>Create a new Workspace</span>
            </button>
            {workspaces.length > 0 && <div className='workspace-menu-section'>Workspaces</div>}
            {workspaces.map((workspaceName) =>
              <button key={workspaceName} type='button' className='workspace-menu-item' data-id={`headerWorkspace-${workspaceName}`} onClick={() => setWorkspace(workspaceName)} disabled={workspaceBusy}>
                <span className='workspace-menu-item-label'>{workspaceName}</span>
                {workspaceName === currentWorkspace && <i className='fas fa-check'></i>}
              </button>
            )}
            <div className='workspace-menu-divider'></div>
            <button type='button' className='workspace-menu-item' data-id='headerBackupWorkspace' onClick={backupWorkspace} disabled={workspaceBusy}>
              <i className='fas fa-download'></i><span>Backup</span>
            </button>
            <button type='button' className='workspace-menu-item' data-id='headerRestoreWorkspace' onClick={openRestoreBackup} disabled={workspaceBusy}>
              <i className='fas fa-upload'></i><span>Restore</span>
            </button>
            <button type='button' className='workspace-menu-item' data-id='headerConnectLocalhost' onClick={() => setWorkspace(LOCALHOST_WORKSPACE)} disabled={workspaceBusy}>
              <i className='fas fa-desktop'></i><span>Connect to Localhost</span>
            </button>
          </div>
        }
      </div>
      <div className='header-layout-toggles' data-id='headerLayoutToggles'>
        <Tooltip title='Toggle Side Panel'>
          <button className='layout-toggle-btn' data-id='headerToggleSidePanel' onClick={toggleSidePanel} aria-label='Toggle Side Panel'>
            <span className='layout-toggle-icon layout-toggle-icon-left' aria-hidden='true'></span>
          </button>
        </Tooltip>
        <Tooltip title='Toggle Bottom Panel'>
          <button className='layout-toggle-btn' data-id='headerToggleBottomPanel' onClick={toggleBottomPanel} aria-label='Toggle Bottom Panel'>
            <span className='layout-toggle-icon layout-toggle-icon-bottom' aria-hidden='true'></span>
          </button>
        </Tooltip>
        <Tooltip title='Toggle AI Panel'>
          <button className='layout-toggle-btn' data-id='headerToggleAiPanel' onClick={toggleAiPanel} aria-label='Toggle AI Panel'>
            <span className='layout-toggle-icon layout-toggle-icon-right' aria-hidden='true'></span>
          </button>
        </Tooltip>
      </div>
      <div className='d-flex align-items-center'>
        <div className='header-actions'>
          <button className='header-action-btn' data-id='headerGithubConnect' onClick={connectGithub}>
            <i className='fab fa-github header-action-icon'></i>
            <span>Connect GitHub</span>
          </button>
          <div className='header-wallet-action' ref={walletMenuRef}>
            <button
              className='header-action-btn wallet-action-btn'
              data-id='headerWalletConnect'
              disabled={walletConnectInFlight}
              title={renderWalletLabel()}
              aria-haspopup={walletState.status === 'connected' ? 'menu' : undefined}
              aria-expanded={walletState.status === 'connected' ? walletMenuOpen : undefined}
              onClick={walletState.status === 'connected' ? () => setWalletMenuOpen(!walletMenuOpen) : connectWallet}
            >
              <span className='header-action-icon'>↔</span>
              <span>{renderWalletLabel()}</span>
            </button>
            {walletMenuOpen && walletState.status === 'connected' &&
              <div className='header-wallet-menu' data-id='headerWalletMenu' role='menu'>
                <div className='wallet-menu-title'>TronLink Wallet</div>
                <div className='wallet-menu-row'>
                  <span>Account</span>
                  <strong data-id='headerWalletAccount' title={walletState.account}>{shortenTronAddress(walletState.account)}</strong>
                </div>
                <div className='wallet-menu-row'>
                  <span>Network</span>
                  <strong data-id='headerWalletNetwork'>{walletState.network || 'Unknown network'}</strong>
                </div>
                <div className='wallet-menu-actions'>
                  <button type='button' data-id='headerWalletReconnect' onClick={reconnectWallet} disabled={walletConnectInFlight}>Reconnect</button>
                  <button type='button' data-id='headerWalletDisconnect' onClick={disconnectWallet}>Disconnect</button>
                </div>
              </div>
            }
          </div>
        </div>
        {
          aiPluginClosed ? <Tooltip title={'Show TRON IDE AI Assistant plugin'}
            align={{
              offset: [-12, -10],
              targetOffset: [0, 0]
            }}
          >
            <svg onClick={showAiPopup} className={'a-icon ai-show-btn'} aria-hidden="true">
              <use xlinkHref="#icon-fangda"></use>
            </svg>
          </Tooltip> : null
        }
        <div className='header-notifications' ref={notificationsRef}>
          <button
            type='button'
            className='settings-icon-wrapper notification-icon-wrapper'
            onClick={toggleNotifications}
            data-id='headerNotificationsButton'
            aria-label='Open notifications'
            title='Notifications'
          >
            <i className='fas fa-bell' aria-hidden='true'></i>
            {notifications.length ? <span className='notification-badge'>{notifications.length}</span> : null}
          </button>
          {notificationsOpen &&
            <div className='header-notifications-dropdown' data-id='headerNotificationsPanel'>
              <div className='notifications-title'>Notifications</div>
              {notifications.length ? notifications.map((item, index) =>
                <div className='notification-row' key={`${item.title || 'notification'}-${index}`}>
                  <div className='notification-row-title'>{item.title || 'Home action'}{item.time ? ` · ${item.time}` : ''}</div>
                  <div className='notification-row-message'>{item.message || ''}</div>
                </div>
              ) : <div className='notification-row notification-empty'>No notifications yet.</div>}
              {notifications.length ? <button type='button' className='notifications-clear' data-id='headerNotificationsClear' onClick={clearNotifications}>Clear</button> : null}
            </div>
          }
        </div>
        <button
          type='button'
          className='settings-icon-wrapper'
          onClick={settingsHandler}
          data-id='headerSettingsButton'
          aria-label='Open settings'
          title='Open settings'
        >
          <i className='fas fa-cog' aria-hidden='true'></i>
        </button>
      </div>
    </div>
  )
}
