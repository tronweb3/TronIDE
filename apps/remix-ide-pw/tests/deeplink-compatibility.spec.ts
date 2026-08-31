import { test, expect } from '@playwright/test'
import { dismissWelcomeModal, getEditorText, readSavedFile, useBuiltinCompiler } from './helpers'

const encodePayload = (value: string) => encodeURIComponent(Buffer.from(value, 'utf8').toString('base64'))

test.describe('External-tool deep links', () => {
  test('TC-DL-001 @gate: percent-encoded UTF-8 source opens without corruption', async ({ page }) => {
    const source = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.0;',
      'contract UnicodeToken {',
      '  string public name = unicode"héllo 日本語 🌍";',
      '  // URL tooling must be allowed to encode Base64 characters such as + and /.',
      '}'
    ].join('\n')
    const payload = encodePayload(source)

    await page.goto(`/#code=${payload}`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)

    await page.locator('#workspacesSelect').waitFor({ state: 'visible', timeout: 30_000 })
    await expect(page.locator('#workspacesSelect')).toHaveValue('code-sample')
    await page.locator('#input').waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => getEditorText(page), { timeout: 15_000 }).toBe(source)
  })

  test('TC-DL-002 @gate: remaps deep link pins the dependency used by solc', async ({ page }) => {
    const source = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.0;',
      'import {Pinned} from "fixture/Pinned.sol";',
      'contract UsesPinned {',
      '  function value() external pure returns (uint256) { return Pinned.value(); }',
      '}'
    ].join('\n')
    const remappings = 'fixture/=fixture@1.2.3/\n'
    const requestedPackages: string[] = []

    await page.route('https://unpkg.com/**', async (route) => {
      requestedPackages.push(route.request().url())
      if (route.request().url().endsWith('/fixture@1.2.3/Pinned.sol')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: [
            '// SPDX-License-Identifier: MIT',
            'pragma solidity ^0.8.0;',
            'library Pinned {',
            '  function value() internal pure returns (uint256) { return 233; }',
            '}'
          ].join('\n')
        })
        return
      }
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'unexpected unpinned import' })
    })

    await page.goto(`/#code=${encodePayload(source)}&remaps=${encodePayload(remappings)}`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)

    await page.locator('#workspacesSelect').waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => readSavedFile(page, 'remappings.txt'), { timeout: 15_000 }).toBe(remappings)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('UsesPinned', { timeout: 60_000 })

    expect(requestedPackages).toContainEqual(expect.stringContaining('/fixture@1.2.3/Pinned.sol'))
    expect(requestedPackages).not.toContainEqual(expect.stringMatching(/\/fixture\/Pinned\.sol$/))
  })

  test('TC-DL-003 @gate: percent-encoded URL imports keep their allowlist and load', async ({ page }) => {
    const target = 'https://raw.githubusercontent.com/tronweb3/TronIDE/main/contracts/Encoded.sol'
    const source = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract EncodedUrl {}\n'
    let requests = 0
    await page.route(target, async (route) => {
      requests++
      await route.fulfill({ status: 200, contentType: 'text/plain', body: source })
    })

    await page.goto(`/#url=${encodeURIComponent(target)}`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)

    await page.locator('#workspacesSelect').waitFor({ state: 'visible', timeout: 30_000 })
    await expect(page.locator('#workspacesSelect')).toHaveValue('code-sample')
    await page.locator('#input').waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => getEditorText(page), { timeout: 15_000 }).toBe(source)
    expect(requests).toBe(1)
  })

  test('TC-DL-004 @gate: oversized embedded source is rejected with import guidance', async ({ page }) => {
    const source = 'a'.repeat((32 * 1024) + 1)

    await page.goto(`/#code=${encodePayload(source)}`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)

    await expect(page.locator('#modal-title-h6')).toHaveText('Unable to import source', { timeout: 15_000 })
    await expect(page.locator('#modal-body-id')).toContainText('Deep links accept up to 32 KiB of decoded source')
    await expect(page.locator('#modal-body-id')).toContainText('Import the contract from GitHub or GitHub Gist instead')
    await expect(page.locator('#workspacesSelect option[value="code-sample"]')).toHaveCount(0)
  })
})
