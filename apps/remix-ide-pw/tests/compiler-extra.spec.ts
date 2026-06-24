import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dismissWelcomeModal } from './helpers'

// Extra compiler coverage:
//   TC-CMP-003 — a syntax error is reported with a location, no crash.
//   TC-CMP-004 — local relative / multi-level imports resolve.
//   TC-CMP-006 — a non-allowlisted custom compiler URL is blocked (the
//                malicious script is never injected).

const tmpDir = path.join(os.tmpdir(), 'tronide-pw-cmp')

async function openDefaultWorkspace (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storage.isVisible()) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await storage.click()
}

async function setEditorContent (page: Page, src: string) {
  await page.locator('#input').waitFor({ timeout: 10_000 })
  await page.evaluate((s) => {
    const el = document.getElementById('input') as any
    el.editor.session.setValue(s)
  }, src)
}

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

async function uploadFiles (page: Page, filePaths: string[]) {
  await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles(filePaths)
  const ok = page.locator('#modal-footer-ok')
  if (await ok.isVisible().catch(() => false)) await ok.click()
}

test.beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }))

test.describe('Solidity compiler (extra)', () => {
  test('TC-CMP-003: a syntax error is reported with a location and does not crash the IDE', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await openDefaultWorkspace(page)

    // Missing semicolon + unterminated function — a clear parser error.
    await setEditorContent(page, [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Broken {',
      '  uint256 public x',
      '  function set(uint256 v) public { x = v }',
      '}'
    ].join('\n'))
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()

    // The error renderer shows a danger alert that references a line:col.
    const errorAlert = page.locator('#compileTabView .alert-danger, [data-id="compiledErrors"] .alert-danger').first()
    await expect(errorAlert).toBeVisible({ timeout: 30_000 })
    await expect(errorAlert).toContainText(/ParserError|Expected|;/, { timeout: 10_000 })
    await expect(errorAlert).toContainText(/\d+:\d+|\.sol:\d+/)

    // The IDE survives: still editable, recompiling clean code clears the error.
    expect(pageErrors).toEqual([])
    await setEditorContent(page, [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Fixed { uint256 public x; function set(uint256 v) public { x = v; } }'
    ].join('\n'))
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Fixed', { timeout: 30_000 })
  })

  test('TC-CMP-004: local relative and multi-level imports resolve', async ({ page }) => {
    // libs/Math.sol (deep) ← contracts/Token.sol imports it ← Main.sol imports Token.
    const mathPath = path.join(tmpDir, 'Math.sol')
    const tokenPath = path.join(tmpDir, 'Token.sol')
    const mainPath = path.join(tmpDir, 'Main.sol')
    fs.writeFileSync(mathPath, [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'library Math { function add(uint256 a, uint256 b) internal pure returns (uint256) { return a + b; } }'
    ].join('\n'))
    fs.writeFileSync(tokenPath, [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'import "./Math.sol";',
      'contract Token { using Math for uint256; uint256 public total; function mint(uint256 v) public { total = total.add(v); } }'
    ].join('\n'))
    fs.writeFileSync(mainPath, [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'import "./Token.sol";',
      'contract Main is Token {}'
    ].join('\n'))

    await createWorkspace(page, 'cmp-imports')
    await uploadFiles(page, [mathPath, tokenPath, mainPath])
    await expect(page.locator('[data-id="treeViewLitreeViewItemMain.sol"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="treeViewLitreeViewItemMain.sol"]').click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()

    // Both the importer and the transitively-imported contracts compile, and
    // no "File not found"/"not found" import resolution error appears.
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Main', { timeout: 30_000 })
    const options = (await page.locator('*[data-id="compiledContracts"] option').allInnerTexts()).join(' ')
    expect(options).toContain('Token')
    await expect(page.locator('#compileTabView')).not.toContainText(/not found|Source .* not found|File import callback/i)
  })

  test('TC-CMP-006: a non-allowlisted custom compiler URL is blocked, the script is never injected', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await openDefaultWorkspace(page)
    await page.locator('#icon-panel div[plugin="solidity"]').click()

    const evilUrl = 'https://evil.example.com/soljson.js'
    // Drive the "Add a custom compiler" prompt (the + next to the version
    // select). It's an icon-font button; click it directly via the DOM to
    // avoid icon-glyph sizing/stability flakiness.
    await page.locator('button[data-title="Add a custom compiler with URL"]').evaluate((el: HTMLElement) => el.click())
    const urlInput = page.locator('[data-id="modalDialogCustomPromptCompiler"]')
    await urlInput.waitFor({ state: 'visible', timeout: 10_000 })
    await urlInput.fill(evilUrl)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    // After the CMP-CUSTOMURL-1 fix the rejection surfaces as a clear message
    // ("Custom compiler URL not allowed: …") instead of an uncaught throw.
    await expect(page.getByText(/Custom compiler URL not allowed/i)).toHaveCount(1, { timeout: 10_000 })

    // The blocked URL must never be injected as a <script> (the security
    // property: the malicious compiler source is never fetched/executed).
    await page.waitForTimeout(2_000)
    const loadedEvilModule = await page.evaluate((u) => {
      return [...document.querySelectorAll('script')].some((s) => (s as HTMLScriptElement).src === u)
    }, evilUrl)
    expect(loadedEvilModule).toBe(false)

    // After the CMP-CUSTOMURL-1 fix: the rejected URL is NOT shown as the
    // active version (the switch is aborted before any state mutation) and a
    // clear "not allowed" message is shown instead of an uncaught throw.
    const activeVersion = await page.locator('#versionSelector').inputValue().catch(() => '')
    expect(activeVersion).not.toContain('evil.example.com')
    expect(pageErrors.filter((e) => /evil\.example\.com|not allowed/i.test(e))).toEqual([])

    // The compile button is still operable (IDE not wedged).
    await expect(page.locator('*[data-id="compilerContainerCompileBtn"]')).toBeEnabled()
  })

  // TC-CMP-VER-004 (v2.3.0 backport of v2.3.2 Q2-c): selecting a 0.4.x build in
  // the full dropdown warns up front on Chromium (the asm.js build crashes the
  // compiler) but does not block the selection.
  test('TC-CMP-VER-004: selecting 0.4.x warns on Chromium without blocking', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the warning targets Chromium-based engines')
    await openDefaultWorkspace(page)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    const selector = page.locator('#versionSelector')
    await expect.poll(async () => (await selector.locator('option').count()), { timeout: 30_000 }).toBeGreaterThan(5)

    // find a real 0.4.x option value from the live list
    const v04 = await selector.locator('option').evaluateAll((opts) => {
      const m = (opts as HTMLOptionElement[]).find((o) => /^soljson-v0\.4\./.test(o.value))
      return m ? m.value : ''
    })
    test.skip(!v04, 'no 0.4.x build offered by the live list')

    await selector.selectOption(v04)
    // the warning toast names 0.4.x and Chromium
    await expect(page.locator('[data-shared="tooltipPopup"]').filter({ hasText: /0\.4\.x.*Chromium|Chromium.*crashes/i }).first())
      .toBeVisible({ timeout: 10_000 })
    // selection is NOT blocked — the selector now shows the 0.4 version
    await expect.poll(async () => await selector.inputValue(), { timeout: 5_000 }).toContain('0.4.')
  })
})
