export interface LocalPluginValidationResult {
  ok: boolean
  normalizedUrl?: string
  warnings: string[]
  errors: string[]
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])
export const DEFAULT_REMOTE_PLUGIN_ALLOWLIST = ['plugins.tronide.io', 'plugins.tron.network']

function normalizeAllowlist (allowlist: string[] = DEFAULT_REMOTE_PLUGIN_ALLOWLIST): string[] {
  return allowlist.map((host) => host.trim().toLowerCase()).filter(Boolean)
}

export function isRemotePluginHostAllowed (hostname: string, allowlist: string[] = DEFAULT_REMOTE_PLUGIN_ALLOWLIST): boolean {
  const normalizedHost = hostname.toLowerCase()
  return normalizeAllowlist(allowlist).some((entry) => normalizedHost === entry || normalizedHost.endsWith(`.${entry}`))
}

export function validateLocalPluginUrl (rawUrl: string, remoteAllowlist: string[] = DEFAULT_REMOTE_PLUGIN_ALLOWLIST): LocalPluginValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  if (!rawUrl || !rawUrl.trim()) {
    return { ok: false, warnings, errors: ['Local plugin URL is required.'] }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (error) {
    return { ok: false, warnings, errors: ['Local plugin URL is invalid.'] }
  }

  // URL.hostname brackets IPv6 literals (e.g. "[::1]"); strip them so loopback matches.
  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
  const isLocalhost = LOCAL_HOSTNAMES.has(hostname)
  const isHttps = parsed.protocol === 'https:'
  const isHttp = parsed.protocol === 'http:'
  const isApprovedRemote = isHttps && isRemotePluginHostAllowed(parsed.hostname, remoteAllowlist)

  if (!isHttps && !isHttp) {
    errors.push('Local plugin URL must use http(s).')
  } else if (isHttp && !isLocalhost) {
    errors.push('HTTP local plugin URLs are only allowed for localhost.')
  } else if (isHttps && !isLocalhost && !isApprovedRemote) {
    errors.push(`Remote plugin URL must be approved before activation. Allowed hosts: ${normalizeAllowlist(remoteAllowlist).join(', ') || '(none)'}.`)
  }

  if (errors.length === 0 && isLocalhost) {
    warnings.push('Only connect local plugins you trust. They can interact with your workspace.')
  }

  if (errors.length === 0 && isApprovedRemote) {
    warnings.push('Approved remote plugin URL — review permissions before enabling.')
  }

  return {
    ok: errors.length === 0,
    normalizedUrl: parsed.toString(),
    warnings,
    errors
  }
}

export function summarizePluginPermissions (permissions: string[] = []): string[] {
  return permissions.map((permission) => {
    if (permission.includes('file')) return `${permission}: can access workspace files`
    if (permission.includes('network')) return `${permission}: can access network resources`
    if (permission.includes('terminal')) return `${permission}: can write to terminal output`
    return `${permission}: review before enabling`
  })
}
