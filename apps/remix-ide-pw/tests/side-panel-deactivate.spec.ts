import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

/**
 * SP-DEACT-1 (P0): the side panel must not keep a stale header over an empty
 * body when the plugin currently shown there is deactivated. This is the
 * panel-level companion to CV-011 (contract-verification.spec.ts): the fix
 * lives in SidePanel.removeView, so it covers EVERY sidePanel plugin. Here we
 * prove it generalizes via the "TVM Solidity Analyzers" home card
 * (solidityStaticAnalysis), a different sidePanel plugin than Contract
 * Verification.
 */
test.describe('Side panel deactivate/re-activate consistency', () => {
  test('SP-DEACT-1 Analyzer card: deactivating the shown plugin falls back to file explorer', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    const card = page.locator('[data-id="landingPluginSolidityAnalyzers"]')
    await card.waitFor({ timeout: 30_000 })

    const sidePanelTitle = page.locator('[data-id="sidePanelSwapitTitle"]')
    const onTag = page.locator('[data-id="landingPluginToggleAnalyzers"]')
    const verticalIcon = page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]')
    const analyzerView = page.locator('#staticAnalyserView')
    const deactivateChip = card.getByText('Deactivate', { exact: true })
    const activateChip = card.getByText('Activate', { exact: true })

    // Precondition: plugin active and the card reflects it
    if (await deactivateChip.count() === 0) {
      await activateChip.click()
    }
    await expect(deactivateChip).toBeVisible()
    await expect(onTag).toHaveCount(1)

    // Open Analyzer -> shown in the side panel
    await card.getByText('Open Analyzer', { exact: true }).click()
    await expect(sidePanelTitle).toHaveText('Solidity static analysis')
    await expect(analyzerView).toBeVisible()

    // Deactivate -> no stale "Solidity static analysis" header; falls back to files
    await deactivateChip.click()
    await expect(onTag).toHaveCount(0)
    await expect(activateChip).toBeVisible()
    await expect(sidePanelTitle).toHaveText('File explorers')
    await expect(verticalIcon).toHaveCount(0)

    // Re-activate -> restored, no stale analyzer panel
    await activateChip.click()
    await expect(onTag).toHaveCount(1)
    await expect(deactivateChip).toBeVisible()
    await expect(sidePanelTitle).toHaveText('File explorers')
    await expect(verticalIcon).toHaveCount(1)

    // Open again -> content re-renders (panel is not empty)
    await card.getByText('Open Analyzer', { exact: true }).click()
    await expect(sidePanelTitle).toHaveText('Solidity static analysis')
    await expect(analyzerView).toBeVisible()
  })
})
