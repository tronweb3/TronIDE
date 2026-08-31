import { test, expect } from '@playwright/test'
import { gotoHome } from './helpers'

test.describe('TRONIDE-129 child regressions', () => {
  test('TRONIDE-134: opening notifications clears only the unread badge', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)

    await page.evaluate(() => {
      window.localStorage.setItem('tronide.home.notifications', JSON.stringify([
        { title: 'First action', message: 'first', time: '10:00', read: false },
        // Legacy records did not have a read field and must start unread.
        { title: 'Legacy action', message: 'legacy', time: '09:00' }
      ]))
      window.dispatchEvent(new CustomEvent('tronideHomeNotificationsChanged'))
    })

    const button = page.locator('[data-id="headerNotificationsButton"]')
    await expect(button.locator('.notification-badge')).toHaveText('2')
    await button.click()

    // Reading retains the history; only the unread indicator disappears.
    await expect(button.locator('.notification-badge')).toHaveCount(0)
    await expect(page.locator('[data-id="headerNotificationsPanel"] .notification-row')).toHaveCount(2)
    expect(await page.evaluate(() => {
      const items = JSON.parse(window.localStorage.getItem('tronide.home.notifications') || '[]')
      return items.every((item: any) => item.read === true)
    })).toBe(true)

    // A later notification becomes the only unread item.
    await button.click()
    await page.evaluate(() => {
      const items = JSON.parse(window.localStorage.getItem('tronide.home.notifications') || '[]')
      items.unshift({ title: 'New action', message: 'new', time: '10:01', read: false })
      window.localStorage.setItem('tronide.home.notifications', JSON.stringify(items))
      window.dispatchEvent(new CustomEvent('tronideHomeNotificationsChanged'))
    })
    await expect(button.locator('.notification-badge')).toHaveText('1')
  })

  test('TRONIDE-135/136: Restore Backup Zip opens and can be reactivated', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)

    const openRestore = async () => {
      await page.locator('[data-id="headerWorkspaceDropdown"]').click()
      await page.locator('[data-id="headerRestoreWorkspace"]').click()
      const iframe = page.locator('iframe#plugin-restorebackupzip')
      await expect(iframe).toBeVisible({ timeout: 15_000 })
      await expect(iframe).toHaveAttribute('src', /\/assets\/plugins\/restorebackupzip\/index\.html$/)
      await expect(page.locator('[data-id="headerWorkspaceMenu"] .header-workspace-dropdown')).toHaveCount(0)
    }

    await openRestore()

    // Closing the tab deactivates the iframe plugin. Its detached iframe used
    // to retain contentWindow, so the next activation threw "already rendered".
    await page.locator('remix-tab#restorebackupzip .close').click({ force: true })
    await expect(page.locator('iframe#plugin-restorebackupzip')).toHaveCount(0, { timeout: 10_000 })

    await openRestore()
    await expect(page.locator('remix-tab#restorebackupzip')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('plugin is already rendered')
  })

  test('TRONIDE-137: leaving localhost keeps the selected browser workspace', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)

    // Minimal remixd protocol double: open the socket, answer the connector
    // handshake and the provider readiness call, then let the real UI exercise
    // the localhost -> browser workspace transition.
    await page.route('**/remixd-token', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: '0123456789abcdef0123456789abcdef' }) })
    })
    await page.evaluate(() => {
      class FakeRemixdWebSocket extends EventTarget {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3
        CONNECTING = 0
        OPEN = 1
        CLOSING = 2
        CLOSED = 3
        readyState = FakeRemixdWebSocket.CONNECTING
        url: string

        constructor (url: string) {
          super()
          this.url = url
          window.setTimeout(() => {
            this.readyState = FakeRemixdWebSocket.OPEN
            this.dispatchEvent(new Event('open'))
          }, 0)
        }

        send (raw: string) {
          const request = JSON.parse(raw)
          let payload: any = true
          if (request.key === 'handshake') {
            payload = ['folderIsReadOnly', 'resolveDirectory', 'get', 'exists', 'isFile', 'set', 'rename', 'remove', 'isDirectory', 'list', 'createDir']
          } else if (request.key === 'folderIsReadOnly') payload = false
          else if (request.key === 'resolveDirectory') payload = { folder1: { isDirectory: true } }
          else if (request.key === 'list') payload = {}
          else if (request.key === 'exists' || request.key === 'isFile') payload = false

          window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent('message', {
              data: JSON.stringify(Object.assign({}, request, { action: 'response', payload, error: undefined }))
            }))
          }, 0)
        }

        close () {
          this.readyState = FakeRemixdWebSocket.CLOSED
          this.dispatchEvent(new CloseEvent('close', { code: 1000 }))
        }
      }
      ;(window as any).WebSocket = FakeRemixdWebSocket
    })

    const select = page.locator('[data-id="workspacesSelect"]')
    await select.selectOption(' - connect to localhost - ')
    const connectModal = page.locator('.modal-content:has-text("Connect to localhost")')
    await expect(connectModal).toContainText('Local Network Access')
    await expect(connectModal).toContainText(`remixd -s <path-to-the-shared-folder> -u ${new URL(page.url()).origin}`)
    await expect(connectModal).not.toContainText('<remix-ide-instance-URL>')
    await connectModal.locator('#modal-footer-ok').click()
    await expect(select).toHaveValue(' - connect to localhost - ', { timeout: 10_000 })
    await expect(page.locator('[data-path="folder1"]')).toBeVisible({ timeout: 10_000 })

    await select.selectOption('default_workspace')
    await expect(select).toHaveValue('default_workspace', { timeout: 10_000 })
    await expect(page.locator('[data-id="treeViewLitreeViewItemcontracts"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-path="folder1"]')).toHaveCount(0)
    await expect(page.locator('.modal-content:has-text("Create Default Workspace")')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('workspace already exists')

    // Reconnect and deactivate RemixD directly from Plugin Manager. The
    // fallback workspace must not retain the daemon's last rendered tree.
    await select.selectOption(' - connect to localhost - ')
    await connectModal.locator('#modal-footer-ok').click()
    await expect(select).toHaveValue(' - connect to localhost - ', { timeout: 10_000 })
    await expect(page.locator('[data-path="folder1"]')).toBeVisible({ timeout: 10_000 })

    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    const remixdButton = page.locator('#pluginManager article[id="remixPluginManagerListItem_remixd"] button')
    await expect(remixdButton).toHaveText('Deactivate')
    await remixdButton.click()

    await expect(select).toHaveValue('default_workspace', { timeout: 10_000 })
    await expect(page.locator('[data-path="folder1"]')).toHaveCount(0)
  })
})
