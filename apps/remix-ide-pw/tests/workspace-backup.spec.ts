import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
const JSZip = require('jszip')

// TC-WS-003 / TC-WS-004: workspace backup must preserve unicode/space file names
// (no mojibake, no lost files) and binary file bytes (not text-mangled).

const tmpDir = path.resolve(__dirname, '../../../tmp')

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

async function uploadFile (page: Page, filePath: string) {
  await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles(filePath)
  // Accept any "overwrite?" confirmation if one appears.
  const ok = page.locator('#modal-footer-ok')
  if (await ok.isVisible().catch(() => false)) await ok.click()
}

async function exportBackupZip (page: Page, destPath: string) {
  // No editor tab is open after upload, so the Home landing (which hosts the
  // backup action) is visible.
  await page.locator('[data-id="landingAdvancedToolsToggle"]').click()
  await page.locator('[data-id="landingGitWorkflowPanel"]').waitFor({ state: 'visible', timeout: 5000 })
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-id="landingGitPrepare"]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('tronideBackup.zip')
  await download.saveAs(destPath)
  expect(fs.existsSync(destPath)).toBe(true)
}

test.beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }))

test.describe('Workspace backup integrity', () => {
  test('TC-WS-003: unicode / spaced file names survive backup without mojibake', async ({ page }) => {
    const unicodeName = '测试 合约 😀.sol'
    const marker = 'UNICODE_CONTENT_验证_42'
    const srcPath = path.join(tmpDir, unicodeName)
    fs.writeFileSync(srcPath, `// ${marker}\npragma solidity >=0.8.0;\ncontract C {}\n`, 'utf8')
    const zipPath = path.join(tmpDir, 'backup_unicode.zip')

    try {
      await createWorkspace(page, 'ws-unicode')
      await uploadFile(page, srcPath)
      await expect(page.locator(`[data-id="treeViewLitreeViewItem${unicodeName}"]`)).toBeVisible({ timeout: 15_000 })

      await exportBackupZip(page, zipPath)

      const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
      const entryName = Object.keys(zip.files).find((n) => n.includes(unicodeName))
      expect(entryName, 'unicode/spaced file name preserved in the backup zip').toBeTruthy()
      const content = await zip.files[entryName].async('string')
      expect(content).toContain(marker)
    } finally {
      for (const p of [srcPath, zipPath]) if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  })

  // WS-BIN-1 fix: uploads are read as ArrayBuffer; binary (non-UTF-8) files are
  // stored as base64 data URLs and the backup writes their real bytes, so they
  // round-trip byte-for-byte instead of being corrupted by text re-encoding.
  test('TC-WS-004: binary files survive backup byte-for-byte (no text mangling)', async ({ page }) => {
    // Bytes that a text round-trip would corrupt: full 0x00..0xFF plus high bytes.
    const binBuf = Buffer.concat([
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
      Buffer.from([0xff, 0xfe, 0x00, 0x80, 0xc0, 0xe2, 0x28, 0xa1])
    ])
    const expectedSha = crypto.createHash('sha256').update(binBuf).digest('hex')
    const srcPath = path.join(tmpDir, 'asset.bin')
    fs.writeFileSync(srcPath, binBuf)
    const zipPath = path.join(tmpDir, 'backup_binary.zip')

    try {
      await createWorkspace(page, 'ws-binary')
      await uploadFile(page, srcPath)
      await expect(page.locator('[data-id="treeViewLitreeViewItemasset.bin"]')).toBeVisible({ timeout: 15_000 })

      await exportBackupZip(page, zipPath)

      const zip = await JSZip.loadAsync(fs.readFileSync(zipPath))
      const entryName = Object.keys(zip.files).find((n) => n.endsWith('asset.bin'))
      expect(entryName, 'binary file present in the backup zip').toBeTruthy()
      const bytes = await zip.files[entryName].async('nodebuffer')
      const actualSha = crypto.createHash('sha256').update(bytes).digest('hex')
      expect(actualSha).toBe(expectedSha)
    } finally {
      for (const p of [srcPath, zipPath]) if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  })
})
