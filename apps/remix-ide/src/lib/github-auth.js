/*
 * Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

'use strict'

/**
 * Tab-scoped TronIDE BFF session store.
 *
 * The browser stores only an opaque, origin-bound TronIDE session handle. The
 * GitHub access token is encrypted in the server-side BFF and is never returned
 * to this module, web storage, frontend state, or browser request headers.
 */

const SESSION_KEY = 'tronide.github.session'
const USER_KEY = 'tronide.github.user'
const LEGACY_TOKEN_KEY = 'tronide.github.token'

function readSession (key) {
  try {
    return typeof window !== 'undefined' && window.sessionStorage
      ? String(window.sessionStorage.getItem(key) || '').trim()
      : ''
  } catch (error) {
    console.debug(`[githubAuth] failed to read ${key} from tab session`, error)
    return ''
  }
}

function writeSession (key, value) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return
    if (value) window.sessionStorage.setItem(key, value)
    else window.sessionStorage.removeItem(key)
  } catch (error) {
    console.debug(`[githubAuth] failed to persist ${key} for this tab`, error)
  }
}

// Never migrate a legacy GitHub token into the BFF session slot. Remove it on
// module load so an upgrade immediately closes the old credential channel.
writeSession(LEGACY_TOKEN_KEY, '')
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY)
    window.localStorage.removeItem(USER_KEY)
    window.localStorage.removeItem(SESSION_KEY)
  }
} catch (error) {
  console.debug('[githubAuth] failed to scrub legacy persistent GitHub state', error)
}
let _session = readSession(SESSION_KEY)
let _login = _session ? readSession(USER_KEY) : ''
if (!_session) writeSession(USER_KEY, '')
const _listeners = new Set()

function notify () {
  for (const cb of Array.from(_listeners)) {
    try {
      cb({ connected: !!_session, login: _login })
    } catch (error) {
      console.debug('[githubAuth] onChange listener threw', error)
    }
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('tronideGithubConnectionChanged'))
    }
  } catch (error) {
    console.debug('[githubAuth] failed to dispatch github-changed event', error)
  }
}

/** @returns {string} opaque TronIDE BFF session handle, or ''. */
export function getSession () {
  return _session
}

/** @returns {boolean} whether this tab has a BFF session handle. */
export function isConnected () {
  return !!_session
}

/** @returns {string} verified GitHub login, or ''. */
export function getLogin () {
  return _login
}

/**
 * Store the opaque BFF session and verified login for this tab.
 * @param {string} session
 * @param {string} [login]
 */
export function setSession (session, login) {
  _session = String(session || '').trim()
  if (login !== undefined) _login = String(login || '').trim()
  writeSession(SESSION_KEY, _session)
  writeSession(USER_KEY, _session ? _login : '')
  writeSession(LEGACY_TOKEN_KEY, '')
  notify()
}

/** @param {string} [login] */
export function setLogin (login) {
  _login = String(login || '').trim()
  writeSession(USER_KEY, _session ? _login : '')
  notify()
}

/** Clear the local BFF session handle and identity. */
export function clearSession () {
  _session = ''
  _login = ''
  writeSession(SESSION_KEY, '')
  writeSession(USER_KEY, '')
  writeSession(LEGACY_TOKEN_KEY, '')
  notify()
}

/** @param {(state: { connected: boolean, login: string }) => void} cb */
export function onChange (cb) {
  if (typeof cb === 'function') _listeners.add(cb)
}

/** @param {Function} cb */
export function offChange (cb) {
  _listeners.delete(cb)
}
