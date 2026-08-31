import { test, expect, Page, Locator } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-RN-001/002 (v2.3.3): Release Notes is an independent same-origin page.
// IDE entry points are ordinary new-tab links, so reading the notes never
// replaces the active file or adds an informational workbench tab.

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingHeroTitle"]').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ state: 'attached', timeout: 30_000 })
}

async function openStandaloneNotes (page: Page) {
  await page.goto('/release-notes.html')
  await page.locator('[data-id="releaseNotesView"]').waitFor({ state: 'visible', timeout: 30_000 })
}

async function expectStandaloneLink (link: Locator) {
  await expect(link).toHaveAttribute('href', 'release-notes.html')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAttribute('rel', /noreferrer/)
}

test.describe('Release notes', () => {
  test('TC-RN-001: the header version badge links to the standalone Release Notes page', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await expectStandaloneLink(page.locator('[data-id="headerVersionBadge"]'))

    await openStandaloneNotes(page)
    // every 2.3.x release is present, and the running version is stated
    await expect(page.locator('[data-id="releaseNotesV233"]')).toBeVisible()
    await expect(page.locator('[data-id="releaseNotesV232"]')).toBeVisible()
    await expect(page.locator('[data-id="releaseNotesV231"]')).toBeVisible()
    await expect(page.locator('[data-id="releaseNotesV230"]')).toBeVisible()
    await expect(page.locator('[data-id="releaseNotesView"]')).toContainText('You are running TRON IDE v')
    await expect(page.locator('[data-id="releaseNotesBackToIde"]')).toHaveAttribute('href', './')
    await expect(page.locator('[data-id="releaseNotesDetailsV233"]')).toHaveJSProperty('open', true)
    await expect(page.locator('[data-id="releaseNotesGalleryV233"]')).toBeVisible()
    for (const version of ['232', '231', '230']) {
      await expect(page.locator(`[data-id="releaseNotesDetailsV${version}"]`)).toHaveJSProperty('open', false)
      await expect(page.locator(`[data-id="releaseNotesGalleryV${version}"]`)).not.toBeVisible()
      await expect(page.locator(`[data-id="releaseNotesToggleV${version}"]`)).toBeVisible()
    }
    for (const version of ['233', '232', '231', '230']) {
      const gallery = page.locator(`[data-id="releaseNotesGalleryV${version}"]`)
      await expect(gallery.locator('figure')).toHaveCount(6)
      const images = gallery.locator('img')
      await expect(images).toHaveCount(6)
      const imageCount = await images.count()
      for (let index = 0; index < imageCount; index++) {
        await expect(images.nth(index)).toHaveAttribute('alt', /\S+/)
        await expect(images.nth(index)).toHaveAttribute('loading', 'lazy')
      }
    }
  })

  test('TC-RN-005: all release screenshot galleries are responsive and use real versioned assets', { tag: '@gate' }, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openStandaloneNotes(page)
    for (const version of ['232', '231', '230']) {
      await page.locator(`[data-id="releaseNotesToggleV${version}"]`).click()
      await expect(page.locator(`[data-id="releaseNotesDetailsV${version}"]`)).toHaveJSProperty('open', true)
    }
    const galleries = page.locator('[data-id^="releaseNotesGalleryV"]')
    await expect(galleries).toHaveCount(4)
    await expect(page.locator('[data-id="releaseNotesGalleryV233"]')).toBeVisible({ timeout: 15_000 })
    await expect(galleries.locator('source[type="image/webp"]')).toHaveCount(24)
    const areaGalleries = page.locator('[data-id^="releaseNotesAreaGalleryV"]')
    await expect(areaGalleries).toHaveCount(17)
    const areaGalleryCount = await areaGalleries.count()
    for (let index = 0; index < areaGalleryCount; index++) {
      const screenshots = await areaGalleries.nth(index).locator('figure').count()
      expect(screenshots).toBeGreaterThan(0)
      expect(screenshots).toBeLessThanOrEqual(2)
    }
    const overflow = await page.locator('[data-id="releaseNotesView"]').evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflow).toBe(false)
    const images = galleries.locator('img')
    const imageCount = await images.count()
    for (let index = 0; index < imageCount; index++) {
      const image = images.nth(index)
      await image.scrollIntoViewIfNeeded()
      await expect(image).toBeVisible()
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    }
  })

  test('TC-RN-002: the Home link opens Release Notes separately and leaves Home active', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    const link = page.locator('[data-id="landingReleaseNotesLink"]')
    await expectStandaloneLink(link)

    const popupPromise = page.waitForEvent('popup')
    await link.click()
    const notes = await popupPromise
    await notes.locator('[data-id="releaseNotesView"]').waitFor({ state: 'visible', timeout: 30_000 })
    expect(new URL(notes.url()).pathname).toBe('/release-notes.html')
    await expect(notes.locator('[data-id="releaseNotesV230"]')).toContainText('TronLink')
    await expect(page.locator('[data-id="landingRemix220Hero"]')).toBeVisible()
    await expect(page.locator('[data-id="releaseNotesView"]')).toBeHidden()
    await notes.close()
  })

  // TC-RN-003: the "Report an issue" feedback entry — on the Home hero and at
  // the bottom of the standalone Release Notes page — links straight to the
  // project's GitHub issues.
  test('TC-RN-003: the feedback entry links to GitHub issues', { tag: '@gate' }, async ({ page }) => {
    const ISSUES = 'https://github.com/tronweb3/TronIDE/issues'
    await openHome(page)
    const homeLink = page.locator('[data-id="landingReportIssueLink"]')
    await expect(homeLink).toBeVisible({ timeout: 15_000 })
    await expect(homeLink).toHaveAttribute('href', ISSUES)
    await expect(homeLink).toHaveAttribute('target', '_blank')

    await openStandaloneNotes(page)
    const notesLink = page.locator('[data-id="releaseNotesReportIssue"]')
    await expect(notesLink).toHaveAttribute('href', ISSUES)
    await expect(page.locator('[data-id="releaseNotesView"]')).toContainText('Help & Feedback')
  })

  // TC-RN-004: both global Release Notes entries are links; Feedback remains a
  // button that opens the GitHub issues page in a new tab.
  test('TC-RN-004: the header exposes standalone Release Notes links and Feedback', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await expectStandaloneLink(page.locator('[data-id="headerVersionBadge"]'))
    await expectStandaloneLink(page.locator('[data-id="headerReleaseNotes"]'))
    await expect(page.locator('[data-id="headerReportIssue"] i')).toHaveClass(/fa-bug/)

    await page.evaluate(() => {
      const w = window as any
      w.__openedUrls = []
      w.open = (url?: unknown) => { w.__openedUrls.push(String(url)); return null }
    })
    await page.locator('[data-id="headerReportIssue"]').click()
    const openedUrls = await page.evaluate(() => (window as any).__openedUrls as string[])
    expect(openedUrls).toHaveLength(1)
    expect(openedUrls[0]).toContain('github.com/tronweb3/TronIDE/issues')
  })
})
