import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

async function compileAndOpenComplexArgs (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

  const source = [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity >=0.8.2 <0.9.0;',
    'contract ComplexArgs {',
    '  struct Item { uint256 amount; string note; }',
    '  uint256 public total;',
    '  string public note;',
    '  function set(Item calldata item, uint256[][] calldata matrix) external {',
    '    total = item.amount + matrix[0][1];',
    '    note = item.note;',
    '  }',
    '  function get() external view returns (uint256, string memory) {',
    '    return (total, note);',
    '  }',
    '}'
  ].join('\n')

  const sourceFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await sourceFile.isVisible()) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await sourceFile.click()
  await page.locator('#input').waitFor({ timeout: 10_000 })
  await page.evaluate((value) => {
    const editor = document.getElementById('input') as any
    editor.editor.session.setValue(value)
  }, source)

  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('ComplexArgs', { timeout: 30_000 })

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('ComplexArgs')
}

test('VM writes and reads tuple/struct plus nested array arguments', async ({ page }) => {
  await compileAndOpenComplexArgs(page)

  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  const instance = page.locator('.instance').first()
  await expect(instance).toBeVisible({ timeout: 30_000 })
  await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

  const setCaret = instance.locator('i[title="set"]')
  await expect(setCaret).toHaveCount(1)
  await setCaret.click()

  await instance.locator('input[data-id="multiParamManagerInputitem"]').fill('[42,"hello"]')
  await instance.locator('input[data-id="multiParamManagerInputmatrix"]').fill('[[1,2],[3,4]]')

  const setButtons = instance.locator('button[data-id="set - transact (not payable)"]')
  await expect(setButtons).toHaveCount(2)
  await setButtons.nth(1).click()

  const journal = page.locator('#journal')
  await expect(journal).toContainText('transact to ComplexArgs.set', { timeout: 30_000 })
  await expect(journal).not.toContainText('transact to ComplexArgs.set errored')

  const getButtons = instance.locator('button[data-id="get - call"]')
  await expect(getButtons).toHaveCount(2)
  await getButtons.nth(0).click()
  await expect(page.locator('*[data-id="treeViewDiv0"]').last()).toContainText('44', { timeout: 15_000 })
  await expect(page.locator('*[data-id="treeViewDiv1"]').last()).toContainText('hello')
})
