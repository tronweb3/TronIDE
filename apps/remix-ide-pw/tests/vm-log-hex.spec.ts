import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Regression guard for G-013: the VM provider must encode byte payloads
// (return data, memory-backed locals, event logs) as canonical 0x hex via
// bufferToHex. The original bug surfaced plain Uint8Array values as a
// comma-joined decimal string (e.g. "72,101,108,108,111, ..."), corrupting
// every downstream bytes/bytes32 display. We deploy the default Ballot
// contract with a known bytes32 proposal name and read it back through a
// view call: the decoded output must render as hex, never as decimals.
test.describe('VM log / return-data hex encoding (G-013)', () => {
  // "Hello World!" packed into the low bytes of a bytes32 proposal name.
  const proposalNameHex = '0x48656c6c6f20576f726c64210000000000000000000000000000000000000000'
  const helloWorldHex = '48656c6c6f20576f726c6421'

  test('bytes32 return value renders as canonical hex, not comma-joined decimals', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Open contracts/3_Ballot.sol from the default workspace.
    const ballotFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/3_Ballot.sol"]')
    if (!await ballotFile.isVisible()) {
      await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    }
    await ballotFile.click()

    // Compile and wait for the Ballot artifact.
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Ballot', { timeout: 30_000 })

    // Deploy & Run on the JavaScript VM (Tron) environment.
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
    await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })

    // Select Ballot (3_Ballot.sol also defines BallotTest) and deploy it
    // with a single, known proposal name.
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Ballot')
    await page.locator('input[placeholder="bytes32[] proposalNames"]').fill(`["${proposalNameHex}"]`)
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // winnerName() is a view call returning bytes32 == proposals[0].name.
    await instance.locator('button:has-text("winnerName")').click()

    const decoded = page.locator('*[data-id="treeViewDiv0"]')
    await expect(decoded).toContainText('bytes32', { timeout: 15_000 })

    const decodedText = (await decoded.innerText()).trim()
    // Must show canonical hex of the proposal name we deployed with...
    expect(decodedText.toLowerCase()).toContain(`0x${helloWorldHex}`)
    // ...and must NOT have regressed to a comma-joined decimal byte string.
    expect(decodedText).not.toMatch(/\d{1,3},\d{1,3},\d{1,3}/)
  })
})
