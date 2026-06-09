import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Debugger coverage over VM (Tron) transactions:
//   TC-DBG-001 — debug a successful tx: trace captured, steppable.
//   TC-DBG-002 — debug a FAILING (revert) tx: does not crash, trace + failing-tx
//                locals are still available (guards the failing-tx-locals fix).
//   TC-DBG-003 — DebuggerLocals: named call params show as locals, state vars do not.

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

async function expectDebuggerReady (page: Page) {
  await expect(page.locator('*[data-id="sidePanelSwapitTitle"]')).toContainText(/debugger/i, { timeout: 60_000 })
  await expect(page.locator('*[data-id="buttonNavigatorJumpPreviousBreakpoint"]')).toBeVisible({ timeout: 60_000 })
  const stepDetail = page.locator('*[data-id="stepdetail"]')
  await expect(stepDetail).toContainText('vm trace step:', { timeout: 60_000 })
  await expect(stepDetail).toContainText('execution step:', { timeout: 60_000 })
}

// The debugger opens at the start of the trace (before the function body), where
// "Solidity Locals" is empty. Step "into forward" until the locals panel matches
// `re`, so assertions don't depend on the exact entry step. Returns the locals
// text at the matched (or final) step.
async function stepIntoForwardUntilLocals (page: Page, re: RegExp, maxSteps = 80): Promise<string> {
  const locals = page.locator('*[data-id="solidityLocals"]')
  const intoForward = page.locator('*[data-id="buttonNavigatorIntoForward"]')
  let txt = await locals.innerText()
  for (let i = 0; i < maxSteps && !re.test(txt); i++) {
    await intoForward.click()
    txt = await locals.innerText()
  }
  return txt
}

test.describe('Debugger over a VM (Tron) transaction', () => {
  test('TC-DBG-001: debug a successful tx — trace is captured and steppable', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.locator('#runTabView input[title="uint256 num"]').fill('42')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()

    const debugButtons = page.locator('*[data-shared="txLoggerDebugButton"]')
    // Wait for the function-call tx to be logged (deploy + call = 2 buttons),
    // then debug the call (oldest-first order, so the call is last).
    await expect(debugButtons).toHaveCount(2, { timeout: 30_000 })
    await debugButtons.last().click()

    await expectDebuggerReady(page)

    // Stepping forward keeps the trace consistent (controls are wired up).
    await page.locator('*[data-id="buttonNavigatorIntoForward"]').click()
    const stepDetail = page.locator('*[data-id="stepdetail"]')
    await expect(stepDetail).toContainText('vm trace step:', { timeout: 60_000 })
    await expect(stepDetail).toContainText('execution step:', { timeout: 60_000 })
  })

  test('TC-DBG-003: named call params show as locals, state variables are not listed as locals', async ({ page }) => {
    await compileAndOpenUdapp(page, '3_Ballot.sol', 'Ballot')

    await page.locator('input[placeholder="bytes32[] proposalNames"]')
      .fill('["0x48656c6c6f20576f726c64210000000000000000000000000000000000000000"]')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    // vote(0) is a valid (succeeding) call. `proposal` is its parameter local;
    // `chairperson` is a state variable that must NOT appear as a local.
    await page.locator('#runTabView input[title="uint256 proposal"]').fill('0')
    await instance.locator('button[title="vote - transact (not payable)"]', { hasText: 'vote' }).click()

    const debugButtons = page.locator('*[data-shared="txLoggerDebugButton"]')
    // Wait for the function-call tx to be logged (deploy + call = 2 buttons),
    // then debug the call (oldest-first order, so the call is last).
    await expect(debugButtons).toHaveCount(2, { timeout: 30_000 })
    await debugButtons.last().click()
    await expectDebuggerReady(page)

    // Step until the call parameter `proposal` shows up in Solidity Locals.
    const localsText = await stepIntoForwardUntilLocals(page, /proposal/)
    expect(localsText).toMatch(/proposal/)
    // The state variable `chairperson` must NOT be reported as a local...
    expect(localsText).not.toContain('chairperson')
    // ...it belongs in Solidity State instead.
    await expect(page.locator('*[data-id="soliditystate"]')).toContainText('chairperson', { timeout: 60_000 })
  })

  test('TC-DBG-002: debug a reverting tx — no crash, trace and failing-tx locals available', async ({ page }) => {
    await compileAndOpenUdapp(page, '3_Ballot.sol', 'Ballot')

    await page.locator('input[placeholder="bytes32[] proposalNames"]')
      .fill('["0x48656c6c6f20576f726c64210000000000000000000000000000000000000000"]')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()

    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // vote(99) reverts (index past the single proposal) — the failing tx to debug.
    await page.locator('#runTabView input[title="uint256 proposal"]').fill('99')
    await instance.locator('button[title="vote - transact (not payable)"]', { hasText: 'vote' }).click()

    // Debug the most recent (failed) transaction.
    const debugButtons = page.locator('*[data-shared="txLoggerDebugButton"]')
    // Wait for the function-call tx to be logged (deploy + call = 2 buttons),
    // then debug the call (oldest-first order, so the call is last).
    await expect(debugButtons).toHaveCount(2, { timeout: 30_000 })
    await debugButtons.last().click()

    // Debugger must open and produce a steppable trace for the reverting tx
    // (it must not crash) — this is the core failing-tx guard.
    await expectDebuggerReady(page)

    // Failing-tx locals must still be recovered AND correctly scoped: stepping
    // through the reverting call surfaces the `proposal` parameter of vote().
    const localsText = await stepIntoForwardUntilLocals(page, /proposal/)
    expect(localsText).toMatch(/proposal/)
  })
})
