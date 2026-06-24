/*
 * R-IX-3 / TC-WAL wallet batch — phase 1 driver.
 * Connects over CDP to the user's running Chrome (port 9223, TronLink
 * unlocked on Nile) and walks TC-WAL-004 (header connect → RunTab sync),
 * TC-IX-ENV-002 (cross-entry consistency) and TC-WAL-009 (disconnect).
 * Opens its own tab against the local dev server and closes it afterwards.
 */
const { chromium } = require('@playwright/test')

const IDE_URL = 'http://localhost:18080'
const CDP_URL = 'http://localhost:9223'
const SHOTS = '/tmp/wallet-batch'

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function walletPopups (browser) {
  const popups = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const url = p.url()
      if (url.startsWith('chrome-extension://') && /secondary_popup|notification|confirm/i.test(url)) popups.push(p)
    }
  }
  return popups
}

// Pump loop: while `active.on`, approve every TronLink confirmation window
// that shows up (connect may trigger more than one in sequence).
function startApprovePump (browser, active) {
  return (async () => {
    const seen = new Set()
    while (active.on) {
      for (const popup of walletPopups(browser)) {
        const key = popup.url()
        try {
          const ok = popup.getByRole('button', { name: /^(连接|同意|确认|签名|Connect|Approve|Confirm|Sign|Accept)$/ }).last()
          if (await ok.isVisible({ timeout: 500 })) {
            if (!seen.has(key)) { log('popup:', key); seen.add(key) }
            await ok.click({ timeout: 2000 })
            log('clicked approve in popup')
            await new Promise((r) => setTimeout(r, 800))
          }
        } catch (e) { /* popup closed mid-click or not ready yet */ }
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  })()
}

;(async () => {
  const fs = require('fs')
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.connectOverCDP(CDP_URL)
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => {
    results.push({ id, pass: !!cond, detail })
    log(cond ? 'PASS' : 'FAIL', id, '—', detail)
  }

  try {
    await page.goto(IDE_URL, { waitUntil: 'domcontentloaded' })
    const welcome = page.locator('button:has-text("I Understand")')
    try { await welcome.click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
    log('IDE loaded')

    // ---- TC-WAL-004: header connect → both surfaces sync ----
    const active = { on: true }
    const pump = startApprovePump(browser, active)
    await page.locator('[data-id="headerWalletConnect"]').click()

    const headerBtn = page.locator('[data-id="headerWalletConnect"]')
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-id="headerWalletConnect"]')
        return el && /Wallet T/.test(el.textContent || '')
      }, null, { timeout: 45000 })
    } catch (e) {
      const label = await headerBtn.getAttribute('title').catch(() => null)
      const text = (await headerBtn.textContent().catch(() => '')) || ''
      throw new Error(`connect did not reach connected state; header text="${text.trim()}" title="${label}"`)
    } finally {
      active.on = false
      await pump
    }
    const headerLabel = (await headerBtn.textContent() || '').trim()
    log('header label:', headerLabel)

    // RunTab surfaces (connect flow auto-selects udapp).
    const envValue = await page.locator('select#selectExEnvOptions').inputValue()
    const netText = (await page.locator('[data-id="settingsNetworkEnv"]').textContent() || '').trim()
    await page.waitForFunction(() => {
      const sel = document.querySelector('select[data-id="runTabSelectAccount"]')
      return sel && sel.options.length > 0 && sel.options[0].text.startsWith('T')
    }, null, { timeout: 20000 })
    const account0 = await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent()
    log('runtab env:', envValue, '| net:', netText, '| account:', account0)
    await page.screenshot({ path: `${SHOTS}/02-connected.png`, fullPage: false })

    check('TC-WAL-004 header', /Wallet T\w{3,6}…?\w*|Wallet T/.test(headerLabel) && /nile/i.test(headerLabel), `header="${headerLabel}"`)
    check('TC-WAL-004 runtab env', envValue === 'injected', `env=${envValue}`)
    check('TC-WAL-004 runtab net', /nile/i.test(netText), `net="${netText}"`)
    const headerShort = (headerLabel.match(/Wallet (T\w{3,5})/) || [])[1]
    check('TC-IX-ENV-002 account sync', account0 && headerShort && account0.startsWith(headerShort.slice(0, 4)), `header=${headerShort} runtab=${account0}`)

    // Wallet menu read surfaces.
    await headerBtn.click()
    const menuAccount = (await page.locator('[data-id="headerWalletAccount"]').textContent({ timeout: 5000 }).catch(() => '')) || ''
    const menuNetwork = (await page.locator('[data-id="headerWalletNetwork"]').textContent().catch(() => '')) || ''
    log('menu account:', menuAccount, '| menu network:', menuNetwork)
    check('TC-IX-ENV-002 menu', /^T/.test(menuAccount.trim()) && /nile/i.test(menuNetwork), `menu acc=${menuAccount} net=${menuNetwork}`)

    // ---- TC-WAL-009: disconnect from the header menu ----
    await page.locator('[data-id="headerWalletDisconnect"]').click()
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-id="headerWalletConnect"]')
      return el && /Connect Wallet/.test(el.textContent || '')
    }, null, { timeout: 15000 })
    // RunTab must fall back to the VM (safe state) with VM accounts refilled.
    await page.waitForFunction(() => {
      const sel = document.querySelector('select#selectExEnvOptions')
      return sel && sel.value === 'vm-tron'
    }, null, { timeout: 15000 })
    await page.waitForFunction((walletAcc) => {
      const sel = document.querySelector('select[data-id="runTabSelectAccount"]')
      return sel && sel.options.length > 0 && sel.options[0].text !== walletAcc
    }, account0, { timeout: 20000 })
    const envAfter = await page.locator('select#selectExEnvOptions').inputValue()
    const accAfter = await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent()
    const netAfter = (await page.locator('[data-id="settingsNetworkEnv"]').textContent() || '').trim()
    await page.screenshot({ path: `${SHOTS}/03-disconnected.png` })
    log('after disconnect → env:', envAfter, '| net:', netAfter, '| account0:', accAfter)
    check('TC-WAL-009 env fallback', envAfter === 'vm-tron', `env=${envAfter}`)
    check('TC-WAL-009 wallet account cleared', accAfter !== account0, `account0=${accAfter}`)
    check('TC-WAL-009 header reset', true, 'header shows Connect Wallet')

    // ---- TC-IX-ENV-002 part 2: reconnect via header again (re-entry works) ----
    const active2 = { on: true }
    const pump2 = startApprovePump(browser, active2)
    await page.locator('[data-id="headerWalletConnect"]').click()
    try {
      await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 30000 })
    } finally {
      active2.on = false
      await pump2
    }
    const envRe = await page.locator('select#selectExEnvOptions').inputValue()
    check('TC-IX-ENV-002 reconnect', envRe === 'injected', `env=${envRe}`)
    await page.screenshot({ path: `${SHOTS}/04-reconnected.png` })

    // Leave DISCONNECTED so later phases start from a known state.
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.locator('[data-id="headerWalletDisconnect"]').click()
    await page.waitForFunction(() => /Connect Wallet/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 15000 })
    log('left in disconnected state')
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/99-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
