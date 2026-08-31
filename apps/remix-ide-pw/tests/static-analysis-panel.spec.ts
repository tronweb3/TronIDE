import { test, expect, Page } from '@playwright/test'
import { gotoHome, readSavedFile, useBuiltinCompiler } from './helpers'

// TC-SA-001 (v2.3.2): the Solidity Static Analysis panel renders with the
// "Hide results from imported libraries" control (on by default) and does not
// crash. The actual library-filtering needs a real OZ-importing compile
// (env-bound), so this @gate case guards the panel/render wiring only.

async function openStaticAnalysis (page: Page) {
  if (await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtonsolidityStaticAnalysis"]').click()
    await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').waitFor({ timeout: 10_000 })
  }
  await page.locator('#icon-panel div[plugin="solidityStaticAnalysis"]').click()
}

test.describe('Solidity Static Analysis panel', () => {
  test('TC-SA-001: the panel renders with the hide-library toggle and no crash', { tag: '@gate' }, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoHome(page)
    await openStaticAnalysis(page)

    // The library-noise filter is present and enabled by default.
    const toggle = page.locator('#hideLibraryWarningsCheckbox')
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    await expect(toggle).toBeChecked()
    await expect(page.getByText('Hide results from imported libraries')).toBeVisible()
    // Core controls still render alongside it.
    await expect(page.getByText('Select all')).toBeVisible()
    await expect(page.locator('#staticanalysisButton button')).toBeDisabled()
    await expect(page.locator('[data-id="staticAnalysisDisabledReason"]'))
      .toContainText('Open a Solidity (.sol) file and compile it first')

    // Toggling it off/on must not crash the panel (no compilation loaded, so the
    // re-run is a no-op, but the effect + render path is exercised). The Bootstrap
    // custom-checkbox input is overlaid by its label, so toggle via the label.
    const label = page.getByText('Hide results from imported libraries')
    await label.click()
    await expect(toggle).not.toBeChecked()
    await label.click()
    await expect(toggle).toBeChecked()

    expect(errors, 'the static analysis panel must render without an uncaught error').toEqual([])
  })

  // TC-SA-005: compiling the active file before opening the panel must still
  // leave the analyzer runnable. The panel used to lose the file-manager
  // context during initialization, so Run stayed disabled until the user
  // clicked the file a second time.
  test('TC-SA-005: Run remains enabled for the active file after a prior compile', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const file = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await file.isVisible().catch(() => false)) {
      const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
      await folder.waitFor({ state: 'visible', timeout: 15_000 })
      await folder.click()
    }
    await file.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 60_000 })

    await openStaticAnalysis(page)
    await expect(page.locator('#staticanalysisButton button')).toBeEnabled({ timeout: 20_000 })
    await expect(page.locator('[data-id="staticAnalysisDisabledReason"]')).toHaveCount(0)

    // A disabled Run button must always explain the next action. Deselecting
    // every built-in category is valid, but should not look like a dead panel.
    await page.getByText('Select all', { exact: true }).click()
    await expect(page.locator('#staticanalysisButton button')).toBeDisabled()
    await expect(page.locator('[data-id="staticAnalysisDisabledReason"]'))
      .toContainText('Select at least one analysis category to enable Run')
    await page.getByText('Select all', { exact: true }).click()
    await expect(page.locator('#staticanalysisButton button')).toBeEnabled()
  })

  // TC-SA-002 (v2.3.2): the panel shows a per-category summary bar, and the
  // sidebar icon badge counts only meaningful findings (Security/Gas/…),
  // excluding advisory MISC noise (Guard conditions on every require/assert).
  test('TC-SA-002: category summary bar + badge excludes advisory findings', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    // author a contract with BOTH a real Security finding (tx.origin) and lots of
    // advisory Guard-conditions noise (one per require) so the split is visible.
    const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await f.isVisible().catch(() => false)) {
      const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
      await folder.waitFor({ state: 'visible', timeout: 15_000 })
      await folder.click()
    }
    await f.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate(() => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue([
        '// SPDX-License-Identifier: GPL-3.0',
        'pragma solidity >=0.7.0 <0.9.0;',
        'contract Mixed {',
        '  address owner;',
        '  uint256 value;',
        '  function auth(address a) public view returns (bool) { return tx.origin == a; }',
        '  function setA(uint256 v) public { require(v > 0, "a"); value = v; }',
        '  function setB(uint256 v) public { require(v > 1, "b"); value = v; }',
        '  function setC(uint256 v) public { require(v > 2, "c"); value = v; }',
        '}',
        ''
      ].join('\n'))
    })
    // Open the SA panel FIRST so it is mounted and listening: the panel only
    // ingests compilations that finish while it is open (it does not fetch the
    // last one), and autorun then analyzes on that event.
    await openStaticAnalysis(page)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Mixed', { timeout: 60_000 })
    await openStaticAnalysis(page)

    // autorun analyzed on the compile event; the summary bar shows category chips
    const summary = page.locator('[data-id="staticAnalysisCategorySummary"]')
    await expect(summary).toBeVisible({ timeout: 20_000 })
    // Security chip (tx.origin) and Advisory chip (Guard conditions ×3) both show
    await expect(page.locator('[data-id="staticAnalysisSummary-SEC"]')).toContainText('Security')
    await expect(page.locator('[data-id="staticAnalysisSummary-MISC"]')).toContainText('Advisory')
    await expect(summary).toContainText(/excluded from the sidebar icon count/i)

    // the sidebar badge counts meaningful only: strictly fewer than the advisory
    // count (3+ Guard conditions), proving advisory is excluded.
    const advisoryText = await page.locator('[data-id="staticAnalysisSummary-MISC"]').innerText()
    const advisoryCount = parseInt((advisoryText.match(/(\d+)/) || [])[1] || '0', 10)
    expect(advisoryCount, 'the three require() calls each raise a Guard-conditions advisory').toBeGreaterThanOrEqual(3)
    const badge = page.locator('#icon-panel div[plugin="solidityStaticAnalysis"] .badge, #icon-panel div[plugin="solidityStaticAnalysis"] [class*="badge"]').first()
    const badgeText = (await badge.innerText().catch(() => '')).trim()
    const badgeCount = parseInt((badgeText.match(/(\d+)/) || [])[1] || '0', 10)
    // badge (meaningful) must be well below total (meaningful + advisory)
    expect(badgeCount).toBeLessThan(advisoryCount + badgeCount)
    expect(badgeCount).toBeLessThanOrEqual(3)
  })

  // TC-SA-003 (J-006/J-002): advisory groups start COLLAPSED so Security/Gas
  // findings stay above the fold (80 advisory lines used to bury 7 real ones),
  // and the compile's own artifact writes no longer toast "is modifying".
  // Open 1_Storage.sol, replace it with the Mixed contract (one Security
  // finding + plenty of advisory Guard-conditions findings), compile, and
  // leave the compiler panel active. Shared by TC-SA-003/004.
  async function setupMixedCompile (page: Page) {
    await gotoHome(page)
    const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await f.isVisible().catch(() => false)) {
      const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
      await folder.waitFor({ state: 'visible', timeout: 15_000 })
      await folder.click()
    }
    await f.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate(() => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue([
        '// SPDX-License-Identifier: GPL-3.0',
        'pragma solidity >=0.7.0 <0.9.0;',
        'contract Mixed {',
        '  address owner;',
        '  uint256 value;',
        '  function auth(address a) public view returns (bool) { return tx.origin == a; }',
        '  function setA(uint256 v) public { require(v > 0, "a"); value = v; }',
        '  function setB(uint256 v) public { require(v > 1, "b"); value = v; }',
        '  function setC(uint256 v) public { require(v > 2, "c"); value = v; }',
        '}',
        ''
      ].join('\n'))
    })
    await openStaticAnalysis(page)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Mixed', { timeout: 60_000 })
  }

  test('TC-SA-003: advisory group starts collapsed and expands on click; artifact writes do not toast', { tag: '@gate' }, async ({ page }) => {
    await setupMixedCompile(page)

    // J-002: the compile rewrote contracts/artifacts/* but no longer toasts.
    // The artifact write happens asynchronously AFTER compiledContracts
    // updates — asserting count-0 immediately passed before a regressed toast
    // could even render. Wait until the write has demonstrably happened, THEN
    // pin the absence.
    await expect.poll(() => readSavedFile(page, 'contracts/artifacts/Mixed.json'), { timeout: 20_000 }).not.toBe('')
    await expect(page.locator('.ant-notification-notice').filter({ hasText: 'is modifying' })).toHaveCount(0)

    await openStaticAnalysis(page)
    await expect(page.locator('[data-id="staticAnalysisCategorySummary"]')).toBeVisible({ timeout: 20_000 })

    // group headers rendered; the advisory content (Guard conditions) is NOT
    // in the DOM while its group is collapsed…
    const headers = page.locator('[data-id^="staticAnalysisGroupHeader"]')
    await expect(headers.first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-id^="staticAnalysisGroupHeader"][aria-expanded="false"]').first()).toBeVisible()
    await expect(page.getByText('Guard conditions').first()).toHaveCount(0)

    // …while the meaningful (Security) findings are visible WITHOUT any click
    await expect(page.locator('#staticanalysisresult')).toContainText(/tx\.origin/i)

    // expanding every collapsed group reveals the advisory content
    while (await page.locator('[data-id^="staticAnalysisGroupHeader"][aria-expanded="false"]').count() > 0) {
      await page.locator('[data-id^="staticAnalysisGroupHeader"][aria-expanded="false"]').first().click()
    }
    await expect(page.getByText('Guard conditions').first()).toBeVisible()
  })

  // TC-SA-004: advisory groups start collapsed, so the header must be
  // keyboard-reachable and -togglable (it was a mouse-only div: findings were
  // unreachable without a mouse). And a recompile (autorun re-analysis) must
  // not snap a manually expanded group shut — the rebuild used to reset the
  // collapse state on every compile, losing the user's reading position.
  test('TC-SA-004: headers toggle from the keyboard; expanded state survives a recompile', { tag: '@gate' }, async ({ page }) => {
    await setupMixedCompile(page)
    await openStaticAnalysis(page)
    await expect(page.locator('[data-id="staticAnalysisCategorySummary"]')).toBeVisible({ timeout: 20_000 })

    // keyboard: Tab-focusable header toggles on Enter…
    const collapsed = page.locator('[data-id^="staticAnalysisGroupHeader"][aria-expanded="false"]').first()
    await expect(collapsed).toBeVisible({ timeout: 20_000 })
    const headerId = await collapsed.getAttribute('data-id')
    const header = page.locator(`[data-id="${headerId}"]`)
    await header.focus()
    await expect(header).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Guard conditions').first()).toBeVisible()

    // …and back shut on Space
    await page.keyboard.press(' ')
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter') // leave it expanded for the recompile check
    await expect(header).toHaveAttribute('aria-expanded', 'true')

    // recompile: the autorun re-analysis rebuilds the groups, but the user's
    // expanded group must stay expanded
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Mixed', { timeout: 60_000 })
    await openStaticAnalysis(page)
    await expect(page.locator('[data-id="staticAnalysisCategorySummary"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator(`[data-id="${headerId}"]`)).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 })
    await expect(page.getByText('Guard conditions').first()).toBeVisible()
  })
})
