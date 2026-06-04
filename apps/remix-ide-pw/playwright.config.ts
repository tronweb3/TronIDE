/*
 * Minimal Playwright config for TronIDE smoke tests.
 *
 * Lives alongside the existing Nightwatch suite at apps/remix-ide-e2e — this
 * is a new, additive harness for the post-2026-05-27 audit surface (Home
 * GitHub token panel, Contract Verification plugin) where Playwright's
 * auto-waiting and trace viewer pay off more than Nightwatch's CRX setup.
 */

import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.TRONIDE_PW_BASE_URL || 'http://localhost:8080'
const REUSE_SERVER = process.env.TRONIDE_PW_REUSE_SERVER === '1'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      command: 'pnpm nx serve remix-ide --configuration=development',
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      stdout: 'ignore',
      stderr: 'pipe'
    }
})
