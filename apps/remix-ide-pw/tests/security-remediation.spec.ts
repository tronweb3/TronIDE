import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('Security remediation regression tests (2026-05-20 / 2026-06-02)', () => {
  test('terminal HTML links are sanitized and dangerous protocols are stripped', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for the workspace/File explorer to load
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Focus the terminal CLI input and type the command to execute
    await page.focus('#terminalCliInput')
    await page.keyboard.type(`remix._components.terminal.log({ type: 'html', value: '<div><a href="javascript:alert(1)" id="dangerous-link">dangerous</a><a href="https://example.com" id="safe-link">safe</a></div>' })`)
    await page.keyboard.press('Enter')

    // Verify in terminal journal that safe-link has href but dangerous-link does not
    const journal = page.locator('[data-id="terminalJournal"]')
    await journal.waitFor({ state: 'attached', timeout: 10_000 })

    const safeLink = journal.locator('a', { hasText: 'safe' })
    await safeLink.waitFor({ state: 'attached', timeout: 10_000 })
    await expect(safeLink).toHaveAttribute('href', 'https://example.com')

    const dangerousLink = journal.locator('a', { hasText: 'dangerous' })
    await dangerousLink.waitFor({ state: 'attached', timeout: 10_000 })
    await expect(dangerousLink).not.toHaveAttribute('href')
  })

  test('plugin manager local plugin URL blocks unsafe protocols and remote non-localhost HTTP', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for workspace load
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Open Plugin Manager
    const pmIcon = page.locator('#icon-panel div[plugin="pluginManager"]')
    await pmIcon.click()

    // Click "Connect to a Local Plugin"
    const localPluginBtn = page.locator('[data-id="pluginManagerComponentPluginSearchButton"]')
    await localPluginBtn.waitFor({ state: 'visible', timeout: 5000 })
    await localPluginBtn.click({ force: true })

    // Wait for local plugin form modal
    const localPluginName = page.locator('[data-id="localPluginName"]')
    await localPluginName.waitFor({ state: 'visible', timeout: 5000 })
    const localPluginDisplayName = page.locator('[data-id="localPluginDisplayName"]')
    const localPluginUrl = page.locator('[data-id="localPluginUrl"]')
    const modalOkBtn = page.locator('#modal-footer-ok')
    const cancelBtn = page.locator('#modal-footer-cancel')

    // Match the validation tooltip by its message text rather than DOM order, so stacked or
    // animating tooltips can't make the assertion pick the wrong one (the source of the flake).
    const expectValidationTooltip = async (message: string) => {
      await expect(
        page.locator('[data-shared="tooltipPopup"]').filter({ hasText: message }).first()
      ).toBeVisible({ timeout: 7000 })
    }
    // Close any open tooltips so the next case starts from a clean slate.
    const clearTooltips = async () => {
      for (const btn of await page.locator('button[data-id="tooltipCloseButton"]').all()) {
        await btn.click({ force: true }).catch(() => {})
      }
      await page.waitForTimeout(300)
    }

    // Test Case 1: Unsafe file:// protocol → must require http(s)
    await localPluginName.fill('testUnsafePlugin')
    await localPluginDisplayName.fill('Test Unsafe')
    await localPluginUrl.fill('file:///etc/passwd')
    await modalOkBtn.click({ force: true })
    await expectValidationTooltip('Local plugin URL must use http(s).')
    await clearTooltips()

    // Test Case 2: Unsafe data: protocol → must require http(s)
    await localPluginBtn.click({ force: true })
    await localPluginName.waitFor({ state: 'visible', timeout: 5000 })
    await localPluginName.fill('testUnsafePlugin2')
    await localPluginDisplayName.fill('Test Unsafe 2')
    await localPluginUrl.fill('data:text/html,<h1>Hack</h1>')
    await modalOkBtn.click({ force: true })
    await expectValidationTooltip('Local plugin URL must use http(s).')
    await clearTooltips()

    // Test Case 3: Remote non-localhost HTTP → only localhost allowed
    await localPluginBtn.click({ force: true })
    await localPluginName.waitFor({ state: 'visible', timeout: 5000 })
    await localPluginName.fill('testUnsafePlugin3')
    await localPluginDisplayName.fill('Test Unsafe 3')
    await localPluginUrl.fill('http://example.com/plugin')
    await modalOkBtn.click({ force: true })
    await expectValidationTooltip('HTTP local plugin URLs are only allowed for localhost.')
  })

  test('remixd connection setup includes unpredictable remixdToken in query parameters', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for workspace load
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Setup mock WebSocket handler to capture the token
    await page.evaluate(() => {
      (window as any).capturedRemixdToken = null;
      const originalWebSocket = window.WebSocket;
      // @ts-ignore
      window.WebSocket = function (url: string, protocols?: string | string[]) {
        try {
          const urlObj = new URL(url);
          (window as any).capturedRemixdToken = urlObj.searchParams.get('remixdToken');
        } catch (e) {}
        window.WebSocket = originalWebSocket;
        return new originalWebSocket(url, protocols);
      };
    })

    // Select " - connect to localhost - " in workspacesSelect dropdown natively
    await page.locator('[data-id="workspacesSelect"]').selectOption(' - connect to localhost - ')

    // Wait for standard "Connect to localhost" modal and click Connect
    const connectModal = page.locator('.modal-content:has-text("Connect to localhost")')
    await connectModal.waitFor({ state: 'visible', timeout: 5000 })
    await connectModal.locator('#modal-footer-ok').click()

    // Retrieve and assert unpredictable token presence using expect.poll to handle async setup
    await expect.poll(async () => {
      return await page.evaluate(() => (window as any).capturedRemixdToken)
    }, { timeout: 15_000 }).toBeTruthy()

    const token = await page.evaluate(() => (window as any).capturedRemixdToken)
    expect(token.length).toBeGreaterThan(0)

    // Close the "Connect to localhost" modal if it appeared (cleanup)
    const modalCancelBtn = page.locator('#modal-footer-cancel')
    if (await modalCancelBtn.isVisible()) {
      await modalCancelBtn.click()
    }
  })
})
