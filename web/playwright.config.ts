import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against the real stack: an isolated API (fresh database, rival simulator off
 * so nothing random interferes) and the Vite dev server proxying to it.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 8100)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5180)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one shared database: tests run in order
  // No retries: tests share one database, so a retry would run against the failed attempt's
  // bids and could pass without testing anything.
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: [
    {
      // seed --reset gives every run a fresh database, on any OS.
      command: `uv run python -m app.seed --reset && uv run python -m app.serve --port ${API_PORT}`,
      cwd: '../server',
      env: { DATABASE_URL: 'sqlite:///e2e.db', SIMULATOR_ENABLED: '0' },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { THE_BLOCK_API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
