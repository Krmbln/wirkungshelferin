import { defineConfig } from '@playwright/test'

const PORT = 4173

// E2E runs against the production build (vite preview) in real Google Chrome.
export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/wirkungshelferin/`,
    channel: 'chrome',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: `http://localhost:${PORT}/wirkungshelferin/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
