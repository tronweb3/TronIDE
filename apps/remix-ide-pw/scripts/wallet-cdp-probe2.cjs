/*
 * Probe 2: instrument the signing popup with a click listener to determine
 * whether an external automation client is clicking Sign (we never click).
 */
const { chromium } = require('@playwright/test')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19) + '.' + String(Date.now() % 1000).padStart(3, '0'), ...a)

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
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    log('deploy clicked — hunting popup with 100ms polling')

    let popup = null
    const t0 = Date.now()
    while (!popup && Date.now() - t0 < 20000) {
      popup = walletPopups(browser)[0] || null
      if (!popup) await new Promise((r) => setTimeout(r, 100))
    }
    if (!popup) { log('no popup'); return }
    log('popup found after', Date.now() - t0, 'ms')

    popup.on('console', (msg) => { if (msg.text().startsWith('[probe]')) log('POPUP>', msg.text()) })
    await popup.evaluate(() => {
      document.addEventListener('click', (e) => {
        const t = e.target
        console.log(`[probe] click isTrusted=${e.isTrusted} at ${e.clientX},${e.clientY} on <${t.tagName}> "${(t.textContent || '').trim().slice(0, 30)}"`)
      }, true)
      document.addEventListener('pointerdown', (e) => {
        console.log(`[probe] pointerdown isTrusted=${e.isTrusted} at ${e.clientX},${e.clientY}`)
      }, true)
      console.log('[probe] listeners armed')
    }).catch((e) => log('instrument failed:', e.message))

    const tClose = Date.now()
    while (walletPopups(browser).length && Date.now() - tClose < 30000) {
      await new Promise((r) => setTimeout(r, 100))
    }
    log('popup closed after', ((Date.now() - tClose) / 1000).toFixed(1), 's — if no [probe] click was logged above, TronLink signed programmatically')
    await page.waitForTimeout(4000)
    const journal = ((await page.locator('#journal').textContent().catch(() => '')) || '').replace(/\s+/g, ' ')
    log('terminal tail:', journal.slice(-200))
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
