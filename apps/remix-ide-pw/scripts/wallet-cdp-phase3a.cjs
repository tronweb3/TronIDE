/*
 * Phase 3a — TC-WAL-010 reject + TC-WAL-011-lite recovery.
 * TronLink controls are <div>s, so all popup clicks use text locators.
 * The user approves the FIRST (re-auth) popup if one appears; the script
 * performs every other click.
 */
const { chromium } = require('@playwright/test')
const SHOTS = '/tmp/wallet-batch'
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

async function waitForPopup (browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const p = walletPopups(browser)[0]
    if (p) return p
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

// Click a TronLink control by visible text (they are divs, not buttons).
async function tapInPopup (browser, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try {
        await popup.getByText(label, { exact: true }).last().click({ timeout: 1500 })
        return true
      } catch (e) { /* retry on fresh target */ }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }

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

    // Connect — the user clicks the re-auth popup if one shows (90s budget).
    log('connecting… (if a TronLink popup appears, the USER approves this one)')
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })
    log('connected')
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    // ---- TC-WAL-010: deploy → wait → script clicks Reject ----
    const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const popup = await waitForPopup(browser, 20000)
    check('TC-WAL-010 popup', !!popup, popup ? 'signing popup pending' : 'no popup')
    if (popup) {
      // Give the estimate a moment to load so Reject/Sign are interactive.
      await new Promise((r) => setTimeout(r, 2500))
      const rejected = await tapInPopup(browser, 'Reject', 15000)
      check('TC-WAL-010 reject clicked', rejected, '')
      await page.waitForTimeout(4000)
      const fresh = ((await page.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore).replace(/\s+/g, ' ')
      log('terminal:', fresh.slice(0, 250))
      check('TC-WAL-010 normalized error', /reject|denied|cancel|declined|拒绝/i.test(fresh), `out≈"${fresh.slice(0, 160)}"`)
      check('TC-WAL-010 no instance', (await page.locator('.instance').count()) === 0, '')
      // The terminal logs an optimistic "creation ... pending..." line before
      // signing; an actual broadcast is identified by the [block:N] marker.
      check('TC-WAL-010 no broadcast', !/\[block:\d+/.test(fresh), '')
    }

    // ---- TC-WAL-011-lite: a fresh attempt prompts again (state recovered) ----
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const popup2 = await waitForPopup(browser, 20000)
    check('TC-WAL-011-lite re-prompt', !!popup2, '')
    if (popup2) {
      await new Promise((r) => setTimeout(r, 2500))
      const rejected2 = await tapInPopup(browser, 'Reject', 15000)
      check('TC-WAL-011-lite cleanup reject', rejected2, '')
    }
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/3a-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
