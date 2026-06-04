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

    // Surface any uncaught errors from boot
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
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
})
