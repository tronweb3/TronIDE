import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, readSavedFile } from './helpers'
import * as fs from 'fs'
import JSZip from 'jszip'
// Pure, IDE-free translation module — exercised directly in Node (no browser).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tronboxExport = require('../../remix-ide/src/app/tabs/runTab/model/tronbox-export.js')

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

  test('TC-DEPLOY-001: address book lists deployed contracts, clears with instances, repopulates on replay', async ({ page }) => {
    await recordAndSaveScenario(page)

    // recordAndSaveScenario leaves the recorder card expanded. Of the two
    // recorded txs only the deploy creates a contract, so the address book
    // holds exactly one Storage entry with a base58 (T...) address.
    const TRON_BASE58 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
    const addressBook = page.locator('[data-id="recorderAddressBook"]')
    const entries = page.locator('[data-id="recorderAddressBookEntry"]')
    await expect(addressBook).toBeVisible()
    await expect(entries).toHaveCount(1)
    await expect(entries.first().locator('[data-id="recorderAddressBookName"]')).toHaveText('Storage')
    const recordedAddress = ((await entries.first().locator('[data-id="recorderAddressBookAddress"]').textContent()) || '').trim()
    expect(recordedAddress).toMatch(TRON_BASE58)

    // The copy icon puts the full (untruncated) address on the clipboard.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await entries.first().locator('[data-id="copyToClipboardCopyIcon"]').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(recordedAddress)

    // Clearing instances resets the recorder, so the address book empties too.
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(entries).toHaveCount(0, { timeout: 10_000 })
    await expect(addressBook).toBeHidden()

    // Replaying the saved scenario repopulates the book — and the entry must
    // survive the recorder's own end-of-run cleanup (run() calls clearAll()
    // right after the last tx, which must not wipe the addresses it deployed).
    await page.locator('i.runtransaction').click()
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
    await expect(entries).toHaveCount(1, { timeout: 15_000 })
    await expect(entries.first().locator('[data-id="recorderAddressBookName"]')).toHaveText('Storage')
    await page.waitForTimeout(1_000) // outlive the end-of-run clearAll
    await expect(entries).toHaveCount(1)
    const replayedAddress = ((await entries.first().locator('[data-id="recorderAddressBookAddress"]').textContent()) || '').trim()
    expect(replayedAddress).toMatch(TRON_BASE58)
  })

  test('TC-DEPLOY-002: replay stops at the failed step, highlights it and keeps earlier deploys in the address book', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Record a three-step scenario whose MIDDLE step fails: deploy Ballot,
    // vote(99) (out-of-range proposal — reverts, but failed txs are recorded,
    // TC-REC-006), then giveRightToVote which succeeds when recorded live.
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

    await page.locator('#runTabView input[title="uint256 proposal"]').fill('99')
    await instance.locator('button[title^="vote - "]', { hasText: 'vote' }).click()
    await expect(page.locator('[title="The number of recorded transactions"]')).toHaveText('2', { timeout: 15_000 })

    const voter = await page.locator('#txorigin option').nth(1).getAttribute('value')
    expect(voter).toBeTruthy()
    await page.locator('#runTabView input[title="address voter"]').fill(voter as string)
    await instance.locator('button[title^="giveRightToVote - "]', { hasText: 'giveRightToVote' }).click()
    await expect(page.locator('[title="The number of recorded transactions"]')).toHaveText('3', { timeout: 15_000 })

    // Save the scenario, clear instances, replay.
    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.locator('i.savetransaction').click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toBeVisible({ timeout: 10_000 })
    await okBtn.click()
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })

    await page.locator('i.runtransaction').click()

    // The flow lists all three steps; the deploy succeeds, the replayed
    // vote(99) reverts again and the flow stops there — failed row
    // highlighted, the third step never executed (stays pending).
    const steps = page.locator('[data-id="recorderDeployFlowStep"]')
    await expect(steps).toHaveCount(3, { timeout: 30_000 })
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'success', { timeout: 30_000 })
    await expect(steps.nth(0)).toContainText('Deploy Ballot')
    await expect(steps.nth(1)).toHaveAttribute('data-status', 'failed', { timeout: 30_000 })
    await expect(steps.nth(1)).toHaveClass(/alert-danger/)
    await page.waitForTimeout(1_500) // a wrongly-continuing flow would reach step 3 here
    await expect(steps.nth(2)).toHaveAttribute('data-status', 'pending')

    // No silent half-success: the address book keeps the deploy that DID land.
    const entries = page.locator('[data-id="recorderAddressBookEntry"]')
    await expect(entries).toHaveCount(1)
    await expect(entries.first().locator('[data-id="recorderAddressBookName"]')).toHaveText('Ballot')

    // Replaying a reverting tx legitimately rejects with "reverted by the EVM"
    // (same as TC-REC-006); anything else is a real error.
    const unexpected = pageErrors.filter((e) => !/reverted by the EVM|revert/i.test(e))
    expect(unexpected).toEqual([])
  })

  test('TC-DEPLOY-003: Export to TronBox downloads a ready-to-migrate project translated from the recorded flow', async ({ page }) => {
    await recordAndSaveScenario(page)

    // The card is expanded; the journal still holds deploy + store(42).
    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-id="recorderExportTronbox"]').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('tronbox-project.zip')

    const zipPath = await download.path()
    expect(zipPath).toBeTruthy()
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath as string))

    // Official tronbox-init scaffolding plus the workspace sources.
    for (const name of ['tronbox-config.js', 'README.md', 'sample-env',
      'migrations/1_initial_migration.js', 'migrations/2_deploy_contracts.js',
      'contracts/Migrations.sol', 'contracts/1_Storage.sol']) {
      expect(zip.file(name), `${name} missing from the export`).toBeTruthy()
    }
    // IDE-only trees must not leak into the project (they break tronbox compile).
    expect(zip.file(/^tests\//).length).toBe(0)

    // The recorded flow is translated: deploy Storage, capture the instance,
    // then replay store("42") against it.
    const migration = await zip.file('migrations/2_deploy_contracts.js')!.async('string')
    expect(migration).toContain("artifacts.require('Storage')")
    expect(migration).toContain('await deployer.deploy(Storage)')
    expect(migration).toContain('await Storage.deployed()')
    expect(migration).toContain('.store("42")')
    expect(migration).not.toContain('TODO')

    // The config carries the Tron networks and pins a concrete solc version.
    const config = await zip.file('tronbox-config.js')!.async('string')
    expect(config).toContain('https://nile.trongrid.io')
    expect(config).toContain('https://api.shasta.trongrid.io')
    expect(config).toMatch(/version: '\d+\.\d+\.\d+'/)
  })

  test('TC-DEPLOY-004: an unresolved address parameter emits a TODO marker, never a bare created{ts} token', async () => {
    // A function call whose `to` resolves (Owned was deployed) but whose
    // address PARAMETER references a deploy that was filtered out / failed
    // (created{999}). The old behaviour shipped a literal "created{999}"
    // string argument — non-compiling code with no warning. It must now be a
    // clear /* TODO: unresolved reference ... */ marker, matching the
    // to-target path.
    const scenario = {
      transactions: [
        { timestamp: '100', record: { type: 'constructor', contractName: 'Owned', parameters: [] } },
        { timestamp: '200', record: { type: 'function', name: 'setOwner', to: 'created{100}', parameters: ['created{999}'] } }
      ]
    }
    const migration = tronboxExport.scenarioToMigration(scenario)
    // The resolvable deploy still translates normally.
    expect(migration).toContain('await deployer.deploy(Owned)')
    // The unresolved param is flagged, not silently broken.
    expect(migration).toContain('/* TODO: unresolved reference')
    // It must NOT pass the raw token as a live JS string argument.
    expect(migration).not.toMatch(/setOwner\(\s*"created\{999\}"\s*\)/)
  })

  test('TC-DEPLOY-005: exporting with a corrupt scenario.json surfaces the parse error, not "Nothing to export"', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Create an invalid scenario JSON and make it the current file (recorder
    // journal is empty, so export falls back to the open .json file).
    // The file explorer is the default side panel on load; clicking its icon
    // when it's already active would TOGGLE it shut (hiding the tree). Only click
    // if the contracts folder isn't already visible. The "New File" toolbar icon
    // also mounts only once the tree has rendered, so wait for the folder first.
    const contractsFolder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    if (!await contractsFolder.isVisible()) await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(contractsFolder).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').click()
    const editable = page.locator('div.remixui_items[contenteditable="true"]')
    await editable.waitFor({ state: 'visible', timeout: 10_000 })
    await editable.focus()
    await page.evaluate((el) => { (el as HTMLElement).innerText = 'broken-scenario.json' }, await editable.elementHandle())
    await editable.press('Enter')
    const fileItem = page.locator('[data-id="treeViewLitreeViewItembroken-scenario.json"]')
    await expect(fileItem).toBeVisible({ timeout: 10_000 })
    await fileItem.click()
    // Wait for the editor to mount the just-opened file, write the corrupt JSON
    // and flush it to disk with Ctrl+S — the editor's own auto-save is debounced
    // 5s, far longer than the export read below, so an explicit save is required
    // for fileManager.readFile to see the corrupt content (not an empty file).
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await page.evaluate(() => {
      const elem = document.getElementById('input') as any
      if (elem && elem.editor) elem.editor.session.setValue('{ this is : not valid json , ]')
    })
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(500) // let the save settle before exporting

    // Open the recorder (export button mounts with the card expanded) and export.
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.locator('[data-id="recorderExportTronbox"]').click()

    // The corrupt JSON is reported as such — not swallowed into the misleading
    // "Nothing to export" fall-through (silent-failure M4).
    const modalBody = page.locator('[data-id="modalDialogModalBody"]')
    await expect(modalBody).toBeVisible({ timeout: 10_000 })
    await expect(modalBody).toContainText(/invalid scenario JSON/i)
    await expect(modalBody).not.toContainText(/Nothing to export/i)
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
  // TC-REC-EXP-1 (J-008): a recorded call that REVERTED in the IDE must not
  // ship as a live migration step — the exporter comments it out with the
  // same TODO convention it already uses for untranslatable steps.
  test('TC-REC-EXP-1: a reverted recorded call exports as a TODO comment, not a live step', { tag: '@gate' }, async () => {
    const scenario = {
      transactions: [
        { timestamp: 1, record: { type: 'constructor', contractName: 'Storage', parameters: [], from: 'account{0}' } },
        { timestamp: 2, record: { type: 'function', name: 'store', to: 'created{1}', parameters: [42], from: 'account{0}' } },
        { timestamp: 3, record: { type: 'function', name: 'store', to: 'created{1}', parameters: [43], from: 'account{0}', failed: true } }
      ]
    }
    const out = tronboxExport.scenarioToMigration(scenario)
    expect(out).toContain('await deployer.deploy(Storage);')
    expect(out).toContain('await storage.store(42);')
    expect(out).toContain('REVERTED')
    expect(out).toContain('// await storage.store(43);')
    // exactly ONE live (uncommented) store call survives
    expect((out.match(/^\s*await storage\.store\(/gm) || []).length).toBe(1)

    // a reverted DEPLOY is also fenced off, and later references to it fall
    // into the existing unresolved-reference TODO path
    const out2 = tronboxExport.scenarioToMigration({
      transactions: [
        { timestamp: 5, record: { type: 'constructor', contractName: 'Storage', parameters: [], from: 'account{0}', failed: true } },
        { timestamp: 6, record: { type: 'function', name: 'store', to: 'created{5}', parameters: [1], from: 'account{0}' } }
      ]
    })
    expect(out2).toContain('// await deployer.deploy(Storage);')
    expect(out2).toMatch(/REVERTED/)
    expect((out2.match(/^\s*await deployer\.deploy\(/gm) || []).length).toBe(0)
    expect(out2).toMatch(/targeted an instance not deployed in this flow/)

    // a reverted library-linked deploy fences its LINK lines too (the fence
    // must start before deployer.link — a live link for a fenced deploy would
    // still run on-chain), and the callValue review note survives fencing
    const out3 = tronboxExport.scenarioToMigration({
      transactions: [
        { timestamp: 7, record: { type: 'constructor', contractName: 'MathLib', parameters: [], from: 'account{0}' } },
        {
          timestamp: 8,
          record: {
            type: 'constructor',
            contractName: 'Consumer',
            parameters: [],
            from: 'account{0}',
            failed: true,
            value: '5',
            linkReferences: { 'contracts/MathLib.sol': { MathLib: [] } }
          }
        }
      ]
    })
    expect(out3).toContain('await deployer.deploy(MathLib);')
    expect(out3).toContain('// await deployer.link(MathLib, Consumer);')
    // A constructor callValue is now emitted as the explicit TronBox options
    // object. Keep the reverted fence assertion aligned with the generated
    // syntax instead of the pre-options deployer form.
    expect(out3).toContain('// await deployer.deploy(Consumer, { callValue: 5 });')
    expect(out3).toContain('callValue: 5')
    // no LIVE link or Consumer-deploy lines survive the fence
    expect((out3.match(/^\s*await deployer\.link\(/gm) || []).length).toBe(0)
    expect((out3.match(/^\s*await deployer\.deploy\(Consumer/gm) || []).length).toBe(0)
  })

  // TC-REC-EXP-2 (J-008): the STAMPING half of the fix — a revert recorded in
  // the real product must land as record.failed=true in the saved scenario.
  // TC-REC-EXP-1 pins the export half from an already-stamped scenario; this
  // pins the recorder listener that produces the stamp, so deleting or
  // breaking it can no longer pass the gate.
  test('TC-REC-EXP-2: a reverting recorded call is stamped failed:true in the saved scenario', { tag: '@gate' }, async ({ page }) => {
    // Deterministic compile: kill the version-list fetch so the panel degrades
    // to the always-reachable builtin compiler (blockCompilerSources would
    // abort the builtin too — it is for specs that never finish a compile).
    await page.route('**/list.json*', (route) => route.abort())
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const ballotFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/3_Ballot.sol"]')
    if (!await ballotFile.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await ballotFile.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await expect.poll(async () => await page.locator('#versionSelector').inputValue(), { timeout: 20_000 }).toBe('builtin')
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

    // vote(99) reverts (out-of-range proposal); both txs stay recorded
    await page.locator('#runTabView input[title="uint256 proposal"]').fill('99')
    await instance.locator('button[title^="vote - "]', { hasText: 'vote' }).click()
    await expect(page.locator('[title="The number of recorded transactions"]')).toHaveText('2', { timeout: 30_000 })

    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    await recorderCard.locator('i[class*="arrow"]').first().click()
    await page.locator('i.savetransaction').click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toBeVisible({ timeout: 10_000 })
    await okBtn.click()

    // the saved scenario carries the stamp the exporter fences on: the deploy
    // stays live, the reverted vote is failed:true. The file lands in the
    // current file's directory (saveScenario uses fileManager.currentPath()).
    await expect.poll(async () => {
      const raw = (await readSavedFile(page, 'contracts/scenario.json').catch(() => '')) ||
        (await readSavedFile(page, 'scenario.json').catch(() => ''))
      if (!raw) return 'missing'
      let scenario
      try { scenario = JSON.parse(raw) } catch (e) { return 'unparseable' }
      const txs = (scenario.transactions || [])
      const deploy = txs.find((t) => t.record && t.record.type === 'constructor')
      const vote = txs.find((t) => t.record && t.record.name === 'vote')
      if (!deploy || !vote) return 'incomplete'
      return `deploy:${deploy.record.failed ? 'failed' : 'live'} vote:${vote.record.failed === true ? 'failed' : 'live'}`
    }, { timeout: 20_000 }).toBe('deploy:live vote:failed')
  })
})
