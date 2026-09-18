import { test, expect } from '@playwright/test'
import { dismissWelcomeModal, useBuiltinCompiler } from './helpers'

const encodePayload = (value: string) => encodeURIComponent(Buffer.from(value, 'utf8').toString('base64'))

test.describe('UUPS proxy deep links', () => {
  test('TC-UUPS-001 @gate: deployProxy preselects and completes implementation plus initialized proxy', async ({ page }) => {
    test.setTimeout(120_000)
    await page.route('https://unpkg.com/**', async (route) => {
      if (route.request().url().endsWith('/uups-fixture@1.0.0/UUPSUpgradeable.sol')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: [
            '// SPDX-License-Identifier: MIT',
            'pragma solidity ^0.8.0;',
            'abstract contract UUPSUpgradeable {',
            '  function UPGRADE_INTERFACE_VERSION() external pure returns (string memory) { return "5.0.0"; }',
            '  function proxiableUUID() external pure returns (bytes32) { return bytes32(uint256(1)); }',
            '  function upgradeToAndCall(address, bytes memory) external payable {}',
            '}'
          ].join('\n')
        })
        return
      }
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'unexpected import' })
    })

    const source = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.0;',
      'import {UUPSUpgradeable} from "uups/UUPSUpgradeable.sol";',
      'contract UpgradeableBox is UUPSUpgradeable {',
      '  uint256 public value;',
      '  bool private initialized;',
      '  function initialize(uint256 initialValue) public {',
      '    require(!initialized, "already initialized");',
      '    initialized = true;',
      '    value = initialValue;',
      '  }',
      '}'
    ].join('\n')
    const remappings = 'uups/=uups-fixture@1.0.0/\n'

    await page.goto(`/#code=${encodePayload(source)}&remaps=${encodePayload(remappings)}&deployProxy=true`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)
    await page.locator('#workspacesSelect').waitFor({ state: 'visible', timeout: 30_000 })

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('UpgradeableBox', { timeout: 60_000 })

    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('#selectExEnvOptions').selectOption({ label: 'JavaScript VM (Tron)' })
    await expect(page.locator('[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)')
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('UpgradeableBox')

    const proxyToggle = page.locator('[data-id="uupsDeployProxyToggle"]')
    await expect(proxyToggle).toBeChecked()
    const proxyPanel = page.locator('[data-id="uupsProxyDeploymentPanel"]')
    await expect(proxyPanel).toBeVisible()
    await proxyPanel.locator('input[data-id="uint256 initialValue"]').fill('42')
    await proxyPanel.locator('button', { hasText: 'Deploy with Proxy' }).click()

    const confirmation = page.locator('button', { hasText: 'Proceed' }).last()
    await confirmation.waitFor({ state: 'visible', timeout: 10_000 })
    await confirmation.click()

    const instances = page.locator('.instance')
    await expect(instances).toHaveCount(2, { timeout: 60_000 })
    await expect(instances.nth(0)).toContainText('UpgradeableBox at')
    const proxyInstance = instances.filter({ hasText: 'UpgradeableBox (ERC1967Proxy)' })
    await expect(proxyInstance).toHaveCount(1)
    await proxyInstance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await proxyInstance.locator('button[title="value - call"]', { hasText: 'value' }).click()
    await expect(proxyInstance.locator('[data-id="treeViewDiv0"]')).toContainText(/uint256:\s*42/, { timeout: 20_000 })

    const attempts = page.locator('[data-id="transactionAttemptGroup"]')
    await expect(attempts).toHaveCount(2)
    await expect(attempts.nth(0)).toHaveAttribute('data-status', 'success')
    await expect(attempts.nth(1)).toHaveAttribute('data-status', 'success')
  })
})
