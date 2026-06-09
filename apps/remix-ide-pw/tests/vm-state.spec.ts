import { test, expect, Page } from '@playwright/test'
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
})
