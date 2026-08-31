import { test, expect } from '@playwright/test'
import { gotoHome, dismissWelcomeModal } from './helpers'

// J-003 (dogfooding, v2.3.2): a fresh boot used to always land on the
// alphabetically-first workspace (default_workspace) while the compiler
// version DID persist — inconsistent. The last-used workspace is now
// remembered (workspaceFileProvider.setWorkspace -> lib/last-workspace) and
// the file panel prefers it at boot when it still exists. The marker is
// per-tab first (sessionStorage) with a cross-session localStorage fallback,
// and transient link-landing workspaces never claim it. Durable IndexedDB
// storage now permits only one writable tab, so cross-tab coverage verifies an
// explicit writer handoff rather than concurrent workspace switching.

test.describe('Workspace restore across sessions', () => {
  test('TC-WS-RESTORE-1: the last-used workspace is restored after a reload', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)

    // create a second workspace; creation switches to it, which persists the marker
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('restore-probe')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('restore-probe', { timeout: 15_000 })

    // a reload runs the same boot path as a fresh browser session — it must
    // land back on restore-probe, not on default_workspace
    await page.reload()
    await dismissWelcomeModal(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('restore-probe', { timeout: 30_000 })

    // and if the remembered workspace disappears, boot falls back gracefully:
    // point the marker (BOTH levels — the per-tab copy wins otherwise) at a
    // workspace that does not exist, reload
    await page.evaluate(() => {
      window.localStorage.setItem('tronide.lastWorkspace', 'no-such-workspace')
      window.sessionStorage.setItem('tronide.lastWorkspace', 'no-such-workspace')
    })
    await page.reload()
    await dismissWelcomeModal(page)
    const fallback = await page.locator('select[data-id="workspacesSelect"]').inputValue()
    expect(['default_workspace', 'restore-probe']).toContain(fallback)
  })

  // The transient gist-sample landing must not hijack the boot workspace: one
  // click on a shared #gist= link (whose fetch may even fail) used to stamp
  // gist-sample as last-used, and every later plain visit booted into the
  // (possibly empty) sample instead of the user's real workspace.
  test('TC-WS-RESTORE-2: landing on a #gist= link does not hijack the boot workspace', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('default_workspace', { timeout: 15_000 })

    // land on a shared gist link whose fetch FAILS (offline by construction);
    // goto+reload because a hash-only change is a same-document navigation
    await page.route('**/gists/**', (route) => route.abort())
    await page.goto('/#gist=0123456789abcdef0123456789abcdef')
    await page.reload()
    await dismissWelcomeModal(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('gist-sample', { timeout: 30_000 })

    // the transient landing never claims the restore marker…
    const marker = await page.evaluate(() => ({
      local: window.localStorage.getItem('tronide.lastWorkspace'),
      session: window.sessionStorage.getItem('tronide.lastWorkspace')
    }))
    expect(marker.local).toBe('default_workspace')
    expect(marker.session).toBe('default_workspace')

    // …so a plain visit boots back into the real workspace, not the sample
    await page.goto('/')
    await page.reload()
    await dismissWelcomeModal(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('default_workspace', { timeout: 30_000 })
  })

  // IndexedDB-backed workspaces are single-writer. A second tab must remain on
  // the recovery splash until the active writer closes; after Retry it should
  // restore the latest durable workspace instead of booting an arbitrary one.
  test('TC-WS-RESTORE-3: writer handoff restores the latest workspace after another tab closes', { tag: '@gate' }, async ({ context, page }) => {
    await gotoHome(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('default_workspace', { timeout: 15_000 })

    // A second tab is blocked while the first writer owns the workspace lock.
    const pageB = await context.newPage()
    await pageB.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(pageB.locator('#tronide-initial-status')).toContainText('already open in another tab', { timeout: 15_000 })

    // Closing A and retrying transfers the writer lock to B. The existing
    // cross-session marker still restores the durable default workspace.
    await page.close()
    await pageB.locator('[data-id="workspaceStorageRetry"]').click()
    await dismissWelcomeModal(pageB)
    await pageB.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await expect(pageB.locator('select[data-id="workspacesSelect"]')).toHaveValue('default_workspace', { timeout: 15_000 })

    // B creates and switches to its own workspace, updating the shared fallback.
    await pageB.locator('[data-id="workspaceCreate"]').click()
    const nameInput = pageB.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('tab-b-workspace')
    await pageB.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(pageB.locator('select[data-id="workspacesSelect"]')).toHaveValue('tab-b-workspace', { timeout: 15_000 })

    // C is blocked until B closes, then receives the same explicit handoff and
    // restores B's latest durable workspace.
    const pageC = await context.newPage()
    await pageC.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(pageC.locator('#tronide-initial-status')).toContainText('already open in another tab', { timeout: 15_000 })
    await pageB.close()
    await pageC.locator('[data-id="workspaceStorageRetry"]').click()
    await dismissWelcomeModal(pageC)
    await pageC.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await expect(pageC.locator('select[data-id="workspacesSelect"]')).toHaveValue('tab-b-workspace', { timeout: 30_000 })

    await pageC.close()
  })
})
