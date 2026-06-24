import { test, expect, Page } from '@playwright/test'
import { keccak256 } from 'js-sha3'
import { dismissWelcomeModal } from './helpers'

// TC-VM-002 / TC-VM-003: state-changing calls update VM state correctly, and
// reverting calls surface a failed transaction (they are not reported as
// success). Both run entirely on the in-browser JavaScript VM (Tron).

async function compileAndOpenUdapp (page: Page, file: string, contractName: string) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

  const sourceFile = page.locator(`[data-id="treeViewLitreeViewItemcontracts/${file}"]`)
  if (!await sourceFile.isVisible()) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await sourceFile.click()

  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText(contractName, { timeout: 30_000 })

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption(contractName)
}

test.describe('JavaScript VM (Tron) state changes and reverts', () => {
  test('TC-VM-002: store updates state and retrieve reads the new value back', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')

    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // store(42) — a state-changing transaction.
    await page.locator('#runTabView input[title="uint256 num"]').fill('42')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()

    // retrieve() — view call must reflect the stored value.
    await instance.locator('button[title="retrieve - call"]', { hasText: 'retrieve' }).click()
    const decoded = page.locator('*[data-id="treeViewDiv0"]')
    await expect(decoded).toContainText('uint256', { timeout: 15_000 })
    await expect(decoded).toContainText('42')
  })

  test('TC-VM-003: a reverting call is reported as a failed transaction, not success', async ({ page }) => {
    await compileAndOpenUdapp(page, '3_Ballot.sol', 'Ballot')

    // Deploy with a single proposal so winningProposal()/vote indices exist.
    await page.locator('input[placeholder="bytes32[] proposalNames"]')
      .fill('["0x48656c6c6f20576f726c64210000000000000000000000000000000000000000"]')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // vote(99) indexes past the single proposal -> Solidity 0.8 panic -> revert.
    await page.locator('#runTabView input[title="uint256 proposal"]').fill('99')
    await instance.locator('button[title="vote - transact (not payable)"]', { hasText: 'vote' }).click()

    // The terminal must report the revert as a failure. (The earlier deploy tx
    // legitimately logs success in the same journal, so we assert on the
    // failure signal that a reverting call produces and a deploy never does.)
    const journal = page.locator('*[data-id="terminalJournal"]')
    await expect(journal).toContainText(/revert|errored|execution failed/i, { timeout: 30_000 })
  })

  test('TC-VM-007: ten consecutive deploys each produce a distinct instance (no polling hang)', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')

    const deploy = page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' })
    const instances = page.locator('.instance')
    // Deploy 10 times; waiting for the instance count after each click confirms
    // every tx mines one-to-one and the VM polling never stalls.
    for (let i = 1; i <= 10; i++) {
      await deploy.click()
      await expect(instances).toHaveCount(i, { timeout: 30_000 })
    }
    await expect(instances).toHaveCount(10)
  })

  test('TC-VM-009: mapping write — getter readback and debugger storage agree on the slot', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')

    // Replace the buffer with a mapping contract and recompile.
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract MapStore {',
      '  mapping(uint256 => uint256) public table;',
      '  function put(uint256 k, uint256 v) public { table[k] = v; }',
      '}'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('MapStore', { timeout: 30_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('MapStore')

    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.locator('#runTabView input[title*="uint256 k"]').fill('1,42')
    await instance.locator('button[title*="put"]', { hasText: 'put' }).click()
    await expect(page.locator('*[data-shared="txLoggerDebugButton"]')).toHaveCount(2, { timeout: 30_000 })

    // Read back through the getter: table(1) == 42.
    await page.locator('#runTabView input[title="uint256 "], #runTabView input[title*="uint256"]').last().fill('1')
    await instance.locator('button[title*="table"]', { hasText: 'table' }).click()
    await expect(page.locator('*[data-id="treeViewDiv0"]')).toContainText('42', { timeout: 15_000 })

    // Debug the put(1,42) tx and jump to the end of the trace: the debugger's
    // Storage panel must show value 0x2a at keccak256(key(1) ++ slot(0)).
    await page.locator('*[data-shared="txLoggerDebugButton"]').nth(1).click()
    await expect(page.locator('*[data-id="sidePanelSwapitTitle"]')).toContainText(/debugger/i, { timeout: 60_000 })
    const slider = page.locator('input[data-id="slider"]')
    await slider.waitFor({ timeout: 30_000 })
    const max = await slider.getAttribute('max')
    await slider.fill(String(max))
    await slider.dispatchEvent('change')

    const keyBytes = new Uint8Array(64)
    keyBytes[31] = 1 // mapping key 1, mapping at storage slot 0
    const expectedSlot = keccak256(keyBytes)
    const storagePanel = page.locator('#storagepanel')
    await expect(storagePanel).toContainText(new RegExp(expectedSlot.slice(0, 12), 'i'), { timeout: 30_000 })
    await expect(storagePanel).toContainText(/2a/i)
  })

  test('TC-VM-010: library linking and CREATE2 deploys survive the tvmjs APIs', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'library MathLib { function double(uint256 x) external pure returns (uint256) { return x * 2; } }',
      'contract Child { uint256 public tag; constructor(uint256 t) { tag = t; } }',
      'contract Factory {',
      '  address public last;',
      '  function make(uint256 t) public { last = address(new Child{salt: bytes32(uint256(t))}(t)); }',
      '  function calc(uint256 x) public pure returns (uint256) { return MathLib.double(x); }',
      '}'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Factory', { timeout: 30_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Factory')

    // Deploying Factory requires the external library to be auto-deployed and
    // linked first (deployContractAndLibraries path).
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // Linked library call works: calc(21) == 42.
    await page.locator('#runTabView input[title="uint256 x"]').fill('21')
    await instance.locator('button[title*="calc"]', { hasText: 'calc' }).click()
    await expect(page.locator('*[data-id="treeViewDiv0"]').last()).toContainText('42', { timeout: 15_000 })

    // CREATE2 works: make(7) succeeds and `last` becomes a real address.
    await page.locator('#runTabView input[title="uint256 t"]').fill('7')
    await instance.locator('button[title*="make"]', { hasText: 'make' }).click()
    await page.waitForTimeout(1_500)
    const journal = ((await page.locator('#journal').textContent()) || '').replace(/\s+/g, ' ')
    expect(journal).not.toMatch(/make.*errored/i)
    await instance.locator('button[title*="last"]', { hasText: 'last' }).click()
    const lastValue = page.locator('*[data-id="treeViewDiv0"]').last()
    await expect(lastValue).toContainText(/T\w{20,}|0x[0-9a-fA-F]{6,}/, { timeout: 15_000 })
    // the zero address must be excluded in BOTH renderings: hex AND base58
    // (T9yD14… satisfied the patterns above vacuously — DEF-VM-1 lesson)
    await expect(lastValue).not.toContainText(/0x0{40}/)
    await expect(lastValue).not.toContainText('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')
  })

  test('TC-VM-011: reload resets the VM — same accounts, nonce back to zero, no stale instances', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    const accountOptions = page.locator('select[data-id="runTabSelectAccount"] option')
    await expect.poll(() => accountOptions.count(), { timeout: 15_000 }).toBeGreaterThan(0)
    const accountsBefore = await accountOptions.allInnerTexts()

    // Two deploys advance the nonce: distinct creation addresses.
    const deployBtn = page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' })
    const instances = page.locator('.instance')
    await deployBtn.click()
    await expect(instances).toHaveCount(1, { timeout: 30_000 })
    const firstAddress = await instances.first().getAttribute('id')
    await deployBtn.click()
    await expect(instances).toHaveCount(2, { timeout: 30_000 })
    expect(await instances.nth(1).getAttribute('id')).not.toBe(firstAddress)

    // Reload = VM reset. The deterministic account set must come back as-is,
    // stale instances must be gone, and the first deploy must land on the SAME
    // creation address as a fresh session (nonce back to zero).
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    await expect(instances).toHaveCount(0)
    await expect.poll(() => accountOptions.count(), { timeout: 15_000 }).toBe(accountsBefore.length)
    expect(await accountOptions.allInnerTexts()).toEqual(accountsBefore)
    await deployBtn.click()
    await expect(instances).toHaveCount(1, { timeout: 30_000 })
    expect(await instances.first().getAttribute('id')).toBe(firstAddress)
  })
})
