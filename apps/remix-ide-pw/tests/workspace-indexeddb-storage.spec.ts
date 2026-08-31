import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

const STORAGE_STATE_KEY = 'tronide_workspace_storage_state_v1'

async function waitForWorkbench (page: Page) {
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function seedLegacyBrowserFs (page: Page) {
  await page.goto('/release-notes.html', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-id="releaseNotesView"]').waitFor({ state: 'visible', timeout: 30_000 })
  // The standalone notes document deliberately skips BrowserFS. Load the same
  // classic bundle used by index.html so legacy state can be prepared without
  // acquiring the IDE's full-session workspace lock.
  await page.addScriptTag({ url: '/assets/js/browserfs.min.js' })
  await page.evaluate(async ({ stateKey }) => {
    localStorage.clear()
    const browserFS = (window as any).BrowserFS
    const legacy = await new Promise<any>((resolve, reject) => {
      browserFS.getFileSystem({ fs: 'LocalStorage' }, (error: Error | null, fileSystem: any) => {
        if (error) reject(error)
        else resolve(fileSystem)
      })
    })
    browserFS.initialize(legacy)
    const fs = browserFS.BFSRequire('fs')
    const Buffer = browserFS.BFSRequire('buffer').Buffer
    for (const directory of [
      '/.workspaces',
      '/.workspaces/indexeddb-e2e',
      '/.workspaces/indexeddb-e2e/contracts',
      '/.workspaces/indexeddb-e2e/.git',
      '/.workspaces/indexeddb-e2e/empty'
    ]) fs.mkdirSync(directory)
    fs.writeFileSync('/.workspaces/indexeddb-e2e/contracts/合同.sol', 'pragma solidity ^0.8.20; contract Durable合同 {}', 'utf8')
    fs.writeFileSync('/.workspaces/indexeddb-e2e/.git/index', Buffer.from([0, 255, 16, 128, 7]))
    localStorage.removeItem(stateKey)
  }, { stateKey: STORAGE_STATE_KEY })
}

test.describe('IndexedDB workspace storage', () => {
  test('TC-WS-IDB-001: migrates legacy bytes, survives reload, and enforces one writable tab', async ({ page, context }) => {
    await seedLegacyBrowserFs(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForWorkbench(page)

    const startup = await page.evaluate(({ stateKey }) => {
      const storage = (window as any).tronideWorkspaceStorage
      const error = storage?.fallbackError
      return {
        mode: storage?.mode,
        state: localStorage.getItem(stateKey),
        error: error && { name: error.name, message: error.message, code: error.code, stack: error.stack }
      }
    }, { stateKey: STORAGE_STATE_KEY })
    expect(startup.mode, JSON.stringify(startup, null, 2)).toBe('indexeddb-mirror')
    const migrated = await page.evaluate(({ stateKey }) => {
      const fs = (window as any).remixFileSystem
      const state = JSON.parse(localStorage.getItem(stateKey) || 'null')
      return {
        state,
        source: String(fs.readFileSync('/.workspaces/indexeddb-e2e/contracts/合同.sol', 'utf8')),
        binary: Array.from(fs.readFileSync('/.workspaces/indexeddb-e2e/.git/index')),
        empty: fs.readdirSync('/.workspaces/indexeddb-e2e/empty'),
        marker: fs.existsSync('/.tronide-workspace-storage-v1')
      }
    }, { stateKey: STORAGE_STATE_KEY })
    expect(migrated.state?.phase).toBe('active')
    expect(migrated.state?.targetStore).toMatch(/^tronide-workspaces-v1-/)
    expect(migrated.state?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(migrated.source).toContain('Durable合同')
    expect(migrated.binary).toEqual([0, 255, 16, 128, 7])
    expect(migrated.empty).toEqual([])
    expect(migrated.marker).toBe(true)

    // A direct BrowserFS write exercises the real AsyncMirror queue. Do not
    // reload until the public durability checkpoint confirms IndexedDB.
    const checkpoint = await page.evaluate(async () => {
      const fs = (window as any).remixFileSystem
      const storage = (window as any).tronideWorkspaceStorage
      fs.writeFileSync('/.workspaces/indexeddb-e2e/contracts/reload.sol', 'contract ReloadProof {}', 'utf8')
      const sequence = storage.checkpoint()
      await storage.whenDurable(sequence)
      return { sequence, status: storage.getStatus() }
    })
    expect(checkpoint.sequence).toBeGreaterThan(0)
    expect(checkpoint.status.state).toBe('idle')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWorkbench(page)
    const reopened = await page.evaluate(() => ({
      mode: (window as any).tronideWorkspaceStorage.mode,
      source: String((window as any).remixFileSystem.readFileSync('/.workspaces/indexeddb-e2e/contracts/reload.sol', 'utf8')),
      migratedAgain: (window as any).tronideWorkspaceStorage.migration?.phase
    }))
    expect(reopened.mode).toBe('indexeddb-mirror')
    expect(reopened.source).toContain('ReloadProof')
    expect(reopened.migratedAgain).toBe('active')

    const secondTab = await context.newPage()
    await secondTab.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(secondTab.locator('#tronide-initial-status')).toContainText('already open in another tab', { timeout: 15_000 })
    await expect(secondTab.locator('[data-id="workspaceStorageRetry"]')).toBeVisible()

    await page.close()
    await secondTab.locator('[data-id="workspaceStorageRetry"]').click()
    await waitForWorkbench(secondTab)
    await expect.poll(() => secondTab.evaluate(() => (window as any).tronideWorkspaceStorage?.mode)).toBe('indexeddb-mirror')
  })

  test('TC-WS-IDB-002: unavailable IndexedDB keeps the unchanged legacy backend visible', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForWorkbench(page)
    await expect.poll(() => page.evaluate(() => (window as any).tronideWorkspaceStorage?.mode)).toBe('legacy-localstorage')
    await expect(page.locator('#tronide-workspace-storage-status')).toContainText('existing files were left unchanged')
    expect(await page.evaluate(() => Boolean((window as any).tronideWorkspaceStorage?.fallbackError))).toBe(true)
  })

  test('TC-WS-IDB-003: an active pointer without its marker fails closed', async ({ page }) => {
    await page.addInitScript(({ stateKey }) => {
      localStorage.setItem(stateKey, JSON.stringify({
        version: 1,
        phase: 'active',
        targetStore: 'tronide-workspaces-v1-missing-browser-test',
        sourceFingerprint: 'a'.repeat(64),
        fileCount: 1,
        directoryCount: 1,
        totalBytes: 1,
        errorCode: '',
        updatedAt: Date.now()
      }))
    }, { stateKey: STORAGE_STATE_KEY })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#tronide-initial-status')).toContainText('could not open its local workspace safely', { timeout: 15_000 })
    await expect(page.locator('[data-id="workspaceStorageRetry"]')).toBeVisible()
    expect(await page.evaluate(() => (window as any).tronideWorkspaceStorage)).toBeUndefined()
  })

  test('TC-WS-IDB-004: a fresh profile still receives the default workspace', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForWorkbench(page)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('default_workspace', { timeout: 15_000 })
    expect(await page.evaluate(() => (window as any).tronideWorkspaceStorage?.mode)).toBe('indexeddb-mirror')
  })
})
