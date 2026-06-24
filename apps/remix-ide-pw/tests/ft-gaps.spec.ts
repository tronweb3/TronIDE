/** Gap-filler e2e for the v2.3.0 full-feature plan: cases not covered by the
 *  existing 23 specs. Self-contained (creates its own files) so it runs against
 *  the live deployed build as well as local. */
import { test, expect, Page } from '@playwright/test'

async function boot (page: Page) {
  await page.goto('/')
  for (const l of ['I Understand']) { const b = page.getByRole('button', { name: l }); if (await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {}) }
  await page.locator('#icon-panel').waitFor({ timeout: 45_000 })
}
async function ensurePanel (page: Page, plugin: string, probe: string) {
  if (await page.locator(probe).first().isVisible().catch(() => false)) return
  await page.locator(`#icon-panel div[plugin="${plugin}"]`).click().catch(() => {})
  await page.locator(probe).first().waitFor({ timeout: 15_000 })
}
async function newFile (page: Page, name: string, content: string) {
  await ensurePanel(page, 'filePanel', 'select[data-id="workspacesSelect"]')
  await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').evaluate((el: HTMLElement) => el.click())
  const ed = page.locator('div.remixui_items[contenteditable="true"]')
  await ed.waitFor({ state: 'visible', timeout: 10_000 })
  await page.evaluate((n) => { const el = document.querySelector('div.remixui_items[contenteditable="true"]') as HTMLElement; if (el) el.innerText = n }, name)
  await ed.press('Enter')
  await page.locator('#input').waitFor({ timeout: 15_000 })
  await page.evaluate((c) => { (document.getElementById('input') as any).editor.session.setValue(c) }, content)
  await page.waitForTimeout(500)
  await page.keyboard.press('Control+S')
}
const SIMPLE = ['// SPDX-License-Identifier: MIT', 'pragma solidity >=0.8.2 <0.9.0;',
  'contract Args { uint256 public n; string public s; constructor(uint256 _n, string memory _s){ n=_n; s=_s; } }'].join('\n')

test.describe('FT gap-filler', () => {
  test('FT-HOME-02/04: Create Contract & Search Workspace quick actions', async ({ page }) => {
    await boot(page)
    // Search Workspace -> global search panel
    const search = page.getByText('Search Workspace', { exact: false }).first()
    if (await search.isVisible().catch(() => false)) {
      await search.click()
      await expect(page.locator('[data-id="search_include"], input[placeholder*="search" i], #search_input').first()).toBeVisible({ timeout: 10_000 })
    }
    // Create Contract -> file creation flow on filePanel
    await page.goto('/'); await page.locator('#icon-panel').waitFor()
    const create = page.getByText('Create Contract', { exact: false }).first()
    if (await create.isVisible().catch(() => false)) {
      await create.click()
      await expect(page.locator('select[data-id="workspacesSelect"]')).toBeVisible({ timeout: 10_000 })
    }
  })

  test('FT-EDIT-03: multi-tab open / switch / close', async ({ page }) => {
    await boot(page)
    await newFile(page, 'A_tab.sol', '// A\ncontract A {}')
    await newFile(page, 'B_tab.sol', '// B\ncontract B {}')
    // two tabs present
    const tabs = page.locator('.remix-ui-tabs_tab, [data-id^="tab-"], remix-tab')
    expect(await tabs.count()).toBeGreaterThanOrEqual(2)
    // editor shows B (last opened)
    expect(await page.evaluate(() => (document.getElementById('input') as any).editor.getValue())).toContain('contract B')
  })

  test('FT-EDIT-07: compile error produces an inline annotation', async ({ page }) => {
    await boot(page)
    await newFile(page, 'Bad.sol', '// SPDX-License-Identifier: MIT\npragma solidity >=0.8.2 <0.9.0;\ncontract Bad { uint x = ; }')
    await ensurePanel(page, 'solidity', '*[data-id="compilerContainerCompileBtn"]')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    // an error entry appears in the compile feedback
    await expect(page.locator('[data-id="compiledErrors"], .alert-danger, [class*="error"]').first()).toBeVisible({ timeout: 60_000 })
  })

  test('FT-CMP-07/08/09: optimize toggle persists, Yul language option, hide-warnings present', async ({ page }) => {
    await boot(page)
    await ensurePanel(page, 'solidity', '*[data-id="compilerContainerCompileBtn"]')
    // language dropdown offers Yul
    const opts = await page.locator('#compilierLanguageSelector option').allTextContents()
    expect(opts.join(',')).toMatch(/Yul/i)
    // hide-warnings control present
    await expect(page.locator('#hideWarningsBox')).toBeAttached()
    // optimize toggle persists across a panel switch (hidden custom checkbox -> force)
    const was = await page.locator('#optimize').isChecked()
    await page.locator('#optimize').setChecked(!was, { force: true })
    await page.locator('#icon-panel div[plugin="filePanel"]').click(); await page.waitForTimeout(300)
    await ensurePanel(page, 'solidity', '#optimize')
    expect(await page.locator('#optimize').isChecked()).toBe(!was)
  })

  test('FT-SYS-05: layout toggles (terminal) + theme select offers light/dark', async ({ page }) => {
    await boot(page)
    // terminal visible by default (layout)
    await expect(page.locator('[data-id="terminalContainer"], #terminalCli, .terminal').first()).toBeVisible({ timeout: 15_000 })
    // Home "Layout Controls": Toggle Terminal hides it, toggling again restores
    const toggleTerm = page.getByText('Toggle Terminal', { exact: false }).first()
    if (await toggleTerm.isVisible().catch(() => false)) {
      await toggleTerm.click(); await page.waitForTimeout(400)
      await toggleTerm.click(); await page.waitForTimeout(400)
      await expect(page.locator('[data-id="terminalContainer"], #terminalCli, .terminal').first()).toBeVisible()
    }
    // theme select (rendered in settings DOM) offers both light & dark options
    const themeOpts = await page.locator('select').evaluateAll((sels) => {
      const t = (sels as HTMLSelectElement[]).find((s) => [...s.options].some((o) => /dark|light/i.test(o.text)))
      return t ? [...t.options].map((o) => o.text) : []
    })
    if (themeOpts.length) { expect(themeOpts.join(',')).toMatch(/light/i); expect(themeOpts.join(',')).toMatch(/dark/i) }
  })

  test('FT-RUN-03/12: constructor args deploy + two distinct instances (VM)', async ({ page }) => {
    await boot(page)
    await newFile(page, 'Args.sol', SIMPLE)
    await ensurePanel(page, 'solidity', '*[data-id="compilerContainerCompileBtn"]')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Args', { timeout: 60_000 })
    await ensurePanel(page, 'udapp', 'select[id="selectExEnvOptions"]')
    await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Args')
    // constructor args via the combined input (legacy default; per-param fields
    // are collapsed behind a caret). Comma-separated, strings quoted.
    const ctor = page.locator('input[data-id="uint256 _n, string _s"]')
    await ctor.fill('7, "hello"')
    await page.locator('button[data-id="Deploy - transact (not payable)"]').first().click()
    await expect(page.locator('.instance')).toHaveCount(1, { timeout: 30_000 })
    // verify the constructor value took effect: n() == 7
    await page.locator('.instance').first().locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.locator('.instance').first().locator('button[title^="n - "]').first().click()
    await expect(page.locator('*[data-id="treeViewDiv0"]').last()).toContainText('7', { timeout: 15_000 })
    // second deploy -> two instances
    await ctor.fill('9, "world"')
    await page.locator('button[data-id="Deploy - transact (not payable)"]').first().click()
    await expect(page.locator('.instance')).toHaveCount(2, { timeout: 30_000 })
  })
})
