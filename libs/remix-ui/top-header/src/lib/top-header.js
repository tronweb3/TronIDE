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
import Tooltip from 'antd/lib/tooltip'
import message from 'antd/lib/message'
import JSZip from 'jszip'
import * as githubAuth from '../../../../../apps/remix-ide/src/lib/github-auth'
import { disconnectGithub } from '../../../../../apps/remix-ide/src/lib/github-connection'
import { RELEASE_NOTES_URL } from '../../../../../apps/remix-ide/src/lib/release-notes-link'

const LOCALHOST_WORKSPACE = ' - connect to localhost - '
const NO_WORKSPACE = ' - none - '
const WALLET_ERROR_MESSAGES = {
  // Unified "couldn't get an account" message. TronLink gives the page NO reliable
  // way to tell a locked wallet apart from a user-rejected connection — both end
  // up with no account, ready === false, and code 4001 — so a single message that
  // is correct for both (unlock it, then approve) is the honest UX. Returned by
  // normalizeTronLinkErrorMessage for code 4001 / reject keywords, so its own
  // "unlock" wording never causes a re-map (the 4001 branch matches first).
  WALLET_CONNECTION_REJECTED: 'TronLink did not connect. Unlock it, approve this site, and try again.',
  WALLET_LOCKED: 'No TronLink account is available. Unlock an account, then reload.',
  // Covers both a locked wallet and an unauthorized site — the page cannot
  // tell them apart (TronLink reports ready=false with no address in both).
  WALLET_UNAUTHORIZED: 'Unlock TronLink and approve this site.',
  WALLET_REQUEST_TIMEOUT: 'TronLink timed out. Try again.',
  WALLET_UNAVAILABLE: 'TronLink is not available in this browser.',
  WALLET_DISCONNECTED: 'TronLink disconnected. Reconnect to continue.',
  WALLET_CAPABILITY_MISSING: 'TronLink cannot request accounts. Update the extension.',
  WALLET_UNKNOWN_ERROR: 'TronLink connection failed. Try again.',
  // Used only for a STALE/dead bridge (extension removed/disabled, objects
  // linger until reload) — i.e. a request that timed out rather than resolved.
  // A resolved-but-empty request is split into rejected vs locked at the call
  // site instead. NOTE: keep this clear of words normalizeTronLinkErrorMessage
  // matches (reject/declin/denied/cancel/unlock/locked/unauthorized/...), or it
  // gets rewritten back into one of the canned messages.
  WALLET_NO_ACCOUNT: 'No TronLink account is available. If the extension changed or was disabled, reload the page.'
}

const WALLET_STATUS_POLL_INTERVAL = 3000
// Mirrors execution-context's WALLET_MANUAL_DISCONNECT_KEY. A deliberate
// disconnect must stick: until the user reconnects, re-selecting the injected
// environment should not silently re-adopt the still-authorized TronLink
// account. Kept as a plain string so this UI lib needn't import from the app.
const WALLET_MANUAL_DISCONNECT_KEY = 'tronide.wallet.manuallyDisconnected'

const setWalletManuallyDisconnected = (flag) => {
  try {
    if (flag) window.sessionStorage.setItem(WALLET_MANUAL_DISCONNECT_KEY, '1')
    else window.sessionStorage.removeItem(WALLET_MANUAL_DISCONNECT_KEY)
  } catch (error) {
    console.debug('[topHeader] failed to persist wallet disconnect flag', error)
  }
}

const readWalletManuallyDisconnected = () => {
  try {
    return typeof window !== 'undefined' && window.sessionStorage &&
      window.sessionStorage.getItem(WALLET_MANUAL_DISCONNECT_KEY) === '1'
  } catch (error) {
    return false
  }
}
// TronLink's tron_requestAccounts never settles when the user dismisses the
// approval popup without an explicit answer. Without a bound, the in-flight
// guard (walletConnectInFlightRef) stays true forever and the Connect Wallet
// button goes permanently unresponsive. Cap the wait so the guard always
// releases and the user can retry.
const WALLET_CONNECT_TIMEOUT_MS = 60000
// A live, already-authorized TronLink answers tron_requestAccounts almost
// instantly and without a popup (the connect + signing paths already rely on
// this). A dead/stale bridge — the extension was disabled or removed but its
// window.tronLink / window.tronWeb objects still linger on the page until a
// reload — never answers. So when an account is already cached, a short probe
// tells a live wallet apart from a zombie one without forcing a reload.
const WALLET_LIVENESS_TIMEOUT_MS = 8000
// A live, authorized bridge answers silently. Recheck it at a deliberately low
// frequency so an extension disabled after page load cannot leave a stale
// connected label forever, without turning account authorization into a busy
// poll. Focus-triggered refreshes use the same throttle.
const WALLET_LIVENESS_RECHECK_INTERVAL_MS = 30000

const requestTronAccountsWithTimeout = (tronLink, timeoutMs = WALLET_CONNECT_TIMEOUT_MS) => {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(Object.assign(new Error(WALLET_ERROR_MESSAGES.WALLET_REQUEST_TIMEOUT), { code: 'WALLET_REQUEST_TIMEOUT' }))
    }, timeoutMs)
    Promise.resolve()
      .then(() => tronLink.request({ method: 'tron_requestAccounts' }))
      .then((value) => { if (settled) return; settled = true; window.clearTimeout(timer); resolve(value) })
      .catch((error) => { if (settled) return; settled = true; window.clearTimeout(timer); reject(error) })
  })
}
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
  const [githubState, setGithubState] = useState({ connected: false, login: '' })
  const [walletConnectInFlight, setWalletConnectInFlight] = useState(false)
  const [walletConnectPrompt, setWalletConnectPrompt] = useState(null)
  const [walletConnectSecondsRemaining, setWalletConnectSecondsRemaining] = useState(0)
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [githubMenuOpen, setGithubMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaces, setWorkspaces] = useState([])
  const [currentWorkspace, setCurrentWorkspace] = useState('default_workspace')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const walletConnectInFlightRef = useRef(false)
  const walletStateRef = useRef(walletState)
  const walletRefreshIdRef = useRef(0)
  const walletNetworkCacheRef = useRef({ provider: null, key: '', label: '' })
  const walletNetworkCacheEpochRef = useRef(0)
  // Read the persisted intent during the first render. Initializing this to
  // false briefly re-adopted a cached TronLink account after reload even though
  // the user had explicitly disconnected in this tab.
  const walletManuallyDisconnectedRef = useRef(readWalletManuallyDisconnected())
  // An explicit provider-side disconnect/revoke is authoritative even when
  // TronLink leaves defaultAddress cached. Keep both injected identities so a
  // genuine reconnect/account event or replacement of either object clears it.
  const walletProviderDisconnectedRef = useRef(null)
  const walletWasConnectedRef = useRef(false)
  const walletListenerCleanupRef = useRef(null)
  const walletListenerProviderRef = useRef(null)
  // Liveness tracking for the injected bridge. walletProbedProviderRef holds the
  // tronLink instance most recently probed; walletBridgeDeadRef is set when a
  // probe proves the bridge is a stale zombie so the poll cannot re-promote the
  // cached account.
  const walletProbedProviderRef = useRef(null)
  const walletBridgeDeadRef = useRef(false)
  const walletBridgeProbeAtRef = useRef(0)
  const walletBridgeProbeInFlightRef = useRef(null)
  const walletBridgeProbeIdRef = useRef(0)
  const walletVmFallbackInFlightRef = useRef(null)
  const workspaceMenuRef = useRef(null)
  const walletMenuRef = useRef(null)
  const githubMenuRef = useRef(null)
  const notificationsRef = useRef(null)
  const homeNavigationTimersRef = useRef([])
  const headerMountedRef = useRef(false)

  useEffect(() => {
    headerMountedRef.current = true
    return () => {
      headerMountedRef.current = false
      homeNavigationTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
      homeNavigationTimersRef.current = []
    }
  }, [])

  useEffect(() => {
    async function fetchVersion () {
      const latestVersion = await plugin.getLatestVersion()
      setVersion(latestVersion)
    }
    fetchVersion()
  }, [])

  useEffect(() => {
    if (!plugin?.events?.on) return undefined
    const onAiPluginClosed = (profile) => {
      setAiPluginClosed(profile)
    }
    plugin.events.on('aiPluginClosed', onAiPluginClosed)
    return () => {
      if (plugin.events.removeListener) plugin.events.removeListener('aiPluginClosed', onAiPluginClosed)
      else if (plugin.events.off) plugin.events.off('aiPluginClosed', onAiPluginClosed)
    }
  }, [plugin])

  useEffect(() => {
    walletStateRef.current = walletState
  }, [walletState])

  useEffect(() => {
    if (!walletConnectPrompt || walletConnectPrompt.status !== 'waiting') {
      setWalletConnectSecondsRemaining(0)
      return undefined
    }
    const updateCountdown = () => {
      setWalletConnectSecondsRemaining(Math.max(0, Math.ceil((walletConnectPrompt.deadline - Date.now()) / 1000)))
    }
    updateCountdown()
    const intervalId = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(intervalId)
  }, [walletConnectPrompt])

  useEffect(() => {
    // Reflect the GitHub connection (made on the Home panel) in the header
    // button — mirrors the wallet header. Only an opaque BFF session handle
    // lives in this tab; GitHub's access token remains encrypted server-side.
    // Keep the existing event plus the direct store subscription in sync.
    const readGithub = () => ({ connected: githubAuth.isConnected(), login: githubAuth.getLogin() })
    const refresh = () => setGithubState(readGithub())
    refresh()
    githubAuth.onChange(refresh)
    window.addEventListener('tronideGithubConnectionChanged', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      githubAuth.offChange(refresh)
      window.removeEventListener('tronideGithubConnectionChanged', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

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
      if (githubMenuRef.current && !githubMenuRef.current.contains(event.target)) setGithubMenuOpen(false)
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) setNotificationsOpen(false)
    }
    // Escape closes any open header menu (they are lightweight popovers, not
    // modals — outside-click alone left keyboard users with no way out).
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setWorkspaceMenuOpen(false)
      setWalletMenuOpen(false)
      setGithubMenuOpen(false)
      setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
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

  const cancelHomeNavigationTimers = () => {
    homeNavigationTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
    homeNavigationTimersRef.current = []
  }

  const scheduleHomeNavigation = (callback, delay) => {
    const timerId = window.setTimeout(() => {
      homeNavigationTimersRef.current = homeNavigationTimersRef.current.filter((id) => id !== timerId)
      if (headerMountedRef.current) callback()
    }, delay)
    homeNavigationTimersRef.current.push(timerId)
  }

  const connectGithub = async () => {
    cancelHomeNavigationTimers()
    try {
      await onHome()
    } catch (error) {
      message.error(error && error.message ? error.message : 'Unable to open Home.')
      return
    }
    if (!headerMountedRef.current) return
    scheduleHomeNavigation(() => {
      const home = document.querySelector('[data-id="landingPageHomeContainer"]')
      if (!home) return
      const advancedToggle = home.querySelector('[data-id="landingAdvancedToolsToggle"]')
      const advancedContent = home.querySelector('[data-id="landingAdvancedToolsContent"]')
      if (!advancedContent && advancedToggle && typeof advancedToggle.click === 'function') advancedToggle.click()
    }, 80)
    scheduleHomeNavigation(() => {
      const home = document.querySelector('[data-id="landingPageHomeContainer"]')
      if (!home) return
      const target = home.querySelector('[data-id="landingGithubTokenPanel"]')
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const connectButton = home.querySelector('[data-id="landingGithubOAuthConnect"]')
      if (connectButton && typeof connectButton.click === 'function') connectButton.click()
    }, 180)
  }

  // When already connected, the header GitHub button opens this menu instead of
  // re-running the OAuth popup (which GitHub, seeing the app already authorized,
  // would flash open and immediately close). Reconnect re-runs OAuth on demand;
  // Disconnect goes through the shared full-cleanup so it matches Home exactly.
  const reconnectGithub = () => {
    setGithubMenuOpen(false)
    connectGithub()
  }
  const onGithubDisconnect = () => {
    disconnectGithub()
    setGithubMenuOpen(false)
    // githubAuth.clearSession() (inside disconnectGithub) notifies our own
    // subscriber, but set state here too so the label flips without waiting.
    setGithubState({ connected: false, login: '' })
  }

  const showAiPopup = async () => {
    plugin.call('aiPanel', 'hide')
    gtag('event', 'click', { event_category: 'ai_user_action', event_label: 'show_ai' })
  }

  const toggleSidePanel = async () => {
    const panel = document.getElementById('side-panel')
    if (!panel) return
    const shouldShow = panel.style.display === 'none'
    if (shouldShow && window.matchMedia('(max-width: 768px)').matches) {
      const aiPanel = document.getElementById('ai-panel')
      if (aiPanel && aiPanel.style.display !== 'none') await plugin.call('aiPanel', 'conceal')
    }
    panel.style.display = shouldShow ? '' : 'none'
    const resizeHandle = panel.nextElementSibling
    if (resizeHandle && window.matchMedia('(max-width: 768px)').matches) {
      resizeHandle.style.display = shouldShow ? 'block' : 'none'
    }
  }

  const toggleBottomPanel = () => {
    const mainview = _deps && _deps.mainview
    if (mainview && typeof mainview.minimizeTerminal === 'function') mainview.minimizeTerminal()
  }

  const toggleAiPanel = () => {
    plugin.call('aiPanel', 'hide')
  }

  const refreshWorkspaceState = async (retry = 1) => {
    try {
      const [workspaceList, workspace] = await Promise.all([
        plugin.call('filePanel', 'getWorkspaces').catch(() => []),
        plugin.call('filePanel', 'getCurrentWorkspace').catch(() => null)
      ])
      const list = Array.isArray(workspaceList) ? workspaceList : []
      setWorkspaces(list)
      const name = workspace && workspace.name
      // Deleting the current workspace switches the file panel to a fallback via
      // the React component (no setWorkspace event), so the name read on the
      // workspaceListChanged tick can still be the just-deleted one. If the
      // resolved name is no longer in the list, it is stale — re-read shortly so
      // the header title doesn't keep showing a deleted workspace (IX-WS-DELETE-1).
      if (name && list.length && !list.includes(name) && retry > 0) {
        window.setTimeout(() => refreshWorkspaceState(retry - 1), 300)
        return
      }
      if (name) setCurrentWorkspace(name)
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
    setWorkspaceMenuOpen(false)
    await runWorkspaceAction(async () => {
      await plugin.appManager.activatePlugin('filePanel')
      if (_deps && _deps.verticalIcons) _deps.verticalIcons.select('filePanel')
      await plugin.call('filePanel', 'openCreateWorkspaceDialog')
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
      const workspaceProvider = fileProviders && fileProviders.workspace
      const activeWorkspace = workspaceProvider && typeof workspaceProvider.getWorkspace === 'function'
        ? workspaceProvider.getWorkspace()
        : ''
      if (!workspaceProvider || typeof workspaceProvider.copyFolderToJson !== 'function' || !activeWorkspace || currentWorkspace === LOCALHOST_WORKSPACE || currentWorkspace === NO_WORKSPACE) {
        throw new Error('Backups are available only for an active browser workspace.')
      }
      if (activeWorkspace !== currentWorkspace) {
        throw new Error('The workspace state changed. Refresh the workspace menu and try again.')
      }
      await workspaceProvider.copyFolderToJson('/', ({ path, content }) => {
        if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
          zip.file(`tronideBackup${path}`, content.slice(content.indexOf(';base64,') + 8), { base64: true })
        } else {
          zip.file(`tronideBackup${path}`, content)
        }
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

  const readNotifications = () => {
    try {
      const items = JSON.parse(window.localStorage.getItem('tronide.home.notifications') || '[]')
      return Array.isArray(items) ? items.slice(0, 8) : []
    } catch (error) {
      return []
    }
  }

  const refreshNotifications = () => setNotifications(readNotifications())

  const toggleNotifications = () => {
    if (!notificationsOpen) {
      const items = readNotifications()
      const updated = items.map((item) => item && item.read === true ? item : Object.assign({}, item, { read: true }))
      try {
        if (updated.some((item, index) => item !== items[index])) {
          window.localStorage.setItem('tronide.home.notifications', JSON.stringify(updated))
          window.dispatchEvent(new CustomEvent('tronideHomeNotificationsChanged'))
        }
      } catch (error) {
        console.debug('[topHeader] failed to mark notifications as read', error)
      }
      setNotifications(updated)
    } else {
      refreshNotifications()
    }
    setNotificationsOpen(!notificationsOpen)
  }

  const clearNotifications = () => {
    try { window.localStorage.setItem('tronide.home.notifications', '[]') } catch (error) { console.debug('[topHeader] failed to clear persisted notifications', error) }
    setNotifications([])
    window.dispatchEvent(new CustomEvent('tronideHomeNotificationsChanged'))
  }

  const unreadNotificationCount = notifications.filter((item) => !item || item.read !== true).length

  const shortenTronAddress = (address) => {
    if (!address || address.length <= 14) return address || ''
    return `${address.slice(0, 6)}…${address.slice(-6)}`
  }

  const getInjectedWallet = () => ({
    tronLink: window.tronLink || null,
    tronWeb: window.tronWeb || null
  })

  const isSameInjectedWallet = (left, right) => !!left && !!right && left.tronLink === right.tronLink && left.tronWeb === right.tronWeb

  const getInjectedWalletAccount = () => {
    const injected = getInjectedWallet()
    return injected.tronWeb && injected.tronWeb.defaultAddress && injected.tronWeb.defaultAddress.base58
  }

  const clearWalletNetworkCache = () => {
    walletNetworkCacheEpochRef.current += 1
    walletNetworkCacheRef.current = { provider: null, key: '', label: '' }
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
    const provider = injected.tronWeb
    const key = getInjectedWalletNetworkKey()
    if (walletNetworkCacheRef.current.provider === provider && walletNetworkCacheRef.current.key === key && walletNetworkCacheRef.current.label) {
      return walletNetworkCacheRef.current.label
    }
    const cacheEpoch = walletNetworkCacheEpochRef.current
    const cacheIfCurrent = (label) => {
      const current = getInjectedWallet()
      if (walletNetworkCacheEpochRef.current === cacheEpoch && current.tronWeb === provider && getInjectedWalletNetworkKey() === key) {
        walletNetworkCacheRef.current = { provider, key, label }
      }
      return label
    }
    try {
      const genesisLabel = await getNetworkFromGenesisBlock(provider)
      if (genesisLabel) {
        return cacheIfCurrent(genesisLabel)
      }
    } catch (error) {
      console.debug('[topHeader] genesis network detection failed; falling back to host label', error)
    }
    const fallbackLabel = getInjectedWalletNetworkHostLabel()
    return cacheIfCurrent(fallbackLabel)
  }

  const invalidateWalletBridgeProbe = () => {
    walletBridgeProbeIdRef.current += 1
    walletBridgeProbeInFlightRef.current = null
    walletBridgeProbeAtRef.current = 0
  }

  const noteWalletProviderAlive = (tronLink = getInjectedWallet().tronLink) => {
    invalidateWalletBridgeProbe()
    walletProviderDisconnectedRef.current = null
    walletProbedProviderRef.current = tronLink
    walletBridgeDeadRef.current = false
    walletBridgeProbeAtRef.current = Date.now()
  }

  const switchDeployAndRunToVmAfterWalletDisconnect = () => {
    const disconnectEpoch = walletBridgeProbeIdRef.current
    if (walletVmFallbackInFlightRef.current === disconnectEpoch) return
    walletVmFallbackInFlightRef.current = disconnectEpoch
    Promise.resolve()
      .then(async () => {
        if (walletBridgeProbeIdRef.current !== disconnectEpoch) return
        if (!plugin.appManager || !await plugin.appManager.isActive('udapp')) return
        // A connect/account event invalidates the disconnect epoch. Do not let
        // an older asynchronous fallback override a freshly reconnected user.
        if (walletBridgeProbeIdRef.current !== disconnectEpoch) return
        await plugin.call('udapp', 'disconnectInjectedTronWeb')
      })
      .catch((error) => {
        console.debug('[topHeader] failed to switch Deploy & Run after external wallet disconnect', error)
      })
      .finally(() => {
        if (walletVmFallbackInFlightRef.current === disconnectEpoch) walletVmFallbackInFlightRef.current = null
      })
  }

  // Probe whether an injected provider's bridge is actually live. Runs in the
  // background so the optimistic "connected" display isn't blocked. The probe
  // is repeated at a low frequency for the same object because disabling an
  // extension does not replace its already-injected window objects.
  const maybeVerifyWalletBridge = (tronLink) => {
    if (!tronLink || typeof tronLink.request !== 'function') return
    const now = Date.now()
    const sameProvider = walletProbedProviderRef.current === tronLink
    const inFlight = walletBridgeProbeInFlightRef.current
    if (sameProvider && inFlight && inFlight.provider === tronLink) return
    if (sameProvider && now - walletBridgeProbeAtRef.current < WALLET_LIVENESS_RECHECK_INTERVAL_MS) return
    const probeId = ++walletBridgeProbeIdRef.current
    walletProbedProviderRef.current = tronLink
    walletBridgeProbeAtRef.current = now
    walletBridgeProbeInFlightRef.current = { provider: tronLink, probeId }
    walletBridgeDeadRef.current = false
    requestTronAccountsWithTimeout(tronLink, WALLET_LIVENESS_TIMEOUT_MS)
      .then((result) => {
        if (walletBridgeProbeIdRef.current !== probeId) return
        const responseCode = result && (result.code != null ? result.code : (result.data && result.data.code))
        // These responses prove the bridge is alive, but also prove that it no
        // longer exposes an account. Treat them as a clean provider disconnect,
        // not as a dead-extension/reload error.
        const emptyLegacyResponse = result === '' || (result && result.code == null && result.message === '')
        if (/^(4001|4100|4900)$/.test(String(responseCode || '')) || emptyLegacyResponse || (Array.isArray(result) && !result.length)) {
          onWalletDisconnected()
        }
      })
      .catch((error) => {
        // Only act if this is still the current provider and nothing newer ran.
        if (walletBridgeProbeIdRef.current !== probeId || walletProbedProviderRef.current !== tronLink) return
        if (getInjectedWallet().tronLink !== tronLink) return
        if (walletManuallyDisconnectedRef.current) return
        const errorMessage = String((error && (error.message || error)) || '')
        const errorCode = String((error && error.code) || '')
        if (/^(4001|4100|4900)$/.test(errorCode) || /reject|unlock|locked|unauthorized|disconnect|not connected/i.test(errorMessage)) {
          onWalletDisconnected()
          return
        }
        walletRefreshIdRef.current += 1
        walletBridgeDeadRef.current = true
        walletWasConnectedRef.current = false
        clearWalletNetworkCache()
        setWalletMenuOpen(false)
        setWalletState({ status: 'error', account: '', network: '', message: WALLET_ERROR_MESSAGES.WALLET_NO_ACCOUNT })
        switchDeployAndRunToVmAfterWalletDisconnect()
        message.error(WALLET_ERROR_MESSAGES.WALLET_NO_ACCOUNT)
      })
      .finally(() => {
        const current = walletBridgeProbeInFlightRef.current
        if (current && current.probeId === probeId) walletBridgeProbeInFlightRef.current = null
      })
  }

  const updateWalletStateFromProvider = async (reason = 'refresh') => {
    const refreshId = ++walletRefreshIdRef.current
    const injected = getInjectedWallet()
    if (!injected.tronLink || !injected.tronWeb) {
      clearWalletNetworkCache()
      if (refreshId === walletRefreshIdRef.current) {
        setWalletState({ status: 'error', account: '', network: '', message: 'TronLink is not installed' })
      }
      return
    }
    if (walletProviderDisconnectedRef.current && !isSameInjectedWallet(walletProviderDisconnectedRef.current, injected)) {
      walletProviderDisconnectedRef.current = null
    }
    if (isSameInjectedWallet(walletProviderDisconnectedRef.current, injected)) return
    // A provider we already proved dead must not be re-promoted from its cached
    // account by the recurring poll. Stay put until the page reloads or TronLink
    // re-injects a fresh object (handled by maybeVerifyWalletBridge's identity
    // check). An explicit reconnect resets the flag in connectWallet.
    if (walletBridgeDeadRef.current && injected.tronLink === walletProbedProviderRef.current) return

    let account = getInjectedWalletAccount()
    if (!account && walletWasConnectedRef.current && reason !== 'disconnect') {
      // TronLink briefly reports no account while the user switches account or
      // network; re-read once before declaring an error (WAL-HDR-1).
      await new Promise((resolve) => setTimeout(resolve, 700))
      if (refreshId !== walletRefreshIdRef.current) return
      account = getInjectedWalletAccount()
    }
    if (!account) {
      clearWalletNetworkCache()
      if (refreshId === walletRefreshIdRef.current) {
        const disconnectedMessage = reason === 'disconnect' ? WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED : 'Unlock TronLink and try again.'
        setWalletState({ status: reason === 'disconnect' ? 'disconnected' : 'error', account: '', network: '', message: disconnectedMessage })
      }
      return
    }

    const network = await getInjectedWalletNetwork()
    if (refreshId === walletRefreshIdRef.current) {
      walletWasConnectedRef.current = true
      setWalletState({ status: 'connected', account, network, message: reason === 'network' ? 'Network updated' : 'Connected' })
      // Verify the bridge behind this cached account is actually live. getBlock/
      // defaultAddress above hit the fullNode HTTP + cached state, which keep
      // working after the extension is disabled — only this probe catches a
      // zombie provider and corrects the optimistic "connected".
      maybeVerifyWalletBridge(injected.tronLink)
    }
  }

  const scheduleWalletStateRefresh = (reason = 'refresh') => {
    // A session that was connected may pass through transient error /
    // disconnected states while TronLink switches account or network; keep
    // refreshing so the header recovers instead of trapping (WAL-HDR-1).
    const recoverable = walletWasConnectedRef.current && !walletManuallyDisconnectedRef.current
    if (walletStateRef.current.status !== 'connected' && !recoverable && reason !== 'connect') return
    updateWalletStateFromProvider(reason).catch((error) => {
      console.debug('[topHeader] failed to refresh wallet state', error)
    })
  }

  const onWalletDisconnected = () => {
    if (walletManuallyDisconnectedRef.current) return
    walletRefreshIdRef.current += 1
    walletProviderDisconnectedRef.current = getInjectedWallet()
    walletWasConnectedRef.current = false
    walletBridgeDeadRef.current = false
    invalidateWalletBridgeProbe()
    walletProbedProviderRef.current = null
    clearWalletNetworkCache()
    setWalletMenuOpen(false)
    setWalletState({ status: 'disconnected', account: '', network: '', message: WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED })
    switchDeployAndRunToVmAfterWalletDisconnect()
  }

  const onWalletConnected = () => {
    if (walletManuallyDisconnectedRef.current) return
    noteWalletProviderAlive()
    window.setTimeout(() => scheduleWalletStateRefresh('connect'), 100)
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
      onWalletDisconnected()
      return
    }
    const wasConnected = walletStateRef.current.status === 'connected'
    noteWalletProviderAlive()
    walletWasConnectedRef.current = true
    if (wasConnected) {
      setWalletState((current) => Object.assign({}, current, { account: nextAccount, message: 'Account updated' }))
    }
    window.setTimeout(() => scheduleWalletStateRefresh(wasConnected ? 'account' : 'connect'), 100)
  }

  const onWalletNetworkChanged = () => {
    if (walletManuallyDisconnectedRef.current) return
    clearWalletNetworkCache()
    window.setTimeout(() => scheduleWalletStateRefresh('network'), 100)
  }

  const onWalletMessage = (event) => {
    // TronLink's injected page bridge posts through this same window. Reject
    // messages delivered by an opener/iframe from another origin (or another
    // Window object) before interpreting any wallet action. Without both checks
    // an attacker page that opened TronIDE could forge connect/disconnect and
    // account-change UI events.
    if (!event || event.source !== window || event.origin !== window.location.origin) return
    const envelope = event && event.data ? event.data : event
    // TronLink's window-message API wraps updates as
    // { message: { action, data } }; emitter-style providers usually put the
    // action at the top level. Accept both so the header reflects the event
    // immediately instead of depending on the recurring poll.
    const data = envelope && envelope.message && typeof envelope.message === 'object' ? envelope.message : envelope
    const action = data && (data.action || data.type || data.method)
    if (!action) return
    const detail = data.data
    const detailAccount = detail && typeof detail === 'object'
      ? (detail.accounts !== undefined ? detail.accounts : (detail.account !== undefined ? detail.account : (detail.address !== undefined ? detail.address : detail.base58)))
      : detail
    const accounts = data.accounts !== undefined ? data.accounts : (data.account !== undefined ? data.account : (data.address !== undefined ? data.address : (data.base58 !== undefined ? data.base58 : detailAccount)))
    if (/accounts?Changed|setAccount|accountChanged|addressChanged/i.test(action)) onWalletAccountsChanged(accounts)
    if (/^(disconnect|disconnectWeb|rejectWeb)$/i.test(action)) onWalletDisconnected()
    else if (/chainChanged|networkChanged|setNode|nodeChanged/i.test(action)) onWalletNetworkChanged()
    else if (/^(connect|connectWeb|acceptWeb)$/i.test(action)) onWalletConnected()
  }

  const attachWalletEmitterListener = (emitter, eventName, handler, removers) => {
    if (!emitter || !eventName || !handler) return
    if (typeof emitter.on === 'function') {
      emitter.on(eventName, handler)
    } else if (typeof emitter.addListener === 'function') {
      emitter.addListener(eventName, handler)
    } else {
      return
    }
    // Only register a remover whose removal method is actually callable.
    // TronLink's tronWeb exposes `off`/`removeListener` as non-function
    // properties, and invoking them — even via optional chaining (`fn?.()`) —
    // throws "is not a function" and crashes the connect flow.
    if (typeof emitter.off === 'function') {
      removers.push(() => emitter.off(eventName, handler))
    } else if (typeof emitter.removeListener === 'function') {
      removers.push(() => emitter.removeListener(eventName, handler))
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
      ;['chainChanged', 'networkChanged', 'setNode', 'nodeChanged'].forEach((eventName) => {
        attachWalletEmitterListener(emitter, eventName, onWalletNetworkChanged, removers)
      })
      attachWalletEmitterListener(emitter, 'connect', onWalletConnected, removers)
      attachWalletEmitterListener(emitter, 'disconnect', onWalletDisconnected, removers)
    })

    walletListenerProviderRef.current = injected
    walletListenerCleanupRef.current = () => {
      removers.forEach((remove) => {
        try { remove() } catch (error) { console.debug('[topHeader] wallet listener cleanup failed', error) }
      })
      if (isSameInjectedWallet(walletListenerProviderRef.current, injected)) walletListenerProviderRef.current = null
      walletListenerCleanupRef.current = null
    }
  }

  const ensureWalletProviderListeners = () => {
    const injected = getInjectedWallet()
    if (!isSameInjectedWallet(walletListenerProviderRef.current, injected)) bindWalletProviderListeners()
    return injected
  }

  const disconnectWallet = async () => {
    walletManuallyDisconnectedRef.current = true
    walletProviderDisconnectedRef.current = getInjectedWallet()
    invalidateWalletBridgeProbe()
    setWalletManuallyDisconnected(true)
    walletWasConnectedRef.current = false
    clearWalletNetworkCache()
    setWalletMenuOpen(false)
    setWalletConnectPrompt(null)
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
    if (walletConnectInFlight) return 'Waiting for TronLink…'
    if (walletState.status === 'connected') return `${shortenTronAddress(walletState.account)} · ${walletState.network}`
    // On error keep the button compact ("Connect Wallet") — the failure reason is
    // surfaced via the toast (message.error) on click, not crammed into the label.
    return 'Connect Wallet'
  }

  const connectWallet = async () => {
    if (walletConnectInFlightRef.current) return
    walletManuallyDisconnectedRef.current = false
    invalidateWalletBridgeProbe()
    setWalletManuallyDisconnected(false)
    setWalletMenuOpen(false)
    bindWalletProviderListeners()
    const injected = getInjectedWallet()
    if (!injected.tronLink || !injected.tronWeb) {
      setWalletState({ status: 'error', account: '', network: '', message: 'TronLink is not installed' })
      setWalletConnectPrompt({
        status: 'error',
        title: 'TronLink is unavailable',
        message: 'Install or enable the TronLink extension, then try again.'
      })
      // Surface an explicit popup — the inline label is truncated by the button
      // width, so a silent error here reads as "nothing happened" to the user.
      message.error('TronLink is not installed. Install or enable the extension, then try again.')
      return
    }
    walletConnectInFlightRef.current = true
    setWalletConnectInFlight(true)
    setWalletState({ status: 'connecting', account: '', network: '', message: 'Waiting for TronLink…' })
    try {
      if (!injected.tronLink.request) throw Object.assign(new Error(WALLET_ERROR_MESSAGES.WALLET_CAPABILITY_MISSING), { code: 'WALLET_CAPABILITY_MISSING' })
      // If an account is already cached, a live bridge answers in well under the
      // liveness window, so a short timeout fails a dead/stale provider fast
      // instead of hanging "Connecting Wallet…" for the full minute. With no
      // cached account a genuine first-time approval popup may need user time,
      // so keep the full timeout there.
      const hadCachedAccount = !!getInjectedWalletAccount()
      const timeoutMs = hadCachedAccount ? WALLET_LIVENESS_TIMEOUT_MS : WALLET_CONNECT_TIMEOUT_MS
      // A persistent, actionable card is harder to miss than the old loading
      // toast and stays readable for the entire wallet wait. It also exposes the
      // real timeout instead of leaving users to guess whether the request froze.
      setWalletConnectPrompt({
        status: 'waiting',
        title: hadCachedAccount ? 'Checking TronLink' : 'Open TronLink',
        message: hadCachedAccount
          ? 'Confirm that the extension is unlocked and responding.'
          : 'Approve this site in the TronLink popup.',
        deadline: Date.now() + timeoutMs
      })
      let requestResult
      try {
        requestResult = await requestTronAccountsWithTimeout(injected.tronLink, timeoutMs)
      } catch (error) {
        if (hadCachedAccount && error && error.code === 'WALLET_REQUEST_TIMEOUT') {
          // Cached account but the bridge never answered → zombie provider.
          walletBridgeDeadRef.current = true
          walletProbedProviderRef.current = injected.tronLink
          throw Object.assign(new Error(WALLET_ERROR_MESSAGES.WALLET_NO_ACCOUNT), { code: 'WALLET_NO_ACCOUNT' })
        }
        throw error
      }
      // TronLink usually RESOLVES (rather than rejects) a denied connection,
      // returning a status object like { code: 4001 } and granting no account.
      // Treat a 4001 status — or any resolve that left us without an account — as
      // an explicit rejection, and stop here so the flow doesn't fall through to
      // connectInjectedTronWeb and fire a SECOND tron_requestAccounts.
      // We deliberately do NOT branch on tronLink.ready to report "locked": a
      // denial flips ready=false too, so that misreported the user's rejection as
      // a locked wallet (and on the first attempt, ready being undefined left the
      // user with no message at all). A genuinely locked wallet that throws an
      // explicit "unlock" error still maps to the locked message via the catch.
      const denialCode = requestResult && (requestResult.code != null ? requestResult.code : (requestResult.data && requestResult.data.code))
      if (String(denialCode || '') === '4001' || !getInjectedWalletAccount()) {
        throw Object.assign(new Error(WALLET_ERROR_MESSAGES.WALLET_CONNECTION_REJECTED), { code: '4001' })
      }
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
      walletWasConnectedRef.current = true
      // This connect completed a real round-trip, so the bridge is proven live —
      // clear any dead mark and treat this instance as already probed.
      noteWalletProviderAlive(injected.tronLink)
      setWalletState({ status: 'connected', account, network, message: 'Connected' })
      setWalletConnectPrompt(null)
    } catch (error) {
      const walletMessage = normalizeTronLinkErrorMessage(error)
      setWalletState({ status: 'error', account: '', network: '', message: walletMessage })
      setWalletConnectPrompt({
        status: 'error',
        title: 'TronLink needs attention',
        message: walletMessage
      })
      // Give visible feedback on rejection/timeout too — otherwise the only cue
      // is the truncated inline label and the user assumes the click did nothing.
      message.error(walletMessage)
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

    // Reflect a wallet that is already injected & authorized when the header
    // mounts — a page reload, or a connection made outside the header (the
    // Deploy & Run env selector, the home card). Without this the button stays
    // on "Connect Wallet" even though an account is available (WAL-HDR-2).
    if (!walletManuallyDisconnectedRef.current && getInjectedWalletAccount()) {
      updateWalletStateFromProvider('connect').catch((error) => {
        console.debug('[topHeader] initial wallet detection failed', error)
      })
    }

    const refreshFromCurrentProvider = (reason = 'refresh') => {
      if (walletManuallyDisconnectedRef.current) return
      ensureWalletProviderListeners()
      const hasUnreflectedAccount = walletStateRef.current.status !== 'connected' && !!getInjectedWalletAccount()
      scheduleWalletStateRefresh(hasUnreflectedAccount ? 'connect' : reason)
    }
    const onFocusRefresh = () => refreshFromCurrentProvider('focus')
    const onProviderAvailable = () => refreshFromCurrentProvider('connect')
    window.addEventListener('message', onWalletMessage)
    window.addEventListener('focus', onFocusRefresh)
    // TronLink can inject after the application mounts (extension startup,
    // unlock, or MV3 service-worker restart). Bind immediately when its
    // availability event is emitted; the poll below remains the fallback for
    // providers that do not emit it.
    window.addEventListener('tronLink#initialized', onProviderAvailable)
    const intervalId = window.setInterval(() => {
      if (walletManuallyDisconnectedRef.current) return
      const injected = ensureWalletProviderListeners()
      if (isSameInjectedWallet(walletProviderDisconnectedRef.current, injected)) return
      const recoverable = walletWasConnectedRef.current || walletStateRef.current.status === 'connected'
      // Promote the header when the provider already holds an account it hasn't
      // reflected yet (connection made outside the header). reason 'connect'
      // bypasses the recoverable gate in scheduleWalletStateRefresh.
      const hasUnreflectedAccount = walletStateRef.current.status !== 'connected' && !!getInjectedWalletAccount()
      if (recoverable || hasUnreflectedAccount) {
        scheduleWalletStateRefresh(hasUnreflectedAccount && !recoverable ? 'connect' : 'poll')
      }
    }, WALLET_STATUS_POLL_INTERVAL)

    return () => {
      if (walletListenerCleanupRef.current) walletListenerCleanupRef.current()
      window.removeEventListener('message', onWalletMessage)
      window.removeEventListener('focus', onFocusRefresh)
      window.removeEventListener('tronLink#initialized', onProviderAvailable)
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('tronideWalletConnectionChanged', {
        detail: { connected: walletState.status === 'connected' && Boolean(walletState.account) }
      }))
    } catch (error) {
      console.debug('[topHeader] wallet state event failed', error)
    }
  }, [walletState.status, walletState.account])

  return (
    <div className='top-header-wrapper'>
      <div className='d-flex align-items-center'>
        <div className='homeIcon' role='button' tabIndex={0} aria-label='Home' onClick={onHome} onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onHome()
          }
        }}>
          <BasicLogo />
        </div>
        <a
          className='header-version'
          data-id='headerVersionBadge'
          href={RELEASE_NOTES_URL}
          target='_blank'
          rel='noopener noreferrer'
          title='Open release notes in a new tab'
        >
          v{version}
        </a>
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
              <i className='fas fa-plus'></i><span>Create a new workspace</span>
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
      <div className='header-right-cluster d-flex align-items-center'>
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
        <div className='header-help-actions d-flex align-items-center' data-id='headerHelpActions'>
          <Tooltip title='Release Notes'>
            <a className='settings-icon-wrapper' data-id='headerReleaseNotes' aria-label='Open Release Notes in a new tab' href={RELEASE_NOTES_URL} target='_blank' rel='noopener noreferrer'>
              <i className='fas fa-bullhorn' aria-hidden='true'></i>
            </a>
          </Tooltip>
          <Tooltip title='Report an issue / Feedback'>
            <button className='settings-icon-wrapper' data-id='headerReportIssue' aria-label='Report an issue on GitHub' onClick={() => { try { window.open('https://github.com/tronweb3/TronIDE/issues', '_blank', 'noopener,noreferrer') } catch (e) { console.debug('[topHeader] open issues failed', e) } }}>
              <i className='fas fa-bug' aria-hidden='true'></i>
            </button>
          </Tooltip>
        </div>
        <div className='header-actions'>
          <div className='header-github-action' ref={githubMenuRef}>
            <button
              className='header-action-btn'
              data-id='headerGithubConnect'
              title={githubState.connected ? `GitHub: ${githubState.login || 'connected'}` : 'Connect GitHub'}
              aria-haspopup={githubState.connected ? 'menu' : undefined}
              aria-expanded={githubState.connected ? githubMenuOpen : undefined}
              onClick={githubState.connected ? () => setGithubMenuOpen(!githubMenuOpen) : connectGithub}
            >
              <i className='fab fa-github header-action-icon'></i>
              <span>{githubState.connected ? (githubState.login || 'GitHub') : 'Connect GitHub'}</span>
            </button>
            {githubMenuOpen && githubState.connected &&
              <div className='header-github-menu' data-id='headerGithubMenu' role='menu'>
                <div className='github-menu-title'>GitHub</div>
                <div className='github-menu-row'>
                  <span>Account</span>
                  <strong data-id='headerGithubAccount' title={githubState.login}>{githubState.login || 'Connected'}</strong>
                </div>
                <div className='github-menu-actions'>
                  <button type='button' data-id='headerGithubReconnect' onClick={reconnectGithub}>Reconnect</button>
                  <button type='button' data-id='headerGithubDisconnect' onClick={onGithubDisconnect}>Disconnect</button>
                </div>
              </div>
            }
          </div>
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
              <i className='fas fa-wallet header-action-icon' aria-hidden='true'></i>
              <span>{renderWalletLabel()}</span>
            </button>
            {walletConnectPrompt && walletState.status !== 'connected' &&
              <div
                className={`header-wallet-connect-prompt ${walletConnectPrompt.status === 'error' ? 'is-error' : ''}`}
                data-id='headerWalletConnectPrompt'
                role={walletConnectPrompt.status === 'error' ? 'alert' : 'status'}
                aria-live='polite'
              >
                <div className='wallet-connect-prompt-heading'>
                  <i className='fas fa-wallet' aria-hidden='true'></i>
                  <strong>{walletConnectPrompt.title}</strong>
                </div>
                <div className='wallet-connect-prompt-message'>{walletConnectPrompt.message}</div>
                {walletConnectPrompt.status === 'waiting'
                  ? <div className='wallet-connect-prompt-countdown' data-id='headerWalletConnectCountdown'>
                    {walletConnectSecondsRemaining}s remaining
                  </div>
                  : <div className='wallet-connect-prompt-actions'>
                    <button type='button' data-id='headerWalletConnectRetry' onClick={connectWallet}>Open TronLink &amp; retry</button>
                    <button type='button' data-id='headerWalletConnectDismiss' onClick={() => setWalletConnectPrompt(null)}>Dismiss</button>
                  </div>
                }
              </div>
            }
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
            <svg onClick={showAiPopup} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                showAiPopup()
              }
            }} className={'a-icon ai-show-btn'} role='button' tabIndex={0} aria-label='Show TRON IDE AI Assistant'>
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
            {unreadNotificationCount ? <span className='notification-badge'>{unreadNotificationCount}</span> : null}
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
      </div>
    </div>
  )
}
