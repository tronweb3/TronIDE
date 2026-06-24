/*
 * TC-WAL-013: a node whose genesis is not main/shasta/nile must be detected
 * as "Custom", and the per-host detection cache must not bleed between
 * networks. Method: route-fulfill the genesis block request (getblockbynum 0)
 * with an unknown blockID while switching the wallet to Shasta — the IDE
 * sees a "custom" chain on that host. Lifting the route and switching back
 * must restore correct per-network identification. Restores Nile.
 */
const { chromium } = require('@playwright/test')
const EXT_HOME = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const FAKE_GENESIS = '00000000000000000000000000000000000000000000000000000000deadbeef'

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
  const waitNet = async (re, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    let txt = ''
    while (Date.now() < deadline) {
      txt = await netText()
      if (re.test(txt)) return txt
      await new Promise((r) => setTimeout(r, 1000))
    }
    return txt
  }

  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })
    const netBefore = await waitNet(/nile/i, 20000)
    check('precondition nile detected', /nile/i.test(netBefore), netBefore)

    // Serve a FAKE genesis for every getblockbynum(0) request.
    await page.route('**/wallet/getblockbynum', async (route) => {
      let isGenesis = false
      try { isGenesis = JSON.parse(route.request().postData() || '{}').num === 0 } catch (e) {}
      if (!isGenesis) return route.continue()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ blockID: FAKE_GENESIS, block_header: { raw_data: { number: 0 } } })
      })
    })

    // Wallet → Shasta: host change invalidates the cache, the re-detection
    // reads the FAKE genesis → the IDE must classify the chain as Custom.
    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2000)
    await switchNetwork(tl, 'TRON Shasta Testnet')
    await page.bringToFront().catch(() => {})
    const customNet = await waitNet(/custom/i, 20000)
    log('indicator with unknown genesis:', customNet)
    await page.screenshot({ path: `${SHOTS}/w13-custom.png` }).catch(() => {})
    check('TC-WAL-013 unknown genesis → Custom', /custom/i.test(customNet), `indicator="${customNet}"`)
    check('TC-WAL-013 no false nile/shasta label', !/nile|shasta/i.test(customNet), `indicator="${customNet}"`)

    // Lift the fake genesis; switch back to Nile — detection must return to
    // the REAL network identity with no Custom residue (per-host cache).
    await page.unroute('**/wallet/getblockbynum')
    await switchNetwork(tl, 'TRON Nile Testnet')
    await page.bringToFront().catch(() => {})
    const nileBack = await waitNet(/nile/i, 20000)
    log('indicator after restore:', nileBack)
    check('TC-WAL-013 cache does not bleed', /nile/i.test(nileBack) && !/custom/i.test(nileBack), `indicator="${nileBack}"`)

    // And the genuine Shasta host (no fake) must now detect as shasta, not
    // the stale Custom from the poisoned round.
    await switchNetwork(tl, 'TRON Shasta Testnet')
    await page.bringToFront().catch(() => {})
    const shastaReal = await waitNet(/shasta/i, 20000)
    log('real shasta detection:', shastaReal)
    check('TC-WAL-013 same host re-detects correctly', /shasta/i.test(shastaReal), `indicator="${shastaReal}"`)
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/w13-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    try { await switchNetwork(tl, 'TRON Nile Testnet'); log('restored Nile') } catch (e) { log('cleanup failed:', e.message) }
    await tapInPopup(browser, 'Reject', 3000)
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
