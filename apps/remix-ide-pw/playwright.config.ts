/*
 * Minimal Playwright config for TronIDE smoke tests.
 *
 * Lives alongside the existing Nightwatch suite at apps/remix-ide-e2e — this
 * is a new, additive harness for the post-2026-05-27 audit surface (Home
 * GitHub token panel, Contract Verification plugin) where Playwright's
 * auto-waiting and trace viewer pay off more than Nightwatch's CRX setup.
 */

import { defineConfig, devices } from '@playwright/test'

// Keep Playwright on a dedicated port by default. Port 8080 is commonly used by
// local Docker/dev services; reusing an arbitrary existing 8080 listener caused
// false white-screen failures in the smoke suite.
const BASE_URL = process.env.TRONIDE_PW_BASE_URL || 'http://localhost:18080'
const REUSE_SERVER = process.env.TRONIDE_PW_REUSE_SERVER === '1'
const serverPort = new URL(BASE_URL).port || '80'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  // Every spec drives the SAME dev server and spins its own in-browser solc
  // compile. Running compiles concurrently saturates the CPU and starves
  // timing-sensitive specs (tooltips, debugger stepping), so run serially —
  // matching CI. A retry still absorbs any residual flake.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  // Boot the dev server unless an external one is already running (set
  // TRONIDE_PW_REUSE_SERVER=1 when iterating locally against `pnpm serve`).
  webServer: REUSE_SERVER
    ? undefined
    : {
      command: `pnpm nx serve remix-ide --configuration=development --port=${serverPort}`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe'
    }
})
