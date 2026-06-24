/*
 * Phase 3d — TC-WAL-008 (S0): IDE connected on Nile, wallet switches to
 * Shasta (stand-in for Mainnet — same cross-network semantics, zero real-fund
 * risk). Deploy is clicked inside the stale-cache window right after the
 * switch. Oracle: no silent wrong-chain broadcast; IDE must block or clearly
 * warn. ANY signing popup gets rejected. Restores Nile at the end.
 */
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

async function switchNetwork (tl, label) {
  await tl.bringToFront().catch(() => {})
  const onSelect = await tl.getByText('Select Network', { exact: true }).isVisible().catch(() => false)
  if (!onSelect) {
    await tl.mouse.click(310, 33)
    await tl.waitForTimeout(1200)
  }
  await tl.getByText(label, { exact: true }).first().click({ timeout: 8000 })
  await tl.waitForTimeout(1500)
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const tl = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }
  const netText = () => page.locator('[data-id="settingsNetworkEnv"]').textContent().then((t) => (t || '').trim()).catch(() => '?')

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
    const netBefore = await netText()
    log('connected; IDE network indicator:', netBefore)
    check('precondition IDE on nile', /nile/i.test(netBefore), netBefore)

    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2000)

    // ---- switch wallet to Shasta, deploy inside the stale window ----
    const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
    await switchNetwork(tl, 'TRON Shasta Testnet')
    log('wallet switched to Shasta; deploying IMMEDIATELY (stale IDE cache window)')
    await page.bringToFront().catch(() => {})
    const netAtDeploy = await netText()
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    log('deploy clicked; IDE indicator at that moment:', netAtDeploy)

    // Post-fix oracle: either the deploy raced into the stale window and the
    // IDE blocks it pre-signing with a network-changed error, or the indicator
    // had already refreshed (consistent state) and the popup may appear.
    let popup = null
    const t0 = Date.now()
    while (!popup && Date.now() - t0 < 8000) {
      popup = walletPopups(browser)[0] || null
      if (!popup) await new Promise((r) => setTimeout(r, 300))
    }
    let popupNet = ''
    if (popup) {
      await new Promise((r) => setTimeout(r, 1500))
      popupNet = await popup.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '')
      await popup.screenshot({ path: `${SHOTS}/3d-sign-popup.png` }).catch(() => {})
      log('signing popup text:', popupNet)
      await tapInPopup(browser, 'Reject', 15000)
      log('rejected')
    } else {
      log('no signing popup — expecting an IDE-level network-changed block')
    }

    await page.waitForTimeout(4000)
    const fresh = ((await page.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore).replace(/\s+/g, ' ')
    const netAfter = await netText()
    log('terminal:', fresh.slice(0, 350))
    log('IDE indicator after settle:', netAfter)
    await page.screenshot({ path: `${SHOTS}/3d-ide-after.png` }).catch(() => {})

    check('TC-WAL-008 no silent broadcast', !/\[block:\d+/.test(fresh), /\[block:\d+/.test(fresh) ? 'TX BROADCAST ON WRONG CHAIN PATH — S0 FAIL' : 'no block marker')
    if (popup) {
      check('TC-WAL-008 consistent at sign time', /shasta/i.test(netAtDeploy) || /shasta/i.test(popupNet), `popup allowed: IDE showed "${netAtDeploy}", popup showed "${popupNet.slice(0, 60)}"`)
    } else {
      check('TC-WAL-008 IDE pre-sign block', /network changed|Wallet network/i.test(fresh), `terminal≈"${fresh.slice(0, 160)}"`)
    }
    check('TC-WAL-008 indicator follows wallet (event refresh)', /shasta/i.test(netAfter), `after="${netAfter}"`)

    // Consistency re-check: once the IDE shows shasta, a deploy must NOT be
    // over-blocked — the signing popup should appear; reject it.
    if (/shasta/i.test(netAfter)) {
      await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
      let popup2 = null
      const t2 = Date.now()
      while (!popup2 && Date.now() - t2 < 15000) {
        popup2 = walletPopups(browser)[0] || null
        if (!popup2) await new Promise((r) => setTimeout(r, 300))
      }
      check('TC-WAL-008 no over-blocking when consistent', !!popup2, popup2 ? 'popup appeared on consistent state' : 'deploy blocked even though states agree')
      if (popup2) {
        await new Promise((r) => setTimeout(r, 1500))
        await tapInPopup(browser, 'Reject', 15000)
        log('rejected consistency-check popup')
      }
    }

    // ---- cleanup: back to Nile ----
    await switchNetwork(tl, 'TRON Nile Testnet')
    await page.waitForTimeout(4000)
    log('restored Nile; IDE indicator:', await netText())
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/3d-error.png` }).catch(() => {})
    await tl.screenshot({ path: `${SHOTS}/3d-error-tl.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    await tapInPopup(browser, 'Reject', 3000)
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
