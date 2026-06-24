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

  test('TC-DBG-004: entry function resolves by calldata selector — distinct functions, distinct locals', async ({ page }) => {
    await compileAndOpenUdapp(page, '3_Ballot.sol', 'Ballot')
    await page.locator('input[placeholder="bytes32[] proposalNames"]').fill('["0x0000000000000000000000000000000000000000000000000000000000000001"]')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()

    // Call giveRightToVote(address) — a different selector than vote(uint256).
    const voterAddress = await page.locator('select[data-id="runTabSelectAccount"] option').nth(1).getAttribute('value')
    await page.locator('#runTabView input[title="address voter"]').fill(voterAddress as string)
    await instance.locator('button[title*="giveRightToVote"]', { hasText: 'giveRightToVote' }).click()
    const debugButtons = page.locator('*[data-shared="txLoggerDebugButton"]')
    await expect(debugButtons).toHaveCount(2, { timeout: 30_000 })
    await debugButtons.last().click()
    await expectDebuggerReady(page)

    // The debugger must resolve the entry to giveRightToVote: its named param
    // `voter` appears in the locals — and vote()'s `proposal` must NOT.
    const localsText = await stepIntoForwardUntilLocals(page, /voter/)
    expect(localsText).toMatch(/voter/)
    expect(localsText).not.toMatch(/proposal\b/)
  })

  test('TC-DBG-009: debugging a stale tx hash after reload fails with a clear message, no blank/uncaught', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    // Produce a tx, then reload — the VM forgets it; use a well-formed but
    // unknown hash to hit the same not-found path deterministically.
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // The debugger plugin only joins the icon panel once activated — go
    // through the Plugin Manager after the reload.
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentSearchInput"]').fill('debugger')
    await page.locator('[data-id="pluginManagerComponentActivateButtondebugger"]').click()
    const debuggerIcon = page.locator('#icon-panel div[plugin="debugger"]')
    await expect(debuggerIcon).toBeVisible({ timeout: 15_000 })
    await debuggerIcon.click()
    const txInput = page.locator('[data-id="debuggerTransactionInput"]')
    await txInput.waitFor({ timeout: 15_000 })
    await txInput.fill('0x' + 'ab'.repeat(32))
    await page.locator('[data-id="debuggerTransactionStartButton"]').click()

    // A clear message must appear in the debugger panel ("unable to retrieve
    // txReceipt …"); the panel must stay rendered and no uncaught error may
    // escape to the page.
    await expect(page.locator('#side-panel')).toContainText(/unable to retrieve|not found|invalid/i, { timeout: 30_000 })
    await expect(txInput).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('TC-DBG-008: a long trace (big loop) stays steppable — UI does not freeze, steps do not drop', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Loop {',
      '  uint256 public acc;',
      '  function burn(uint256 n) public { uint256 s = 0; for (uint256 i = 0; i < n; i++) { s += i; } acc = s; }',
      '}'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Loop', { timeout: 30_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Loop')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.locator('#runTabView input[title="uint256 n"]').fill('200')
    await instance.locator('button[title^="burn - "]', { hasText: 'burn' }).click()

    const debugButtons = page.locator('*[data-shared="txLoggerDebugButton"]')
    await expect(debugButtons).toHaveCount(2, { timeout: 30_000 })
    await debugButtons.last().click()
    await expectDebuggerReady(page)

    // The slider exposes a long trace (a 200-iteration loop is hundreds of vm
    // steps). Jumping to the end keeps the panels live and the step counter
    // tracks — no freeze, no dropped final step.
    const slider = page.locator('input[data-id="slider"]')
    await slider.waitFor({ timeout: 30_000 })
    const max = Number(await slider.getAttribute('max'))
    expect(max).toBeGreaterThan(150)
    await slider.fill(String(max))
    await slider.dispatchEvent('change')
    const stepDetail = page.locator('*[data-id="stepdetail"]')
    await expect(stepDetail).toContainText(new RegExp(`vm trace step:\\s*${max}`), { timeout: 30_000 })

    // And stepping back from the end stays responsive (controls still wired).
    await page.locator('*[data-id="buttonNavigatorIntoBack"]').click()
    await expect(stepDetail).toContainText(new RegExp(`vm trace step:\\s*${max - 1}`), { timeout: 15_000 })
  })

  test('TC-DBG-005: instruction disassembly shows real opcodes, no Missing parameter value', async ({ page }) => {
    await compileAndOpenUdapp(page, '1_Storage.sol', 'Storage')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const instance = page.locator('.instance, *[data-id^="instance"]').first()
    await expect(instance).toBeVisible({ timeout: 30_000 })
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await page.locator('#runTabView input[title="uint256 num"]').fill('42')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()
    const debugButtons = page.locator('*[data-shared="txLoggerDebugButton"]')
    await expect(debugButtons).toHaveCount(2, { timeout: 30_000 })
    await debugButtons.last().click()
    await expectDebuggerReady(page)

    // The trace starts at pc 0, so the instruction window covers the standard
    // solidity prologue 6080604052. Before the codeUtils fix the disassembler
    // decoded EVERY byte as INVALID (and could surface 'Missing parameter
    // value') because @tvmjs getOpcodesForHF()'s wrapper object was used as a
    // Map — guard against both failure modes.
    // Operands render without a 0x prefix: "000 PUSH1 80", "002 PUSH1 40", …
    const asm = page.locator('#asmitems')
    await expect(asm).toBeVisible({ timeout: 30_000 })
    await expect(asm).toContainText(/PUSH1 80/, { timeout: 30_000 })
    const txt = await asm.innerText()
    expect(txt).not.toContain('Missing parameter value')
    expect(txt).toMatch(/PUSH1 40/)
    expect(txt).toMatch(/MSTORE/)
    // The window starts at pc 0 (deployed-code prologue): every byte must
    // decode as a real opcode — the pre-fix failure mode was all-INVALID.
    expect(txt.match(/INVALID/g) || []).toHaveLength(0)
    expect((txt.match(/PUSH\d/g) || []).length).toBeGreaterThan(10)
  })
})
