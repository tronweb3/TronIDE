import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-REC-001 / TC-REC-004: VM (Tron) transactions are recorded and can be saved
// to a scenario file, and a saved scenario can be replayed to re-create state.

// Compile + deploy Storage, run a state-changing call (both recorded), expand the
// recorder card and save the scenario. Leaves the Deploy & Run panel active with
// scenario.json as the current file.
async function recordAndSaveScenario (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

  const storageFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storageFile.isVisible()) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await storageFile.click()
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

  const instance = page.locator('.instance').first()
  await expect(instance).toBeVisible({ timeout: 30_000 })
  await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
  await page.locator('#runTabView input[title="uint256 num"]').fill('42')
  await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()

  // The recorder save/run icons only mount when the card is expanded.
  const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
  await recorderCard.locator('i[class*="arrow"]').first().click()

  await page.locator('i.savetransaction').click()
  const okBtn = page.locator('#modal-footer-ok')
  await expect(okBtn).toBeVisible({ timeout: 10_000 })
  await okBtn.click()
}

test.describe('Transaction recorder', () => {
  test('TC-REC-001: record VM transactions and save them to a scenario file', async ({ page }) => {
    await recordAndSaveScenario(page)

    // The scenario file is created in the workspace.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(page.locator('span[data-path$="scenario.json"]').first()).toBeVisible({ timeout: 20_000 })
  })

  test('TC-REC-004: replay a saved scenario re-creates the deployed instance', async ({ page }) => {
    await recordAndSaveScenario(page)

    // Clear the recorded/deployed instances...
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })

    // ...then replay the scenario (scenario.json is the current file). Replaying on
    // the VM auto-proceeds (no Main-net confirmation modal).
    await page.locator('i.runtransaction').click()

    // The deploy from the scenario re-creates the instance.
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
  })

  test('TC-IX-FILE-002: saving a scenario makes it the current file so an immediate replay targets it', async ({ page }) => {
    // Save flow auto-opens scenario.json — the recorder reads config currentFile
    // when replaying, so the just-saved scenario must be the active target with
    // no intermediate file switch (S3 currentFile sync).
    await recordAndSaveScenario(page)
    await expect(page.locator('remix-tab[id$="scenario.json"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })

    // Replay immediately (no file navigation in between) — it must re-run the
    // saved scenario, not error on a stale/empty current file.
    await page.locator('i.runtransaction').click()
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#journal')).not.toContainText(/a json content must be provided|scenario file is required/i)
  })

  test('TC-REC-007: a second save fires its callback exactly once — one file per save, no late modal', async ({ page }) => {
    await recordAndSaveScenario(page)

    // Save again right away. fileProvider.set supports both callback and
    // Promise completion; the recorder must resolve each save exactly once
    // (non-clashing name, single prompt, no duplicate/late dialogs).
    await page.locator('i.savetransaction').click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toHaveCount(1, { timeout: 10_000 })
    await okBtn.click()
    await expect(okBtn).toBeHidden({ timeout: 10_000 })
    await page.waitForTimeout(2_000)
    await expect(okBtn).toBeHidden() // a late duplicate callback would re-open a dialog

    // Exactly two scenario files: scenario.json + the non-clashing second name
    // (TC-REC-003: the clash resolves to scenario1.json, nothing overwritten).
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(page.locator('span[data-path*="scenario"][data-path$=".json"]')).toHaveCount(2, { timeout: 20_000 })
    await expect(page.locator('span[data-path$="scenario1.json"]')).toHaveCount(1)
  })

  test('TC-REC-002: saving from the workspace root writes a clean root path, content intact', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

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
    await page.locator('#runTabView input[title="uint256 num"]').fill('42')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()
    await expect(page.locator('[title="The number of recorded transactions"]')).toHaveText('2', { timeout: 15_000 })

    // Close the source tab: with no file selected, currentPath() falls back to
    // the workspace root — the recorder must save a clean root path, never
    // '//scenario.json' or '/scenario.json'.
    await page.locator('remix-tab[id$="1_Storage.sol"] .close').click()
    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.locator('i.savetransaction').click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toBeVisible({ timeout: 10_000 })
    await okBtn.click()

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const rootFile = page.locator('span[data-path="scenario.json"]')
    await expect(rootFile).toHaveCount(1, { timeout: 20_000 })
    // The bug guarded against is a doubled/leading slash like '//scenario.json'.
    await expect(page.locator('span[data-path="//scenario.json"], span[data-path="/scenario.json"]')).toHaveCount(0)

    // Content integrity: the saved journal parses and holds both records.
    await rootFile.click()
    await page.waitForTimeout(1_000)
    const content = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })
    const parsed = JSON.parse(content)
    expect(Array.isArray(parsed.transactions)).toBeTruthy()
    expect(parsed.transactions.length).toBe(2)
  })

  test('TC-REC-005: replay rebinds recorded addresses — the replayed instance serves the recorded state', async ({ page }) => {
    await recordAndSaveScenario(page)

    // Clear and replay: the scenario's account/created-address tokens must
    // rebind (base58/hex round-trip) so the replayed instance works end-to-end.
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })
    await page.locator('i.runtransaction').click()
    const replayed = page.locator('.instance').first()
    await expect(replayed).toBeVisible({ timeout: 30_000 })
    await replayed.locator('[data-id="universalDappUiTitleExpander"]').click()
    await replayed.locator('button[title="retrieve - call"]', { hasText: 'retrieve' }).click()
    await expect(page.locator('*[data-id="treeViewDiv0"]').last()).toContainText('42', { timeout: 15_000 })
  })

  test('TC-REC-006: failing txs are recorded and the replay preserves the failure', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const ballotFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/3_Ballot.sol"]')
    if (!await ballotFile.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await ballotFile.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Ballot', { timeout: 30_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Ballot')
    await page.locator('input[placeholder="bytes32[] proposalNames"]').fill('["0x0000000000000000000000000000000000000000000000000000000000000001"]')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // vote(99) reverts — the failed tx must still be recorded (badge 2).
    await page.locator('#runTabView input[title="uint256 proposal"]').fill('99')
    await instance.locator('button[title^="vote - "]', { hasText: 'vote' }).click()
    await expect(page.locator('#journal')).toContainText(/vote.*errored|errored.*vote|revert/i, { timeout: 30_000 })
    await expect(page.locator('[title="The number of recorded transactions"]')).toHaveText('2', { timeout: 15_000 })

    // Save, clear, replay: the deploy replays AND the failure replays as a
    // failure — preserved, not silently dropped; nothing uncaught.
    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.locator('i.savetransaction').click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toBeVisible({ timeout: 10_000 })
    await okBtn.click()
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })
    const journalBefore = ((await page.locator('#journal').textContent()) || '').length

    await page.locator('i.runtransaction').click()
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => (((await page.locator('#journal').textContent()) || '').slice(journalBefore)), { timeout: 30_000 })
      .toMatch(/errored|revert/i)
    // Replaying a reverting tx legitimately rejects with "reverted by the EVM";
    // only genuinely unexpected errors (not the recorded revert) should fail.
    const unexpected = pageErrors.filter((e) => !/reverted by the EVM|revert/i.test(e))
    expect(unexpected).toEqual([])
  })
})
