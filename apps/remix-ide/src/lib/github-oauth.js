/*
 * Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

/**
 * Start the server-owned GitHub OAuth flow.
 *
 * The BFF generates and validates OAuth state + PKCE, exchanges the code,
 * verifies /user, encrypts the GitHub token in KV, and postMessages only an
 * opaque TronIDE session handle. The browser never receives a GitHub token.
 */

import { assertBffReady, GITHUB_BFF } from './github-bff'

export const GITHUB_OAUTH = {
  proxyOrigin: GITHUB_BFF.messageOrigin,
  get startUrl () { return GITHUB_BFF.baseUrl + '/oauth/start' }
}

function randomChannel () {
  const bytes = new Uint8Array(24)
  ;(window.crypto || window.msCrypto).getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

/**
 * @returns {Promise<{ session: string, login: string, userId: number, expiresAt: number }>}
 */
export function connectWithGithubOAuth () {
  return new Promise((resolve, reject) => {
    let capabilities = null
    const channel = randomChannel()
    const start = `${GITHUB_OAUTH.startUrl}?` + new URLSearchParams({
      origin: window.location.origin,
      channel
    }).toString()

    const width = 720
    const height = 720
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
    // Open synchronously to satisfy popup blockers, but do not send users to a
    // legacy proxy that would expose a GitHub token to the browser.
    const popup = window.open('about:blank', 'tronide-github-oauth-' + channel,
      `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`)
    if (!popup) return reject(new Error('Popup blocked — allow popups for this site, then try again.'))

    let settled = false
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      clearInterval(closedTimer)
      clearTimeout(hardTimeout)
    }
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      cleanup()
      try { popup.close() } catch (error) { console.debug('[githubOAuth] popup close failed', error) }
      fn(arg)
    }
    const onMessage = (event) => {
      if (event.origin !== GITHUB_OAUTH.proxyOrigin || event.source !== popup) return
      const data = event.data
      if (!data || data.source !== 'tronide-github-oauth' || data.channel !== channel) return
      if (data.error) return finish(reject, new Error('GitHub authorization failed: ' + data.error))
      if (!/^[A-Za-z0-9_-]{43}$/.test(String(data.session || ''))) {
        return finish(reject, new Error('GitHub authorization returned an invalid BFF session.'))
      }
      if (!data.login || !Number.isSafeInteger(Number(data.userId)) || Number(data.userId) <= 0) {
        return finish(reject, new Error('GitHub authorization returned an unverified identity.'))
      }
      finish(resolve, {
        session: String(data.session),
        login: String(data.login || ''),
        userId: Number(data.userId || 0),
        expiresAt: Number(data.expiresAt || 0),
        authProvider: capabilities && capabilities.authProvider ? capabilities.authProvider : 'oauth_app',
        repositoryInstallationRequired: !!(capabilities && capabilities.repositoryInstallationRequired),
        githubAppSlug: capabilities && capabilities.githubAppSlug ? capabilities.githubAppSlug : ''
      })
    }
    window.addEventListener('message', onMessage)

    const closedTimer = setInterval(() => {
      if (popup.closed) finish(reject, new Error('GitHub connection cancelled.'))
    }, 500)
    const hardTimeout = setTimeout(() => finish(reject, new Error('GitHub connection timed out.')), 120000)

    assertBffReady()
      .then((readyCapabilities) => {
        capabilities = readyCapabilities
        if (popup.closed) return finish(reject, new Error('GitHub connection cancelled.'))
        popup.location.replace(start)
      })
      .catch((error) => finish(reject, error))
  })
}
