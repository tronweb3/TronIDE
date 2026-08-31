import { test, expect } from '@playwright/test'
import { dismissWelcomeModal, useBuiltinCompiler } from './helpers'

test.describe('Prague and Osaka compatibility', () => {
  test('TC-PROTOCOL-001: template seeds all files and VM deployment fails closed', { tag: '@gate' }, async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('protocol-compatibility')
    await page.locator('select[data-id="modalDialogCustomSelectTemplate"]').selectOption('prague-osaka-compatibility')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('protocol-compatibility', { timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      return [
        'contracts/P256Verifier.sol',
        'contracts/PragueHistory.sol',
        'tests/P256Verifier_test.sol',
        'README.md'
      ].filter((path) => fs.existsSync(`.workspaces/protocol-compatibility/${path}`))
    })).toHaveLength(4)
    await expect(page.locator('remix-tab[id$="P256Verifier.sol"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('P256Verifier', { timeout: 30_000 })

    await page.locator('#icon-panel div[plugin="udapp"]').click()
    const card = page.locator('[data-id="protocolCapabilitiesCard"]')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="protocolPragueStatus"]')).toHaveAttribute('data-status', 'unsupported')
    await expect(page.locator('[data-id="protocolOsakaStatus"]')).toHaveAttribute('data-status', 'unsupported')
    await expect(page.locator('[data-id="protocolArtifactRequirements"]')).toContainText('P-256 precompile')

    await page.locator('#runTabView select[class^="contractNames"]').selectOption('P256Verifier')
    await page.locator('#runTabView button').filter({ hasText: /^Deploy$/ }).first().click()
    await expect(page.locator('[data-shared="tooltipPopup"]').filter({ hasText: 'Deployment blocked:' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="protocolCapabilitiesMessage"]')).toContainText('requires OSAKA')
    await expect(page.locator('.instance, *[data-id^="instance"]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__tronideLastDeployment))).toBe(false)

    // A later clean compilation replaces the incompatible artifact. The old
    // deployment error must disappear immediately rather than accusing the
    // newly selected contract of requiring Osaka until the next deploy click.
    await page.locator('.nav-item .title:has-text("Home"), .title:has-text("Home")').first().click()
    await page.locator('[data-id="landingDappStarterCard"]').click()
    await page.locator('[data-id="landingTemplateSelect"]').selectOption('simple-storage')
    await page.locator('#modal-footer-ok').click()
    await expect(page.locator('remix-tab[id$="SimpleStorage.sol"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('SimpleStorage', { timeout: 30_000 })

    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await expect(page.locator('[data-id="protocolArtifactRequirements"]')).toContainText('no Prague/Osaka dependency')
    await expect(page.locator('[data-id="protocolCapabilitiesMessage"]')).toBeHidden()

    await page.locator('#runTabView select[class^="contractNames"]').selectOption('SimpleStorage')
    await page.locator('#runTabView button').filter({ hasText: /^Deploy$/ }).first().click()
    await expect.poll(() => page.evaluate(() => (window as any).__tronideLastDeployment?.contractName)).toBe('SimpleStorage')
  })
})
