import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// DEF-VM-1 regression locks (v2.3.2 Q1). Root cause: TxRunner's serial queue
// never engaged (`opt.runAsync || true` discarded the simulator's explicit
// false), so calls and transactions executed concurrently against the single
// VM and interleaved checkpoint/revert sequences silently dropped contract
// storage. Fixed in remix-lib txRunner.ts; see
// reports/docs/v2.3.2/DEF-VM-1诊断报告.md. Formerly test.fail-marked repros,
// promoted to regular cases by the fix.

async function editorSet (page: Page, src: string) {
  await page.locator('#input').waitFor({ timeout: 10_000 })
  await page.evaluate((s) => {
    const el = document.getElementById('input') as any
    el.editor.session.setValue(s)
  }, src)
}

test('DEF-VM-1a: plain tx after an eth_call must build on current state (no reverts involved)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  const f0 = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await f0.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await f0.click()
  await editorSet(page, [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity >=0.8.2 <0.9.0;',
    'contract RB2 { uint256 public total; function add(uint256 v) public { total += v; } }'
  ].join('\n'))
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('RB2', { timeout: 30_000 })
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('RB2')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const inst = page.locator('.instance').first()
  await expect(inst).toBeVisible({ timeout: 30_000 })
  await inst.locator('[data-id="universalDappUiTitleExpander"]').click()
  const addRow = inst.locator('div[class*="contractActionsContainer"]').filter({ has: page.locator('button[title^="add - "]') })
  const totalRow = inst.locator('div[class*="contractActionsContainer"]').filter({ has: page.locator('button[title^="total - "]') })
  await addRow.locator('input').first().fill('5')
  await addRow.locator('button[title^="add - "]').first().click()
  await page.waitForTimeout(1_500)
  await totalRow.locator('button[title^="total - "]').first().click()
  await expect(totalRow.locator('[data-id="treeViewDiv0"]').last()).toContainText('5', { timeout: 15_000 })
  await addRow.locator('input').first().fill('2')
  await addRow.locator('button[title^="add - "]').first().click()
  await page.waitForTimeout(1_500)
  await totalRow.locator('button[title^="total - "]').first().click()
  await page.waitForTimeout(2_000)
  const total = (await totalRow.locator('[data-id="treeViewDiv0"]').last().textContent()) || ''
  expect(total, 'add(2) after a read must accumulate on total=5').toMatch(/uint256:\s*7/)
})

test('DEF-VM-1b: state written before a reverted tx must survive the revert', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await f.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await f.click()
  await editorSet(page, [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity >=0.8.2 <0.9.0;',
    'contract RB {',
    '  uint256 public x;',
    '  function set(uint256 v) public { x = v; }',
    '  function boom() public { revert("no"); }',
    '}'
  ].join('\n'))
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('RB', { timeout: 30_000 })

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('RB')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const instance = page.locator('.instance').first()
  await expect(instance).toBeVisible({ timeout: 30_000 })
  await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

  // write state and verify it
  const setRow = instance.locator('div[class*="contractActionsContainer"]').filter({ has: page.locator('button[title^="set - "]') }).first()
  await setRow.locator('input').first().fill('5')
  await setRow.locator('button[title^="set - "]').first().click()
  await page.waitForTimeout(1_500)
  const xRow = instance.locator('div[class*="contractActionsContainer"]').filter({ has: page.locator('button[title^="x - "]') })
  await xRow.locator('button[title^="x - "]').first().click()
  await expect(xRow.locator('[data-id="treeViewDiv0"]').last()).toContainText('5', { timeout: 15_000 })

  // revert a tx
  const before = ((await page.locator('#journal').textContent()) || '').length
  await instance.locator('button[title^="boom - "]').first().click()
  await expect
    .poll(async () => (((await page.locator('#journal').textContent()) || '').slice(before)), { timeout: 20_000 })
    .toMatch(/errored|revert/i)

  // the pre-revert state must still be readable
  await page.waitForTimeout(1_500)
  await xRow.locator('button[title^="x - "]').first().click()
  await page.waitForTimeout(2_000)
  const value = (await xRow.locator('[data-id="treeViewDiv0"]').last().textContent()) || ''
  expect(value).toMatch(/uint256:\s*5/)
})

// TC-VM-012 (v2.3.2 Q1): tx/call interleave matrix — three rounds of
// write→read must accumulate correctly with reads interleaved between writes.
test('TC-VM-012: three interleaved write/read rounds accumulate correctly', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await f.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await f.click()
  await editorSet(page, [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity >=0.8.2 <0.9.0;',
    'contract IM { uint256 public total; function add(uint256 v) public { total += v; } }'
  ].join('\n'))
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('IM', { timeout: 30_000 })
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('IM')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const inst = page.locator('.instance').first()
  await expect(inst).toBeVisible({ timeout: 30_000 })
  await inst.locator('[data-id="universalDappUiTitleExpander"]').click()
  const addRow = inst.locator('div[class*="contractActionsContainer"]').filter({ has: page.locator('button[title^="add - "]') })
  const totalRow = inst.locator('div[class*="contractActionsContainer"]').filter({ has: page.locator('button[title^="total - "]') })

  let expected = 0
  for (const v of [5, 2, 9]) {
    expected += v
    await addRow.locator('input').first().fill(String(v))
    await addRow.locator('button[title^="add - "]').first().click()
    await page.waitForTimeout(1_200)
    await totalRow.locator('button[title^="total - "]').first().click()
    await expect(totalRow.locator('[data-id="treeViewDiv0"]').last())
      .toContainText(new RegExp(`uint256:\\s*${expected}(?!\\d)`), { timeout: 15_000 })
  }

  // burst reads then one more write — still consistent
  for (let i = 0; i < 3; i++) await totalRow.locator('button[title^="total - "]').first().click()
  await page.waitForTimeout(1_500)
  await addRow.locator('input').first().fill('4')
  await addRow.locator('button[title^="add - "]').first().click()
  await page.waitForTimeout(1_200)
  await totalRow.locator('button[title^="total - "]').first().click()
  await expect(totalRow.locator('[data-id="treeViewDiv0"]').last())
    .toContainText(/uint256:\s*20(?!\d)/, { timeout: 15_000 })
})
