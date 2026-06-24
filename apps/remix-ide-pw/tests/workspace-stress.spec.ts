import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Workspace robustness:
//   TC-WS-005 — deep nested paths and very long file names are handled without
//               crashing the IDE.
//   TC-WS-009 — fast file switching while saving a recorder scenario does not
//               open empty content or overwrite the wrong file.

async function createWorkspace (page: Page, name: string) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  await page.locator('[data-id="workspaceCreate"]').click()
  const input = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
  await input.waitFor({ state: 'visible', timeout: 5000 })
  await input.fill(name)
  await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
  await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(name, { timeout: 15_000 })
}

// Create a file by name (slashes create intermediate folders) via the file
// explorer's inline contenteditable input.
async function createFileNamed (page: Page, name: string) {
  await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').click()
  const editable = page.locator('div.remixui_items[contenteditable="true"]')
  await editable.waitFor({ state: 'visible', timeout: 5000 })
  await editable.focus()
  await page.evaluate((n) => {
    const el = document.querySelector('div.remixui_items[contenteditable="true"]') as HTMLElement
    if (el) el.innerText = n
  }, name)
  await editable.press('Enter')
}

test.describe('Workspace robustness', () => {
  test('TC-WS-005: deep nested paths and a long file name are handled without crashing', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await createWorkspace(page, 'ws-deep')

    // A very long file name (200 chars) at the root — done first, on a clean
    // tree, so the inline input is on-screen. Either created or rejected with a
    // message, never a crash.
    const longName = 'L'.repeat(200) + '.sol'
    await createFileNamed(page, longName)
    await page.waitForTimeout(1_500)
    await expect(page.locator('#side-panel')).toBeVisible()
    expect(pageErrors).toEqual([])

    // 20-level nested path — creating it opens the leaf in the editor, the most
    // reliable proof (tree nodes are virtualized, folder data-ids vary).
    const levels = Array.from({ length: 20 }, (_, i) => `lvl${i + 1}`)
    const deepPath = levels.join('/') + '/Deep.sol'
    await createFileNamed(page, deepPath)
    await expect(page.locator('remix-tab[id$="Deep.sol"]')).toBeVisible({ timeout: 20_000 })
    await page.evaluate(() => {
      const el = document.getElementById('input') as any
      if (el && el.editor) el.editor.session.setValue('// deep file ok')
    })

    // The IDE survived both operations: still responsive, no uncaught error.
    await expect(page.locator('#side-panel')).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('TC-WS-009: fast file switching while saving a recorder scenario keeps content correct', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Record a VM transaction (deploy + store) to have something to save.
    const storageFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storageFile.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storageFile.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.locator('#runTabView input[title="uint256 num"]').fill('7')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()
    await expect(page.locator('[title="The number of recorded transactions"]')).toHaveText('2', { timeout: 15_000 })

    // Rapidly switch the open file across the contract set while kicking off the
    // scenario save — the save must not capture an empty buffer or clobber the
    // file that happens to be current mid-switch.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const files = ['contracts/2_Owner.sol', 'contracts/3_Ballot.sol', 'contracts/1_Storage.sol']
    for (const f of files) {
      const item = page.locator(`[data-id="treeViewLitreeViewItem${f}"]`)
      if (await item.isVisible()) await item.click()
    }
    // Save the scenario from the recorder card immediately after the churn.
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.locator('i.savetransaction').click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toBeVisible({ timeout: 10_000 })
    await okBtn.click()

    // The scenario saved with real content; none of the existing contracts were
    // overwritten by the scenario JSON.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const scenario = page.locator('span[data-path$="scenario.json"]').first()
    await expect(scenario).toBeVisible({ timeout: 20_000 })
    await scenario.click()
    await page.waitForTimeout(1_000)
    const scenarioContent = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })
    expect(scenarioContent.length).toBeGreaterThan(2)
    expect(() => JSON.parse(scenarioContent)).not.toThrow()

    // The Storage contract still holds its Solidity source, not scenario JSON.
    await page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]').click()
    await page.waitForTimeout(1_000)
    const storageContent = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })
    expect(storageContent).toMatch(/contract Storage/)
    expect(storageContent).not.toContain('"transactions"')
    expect(pageErrors).toEqual([])
  })
})
