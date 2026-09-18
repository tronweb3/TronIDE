import { test, expect } from '@playwright/test'
import { dismissWelcomeModal, getEditorText, readSavedFile, useBuiltinCompiler } from './helpers'

const encodePayload = (value: string) => encodeURIComponent(Buffer.from(value, 'utf8').toString('base64'))

test.describe('Deep-link issue regressions', () => {
  test('TC-DL-001 @gate: percent-encoded UTF-8 source opens without corruption', async ({ page }) => {
    const source = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.0;',
      'contract UnicodeToken {',
      '  string public name = unicode"héllo 日本語 🌍";',
      '}'
    ].join('\n')

    await page.goto(`/#code=${encodePayload(source)}`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)
    await page.locator('#workspacesSelect').waitFor({ state: 'visible', timeout: 30_000 })
    await expect(page.locator('#workspacesSelect')).toHaveValue('code-sample')
    await page.locator('#input').waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => getEditorText(page), { timeout: 15_000 }).toBe(source)
  })

  test('TC-DL-002 @gate: remaps deep link is persisted and pins compiler imports', async ({ page }) => {
    const source = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.0;',
      'import {Pinned} from "fixture/Pinned.sol";',
      'contract UsesPinned { function value() external pure returns (uint256) { return Pinned.value(); } }'
    ].join('\n')
    const remappings = 'fixture/=fixture@1.2.3/\n'
    const requestedPackages: string[] = []

    await page.route('https://unpkg.com/**', async (route) => {
      requestedPackages.push(route.request().url())
      if (route.request().url().endsWith('/fixture@1.2.3/Pinned.sol')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'pragma solidity ^0.8.0; library Pinned { function value() internal pure returns (uint256) { return 233; } }'
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

  test('TC-DL-003 @gate: oversized code deep links show import guidance', async ({ page }) => {
    await page.goto(`/#code=${encodePayload('a'.repeat((32 * 1024) + 1))}`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)
    await expect(page.locator('#modal-title-h6')).toHaveText('Unable to import source', { timeout: 15_000 })
    await expect(page.locator('#modal-body-id')).toContainText('Deep links accept up to 32 KiB of decoded source')
    await expect(page.locator('#modal-body-id')).toContainText('Import the contract from GitHub or GitHub Gist instead')
  })
})
