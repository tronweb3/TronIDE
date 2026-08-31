import { test, expect, Page } from '@playwright/test'
import { createFile, ensureFilePanel, gotoHome, seedGithubBffSession, setEditorText, saveCurrentFile } from './helpers'

const CREATED_GIST_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const UPDATE_GIST_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

async function connectViaBffSession (page: Page) {
  await seedGithubBffSession(page)
  const advanced = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if ((await advanced.getAttribute('aria-expanded')) === 'false') await advanced.click()
  await expect(page.locator('[data-id="landingGithubTokenPanel"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-id="landingGithubTokenDisconnect"]')).toBeVisible({ timeout: 10_000 })
}

function modalWithText (page: Page, text: string) {
  return page.locator('[data-id$="ModalDialogContainer-react"]').filter({ hasText: text }).last()
}

test.describe('GitHub Gist publish and update workflow', () => {
  test('creates a gist and updates an imported gist without real GitHub traffic', { tag: '@gate' }, async ({ page }) => {
    let createPayload: any = null
    let updatePayload: any = null
    let createRequestBody = ''
    let updateRequestBody = ''
    let updateReads = 0

    await page.route('**/api/gists**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      // The deployed BFF may live below a reverse-proxy prefix (for example
      // /tronide-github-bff/api), while local runs expose /api directly.
      const apiPathStart = url.pathname.lastIndexOf('/api/')
      const path = apiPathStart >= 0
        ? url.pathname.slice(apiPathStart + '/api'.length)
        : url.pathname.replace(/^\/api/, '')

      if (request.method() === 'POST' && path === '/gists') {
        createRequestBody = request.postData() || ''
        createPayload = JSON.parse(createRequestBody || '{}')
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: CREATED_GIST_ID,
            html_url: `https://gist.github.com/${CREATED_GIST_ID}`
          })
        })
        return
      }

      if (request.method() === 'GET' && path === `/gists/${UPDATE_GIST_ID}`) {
        updateReads++
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: UPDATE_GIST_ID,
            files: {
              'README.md': {
                filename: 'README.md',
                type: 'text/markdown',
                language: 'Markdown',
                truncated: false,
                content: '# imported gist\n'
              },
              'removed.sol': {
                filename: 'removed.sol',
                type: 'text/plain',
                language: 'Solidity',
                truncated: false,
                content: 'contract Removed {}\n'
              }
            }
          })
        })
        return
      }

      if (request.method() === 'PATCH' && path === `/gists/${UPDATE_GIST_ID}`) {
        updateRequestBody = request.postData() || ''
        updatePayload = JSON.parse(updateRequestBody || '{}')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: UPDATE_GIST_ID,
            html_url: `https://gist.github.com/${UPDATE_GIST_ID}`
          })
        })
        return
      }

      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) })
    })

    await gotoHome(page)
    await connectViaBffSession(page)
    await ensureFilePanel(page)

    // Keep the create payload meaningful and deterministic, including the
    // empty-file substitution that must be disclosed before publication.
    await createFile(page, 'empty.sol')
    await createFile(page, 'publish.sol')
    await page.locator('[data-id="treeViewLitreeViewItempublish.sol"]').click()
    await setEditorText(page, 'pragma solidity ^0.8.0; contract GistPublish {}')
    await saveCurrentFile(page, 'publish.sol', 'contract GistPublish')

    await page.locator('[data-id="fileExplorerNewFilepublishToGist"]').click()
    const createConfirm = modalWithText(page, 'using your connected GitHub account')
    await expect(createConfirm).toBeVisible()
    await expect(createConfirm).toContainText('all files in the default_workspace workspace as a public gist')
    await expect(createConfirm.locator('[data-id="gistPayloadVisibility"]')).toContainText('Public')
    await expect(createConfirm.locator('[data-id="gistPayloadFileCount"]')).toContainText(/\d+ included/)
    await expect(createConfirm.locator('[data-id="gistPayloadSize"]')).toContainText(/[\d,]+ bytes/)
    await expect(createConfirm.locator('[data-id="gistPlaceholderDisclosure"]')).toContainText('empty.sol')
    await expect(createConfirm.locator('[data-id="gistPlaceholderDisclosure"]')).toContainText('Empty file is not allowed')

    const previewPayload = JSON.parse((await createConfirm.locator('[data-id="gistExactPayload"]').textContent()) || '{}')
    expect(previewPayload.public).toBe(true)
    expect(previewPayload.description).toContain('https://tronide.io/')
    expect(previewPayload.description).not.toContain('http://')
    expect(previewPayload.description).toContain("append this gist's URL or ID")
    expect(previewPayload.files['publish.sol'].content).toContain('contract GistPublish')
    expect(previewPayload.files['empty.sol'].content).toContain('Empty file is not allowed')
    const previewBytes = new TextEncoder().encode(JSON.stringify(previewPayload)).length
    expect(Number(((await createConfirm.locator('[data-id="gistPayloadSize"]').textContent()) || '').replace(/\D/g, ''))).toBe(previewBytes)
    expect(createPayload, 'no POST occurs before exact-payload confirmation').toBeNull()
    await createConfirm.locator('.modal-ok').click()

    await expect.poll(() => createPayload, { timeout: 15_000 }).not.toBeNull()
    expect(createPayload).toEqual(previewPayload)
    expect(createRequestBody).toBe(JSON.stringify(previewPayload))

    const createSuccess = modalWithText(page, `https://gist.github.com/${CREATED_GIST_ID}`)
    await expect(createSuccess).toBeVisible({ timeout: 15_000 })
    await createSuccess.locator('.modal-cancel').click()

    // Import a deterministic gist through the real terminal command, then use
    // the gist root context action to exercise the authenticated update path.
    await page.focus('#terminalCliInput')
    await page.keyboard.type(`remix.loadgist('${UPDATE_GIST_ID}')`)
    await page.keyboard.press('Enter')
    const gistNodes = page.locator(`[data-id*="${UPDATE_GIST_ID}"]`)
    await expect.poll(() => gistNodes.count(), { timeout: 15_000 }).toBeGreaterThan(0)
    // Target the directory row, not the enclosing <li> whose bounding box also
    // contains README.md; a right-click in the latter opens the file menu.
    const gistRoot = page.locator(`[data-id="treeViewDivtreeViewItemgist-${UPDATE_GIST_ID}"]`)
    await gistRoot.waitFor({ state: 'visible', timeout: 15_000 })

    // Remove one imported remote file locally so the exact PATCH preview also
    // proves that deletions are represented as null before confirmation.
    const removedFile = page.locator(`[data-id$="gist-${UPDATE_GIST_ID}/removed.sol"]`).first()
    await removedFile.waitFor({ state: 'visible', timeout: 15_000 })
    await removedFile.click({ button: 'right' })
    await page.locator('#menuItemsContainer li').filter({ hasText: /^Delete$/ }).click()
    const deleteConfirm = modalWithText(page, 'removed.sol')
    await expect(deleteConfirm).toBeVisible()
    await deleteConfirm.locator('.modal-ok').click()
    await expect(removedFile).toHaveCount(0)

    await gistRoot.click({ button: 'right' })
    await page.locator('#menuItemsContainer li').filter({ hasText: /^Push changes to gist$/ }).click()
    const updateConfirm = modalWithText(page, `public gist ${UPDATE_GIST_ID}`)
    await expect(updateConfirm).toBeVisible()
    await expect.poll(() => updateReads, { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(updateConfirm.locator('[data-id="gistPayloadVisibility"]')).toContainText('Public')
    await expect(updateConfirm.locator('[data-id="gistPayloadFileCount"]')).toContainText('1 deleted')
    const updatePreviewPayload = JSON.parse((await updateConfirm.locator('[data-id="gistExactPayload"]').textContent()) || '{}')
    expect(updatePreviewPayload.public).toBe(true)
    expect(updatePreviewPayload.description).toContain('https://tronide.io/')
    expect(updatePreviewPayload.description).not.toContain('http://')
    expect(updatePreviewPayload.files['README.md'].content).toContain('imported gist')
    expect(updatePreviewPayload.files['removed.sol']).toBeNull()
    expect(updatePayload, 'no PATCH occurs before exact-payload confirmation').toBeNull()
    await updateConfirm.locator('.modal-ok').click()

    await expect.poll(() => updatePayload, { timeout: 15_000 }).not.toBeNull()
    expect(updatePayload).toEqual(updatePreviewPayload)
    expect(updateRequestBody).toBe(JSON.stringify(updatePreviewPayload))

    const updateSuccess = modalWithText(page, `https://gist.github.com/${UPDATE_GIST_ID}`)
    await expect(updateSuccess).toBeVisible({ timeout: 15_000 })
  })
})
