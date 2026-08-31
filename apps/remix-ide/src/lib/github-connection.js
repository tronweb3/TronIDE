/*
 * Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 */

'use strict'

import * as githubAuth from './github-auth'
import { revokeSession } from './github-bff'

const globalRegistry = require('../global/registry')

/**
 * Disconnect the current BFF session and scrub every legacy browser token sink.
 * Local state is cleared first so a network failure can never leave the UI
 * connected. The remote session revocation is best-effort and never exposes the
 * GitHub token to this module.
 */
export function disconnectGithub () {
  const session = githubAuth.getSession()
  githubAuth.clearSession()

  try { window.localStorage.removeItem('tronide.github.token') } catch (error) { console.debug('[githubConnection] clear ls token', error) }
  try { window.localStorage.removeItem('tronide.github.user') } catch (error) { console.debug('[githubConnection] clear ls user', error) }
  try { window.localStorage.removeItem('tronide.github.session') } catch (error) { console.debug('[githubConnection] clear ls session', error) }
  try { window.sessionStorage.removeItem('tronide.github.token') } catch (error) { console.debug('[githubConnection] clear ss token', error) }
  try { globalRegistry.get('config').api.set('settings/gist-access-token', '') } catch (error) { console.debug('[githubConnection] clear settings gist token', error) }

  revokeSession(session).catch((error) => {
    console.debug('[githubConnection] remote BFF session revocation failed', error)
  })
}
