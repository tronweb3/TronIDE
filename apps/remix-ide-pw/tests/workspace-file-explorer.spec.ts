import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'
import * as path from 'path'
import * as fs from 'fs'

test.describe('Workspace and File Explorer operations', () => {
  test('create workspace, create file, edit code, export zip, and restore zip backup', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for the workspace/File explorer status to load
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Step 1: Create a new workspace named "explorer-workspace"
    await page.locator('[data-id="workspaceCreate"]').click()
    
    // Wait for the modal dialog prompt to appear
    const workspaceInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await workspaceInput.waitFor({ state: 'visible', timeout: 5000 })
    await workspaceInput.fill('explorer-workspace')

    // Click OK on the workspaces modal dialog
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    // Wait for workspacesSelect to select "explorer-workspace"
    const select = page.locator('select[data-id="workspacesSelect"]')
    await expect(select).toHaveValue('explorer-workspace', { timeout: 15_000 })

    // Step 2: Create a new file "my-contract.sol" in the file explorer
    await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').click()

    // Locate the contenteditable input and type the file name
    const editable = page.locator('div.remixui_items[contenteditable="true"]')
    await editable.waitFor({ state: 'visible', timeout: 5000 })
    await editable.focus()
    await page.evaluate((el) => {
      (el as HTMLElement).innerText = 'my-contract.sol'
    }, await editable.elementHandle())
    await editable.press('Enter')

    // Wait for the new file to render in the file explorer tree
    const fileItem = page.locator('[data-id="treeViewLitreeViewItemmy-contract.sol"]')
    await expect(fileItem).toBeVisible({ timeout: 10_000 })

    // Click the file to open it in Ace editor
    await fileItem.click()
    await page.waitForTimeout(1000)

    // Step 3: Set code content in the editor
    const contractCode = `// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

contract ExplorerTest {
    uint256 public value = 999;
}
`
    await page.evaluate((val) => {
      const elem = document.getElementById('input') as any
      if (elem && elem.editor) {
        elem.editor.session.setValue(val)
      }
    }, contractCode)

    // Verify it is written correctly
    const editorValue = await page.evaluate(() => {
      const elem = document.getElementById('input') as any
      return elem && elem.editor ? elem.editor.session.getValue() : ''
    })
    expect(editorValue).toContain('contract ExplorerTest')

    // Close the file editor tab to return to the Home/Landing page (making Home elements visible)
    const tabCloseBtn = page.locator('[id$="my-contract.sol"] .close')
    await tabCloseBtn.waitFor({ state: 'visible', timeout: 5000 })
    await tabCloseBtn.click()

    // Step 4: Toggle Advanced Tools to access Git Workflow
    await page.locator('[data-id="landingAdvancedToolsToggle"]').click()
    await page.locator('[data-id="landingGitWorkflowPanel"]').waitFor({ state: 'visible', timeout: 5000 })

    // Step 5: Export workspace backup ZIP and download it
    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-id="landingGitPrepare"]').click()
    const download = await downloadPromise
    
    expect(download.suggestedFilename()).toBe('tronideBackup.zip')
    
    // Save the zip file to a temporary location outside the watched test folder
    const tempZipPath = path.resolve(__dirname, '../../../tmp/temp_backup_test.zip')
    await download.saveAs(tempZipPath)
    expect(fs.existsSync(tempZipPath)).toBe(true)

    try {
      // Step 6: Activate restorebackupzip plugin
      const pmIcon = page.locator('#icon-panel div[plugin="pluginManager"]')
      await pmIcon.click()
      
      // Use the plugin search to find restorebackupzip
      const searchInput = page.locator('[data-id="pluginManagerComponentSearchInput"]')
      await searchInput.waitFor({ state: 'visible', timeout: 5000 })
      await searchInput.fill('restorebackupzip')
      
      const activateRestoreBtn = page.locator('[data-id="pluginManagerComponentActivateButtonrestorebackupzip"]')
      await activateRestoreBtn.waitFor({ state: 'visible', timeout: 5000 })
      await activateRestoreBtn.click()

      // Step 7: Interact with restorebackupzip iframe to upload the ZIP
      const iframeElement = page.locator('iframe#plugin-restorebackupzip')
      await iframeElement.waitFor({ state: 'visible', timeout: 10_000 })
      const iframe = page.frameLocator('iframe#plugin-restorebackupzip')

      // Set input file in the iframe to the exported ZIP
      const fileInput = iframe.locator('#file-input')
      await fileInput.setInputFiles(tempZipPath)

      // Wait for files to be parsed and .importfile button to be visible
      const importBtn = iframe.locator('.importfile')
      await importBtn.waitFor({ state: 'visible', timeout: 10_000 })

      // Start accepting permission modals in the background/parent page during import
      let importing = true
      const clickPromise = (async () => {
        while (importing) {
          try {
            const remember = page.locator('#remember')
            const okBtn = page.locator('#modal-ok') // The permission modal OK button inside permissions
            if (await remember.isVisible()) {
              if (!await remember.isChecked()) {
                await remember.click()
              }
            }
            const generalOkBtn = page.locator('#modal-footer-ok')
            if (await generalOkBtn.isVisible()) {
              await generalOkBtn.click()
            }
          } catch (e) {
            // Ignore error
          }
          await page.waitForTimeout(300)
        }
      })()

      // Click import
      await importBtn.click()

      // Wait for success log in the iframe logs
      const logEntry = iframe.locator('#log-entry')
      try {
        await expect(logEntry).toContainText('explorer-workspace/my-contract.sol', { timeout: 25_000 })
      } finally {
        importing = false
        await clickPromise
      }

      // Step 8: Go back to File Panel and verify restored workspace is selected
      const fileIcon = page.locator('#icon-panel div[plugin="filePanel"]')
      await fileIcon.click()

      // Wait and select "explorer-workspace"
      await select.waitFor({ state: 'visible', timeout: 10_000 })
      await select.selectOption('explorer-workspace')
      await expect(select).toHaveValue('explorer-workspace', { timeout: 10_000 })
      await expect(page.locator('[data-id="treeViewLitreeViewItemmy-contract.sol"]')).toBeVisible({ timeout: 5000 })

    } finally {
      // Clean up the temporary zip file
      if (fs.existsSync(tempZipPath)) {
        fs.unlinkSync(tempZipPath)
      }
    }
  })
})
