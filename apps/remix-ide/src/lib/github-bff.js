/*
 * Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

'use strict'

import * as githubAuth from './github-auth.js'

const BFF_BASE_URL = String(process.env.TRONIDE_GITHUB_BFF_ORIGIN || '').replace(/\/+$/, '')

function messageOrigin (baseUrl) {
  if (!baseUrl) return ''
  try {
    return new URL(baseUrl).origin
  } catch (_error) {
    return ''
  }
}

export const GITHUB_BFF = {
  // The legacy environment-variable name says "origin", but the configured
  // value may include a reverse-proxy path prefix.
  baseUrl: BFF_BASE_URL,
  messageOrigin: messageOrigin(BFF_BASE_URL),
  sessionHeader: 'X-TronIDE-Session'
}

function bffUrl (path) {
  const normalized = String(path || '')
  if (!GITHUB_BFF.baseUrl || !GITHUB_BFF.messageOrigin) throw new Error('GitHub BFF is not configured.')
  if (!normalized.startsWith('/')) throw new Error('GitHub BFF path must be absolute.')
  return GITHUB_BFF.baseUrl + normalized
}

function sessionHeaders (session, headers) {
  const result = new Headers(headers || {})
  const handle = String(session || '').trim()
  if (handle) result.set(GITHUB_BFF.sessionHeader, handle)
  return result
}

/**
 * Make a request to the TronIDE BFF with the current opaque session handle.
 * @param {string} path
 * @param {RequestInit & { session?: string }} [options]
 */
export async function request (path, options = {}) {
  const session = options.session === undefined ? githubAuth.getSession() : options.session
  const init = Object.assign({}, options, {
    headers: sessionHeaders(session, options.headers),
    redirect: 'error'
  })
  delete init.session
  const response = await window.fetch(bffUrl(path), init)
  // Do not leave an expired/revoked handle advertised as connected. An
  // explicit request may target an old handle during reconnect/disconnect; in
  // that case, never clear the newer current session.
  if (response.status === 401 && session && githubAuth.getSession() === session) {
    githubAuth.clearSession()
  }
  return response
}

/** Fail closed when the independently deployed OAuth service is still legacy. */
export async function assertBffReady () {
  let response
  try {
    response = await window.fetch(bffUrl('/capabilities'), {
      headers: { Accept: 'application/json' },
      redirect: 'error'
    })
  } catch (_error) {
    throw new Error('GitHub connection is temporarily unavailable while its secure backend is being upgraded.')
  }
  if (!response.ok) {
    throw new Error('GitHub connection is temporarily unavailable while its secure backend is being upgraded.')
  }
  const capabilities = await response.json().catch(() => null)
  const validProvider = capabilities && ['oauth_app', 'github_app'].includes(capabilities.authProvider)
  const validGithubApp = capabilities && capabilities.authProvider === 'github_app'
    ? capabilities.repositoryInstallationRequired === true && /^[A-Za-z0-9-]{1,100}$/.test(String(capabilities.githubAppSlug || ''))
    : capabilities && capabilities.repositoryInstallationRequired === false
  if (!capabilities || capabilities.authMode !== 'bff-v1' || capabilities.githubTokenInBrowser !== false || !validProvider || !validGithubApp) {
    throw new Error('GitHub connection is temporarily unavailable while its secure backend is being upgraded.')
  }
  return capabilities
}

/**
 * Read the current user's verified GitHub App installations. During the staged
 * OAuth App cutover the BFF returns required=false, so existing deployments do
 * not gain a repository-installation requirement prematurely.
 */
export async function getGithubInstallations () {
  if (!githubAuth.getSession()) return null
  const response = await request('/installations', { method: 'GET' })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const error = new Error(payload.error === 'authorization_revoked'
      ? 'GitHub authorization was revoked. Connect GitHub again.'
      : 'GitHub App installation status is temporarily unavailable.')
    error.status = response.status
    error.code = payload.error || 'installation_status_unavailable'
    throw error
  }
  return response.json()
}

/** Verify access to one exact repository without exposing a general API proxy. */
export async function getGithubRepositoryAccess (owner, repo) {
  if (!githubAuth.getSession()) throw new Error('Connect GitHub first.')
  const validPart = (value) => /^[A-Za-z0-9_.-]{1,100}$/.test(String(value || ''))
  if (!validPart(owner) || !validPart(repo)) throw new Error('Invalid GitHub repository.')
  const path = '/repository-access?' + new URLSearchParams({ owner: String(owner), repo: String(repo) }).toString()
  const response = await request(path, { method: 'GET' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error === 'authorization_revoked'
      ? 'GitHub authorization was revoked. Connect GitHub again.'
      : 'GitHub repository access could not be verified.')
    error.status = response.status
    error.code = payload.error || 'repository_access_unavailable'
    throw error
  }
  return payload
}

/** Open GitHub's pinned installation page without granting it opener access. */
export function openGithubAppInstallation (installUrl) {
  const target = new URL(String(installUrl || ''))
  if (target.protocol !== 'https:' || target.hostname !== 'github.com' || !/^\/apps\/[A-Za-z0-9-]+\/installations\/new$/.test(target.pathname)) {
    throw new Error('GitHub App installation URL is unavailable.')
  }
  window.open(target.toString(), '_blank', 'noopener,noreferrer')
}

/** Route an allow-listed GitHub REST path through the BFF. */
export function githubRequest (path, options = {}) {
  if (!githubAuth.getSession()) return Promise.reject(new Error('Connect GitHub first.'))
  const normalized = String(path || '')
  if (!normalized.startsWith('/')) return Promise.reject(new Error('Invalid GitHub API path.'))
  return request('/api' + normalized, options)
}

/** Convert GitHub App repository denials into an actionable product error. */
export async function githubRepositoryRequest (path, options = {}) {
  const response = await githubRequest(path, options)
  if (response.status !== 403 && response.status !== 404) return response

  const match = String(path || '').match(/^\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\//)
  if (!match) return response
  const access = await getGithubRepositoryAccess(match[1], match[2])
  if (!access || !access.required || access.accessible) return response
  const error = new Error(access.installed
    ? 'This repository is not selected for the TronIDE GitHub App. Manage repository access, then try again.'
    : 'Grant TronIDE access to this repository, then try again.')
  error.code = access.installed ? 'repository_not_selected' : 'installation_required'
  error.status = response.status
  error.installUrl = access.installUrl || ''
  throw error
}

/** Validate and hydrate the current BFF session. */
export async function validateSession () {
  if (!githubAuth.getSession()) return null
  const response = await request('/session', { method: 'GET' })
  if (!response.ok) {
    if (response.status === 401) githubAuth.clearSession()
    return null
  }
  const state = await response.json()
  githubAuth.setLogin(state.login || '')
  return state
}

/** Revoke a BFF session. The caller clears local state even when this fails. */
export function revokeSession (session) {
  const handle = String(session || '').trim()
  if (!handle) return Promise.resolve()
  return request('/session', { method: 'DELETE', session: handle }).then(() => undefined)
}
