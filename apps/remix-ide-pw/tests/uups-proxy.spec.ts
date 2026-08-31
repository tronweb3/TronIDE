import { test, expect } from '@playwright/test'
import { dismissWelcomeModal, useBuiltinCompiler } from './helpers'

const encodePayload = (value: string) => encodeURIComponent(Buffer.from(value, 'utf8').toString('base64'))

test.describe('UUPS proxy deep links', () => {
  test('TC-UUPS-001 @gate: deployProxy preselects and completes implementation plus initialized proxy', async ({ page }) => {
    test.setTimeout(180_000)
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
            '  function upgradeToAndCall(address newImplementation, bytes memory data) external payable {',
            '    assembly { sstore(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc, newImplementation) }',
            '    if (data.length > 0) {',
            '      (bool ok,) = newImplementation.delegatecall(data);',
            '      require(ok, "migration failed");',
            '    }',
            '  }',
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
    const proxyAddress = String(await proxyInstance.getAttribute('id')).replace(/^instance/, '')
    await proxyInstance.locator('[data-id="universalDappUiTitleExpander"]').click()
    await proxyInstance.locator('button[title="value - call"]', { hasText: 'value' }).click()
    await expect(proxyInstance.locator('[data-id="treeViewDiv0"]')).toContainText(/uint256:\s*42/, { timeout: 20_000 })

    const attempts = page.locator('[data-id="transactionAttemptGroup"]')
    await expect(attempts).toHaveCount(2)
    await expect(attempts.nth(0)).toHaveAttribute('data-status', 'success')
    await expect(attempts.nth(1)).toHaveAttribute('data-status', 'success')

    const upgradedSource = source.replace(
      '  function initialize(uint256 initialValue) public {',
      '  function implementationVersion() external pure returns (uint256) { return 2; }\n  function initialize(uint256 initialValue) public {'
    )
    await page.evaluate((value) => {
      const editor = (document.getElementById('input') as any)?.editor
      if (!editor) throw new Error('editor unavailable')
      editor.setValue(value)
    }, upgradedSource)
    // The Compile button saves the edited source. Do not press Ctrl+S here:
    // TronIDE maps that shortcut to a compile and overlapping runs can leave
    // the deployment panel bound to the stale artifact.
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    const recompileButton = page.locator('[data-id="compilerContainerCompileBtn"]')
    const recompileIcon = recompileButton.locator('i.remixui_icon')
    await recompileButton.click()
    // UpgradeableBox is already listed from the first compilation. Wait for
    // this new spinner cycle so a late compiler event cannot rebuild the
    // deployment panel after the proxy address has been entered.
    await expect(recompileIcon).toHaveAttribute('title', 'compiling...', { timeout: 10_000 })
    await expect(recompileIcon).not.toHaveAttribute('title', 'compiling...', { timeout: 60_000 })
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('UpgradeableBox', { timeout: 60_000 })

    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('UpgradeableBox')
    const upgradeToggle = page.locator('[data-id="uupsUpgradeProxyToggle"]')
    await upgradeToggle.check()
    const upgradePanel = page.locator('[data-id="uupsProxyUpgradePanel"]')
    await expect(upgradePanel).toBeVisible()
    await upgradePanel.locator('[data-id="uupsProxyAddress"]').fill(proxyAddress)
    await upgradePanel.locator('button', { hasText: 'Upgrade Proxy' }).click()
    await page.locator('button', { hasText: 'Proceed' }).last().click()

    const upgradedProxy = instances.filter({ hasText: 'UpgradeableBox (Upgraded ERC1967Proxy)' })
    await expect(upgradedProxy).toHaveCount(1, { timeout: 60_000 })
    await upgradedProxy.locator('[data-id="universalDappUiTitleExpander"]').click()
    await upgradedProxy.locator('button[title="implementationVersion - call"]', { hasText: 'implementationVersion' }).click()
    await expect(upgradedProxy.locator('[data-id="treeViewDiv0"]')).toContainText(/uint256:\s*2/, { timeout: 20_000 })
    await upgradedProxy.locator('button[title="value - call"]', { hasText: 'value' }).click()
    await expect(upgradedProxy.locator('[data-id="treeViewDiv0"]').filter({ hasText: /uint256:\s*42/ })).toHaveCount(1, { timeout: 20_000 })
  })

  test('TC-UUPS-002 @gate: upgradeProxy preselects the existing-proxy flow', async ({ page }) => {
    const source = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.0;',
      'abstract contract UUPSUpgradeable { function upgradeTo(address) external {} }',
      'contract UpgradeTarget is UUPSUpgradeable {}'
    ].join('\n')

    await page.goto(`/#code=${encodePayload(source)}&upgradeProxy=true`, { waitUntil: 'domcontentloaded' })
    await dismissWelcomeModal(page)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('UpgradeTarget', { timeout: 60_000 })

    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('UpgradeTarget')
    await expect(page.locator('[data-id="uupsUpgradeProxyToggle"]')).toBeChecked()
    await expect(page.locator('[data-id="uupsProxyUpgradePanel"]')).toBeVisible()
    await expect(page.locator('[data-id="uupsProxyDeploymentPanel"]')).toBeHidden()
  })
})
