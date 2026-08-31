import { Page, Request, expect } from '@playwright/test'

/**
 * The v2.3.3 Task Runtime sends a canonical JSON ToolResult to every model
 * adapter. Most browser behavior specs assert the user-facing executor summary
 * rather than the envelope itself, so unwrap exactly that field while keeping
 * legacy text results compatible. Protocol-shape tests cover the envelope in
 * the unit suite.
 */
export function toolResultSummary (content: unknown): string {
  const raw = String(content ?? '')
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.boundary?.type === 'tronide_untrusted_tool_output') {
      const result = parsed.result
      return result && typeof result.summary === 'string' ? result.summary : String(result ?? '')
    }
    return parsed && typeof parsed.summary === 'string' ? parsed.summary : raw
  } catch (e) {
    return raw
  }
}

/**
 * Hide the webpack dev-server overlay and dismiss the first-load "I Understand"
 * welcome dialog if it appears. Safe to call on every page that may show it.
 */
export async function dismissWelcomeModal (page: Page) {
  try {
    await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' })
  } catch (e) {}
  const welcomeDialogBtn = page.locator('button:has-text("I Understand")')
  try {
    await welcomeDialogBtn.waitFor({ state: 'visible', timeout: 5000 })
    // The legacy modal's static backdrop can briefly win hit-testing while the
    // dialog is animating. Force this setup-only acknowledgement so a blocked
    // pointer action cannot consume the entire test timeout.
    await welcomeDialogBtn.click({ force: true, timeout: 5000 })
  } catch (e) {
    // Ignore if dialog does not appear
  }
}

/** Load the IDE and wait until the landing page is interactive. */
export async function gotoHome (page: Page) {
  // The IDE readiness marker is the real application gate. Waiting for the
  // browser `load` event also waits on optional CDN assets and can time out on
  // an otherwise interactive live deployment during a long serial run.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

/**
 * Seed only TronIDE's opaque BFF session for deterministic UI tests. This is
 * not a GitHub credential; no PAT or OAuth access token enters browser storage.
 */
export async function seedGithubBffSession (page: Page, login = 'tron-tester', options: { mockBff?: boolean } = {}) {
  // A synthetic handle is intentionally unknown to every real BFF. Stub the
  // two session-hydration endpoints by default so reloading cannot turn a UI
  // fixture into a dependency on whichever local/deployed BFF origin happens
  // to be compiled into the app. Tests that exercise richer BFF behavior set
  // mockBff=false and install their own route handlers before calling here.
  if (options.mockBff !== false) {
    const corsHeaders = (request: Request) => ({
      'access-control-allow-origin': request.headers().origin || new URL(page.url()).origin,
      'access-control-allow-methods': 'GET, DELETE, OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'x-tronide-session'
    })
    await page.route('**/session', (route) => {
      const request = route.request()
      const headers = corsHeaders(request)
      if (request.method() === 'OPTIONS' || request.method() === 'DELETE') {
        return route.fulfill({ status: 204, headers })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({ login, repositoryInstallationRequired: false })
      })
    })
    await page.route('**/installations', (route) => {
      const request = route.request()
      const headers = corsHeaders(request)
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers,
        body: JSON.stringify({ provider: 'oauth_app', required: false, installed: true, installations: [] })
      })
    })
  }
  await page.evaluate(({ user }) => {
    window.sessionStorage.setItem('tronide.github.session', 'test_bff_session_handle_012345678901234567890')
    window.sessionStorage.setItem('tronide.github.user', user)
    window.sessionStorage.removeItem('tronide.github.token')
    window.localStorage.removeItem('tronide.github.token')
  }, { user: login })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

/** data-id selector for a row of the File Explorer tree. */
export function treeItem (path: string) {
  return `[data-id="treeViewLitreeViewItem${path}"]`
}

/**
 * Show plugin `name` in the side panel WITHOUT toggle-closing it: clicking the
 * icon of the plugin that is already shown collapses the panel. The check must
 * key off the VISIBILITY of the plugin's own panel content (`readySelector`) —
 * not the swap-it header text, which keeps its last value while the panel is
 * collapsed to zero width. Safe whether the panel currently shows this plugin,
 * another plugin, or is collapsed.
 */
export async function ensureSidePanel (page: Page, name: string, readySelector: string) {
  const ready = page.locator(readySelector)
  if (!await ready.isVisible().catch(() => false)) {
    await page.locator(`#icon-panel div[plugin="${name}"]`).click()
    await ready.waitFor({ state: 'visible', timeout: 10_000 })
  }
}

/** Make the File Explorer the shown side panel (see ensureSidePanel). */
export async function ensureFilePanel (page: Page) {
  await ensureSidePanel(page, 'filePanel', '[data-id="filePanelFileExplorerTree"]')
}

/**
 * Select the same-origin compiler bundled with TronIDE and wait until it is
 * ready. VM/browser gates should not depend on downloading the legacy default
 * compiler from a CDN: a slow download otherwise looks like an application
 * regression and consumes the whole per-test timeout.
 */
export async function useBuiltinCompiler (page: Page) {
  const version = page.locator('#versionSelector')
  const compile = page.locator('[data-id="compilerContainerCompileBtn"]')
  await version.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(version).toBeEnabled({ timeout: 30_000 })
  if (await version.inputValue() !== 'builtin') await version.selectOption('builtin')
  await expect(version).toHaveValue('builtin')

  // The compiler worker reports loading asynchronously after the select
  // change. Give that event a turn, then wait for the settled enabled state.
  // In a long serial run Chromium can occasionally abandon an earlier worker
  // load while the select already reads `builtin`. Re-dispatching that choice
  // starts a fresh, cached same-origin load instead of leaving the test stuck
  // behind a permanently disabled Compile button.
  await page.waitForTimeout(500)
  try {
    await expect(compile).toBeEnabled({ timeout: 10_000 })
  } catch {
    await version.evaluate((element: HTMLSelectElement) => {
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForTimeout(500)
    await expect(compile).toBeEnabled({ timeout: 35_000 })
  }
  await expect(compile.locator('[aria-label="compiler is loading"]')).toHaveCount(0)
}

/**
 * Activate the Solidity UML plugin via the Plugin Manager if needed, then show
 * its panel without toggle-closing it.
 */
export async function activateUml (page: Page) {
  if (await page.locator('#icon-panel div[plugin="solidityUml"]').count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerComponentActivateButtonsolidityUml"]').click()
    await page.locator('#icon-panel div[plugin="solidityUml"]').waitFor({ timeout: 10_000 })
  }
  await ensureSidePanel(page, 'solidityUml', '[data-id="solidityUmlPanel"]')
}

/**
 * Abort every Solidity compiler source — the remote version list/binaries AND
 * the bundled same-origin fallback (assets/js/soljson.js) — so the specs never
 * spend CPU on solc. Ctrl+S still saves (compile-tab's global handler runs
 * fileManager.saveCurrentFile() before compiling) but the compile attempt now
 * fails instantly instead of loading a compiler and saturating the runner: the
 * compile-saturation flake must stay out of the @gate subset. Call BEFORE
 * page.goto.
 */
export async function blockCompilerSources (page: Page) {
  await page.route(
    /binaries\.soliditylang\.org|tronprotocol\.github\.io|\/assets\/js\/soljson\.js/,
    (route) => route.abort()
  )
}

/** Replace the whole Ace editor buffer. */
export async function setEditorText (page: Page, source: string) {
  await page.evaluate((s) => {
    const el = document.getElementById('input') as any
    el.editor.session.setValue(s)
  }, source)
}

/** Current Ace editor buffer ('' when the editor isn't up yet). */
export async function getEditorText (page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.getElementById('input') as any
    return el && el.editor ? el.editor.session.getValue() : ''
  })
}

/**
 * Read a workspace file straight from the in-browser filesystem ('' if
 * missing). This is the saved (provider) content, not the editor buffer.
 */
export async function readSavedFile (page: Page, path: string): Promise<string> {
  return page.evaluate((p) => {
    try {
      const select = document.querySelector('#workspacesSelect') as HTMLSelectElement | null
      const ws = (select && select.value) || 'default_workspace'
      return (window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/${p}`, 'utf8')
    } catch (e) {
      return ''
    }
  }, path)
}

/**
 * Ctrl+S the active file, then wait until the provider actually holds
 * `mustContain` — the deterministic replacement for sleeping after a save.
 */
export async function saveCurrentFile (page: Page, path: string, mustContain: string) {
  await page.keyboard.press('Control+S')
  await expect.poll(() => readSavedFile(page, path), { timeout: 15_000 }).toContain(mustContain)
}

/**
 * Create a file through the File Explorer's inline-edit flow. The explorer adds
 * a blank tree row in edit mode under the currently FOCUSED folder — not the
 * workspace root — and focuses its contenteditable label on a ~150ms delay:
 * wait for that focus before typing. Waits for the new row (matched by data-id
 * suffix, since the full path depends on the focused folder) to appear.
 */
export async function createFile (page: Page, name: string) {
  await ensureFilePanel(page)
  await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').click()
  const blank = page.locator('[data-id$="/blank"]').first()
  await blank.waitFor({ state: 'visible', timeout: 10_000 })
  await expect(blank.locator('.remixui_items[contenteditable="true"]')).toBeFocused({ timeout: 10_000 })
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await page.locator(`[data-id^="treeViewLitreeViewItem"][data-id$="${name}"]`).waitFor({ timeout: 20_000 })
  // The durable write emits fileAdded before File Explorer's async open()
  // finishes. A visible tree row therefore does not yet guarantee that test
  // editor operations target the new file instead of the previously active
  // session. Wait for the tab switch that completes the user-visible create
  // flow before returning to callers.
  await expect.poll(() => page.locator('remix-tab[active]').evaluateAll(
    (tabs, expectedName) => tabs.some((tab) => tab.id.endsWith(String(expectedName))),
    name
  ), { timeout: 20_000 }).toBe(true)
}

// Ace annotations carry { row, column, text, type }. Lint-owned annotations are
// tagged with their rule in the message text — the single source of truth for
// which rules exist; specs must not copy this list.
export const LINT_RULE_TAG = /\[(spdx|pragma|func-visibility|state-visibility|avoid-tx-origin|no-selfdestruct|avoid-throw|avoid-sha3|reason-string|contract-name-capwords)\]/

/** Only the lint plugin's annotations, read straight off the Ace session. */
export async function lintAnnotations (page: Page): Promise<Array<{ type: string, text: string, row: number }>> {
  const all = await page.evaluate(() => {
    const el = document.getElementById('input') as any
    return ((el && el.editor && el.editor.session.getAnnotations()) || [])
      .map((a: any) => ({ type: a.type, text: a.text, row: a.row }))
  })
  return all.filter((a) => LINT_RULE_TAG.test(a.text))
}
