/*
 * Probe: deploy once and OBSERVE the TronLink signing popup without clicking
 * anything. Determines (a) whether the popup auto-signs (whitelist mode) and
 * (b) the real DOM of the Reject/Sign controls for selector calibration.
 */
const { chromium } = require('@playwright/test')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function walletPopups (browser) {
  const popups = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().startsWith('chrome-extension://') && /secondary_popup|notification/i.test(p.url())) popups.push(p)
    }
  }
  return popups
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded' })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })

    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('*[data-id="compiledContracts"]').waitFor({ timeout: 30000 })

    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 30000 })
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    log('deploy clicked — observing popup WITHOUT interacting')

    const t0 = Date.now()
    let sawPopup = false
    let domDumped = false
    while (Date.now() - t0 < 40000) {
      const popups = walletPopups(browser)
      if (popups.length) {
        sawPopup = true
        if (!domDumped) {
          try {
            const dump = await popups[0].evaluate(() => {
              const els = [...document.querySelectorAll('button, [role="button"], div[class*="btn"], div[class*="Button"]')]
              return els.slice(0, 20).map((el) => `${el.tagName}.${(el.className || '').toString().slice(0, 60)} text="${(el.textContent || '').trim().slice(0, 30)}" disabled=${el.disabled}`)
            })
            log('clickables:', JSON.stringify(dump, null, 1))
            domDumped = true
          } catch (e) { /* not ready yet */ }
        }
      } else if (sawPopup) {
        log(`popup closed by itself after ${((Date.now() - t0) / 1000).toFixed(1)}s — NO clicks were made`)
        break
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    if (!sawPopup) log('no popup ever appeared (instant auto-sign?)')

    await page.waitForTimeout(5000)
    const journal = ((await page.locator('#journal').textContent().catch(() => '')) || '')
    const newText = journal.slice(journalBefore).replace(/\s+/g, ' ')
    log('new terminal output:', newText.slice(0, 400))
    log(newText.includes('creation of Storage') ? 'VERDICT: transaction was signed WITHOUT any click → whitelist/auto-sign is ON' : 'VERDICT: no tx — popup stayed pending or was dismissed')
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
