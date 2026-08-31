import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('Security remediation regression tests (2026-05-20 / 2026-06-02 / 2026-07-21)', () => {
  test('URL hash blocks unsafe actions while preserving file-open deep links', { tag: '@gate' }, async ({ page }) => {
    await page.goto('/#activate=solidity&call=fileManager//writeFile//contracts/EVIL.sol//INJECTED')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const injected = await page.evaluate(async () => {
      const fs = (window as any).remixFileSystem
      return await new Promise((resolve) => {
        fs.readFile('.workspaces/default_workspace/contracts/EVIL.sol', 'utf8', (error: Error | null, data: unknown) => {
          resolve(error ? null : String(data))
        })
      })
    })
    expect(injected).toBeNull()

    // Use the legacy `?` form here to force a full navigation; QueryParams
    // rewrites it to the equivalent hash during boot.
    await page.goto('/?activate=remixd')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await expect(page.locator('.modal-content').filter({ hasText: 'Connect to localhost' })).toHaveCount(0)

    // Keep the established non-mutating deep-link behavior: callers can still
    // open an existing workspace file and select an ordinary IDE panel.
    await page.goto('/?activate=solidity&call=fileManager//open//contracts/3_Ballot.sol&deactivate=home')
    await dismissWelcomeModal(page)
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await expect.poll(async () => page.evaluate(() => {
      const editor = (document.getElementById('input') as any)?.editor
      return editor ? editor.session.getValue() : ''
    }), { timeout: 15_000 }).toContain('contract Ballot')
  })

  test('URL import rejects localhost before issuing a network request', { tag: '@gate' }, async ({ page }) => {
    let targetRequests = 0
    page.on('request', (request) => {
      if (request.url().startsWith('http://127.0.0.1:8545/')) targetRequests++
    })

    // Seed a real workspace first so the URL-import startup branch is reached
    // (a brand-new profile otherwise stops at the separate "no workspace" alert).
    await page.goto('/')
    await dismissWelcomeModal(page)
    const initialAlertOk = page.locator('#modal-footer-ok')
    if (await initialAlertOk.isVisible().catch(() => false)) await initialAlertOk.click()
    await page.locator('[data-id="workspaceCreate"]').click()
    const input = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await input.waitFor({ state: 'visible', timeout: 5_000 })
    await input.fill('security-url-import')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('security-url-import', { timeout: 15_000 })

    await page.goto('/?url=http://127.0.0.1:8545/private')
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(2_000)
    expect(targetRequests).toBe(0)
    await expect(page.locator('select[data-id="workspacesSelect"] option[value="code-sample"]')).toHaveCount(0)
  })

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

  test('plugin manager local plugin URL blocks unsafe protocols and remote URLs', async ({ page }) => {
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
    const localPluginModal = page.locator('[data-id="modalDialogContainer"]').filter({ hasText: 'Local Plugin' })
    const localPluginName = localPluginModal.locator('[data-id="localPluginName"]')
    const localPluginDisplayName = localPluginModal.locator('[data-id="localPluginDisplayName"]')
    const localPluginUrl = localPluginModal.locator('[data-id="localPluginUrl"]')

    const submitInvalidPlugin = async (name: string, displayName: string, url: string, message: string) => {
      await expect(localPluginModal).toBeVisible({ timeout: 5000 })
      await localPluginName.fill(name)
      await localPluginDisplayName.fill(displayName)
      await localPluginUrl.fill(url)
      await expect(localPluginUrl).toHaveValue(url)

      // Use an actionable user click and wait for the modal to settle. A forced
      // click could run while the legacy queued modal was still activating,
      // intermittently skipping its click listener and testing no validation.
      await localPluginModal.locator('#modal-footer-ok').click()
      await expect(localPluginModal).toHaveCount(0)

      const tooltip = page.locator('[data-shared="tooltipPopup"]').filter({ hasText: message }).first()
      await expect(tooltip).toBeVisible({ timeout: 7000 })
      await tooltip.locator('button[data-id="tooltipCloseButton"]').click()
      // Legacy tooltips animate for two seconds before leaving the DOM. Wait
      // for that lifecycle so they cannot cover the next real click.
      await expect(tooltip).toHaveCount(0, { timeout: 3000 })
    }

    // Test Case 1: Unsafe file:// protocol → must require http(s)
    await localPluginBtn.click()
    await submitInvalidPlugin('testUnsafePlugin', 'Test Unsafe', 'file:///etc/passwd', 'Local plugin URL must use http(s).')

    // Test Case 2: Unsafe data: protocol → must require http(s)
    await localPluginBtn.click()
    await submitInvalidPlugin('testUnsafePlugin2', 'Test Unsafe 2', 'data:text/html,<h1>Hack</h1>', 'Local plugin URL must use http(s).')

    // Test Case 3: Remote non-localhost HTTP → only localhost allowed
    await localPluginBtn.click()
    await submitInvalidPlugin('testUnsafePlugin3', 'Test Unsafe 3', 'http://example.com/plugin', 'HTTP local plugin URLs are only allowed for localhost.')

    // Test Case 4: Remote HTTPS → remote plugins are disabled.
    await localPluginBtn.click()
    await submitInvalidPlugin('testUnsafePlugin4', 'Test Unsafe 4', 'https://example.com/plugin', 'Remote plugin URLs are disabled. Use localhost, 127.0.0.1, or ::1.')
  })

  test('remixd connection setup includes unpredictable remixdToken in query parameters', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for workspace load
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // The connector obtains a daemon-issued token before opening the socket.
    // Keep this test focused on the URL binding by stubbing that local
    // endpoint as well as the WebSocket below.
    await page.route('**/remixd-token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: '0123456789abcdef0123456789abcdef' }) })
    })

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
