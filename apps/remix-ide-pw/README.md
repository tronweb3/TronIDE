# TronIDE Playwright smoke

Minimal Playwright harness for the post-2026-05-27 audit surface. The
existing Nightwatch suite at `apps/remix-ide-e2e/` still owns the full
deploy/debug/MetaMask flows; this harness exists to add cheap,
fast-feedback smoke tests for new Home / GitHub-token / Contract
Verification work where Playwright's auto-waiting and trace viewer are
worth the extra dep.

## Layout

- `playwright.config.ts` — single-browser (Chromium) config; auto-starts
  `pnpm nx serve remix-ide --configuration=development` on port 18080
  unless `TRONIDE_PW_REUSE_SERVER=1` is set. Use
  `TRONIDE_PW_BASE_URL=http://localhost:<port>` when iterating against a
  different external server.
- `tests/*.spec.ts` — smoke specs. Today: home loads, GitHub token modal
  storage regression.

## Running

```bash
# First-time browser install (Chromium + system deps)
pnpm test:pw:install

# Headless run — boots its own dev server, runs, tears down
pnpm test:pw

# Iterate against an already-running server
TRONIDE_PW_REUSE_SERVER=1 TRONIDE_PW_BASE_URL=http://localhost:18080 pnpm test:pw

# Headed / debug
pnpm test:pw:headed
pnpm test:pw:debug
```

Reports land in `playwright-report/` (gitignored under `reports/*`).

## What's covered

| Spec | What it asserts |
|---|---|
| `home.spec.ts` | Landing page renders, primary Home actions are present, Advanced tools remain collapsed until expanded, the expanded advanced sections render, the state is persisted, the tabbar compile shortcut starts disabled without an active Solidity tab, and no console errors occur during initial load |
| `github-token-modal.spec.ts` | "Connect token" opens the modal **without** the legacy "Remember in this browser" checkbox; the tab-only storage notice is present (regression for the 2026-05-27 HIGH finding) |

## What it's NOT for

- MetaMask / TronLink wallet flows — keep those in the Nightwatch suite
  for now (CRX install via Selenium chromedriver is already tuned there).
- Full compile/deploy round-trips — the Nightwatch suite already covers
  `ballot.test.ts`, `libraryDeployment.test.ts`, etc.
- Anything that needs a real TronGrid / TronScan call — mock at the
  fetch boundary if you reach for that.
