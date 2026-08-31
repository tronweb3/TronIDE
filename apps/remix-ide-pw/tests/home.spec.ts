import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('Home / landing page smoke', () => {
  test('landing renders the Remix 2.2.0 hero and onboarding sections', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (text.includes('React 18') || text.includes('ReactDOM.render') || text.includes('defaultProps') || text.includes('findDOMNode') || text.includes('Content Security Policy')) {
          return
        }
        consoleErrors.push(`console.error: ${text}`)
      }
    })

    await page.goto('/')
    await dismissWelcomeModal(page)

    // The landing layout key surfaces from `apps/remix-ide/src/app/ui/landing-page/landing-page.js`.
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-id="landingPrimaryActionsPanel"]')).toBeVisible()
    await expect(page.locator('[data-id="landingAdvancedToolsPanel"]')).toBeVisible()
    await expect(page.locator('[data-id="landingDappStarterCard"] .fa-file-code')).toBeVisible()
    await expect(page.locator('[data-id="landingAiTaskNileDeploy"] .fa-rocket')).toBeVisible()
    await expect(page.locator('[data-id="landingWalletStatus"]')).toContainText(/Wallet: (Not connected|TronLink connected)/)

    // Surface any uncaught errors from boot
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  })

  test('informational Release Notes do not become the next startup tab', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('workspace', JSON.stringify(['releaseNotes'])))
    await page.goto('/')
    await dismissWelcomeModal(page)

    await expect(page.locator('[data-id="landingRemix220Hero"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-id="releaseNotesView"]')).toBeHidden()
  })

  test('advanced tools stay collapsed by default and can be expanded from primary actions', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('tronide.home.advancedToolsOpen'))
    await page.goto('/')
    await dismissWelcomeModal(page)

    await page.locator('[data-id="landingPrimaryActionsPanel"]').waitFor({ timeout: 30_000 })

    await expect(page.locator('[data-id="quickStartCreateContract"]')).toBeVisible()
    await expect(page.locator('[data-id="landingDappStarterCard"]')).toBeVisible()
    await expect(page.locator('[data-id="landingOpenGlobalSearchButton"]')).toBeVisible()
    await expect(page.locator('[data-id="landingWalletConnectEntry"]')).toBeVisible()
    await expect(page.locator('[data-id="landingStartLearningButton"]')).toHaveCount(0)

    const advancedShortcut = page.locator('[data-id="landingAdvancedToolsToggle"]')
    await expect(advancedShortcut).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[data-id="landingAdvancedToolsContent"]')).toHaveCount(0)

    await advancedShortcut.click()

    await expect(page.locator('[data-id="landingAdvancedToolsContent"]')).toBeVisible()
    await expect(advancedShortcut).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-id="landingVerificationPanel"]')).toBeVisible()
    await expect(page.locator('[data-id="landingWalkthroughsPanel"]')).toHaveCount(0)
    await expect(page.locator('[data-id="landingGithubTokenPanel"]')).toBeVisible()
    await expect(advancedShortcut).toHaveText(/Hide/)

    await expect.poll(() => page.evaluate(() => window.localStorage.getItem('tronide.home.advancedToolsOpen'))).toBe('true')
  })

  test('TC-HOME-ACTION-1: rapid clicks trigger a Home action only once', { tag: '@gate' }, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.removeItem('tronide.home.advancedToolsOpen'))
    await page.goto('/')
    await dismissWelcomeModal(page)

    const toggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 30_000 })

    // Dispatch two clicks in the same turn. Without the leading-edge guard the
    // second click closes the panel again; with it, the action runs only once.
    await toggle.evaluate((element: HTMLElement) => {
      element.click()
      element.click()
    })
    await expect(page.locator('[data-id="landingAdvancedToolsContent"]')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // The toggle is re-rendered by the first click, so exercise the shared key:
    // a new DOM button must still be blocked during the same cooldown window.
    await toggle.click()
    await expect(page.locator('[data-id="landingAdvancedToolsContent"]')).toBeVisible()

    await page.waitForTimeout(700)
    await toggle.click()
    await expect(page.locator('[data-id="landingAdvancedToolsContent"]')).toHaveCount(0)
  })

  test('TC-HOME-ACTION-2: Create Contract suggests a Solidity file and Escape cancels it', { tag: '@gate' }, async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    const createContract = page.locator('[data-id="quickStartCreateContract"]')
    await expect(createContract).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-id="landingDappStarterCard"]')).toContainText('Add a TRON starter contract')

    const walletCard = page.locator('[data-id="landingWalletConnectEntry"]')
    const walletTitle = await page.locator('[data-id="landingWalletQuickActionTitle"]').innerText()
    await expect(walletCard).toHaveAttribute('aria-label', walletTitle)

    await createContract.click()
    const editable = page.locator('div.remixui_items[contenteditable="true"]')
    await expect(editable).toBeVisible({ timeout: 10_000 })
    await expect(editable).toHaveText('NewContract.sol')
    await expect(editable).toBeFocused()

    await editable.press('Escape')
    await expect(editable).toHaveCount(0)
    const newContractTreeItem = page.locator('[data-id="treeViewLitreeViewItemNewContract.sol"]')
    await expect(newContractTreeItem).toHaveCount(0)

    // The Home action gate intentionally ignores a repeated click for 650 ms.
    await page.waitForTimeout(700)
    await createContract.click()
    await expect(editable).toHaveText('NewContract.sol', { timeout: 10_000 })
    await editable.press('Enter')

    await expect(newContractTreeItem).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('banner').getByText('NewContract.sol', { exact: true })).toBeVisible()
  })

  test('tabbar compile shortcut starts disabled until a Solidity tab is active', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    const compileButton = page.locator('[data-id="tabProxyCompileCurrent"]')
    await expect(compileButton).toBeVisible({ timeout: 30_000 })
    await expect(compileButton).toHaveAttribute('aria-disabled', 'true')
    await expect(compileButton).toHaveAttribute('title', 'Open a .sol tab to compile')
    await expect(compileButton).toHaveAttribute('data-title', 'Open a .sol tab to compile')
    await expect(compileButton).toHaveClass(/disabled/)
  })

  // The Git Workflow panel's second chip used to be a "Git Help" link to the
  // repo root (not help, and easy to miss); it now opens the in-IDE Git panel.
  // The export toast is also pinned to sentence case here.
  test('TC-HOME-GIT-1: Git Workflow panel exports with a sentence-case toast and opens the Git panel', { tag: '@gate' }, async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingAdvancedToolsPanel"]').waitFor({ timeout: 30_000 })

    // the panel lives behind the Advanced tools toggle (collapsed by default)
    const toggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    if (await toggle.textContent().then((t) => /Show/.test(t || ''))) await toggle.click()
    await expect(page.locator('[data-id="landingGitWorkflowPanel"]')).toBeVisible()

    // Export workspace ZIP → concise progress toast
    const download = page.waitForEvent('download')
    await page.locator('[data-id="landingGitPrepare"]').click()
    await expect(page.locator('[data-shared="tooltipPopup"]').filter({ hasText: 'Preparing download' }).first())
      .toBeVisible({ timeout: 10_000 })
    await (await download).cancel()

    // Open Git Panel lands on the real in-IDE git panel, not an external link
    await page.locator('[data-id="landingGitOpenPanel"]').click()
    await expect(page.locator('[data-id="gitPanel"]')).toBeVisible({ timeout: 15_000 })
  })
})
