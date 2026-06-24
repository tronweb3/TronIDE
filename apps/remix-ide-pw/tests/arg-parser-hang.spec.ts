/** REGRESSION: txFormat.parseFunctionParams must not hang on a malformed arg.
 *  An argument string whose last char is an unpaired delimiter (`"` or `[`,
 *  e.g. `5"`, `hello"`, `[`) previously sent parseFunctionParams into an
 *  unbounded loop on the browser MAIN THREAD, freezing the tab (the deploy
 *  path buildData()->parseFunctionParams() at libs/remix-lib/.../txFormat.ts
 *  is in a try/catch that cannot catch a hang). The scan loops are now bounded
 *  by `j < params.length` and throw the existing error, so the deploy fails
 *  cleanly ("Error encoding arguments: ...") and the tab stays responsive.
 *  Self-contained; runs against a freshly-built app. */
import { test, expect, Page } from '@playwright/test'

test.setTimeout(150_000)

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

// True if the page's main thread stops responding within `ms` (an infinite
// synchronous loop would block every page.evaluate round-trip).
async function isFrozen (page: Page, ms: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const r = await Promise.race([
      page.evaluate(() => 1).then(() => 'alive').catch(() => 'alive'),
      new Promise<string>((res) => setTimeout(() => res('frozen'), 1500))
    ])
    if (r === 'frozen') return true
    await new Promise((res) => setTimeout(res, 300))
  }
  return false
}

test('REGRESSION: a deploy arg ending in a double-quote fails cleanly, no freeze', async ({ page }) => {
  await boot(page)
  await newFile(page, 'Args.sol', SIMPLE)
  await ensurePanel(page, 'solidity', '*[data-id="compilerContainerCompileBtn"]')
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Args', { timeout: 90_000 })
  await ensurePanel(page, 'udapp', 'select[id="selectExEnvOptions"]')
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('Args')

  const ctor = page.locator('input[data-id="uint256 _n, string _s"]')
  const deploy = page.locator('button[data-id="Deploy - transact (not payable)"]').first()
  await ctor.waitFor({ state: 'visible', timeout: 15_000 })

  // CONTROL: well-formed args deploy fine and the tab stays responsive.
  await ctor.fill('7, "ok"')
  await deploy.click()
  await expect(page.locator('.instance')).toHaveCount(1, { timeout: 30_000 })
  expect(await isFrozen(page, 3000), 'tab must be responsive after a valid deploy').toBe(false)

  // FIXED BEHAVIOR: an arg whose last char is a lone double-quote must NOT
  // freeze the tab; the deploy is rejected and no new instance is created.
  await ctor.fill('5"')
  await deploy.click({ timeout: 5000 }).catch(() => {})
  expect(await isFrozen(page, 8000), 'trailing-quote arg must not freeze the main thread').toBe(false)
  await expect(page.locator('.instance')).toHaveCount(1, { timeout: 10_000 })
})
