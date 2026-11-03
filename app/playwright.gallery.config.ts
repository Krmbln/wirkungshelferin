import { defineConfig } from '@playwright/test'

const PORT = 5174

// The state gallery exists only in the dev server, so these tests run against
// `vite` instead of `vite preview`. Screenshots land in screenshots/gallery/.
export default defineConfig({
  testDir: 'tests/gallery',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/wirkungshelferin/`,
    channel: 'chrome',
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/wirkungshelferin/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
