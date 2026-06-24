/*
 * Inspect TronLink's chrome.storage.local via its service worker (CDP).
 * Usage: node tronlink-storage.cjs list            → dump keys + whitelist-ish entries
 *        node tronlink-storage.cjs get <key>       → print one key (JSON)
 *        node tronlink-storage.cjs delete <key>    → backup to /tmp then remove
 */
const { chromium } = require('@playwright/test')
const fs = require('fs')

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  let sw = ctx.serviceWorkers().find((w) => w.url().includes('ibnejdfjmmkpcnlpebklmnkoeoihofec'))
  if (!sw) {
    // Service worker may be idle; poke the extension to wake it.
    const page = await ctx.newPage()
    await page.goto('chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home').catch(() => {})
    await new Promise((r) => setTimeout(r, 3000))
    sw = ctx.serviceWorkers().find((w) => w.url().includes('ibnejdfjmmkpcnlpebklmnkoeoihofec'))
    await page.close().catch(() => {})
  }
  if (!sw) { console.log('NO service worker target found'); await browser.close(); return }

  const cmd = process.argv[2] || 'list'
  const key = process.argv[3]
  if (cmd === 'list') {
    const out = await sw.evaluate(async () => {
      const all = await chrome.storage.local.get(null)
      const keys = Object.keys(all)
      const interesting = {}
      for (const k of keys) {
        const v = JSON.stringify(all[k])
        if (/whitelist|localhost|18080|authoriz|connect|sign/i.test(k) || (v && /localhost|18080|whitelist/i.test(v.slice(0, 4000)))) {
          interesting[k] = v.length > 1200 ? v.slice(0, 1200) + `…(${v.length})` : v
        }
      }
      return { keys, interesting }
    })
    console.log('ALL KEYS:', out.keys.join(', '))
    console.log('\nINTERESTING:')
    for (const [k, v] of Object.entries(out.interesting)) console.log(`\n--- ${k} ---\n${v}`)
  } else if (cmd === 'get') {
    const v = await sw.evaluate(async (k) => JSON.stringify((await chrome.storage.local.get(k))[k]), key)
    console.log(v)
  } else if (cmd === 'delete') {
    const v = await sw.evaluate(async (k) => JSON.stringify((await chrome.storage.local.get(k))[k]), key)
    fs.writeFileSync(`/tmp/wallet-batch/backup-${key.replace(/[^\w.-]/g, '_')}.json`, v || 'undefined')
    await sw.evaluate(async (k) => { await chrome.storage.local.remove(k) }, key)
    console.log('deleted', key, '(backup in /tmp/wallet-batch)')
  }
  await browser.close()
})()
