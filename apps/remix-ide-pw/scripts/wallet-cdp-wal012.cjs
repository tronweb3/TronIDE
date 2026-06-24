/*
 * TC-WAL-012: the wallet RPC endpoint returns 429 — the IDE must back off
 * (no request hammering; rate-limit backoff is 60s), keep a usable UI on
 * stale state, and recover once the endpoint is healthy again.
 * Method: page.route intercepts the IDE page's TRON node calls with 429,
 * a wallet network switch (Nile→Shasta) forces a re-detection attempt.
 * Restores Nile + unroutes at the end.
 */
const { chromium } = require('@playwright/test')
const EXT_HOME = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const RPC_HOST_RE = /trongrid\.io|nileex\.io|shasta|tronstack|tronex/i

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

  const hits = []
  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 60000 })
    await page.waitForFunction(() => /nile/i.test((document.querySelector('[data-id="settingsNetworkEnv"]') || {}).textContent || ''), null, { timeout: 20000 })
    log('connected on nile; arming 429 route')

    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (RPC_HOST_RE.test(url)) {
        hits.push({ t: Date.now(), url: url.replace(/^https?:\/\//, '').slice(0, 80) })
        return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ Error: 'rate limit exceeded' }) })
      }
      return route.continue()
    })

    // Force a re-detection: wallet switches Nile→Shasta (host change triggers
    // the 1s host watcher → detectNetwork → 429 → 60s rate-limit backoff).
    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2000)
    await switchNetwork(tl, 'TRON Shasta Testnet')
    await page.bringToFront().catch(() => {})
    log('switched to Shasta with 429 active; observing 20s…')

    const t0 = Date.now()
    await page.waitForTimeout(20000)
    const windowHits = hits.filter((h) => h.t >= t0)
    const byPath = {}
    for (const h of windowHits) {
      const path = h.url.split('/').slice(1).join('/').split('?')[0] || '(root)'
      byPath[path] = (byPath[path] || 0) + 1
    }
    log(`RPC attempts in 20s window: ${windowHits.length}`, JSON.stringify(byPath))
    const indicator = await netText()
    log('indicator under 429:', indicator)
    await page.screenshot({ path: `${SHOTS}/w12-under-429.png` }).catch(() => {})

    // Oracle: bounded request volume (backoff active — no 1/s hammering ⇒
    // far fewer than 20 calls in 20s), and per-endpoint at most a couple.
    check('TC-WAL-012 no hammering', windowHits.length < 10, `${windowHits.length} calls in 20s: ${JSON.stringify(byPath)}`)
    const maxPerPath = Math.max(0, ...Object.values(byPath))
    check('TC-WAL-012 per-endpoint backoff', maxPerPath <= 3, `max per endpoint=${maxPerPath}`)
    // UI stays alive on stale/explicit state — never blank or crashed.
    const alive = await page.evaluate(() => !!document.querySelector('[data-id="headerWalletConnect"]')).catch(() => false)
    check('TC-WAL-012 UI alive on stale state', alive && indicator.length > 0, `indicator="${indicator}"`)

    // Recovery: lift the 429 and give the backoff (60s) + detection a chance.
    await page.unroute('**/*')
    log('429 lifted; waiting for recovery (backoff is 60s)…')
    let recovered = ''
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      recovered = await netText()
      if (/shasta/i.test(recovered)) break
      await new Promise((r) => setTimeout(r, 3000))
    }
    log('indicator after lift:', recovered)
    check('TC-WAL-012 recovers after backoff', /shasta/i.test(recovered), `indicator="${recovered}"`)
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/w12-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    // Cleanup: restore Nile regardless of outcome.
    try {
      await switchNetwork(tl, 'TRON Nile Testnet')
      log('restored Nile')
    } catch (e) { log('cleanup network restore failed:', e.message) }
    await tapInPopup(browser, 'Reject', 3000)
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
