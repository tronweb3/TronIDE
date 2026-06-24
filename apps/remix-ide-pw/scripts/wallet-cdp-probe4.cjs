/* Probe 4: capture the window.postMessage shapes TronLink emits on a network switch. */
const { chromium } = require('@playwright/test')
const EXT_HOME = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const tl = await ctx.newPage()
  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })

    await page.evaluate(() => {
      window.__msgs = []
      window.addEventListener('message', (e) => {
        try {
          const d = e.data
          const desc = JSON.stringify(d)
          if (desc && desc !== '{}' && !/webpack|react-devtools/i.test(desc)) window.__msgs.push(desc.slice(0, 300))
        } catch (err) {}
      })
    })
    log('listener armed; switching network Nile→Shasta→Nile')

    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2000)
    const onSelect = await tl.getByText('Select Network', { exact: true }).isVisible().catch(() => false)
    if (!onSelect) { await tl.mouse.click(310, 33); await tl.waitForTimeout(1200) }
    await tl.getByText('TRON Shasta Testnet', { exact: true }).first().click({ timeout: 8000 })
    await tl.waitForTimeout(3000)
    await tl.mouse.click(310, 33); await tl.waitForTimeout(1200)
    await tl.getByText('TRON Nile Testnet', { exact: true }).first().click({ timeout: 8000 })
    await tl.waitForTimeout(3000)

    const msgs = await page.evaluate(() => window.__msgs.slice(0, 30))
    log('captured', msgs.length, 'messages:')
    for (const m of msgs) console.log('  ', m)
  } finally {
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
