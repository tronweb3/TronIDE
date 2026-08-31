import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, seedGithubBffSession } from './helpers'

// TC-GIT-R1/R2/R3 (v2.3.2 remote-git): the Git panel exposes Clone (into a new
// workspace) + Add-remote + Push/Pull against a GitHub remote, routed through
// the Deno CORS proxy (services/github-oauth /git). Remix auto-git-inits every
// workspace, so Clone is offered in the normal (initialized) panel and clones
// into a FRESH workspace rather than the current one.
//
// R1 is deterministic local UI. R2/R3 use a tiny public multi-branch repo and
// depend on the deployed proxy + github.com — together they guard clone, Add
// remote, all-ref fetch, and remote-tracking checkout wiring.

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function openGitPanel (page: Page) {
  await page.locator('#icon-panel div[plugin="gitPanel"]').click()
  await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
}

async function connectFakeGithubSession (page: Page) {
  // Keep this destructive-action test independent of whichever BFF origin the
  // frontend was built with. A real local/deployed BFF correctly rejects the
  // synthetic handle and clears it during reload; mock session and installation
  // hydration (including CORS preflights) before seeding so the fixture remains
  // an opaque TronIDE session rather than accidentally depending on a DNS error.
  await page.route('**/session', (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': request.headers().origin || new URL(page.url()).origin,
          'access-control-allow-methods': 'GET, DELETE, OPTIONS',
          'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'x-tronide-session'
        }
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': request.headers().origin || new URL(page.url()).origin },
      body: JSON.stringify({ login: 'force-push-tester', repositoryInstallationRequired: false })
    })
  })
  await page.route('**/installations', (route) => {
    const request = route.request()
    const corsHeaders = {
      'access-control-allow-origin': request.headers().origin || new URL(page.url()).origin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'x-tronide-session'
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ provider: 'oauth_app', required: false, installed: true, installations: [] })
    })
  })
  await seedGithubBffSession(page, 'force-push-tester', { mockBff: false })
  const advanced = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if ((await advanced.getAttribute('aria-expanded')) === 'false') await advanced.click()
  await expect(page.locator('[data-id="landingGithubTokenDisconnect"]')).toBeVisible({ timeout: 10_000 })
}

test.describe('Git panel (remote)', () => {
  test('TC-GIT-R1: Clone + Add-remote affordances are reachable in a normal workspace', async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)
    // Clone is offered even though the workspace is already git-initialized.
    await expect(page.locator('[data-id="gitCloneUrl"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="gitClone"]')).toBeVisible()
    // With no remote configured, the Add-remote affordance is shown.
    await expect(page.locator('[data-id="gitAddRemoteUrl"]')).toBeVisible()
    await expect(page.locator('[data-id="gitAddRemote"]')).toBeVisible()
  })

  test('TC-GIT-R3: adding a remote fetches every branch and gates HEAD-dependent actions', async ({ page }) => {
    test.slow() // live all-ref fetch through the proxy
    await openHome(page)
    await openGitPanel(page)
    await page.locator('[data-id="gitAddRemoteUrl"]').fill('https://github.com/octocat/Hello-World.git')
    await page.locator('[data-id="gitAddRemote"]').click()

    // Adding origin also fetches its refs. The repository is still unborn, so
    // selecting one of these remote branches is the next valid action; Push /
    // Pull / Force push must not run against the unresolved local HEAD.
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/branches fetched/i, { timeout: 120_000 })
    await expect(page.locator('[data-id="gitPush"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-id="gitPull"]')).toBeVisible()
    await expect(page.locator('[data-id="gitRemoteUrl"]')).toContainText('octocat/Hello-World')
    await expect(page.locator('[data-id="gitPush"]')).toBeDisabled()
    await expect(page.locator('[data-id="gitPull"]')).toBeDisabled()
    await expect(page.locator('[data-id="gitForcePush"]')).toBeDisabled()
    await expect(page.locator('[data-id="gitFetch"]')).toBeEnabled()
    await expect(page.locator('[data-id="gitNewBranch"]')).toBeDisabled()

    const branchSelect = page.locator('[data-id="gitBranchSelect"]')
    await expect(branchSelect).toBeEnabled()
    const branchValues = await branchSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    expect(branchValues).toEqual(expect.arrayContaining(['master', 'octocat-patch-1', 'test']))
    await expect(page.locator('[data-id="gitBranchHint"]')).toContainText(/select a remote branch/i)
  })

  test('TC-GIT-R7: force push requires confirmation; cancel blocks it and normal push remains direct', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await connectFakeGithubSession(page)
    await openGitPanel(page)

    const init = page.locator('[data-id="gitInit"]')
    if (await init.isVisible().catch(() => false)) await init.click()
    await page.locator('[data-id="gitBranchSelect"]').waitFor({ state: 'visible', timeout: 15_000 })

    // Give push a real local ref so reaching the proxy is an unambiguous signal
    // that doPush ran (rather than failing locally before the network call).
    const stageAll = page.locator('[data-id="gitStageAll"]')
    if (await stageAll.isVisible().catch(() => false)) {
      await stageAll.click()
      await page.locator('[data-id="gitUnstageFile"]').first().waitFor({ state: 'visible', timeout: 15_000 })
      await page.locator('[data-id="gitCommitMessage"]').fill('force push confirmation fixture')
      await page.locator('[data-id="gitCommit"]').click()
      await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'force push confirmation fixture' }))
        .toBeVisible({ timeout: 15_000 })
    }

    let proxiedPushes = 0
    const proxiedHeaders: Array<Record<string, string>> = []
    await page.route('**/git/**', (route) => {
      const request = route.request()
      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': request.headers().origin || new URL(page.url()).origin,
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'x-tronide-session'
          }
        })
      }
      proxiedPushes++
      proxiedHeaders.push(request.headers())
      return route.abort()
    })
    await page.locator('[data-id="gitAddRemoteUrl"]').fill('https://github.com/octocat/Hello-World.git')
    await page.locator('[data-id="gitAddRemote"]').click()
    await expect(page.locator('[data-id="gitForcePush"]')).toBeVisible({ timeout: 15_000 })
    // Add remote now performs an all-ref fetch. This test intentionally aborts
    // that request to remain an offline @gate test; count only later pushes.
    proxiedPushes = 0
    proxiedHeaders.length = 0

    // Approval is scoped to the branch that was visible in the modal. Switch
    // branches programmatically while it is open; confirming the stale modal
    // must cancel instead of force-pushing the newly selected branch.
    const branchSelect = page.locator('[data-id="gitBranchSelect"]')
    const originalBranch = await branchSelect.inputValue()
    await page.locator('[data-id="gitNewBranch"]').click()
    const branchPrompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await branchPrompt.waitFor({ state: 'visible', timeout: 10_000 })
    await branchPrompt.fill('force-push-race-target')
    await page.locator('#modal-footer-ok').click()
    await expect.poll(() => branchSelect.inputValue(), { timeout: 15_000 }).toBe('force-push-race-target')

    await page.locator('[data-id="gitForcePush"]').click()
    await expect(page.locator('#modal-title-h6')).toContainText('force-push-race-target')
    await branchSelect.selectOption(originalBranch)
    await expect.poll(() => branchSelect.inputValue(), { timeout: 15_000 }).toBe(originalBranch)
    await page.locator('#modal-footer-ok').click()
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/changed.*cancelled/i)
    expect(proxiedPushes).toBe(0)

    // Cancel is a hard barrier: doPush(true) must not be reached.
    await page.locator('[data-id="gitForcePush"]').click()
    await expect(page.locator('#modal-title-h6')).toContainText(/Force push/)
    await expect(page.locator('#modal-body-id')).toContainText(/overwrite commits/)
    await page.locator('#modal-footer-cancel').click()
    await page.waitForTimeout(500)
    expect(proxiedPushes).toBe(0)

    // Confirm invokes the force push path.
    await page.locator('[data-id="gitForcePush"]').click()
    await page.locator('#modal-footer-ok').click()
    await expect.poll(() => proxiedPushes, { timeout: 15_000 }).toBeGreaterThan(0)
    expect(proxiedHeaders.every((headers) => headers['x-tronide-session'] === 'test_bff_session_handle_012345678901234567890')).toBe(true)
    expect(proxiedHeaders.every((headers) => !headers.authorization)).toBe(true)
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/push failed/i, { timeout: 15_000 })

    // Ordinary Push remains direct: no destructive-action modal is introduced.
    const beforeNormalPush = proxiedPushes
    await page.locator('[data-id="gitPush"]').click()
    await expect(page.locator('#modal-dialog')).toHaveCount(0)
    await expect.poll(() => proxiedPushes, { timeout: 15_000 }).toBeGreaterThan(beforeNormalPush)
  })

  test('TC-GIT-R2: Clone a public repo end-to-end into a new workspace via the Deno proxy', async ({ page }) => {
    test.slow() // network clone through the proxy
    await openHome(page)
    await openGitPanel(page)
    await page.locator('[data-id="gitCloneUrl"]').fill('https://github.com/octocat/Hello-World.git')
    await page.locator('[data-id="gitClone"]').click()

    // Clone lands in a fresh workspace named after the repo, with its README.
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('Hello-World', { timeout: 120_000 })
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/cloned/i, { timeout: 30_000 })

    // A shallow clone still retains every remote ref. Selecting a remote-only
    // branch creates its local tracking branch and checks it out.
    const branchSelect = page.locator('[data-id="gitBranchSelect"]')
    await expect(branchSelect).toBeEnabled({ timeout: 30_000 })
    await expect.poll(async () => await branchSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['master', 'octocat-patch-1', 'test']))
    await branchSelect.selectOption('test')
    await expect.poll(() => branchSelect.inputValue(), { timeout: 30_000 }).toBe('test')

    // The clone leaves the git panel active — switch to the file explorer to see the tree.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(page.locator('[data-id="treeViewLitreeViewItemREADME"], [data-id="treeViewLitreeViewItemREADME.md"]').first())
      .toBeVisible({ timeout: 20_000 })
  })

  // TC-GIT-R4 (J-009): a clone that dies MID-WAY (network here; storage quota
  // in the field) must not leave the half-created workspace as the
  // restore-on-boot target — createWorkspace stamps it as last-used, and
  // before this fix a reload dropped the user inside the broken workspace.
  // Offline by construction: the proxy request is aborted, so no network.
  test('TC-GIT-R4: a failed clone repairs the last-workspace marker and switches back', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    const before = await page.locator('select[data-id="workspacesSelect"]').inputValue()
    await openGitPanel(page)

    // kill every proxied git request → the clone fails right after the
    // workspace was created and switched to
    await page.route('**/git/**', (route) => route.abort())
    await page.locator('[data-id="gitCloneUrl"]').fill('https://github.com/octocat/definitely-not-here.git')
    await page.locator('[data-id="gitClone"]').click()

    // the failure surfaces AND reports the switch-back
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/switched back|could not switch back/i, { timeout: 60_000 })
    // the live switch-back landed on the previous workspace…
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(before, { timeout: 15_000 })
    // …and the boot marker points at it too, NOT at the stranded workspace
    const marker = await page.evaluate(() => window.localStorage.getItem('tronide.lastWorkspace'))
    expect(marker).toBe(before)
    // a fresh boot therefore lands back home, not inside the broken workspace
    await page.reload()
    await dismissWelcomeModal(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(before, { timeout: 30_000 })
  })

  // TC-GIT-R6: the repair in doClone's catch cannot help when the tab dies
  // MID-CLONE (large clones run for minutes) — the marker stamp is therefore
  // MUTED while the clone workspace is provisional, so no repair is needed:
  // a fresh boot must land in the previous workspace, never the half-created
  // clone target.
  test('TC-GIT-R6: a tab closed mid-clone never boots into the half-created workspace', { tag: '@gate' }, async ({ context, page }) => {
    await openHome(page)
    const before = await page.locator('select[data-id="workspacesSelect"]').inputValue()
    await openGitPanel(page)

    // the proxied git request HANGS (neither fulfilled nor aborted): the clone
    // workspace is created and switched to, then the tab dies mid-clone
    await page.route('**/git/**', () => { /* hold the request open forever */ })
    await page.locator('[data-id="gitCloneUrl"]').fill('https://github.com/octocat/hang-forever.git')
    await page.locator('[data-id="gitClone"]').click()
    // the provisional workspace switch happened — we are now "mid-clone"
    await expect.poll(async () => await page.locator('select[data-id="workspacesSelect"]').inputValue(), { timeout: 30_000 }).not.toBe(before)
    await page.close()

    // a fresh boot lands in the previous workspace — the half-created clone
    // target never became the restore marker
    const reborn = await context.newPage()
    await reborn.goto('/')
    await dismissWelcomeModal(reborn)
    await expect(reborn.locator('select[data-id="workspacesSelect"]')).toHaveValue(before, { timeout: 30_000 })
    await reborn.close()
  })

  // TC-GIT-R5: the "Browser storage is full — delete unused workspaces" rewrite
  // is DESTRUCTIVE advice if wrong, so it may fire only for a real storage
  // QuotaExceededError — never for server-side errors that merely mention
  // "quota" (the git CORS proxy's own usage quotas, GitHub/HTTP bodies).
  // Pure classifier, exercised directly in Node like tronbox-export.
  test('TC-GIT-R5: only a real storage QuotaExceededError claims "storage is full"', { tag: '@gate' }, async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isStorageQuotaError } = require('../../remix-ide/src/lib/git-error-messages.js')
    const err = (props: Record<string, unknown>, message: string) => Object.assign(new Error(message), props)

    // real DOMException shapes -> storage full
    expect(isStorageQuotaError(err({ name: 'QuotaExceededError' }, 'The quota has been exceeded.'), 'The quota has been exceeded.')).toBe(true)
    expect(isStorageQuotaError(err({ code: 22 }, 'QUOTA_EXCEEDED_ERR'), 'QUOTA_EXCEEDED_ERR')).toBe(true)
    // provider/BrowserFS wrappers that stringify the DOMException -> storage full
    expect(isStorageQuotaError(new Error('ApiError: QuotaExceededError: writing object file'), 'ApiError: QuotaExceededError: writing object file')).toBe(true)
    // server-side errors that merely SAY quota -> NOT storage full
    expect(isStorageQuotaError(new Error('HTTP Error: 429 usage quota exceeded for /git'), 'HTTP Error: 429 usage quota exceeded for /git')).toBe(false)
    expect(isStorageQuotaError(new Error('proxy rejected: monthly request quota reached'), 'proxy rejected: monthly request quota reached')).toBe(false)
    expect(isStorageQuotaError(null, 'GitHub API rate/quota limits apply')).toBe(false)
  })
})
