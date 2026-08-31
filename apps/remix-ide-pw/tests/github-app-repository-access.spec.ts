import { expect, Page, Route, test } from '@playwright/test'
import { gotoHome, readSavedFile, seedGithubBffSession, treeItem } from './helpers'

const INSTALL_URL = 'https://github.com/apps/tronide-bff-test/installations/new'
const SELECTED_FILE_CONTENT = '# selected repository\n\nUnicode: héllo 日本語 🌍\n'

type GithubRequestCounts = {
  selectedContents: number
  unselectedContents: number
  repositoryAccess: number
  session: number
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS'
  },
  body: JSON.stringify(body)
})

async function mockGithubAppBff (page: Page, counts: GithubRequestCounts) {
  const handle = (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS'
        }
      })
    }

    if (url.pathname.endsWith('/session')) {
      counts.session++
      return json(route, 200, { login: 'tron-tester', repositoryInstallationRequired: true })
    }
    if (url.pathname.endsWith('/installations')) {
      return json(route, 200, {
        provider: 'github_app',
        required: true,
        installed: true,
        installations: [{ id: 1, account: 'tron-tester', repositorySelection: 'selected', suspended: false }],
        installUrl: INSTALL_URL
      })
    }
    if (url.pathname.includes('/api/repos/Redchar1992/TemplateTest/contents/')) {
      counts.selectedContents++
      return json(route, 200, {
        type: 'file',
        sha: 'selected-file-sha',
        content: Buffer.from(SELECTED_FILE_CONTENT, 'utf8').toString('base64')
      })
    }
    if (url.pathname.includes('/api/repos/Redchar1992/UnselectedRepo/contents/')) {
      counts.unselectedContents++
      return json(route, 404, { message: 'Not Found' })
    }
    if (url.pathname.endsWith('/repository-access')) {
      counts.repositoryAccess++
      return json(route, 200, {
        provider: 'github_app',
        required: true,
        accessible: false,
        installed: true,
        installUrl: INSTALL_URL
      })
    }
    return json(route, 404, { message: 'Unexpected GitHub BFF test request' })
  }
  // Match the BFF API by path rather than a compile-time test origin. The
  // serial suite deliberately reuses a locally served candidate whose BFF may
  // be localhost or live behind a reverse-proxy prefix.
  for (const pattern of ['**/session', '**/installations', '**/api/repos/**', '**/repository-access*']) {
    await page.route(pattern, handle)
  }
}

async function openConnectedGithubPanel (page: Page) {
  await gotoHome(page)
  await seedGithubBffSession(page, 'tron-tester', { mockBff: false })
  const advanced = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if ((await advanced.getAttribute('aria-expanded')) === 'false') await advanced.click()
  await expect(page.locator('[data-id="landingGithubTokenPanel"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-id="landingGithubAppInstall"]')).toHaveText('Manage repository access')
}

async function importGithubFile (page: Page, url: string) {
  await page.locator('[data-id="landingGithubTokenImport"]').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(url)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
}

test.describe('GitHub App repository access smoke', () => {
  test('TC-GITHUB-APP-001: selected repository imports through the BFF without a browser token', { tag: '@gate' }, async ({ page }) => {
    const counts = { selectedContents: 0, unselectedContents: 0, repositoryAccess: 0, session: 0 }
    await mockGithubAppBff(page, counts)
    await openConnectedGithubPanel(page)

    await importGithubFile(page, 'https://github.com/Redchar1992/TemplateTest/blob/main/smoke/selected.md')

    await expect(page.locator(treeItem('github/Redchar1992/TemplateTest/smoke/selected.md'))).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => readSavedFile(page, 'github/Redchar1992/TemplateTest/smoke/selected.md')).toBe(SELECTED_FILE_CONTENT)
    expect(counts.selectedContents).toBe(1)
    expect(counts.repositoryAccess).toBe(0)
    expect(await page.evaluate(() => ({
      session: window.sessionStorage.getItem('tronide.github.session'),
      sessionToken: window.sessionStorage.getItem('tronide.github.token'),
      localToken: window.localStorage.getItem('tronide.github.token')
    }))).toEqual({
      session: 'test_bff_session_handle_012345678901234567890',
      sessionToken: null,
      localToken: null
    })
  })

  test('TC-GITHUB-APP-002: unselected repository stays blocked and shows the recovery action', { tag: '@gate' }, async ({ page }) => {
    const counts = { selectedContents: 0, unselectedContents: 0, repositoryAccess: 0, session: 0 }
    await mockGithubAppBff(page, counts)
    await openConnectedGithubPanel(page)

    await importGithubFile(page, 'https://github.com/Redchar1992/UnselectedRepo/blob/main/README.md')

    const message = 'This repository is not selected for the TronIDE GitHub App. Manage repository access, then try again.'
    const toast = page.locator('[data-shared="tooltipPopup"]').filter({ hasText: message }).first()
    await expect(toast).toBeVisible({ timeout: 10_000 })
    await expect(toast.locator('[data-id="githubRepositoryAccessManage"]')).toHaveText('Manage repository access')
    await expect(page.locator(treeItem('github/Redchar1992/UnselectedRepo/README.md'))).toHaveCount(0)

    expect(counts.unselectedContents).toBe(1)
    expect(counts.repositoryAccess).toBe(1)
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.session'))).toBe('test_bff_session_handle_012345678901234567890')
    const notification = await page.evaluate(() => JSON.parse(window.localStorage.getItem('tronide.home.notifications') || '[]')[0])
    expect(notification).toMatchObject({
      title: 'GitHub repository access required',
      message,
      type: 'error',
      read: false
    })
  })
})
