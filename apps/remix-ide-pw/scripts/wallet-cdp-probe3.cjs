/* Probe 3: what does popup.html show while a sign request is pending? */
const { chromium } = require('@playwright/test')
const EXT_HOME = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function walletPopups (browser) {
  const out = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().startsWith('chrome-extension://') && /secondary_popup|notification/i.test(p.url())) out.push(p)
    }
  }
  return out
}

async function tapInPopup (browser, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try { await popup.getByText(label, { exact: true }).last().click({ timeout: 1500 }); return true } catch (e) {}
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const tl = await ctx.newPage()
  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('*[data-id="compiledContracts"]').waitFor({ timeout: 30000 })
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const t0 = Date.now()
    while (!walletPopups(browser).length && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200))
    log('pending sign request present')

    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2500)
    await tl.screenshot({ path: `${SHOTS}/p3-home-during-pending.png` })
    log('home shot saved')
    await tl.mouse.click(70, 33)
    await tl.waitForTimeout(1500)
    await tl.screenshot({ path: `${SHOTS}/p3-after-selector-click.png` })
    log('selector shot saved; body head:', (await tl.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?')))
  } finally {
    await tapInPopup(browser, 'Reject', 5000)
    log('cleanup reject attempted')
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
