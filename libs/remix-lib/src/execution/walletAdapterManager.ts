import { getInjectedWalletStatus, normalizeWalletError, requestInjectedWalletAccounts, WALLET_STATUS, WalletStatus } from './walletProviderAdapter'

export type WalletAdapterKind = 'tronlink' | 'okx' | 'walletconnect' | 'metamask-tron' | 'unknown'

export interface WalletAdapterCapability {
  detect: boolean
  connect: boolean
  disconnect: boolean
  sign: boolean
  broadcast: boolean
  accountChanged: boolean
  chainChanged: boolean
}

export interface WalletAdapterDescriptor {
  kind: WalletAdapterKind
  name: string
  status: WalletStatus
  capabilities: WalletAdapterCapability
  account?: string
  network?: string
  enabled: boolean
  reason?: string
}

export interface WalletAdapterManagerState {
  active?: WalletAdapterDescriptor
  adapters: WalletAdapterDescriptor[]
}

export const DEFAULT_WALLET_CAPABILITY: WalletAdapterCapability = {
  detect: false,
  connect: false,
  disconnect: false,
  sign: false,
  broadcast: false,
  accountChanged: false,
  chainChanged: false
}

function capability (overrides: Partial<WalletAdapterCapability>): WalletAdapterCapability {
  return { ...DEFAULT_WALLET_CAPABILITY, ...overrides }
}

export function detectWalletAdapters (scope: any = typeof window !== 'undefined' ? window : undefined): WalletAdapterDescriptor[] {
  const tronStatus = getInjectedWalletStatus(scope)
  const tronWeb = scope?.tronWeb
  const tronLink = scope?.tronLink
  const okx = scope?.okxwallet?.tronLink || scope?.okxwallet?.tronWeb || scope?.okxWallet?.tronLink
  const ethereum = scope?.ethereum

  const adapters: WalletAdapterDescriptor[] = [
    {
      kind: 'tronlink',
      name: 'TronLink',
      status: tronStatus,
      account: tronWeb?.defaultAddress?.base58,
      enabled: tronStatus !== WALLET_STATUS.unavailable,
      capabilities: capability({
        detect: Boolean(tronLink || tronWeb),
        connect: Boolean(tronLink?.request),
        disconnect: true,
        sign: Boolean(tronWeb?.trx?.sign),
        broadcast: Boolean(tronWeb?.trx?.sendRawTransaction),
        accountChanged: true,
        chainChanged: true
      })
    },
    {
      kind: 'okx',
      name: 'OKX Wallet',
      status: okx ? WALLET_STATUS.disconnected : WALLET_STATUS.unavailable,
      enabled: Boolean(okx),
      reason: okx ? 'Detected. Enable behind feature flag before production use.' : 'Not detected.',
      capabilities: capability({ detect: Boolean(okx), connect: Boolean(okx?.request), accountChanged: Boolean(okx), chainChanged: Boolean(okx) })
    },
    {
      kind: 'walletconnect',
      name: 'WalletConnect',
      status: WALLET_STATUS.unavailable,
      enabled: false,
      reason: 'Behind feature flag. Requires session and chain configuration.',
      capabilities: capability({ connect: true, disconnect: true, sign: true, broadcast: true })
    },
    {
      kind: 'metamask-tron',
      name: 'MetaMask TRON',
      status: ethereum ? WALLET_STATUS.disconnected : WALLET_STATUS.unavailable,
      enabled: false,
      reason: 'Compatibility research only. Not enabled by default.',
      capabilities: capability({ detect: Boolean(ethereum), connect: Boolean(ethereum?.request), accountChanged: Boolean(ethereum), chainChanged: Boolean(ethereum) })
    }
  ]

  return adapters
}

export function createWalletAdapterManagerState (scope: any = typeof window !== 'undefined' ? window : undefined): WalletAdapterManagerState {
  const adapters = detectWalletAdapters(scope)
  const active = adapters.find((adapter) => adapter.kind === 'tronlink' && adapter.status === WALLET_STATUS.connected) || adapters.find((adapter) => adapter.enabled)
  return { active, adapters }
}

export async function connectWalletAdapter (kind: WalletAdapterKind, scope: any = typeof window !== 'undefined' ? window : undefined): Promise<string[]> {
  if (kind === 'tronlink') return requestInjectedWalletAccounts(scope)
  throw Object.assign(new Error(normalizeWalletError(new Error('Wallet action unsupported')).message), normalizeWalletError(new Error('Wallet action unsupported')))
}
