/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

// Keep every IDE entry point on one same-origin, standalone document. A
// relative URL also keeps GitHub Pages/sub-path deployments working.
export const RELEASE_NOTES_URL = 'release-notes.html'

export function isReleaseNotesPage (pathname) {
  return /(?:^|\/)release-notes\.html$/.test(String(pathname || ''))
}
