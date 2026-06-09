import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-CMP-001 / TC-CMP-002: compilation produces complete artifacts (ABI, bytecode,
// metadata), and a multi-contract file exposes every contract without confusing them.

async function openWorkspaceAndContracts (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storage.isVisible()) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await storage.click()
}

test.describe('Solidity compiler', () => {
  test('TC-CMP-001: compilation produces ABI, bytecode and metadata artifacts', async ({ page }) => {
    await openWorkspaceAndContracts(page)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })

    // The Compilation Details modal exposes the core artifacts as tree items.
    await page.locator('*[data-id="compilation-details"]').click()
    const items = page.locator('[data-id^="remixui_treeviewitem_"]')
    await expect(items.first()).toBeVisible({ timeout: 10_000 })
    const artifactNames = (await items.allInnerTexts()).join(' ').toLowerCase()
    expect(artifactNames).toContain('abi')
    expect(artifactNames).toContain('bytecode')
    expect(artifactNames).toContain('metadata')
  })

  test('TC-CMP-002: a multi-contract file lists every contract without confusing them', async ({ page }) => {
    await openWorkspaceAndContracts(page)

    // Replace the editor buffer with a two-contract source (the default workspace
    // has no multi-contract file). Ace exposes the session on the #input element.
    const twoContracts = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.7.0 <0.9.0;',
      'contract Alpha { uint256 public a; function setA(uint256 v) public { a = v; } }',
      'contract Beta  { uint256 public b; function setB(uint256 v) public { b = v; } }'
    ].join('\n')
    await page.waitForFunction(() => {
      const el = document.getElementById('input') as any
      return el && el.editor
    }, { timeout: 30_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, twoContracts)

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()

    const dropdown = page.locator('*[data-id="compiledContracts"]')
    await expect(dropdown).toContainText('Alpha', { timeout: 30_000 })
    await expect(dropdown).toContainText('Beta')

    // Switching the selected contract works for each (option value = contract name).
    await dropdown.selectOption('Beta')
    expect(await dropdown.inputValue()).toBe('Beta')
    await dropdown.selectOption('Alpha')
    expect(await dropdown.inputValue()).toBe('Alpha')
  })
})
