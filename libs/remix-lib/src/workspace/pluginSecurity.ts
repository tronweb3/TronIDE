export interface LocalPluginValidationResult {
  ok: boolean
  normalizedUrl?: string
  warnings: string[]
  errors: string[]
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])
export const DEFAULT_REMOTE_PLUGIN_ALLOWLIST: string[] = []

/**
 * @deprecated Remote local-plugin hosts are disabled. This compatibility shim
 * intentionally returns false so older consumers fail closed.
 */
export function isRemotePluginHostAllowed (_hostname: string, _allowlist: string[] = DEFAULT_REMOTE_PLUGIN_ALLOWLIST): boolean {
  return false
}

export function validateLocalPluginUrl (
  rawUrl: string,
  remoteAllowlistOrTransport: string[] | string = DEFAULT_REMOTE_PLUGIN_ALLOWLIST,
  explicitTransport: string = 'iframe'
): LocalPluginValidationResult {
  const warnings: string[] = []
  const errors: string[] = []
  // Keep the historical allowlist argument source-compatible, but ignore it:
  // remote plugin URLs are disabled. New callers may pass the transport as the
  // second argument; legacy callers can pass it as the third argument.
  const transport = typeof remoteAllowlistOrTransport === 'string' ? remoteAllowlistOrTransport : explicitTransport

  if (!rawUrl || !rawUrl.trim()) {
    return { ok: false, warnings, errors: ['Local plugin URL is required.'] }
  }

  if (transport !== 'iframe' && transport !== 'ws') {
    return { ok: false, warnings, errors: ['Local plugin connection type must be iframe or ws.'] }
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
  const isWss = parsed.protocol === 'wss:'
  const isWs = parsed.protocol === 'ws:'

  if (transport === 'iframe' && !isHttps && !isHttp) {
    errors.push('Local plugin URL must use http(s).')
  } else if (transport === 'ws' && !isWss && !isWs) {
    errors.push('Local WebSocket plugin URL must use ws(s).')
  } else if (isHttp && !isLocalhost) {
    errors.push('HTTP local plugin URLs are only allowed for localhost.')
  } else if (isHttps && !isLocalhost) {
    errors.push('Remote plugin URLs are disabled. Use localhost, 127.0.0.1, or ::1.')
  } else if ((isWs || isWss) && !isLocalhost) {
    errors.push('Remote WebSocket plugin URLs are disabled. Use localhost, 127.0.0.1, or ::1.')
  }

  if (errors.length === 0 && isLocalhost) {
    warnings.push('Only connect local plugins you trust. They can interact with your workspace.')
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
