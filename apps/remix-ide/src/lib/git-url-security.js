'use strict'

// TronIDE's browser Git transport is pinned to the GitHub HTTPS proxy. Keep
// URL validation at both the UI and provider boundaries: a caller must not be
// able to turn a generic Git permission into an arbitrary network request.
const GITHUB_REPOSITORY = /^\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*?)(\.git)?$/

function normalizeGithubRemoteUrl (raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('A GitHub repository URL is required.')
  let parsed
  try {
    parsed = new URL(raw.trim())
  } catch (error) {
    throw new Error('Enter a full https://github.com/owner/repo.git URL.')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Only public GitHub HTTPS repository URLs are supported (https://github.com/owner/repo.git).')
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  const match = GITHUB_REPOSITORY.exec(pathname)
  if (!match) throw new Error('Use a GitHub repository URL in the form https://github.com/owner/repo.git.')
  return `https://github.com/${match[1]}/${match[2]}${match[3] || ''}`
}

// Remote URLs are shown in the Git panel and can come from an old repository
// created before the HTTPS-only policy. Remove credentials without trying to
// reinterpret legacy SSH URLs; provider network operations still validate any
// URL they receive before using it.
function redactRemoteUrl (raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString().replace(/\/$/, '')
  } catch (error) {
    return value.replace(/^(?:[a-z][a-z0-9+.-]*:\/\/|[^@\s]+@)/i, (prefix) => prefix.includes('@') ? '' : prefix)
  }
}

module.exports = {
  normalizeGithubRemoteUrl,
  redactRemoteUrl
}
