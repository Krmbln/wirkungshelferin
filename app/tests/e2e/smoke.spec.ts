import { expect, test } from '@playwright/test'
import { startProject, watchProblems } from './helpers'

test('loads in Google Chrome without CSP violations', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)

  const brands = await page.evaluate(() =>
    (navigator as unknown as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands.map(
      (b) => b.brand,
    ),
  )
  expect(brands).toContain('Google Chrome')

  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible()
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  // The self-hosted font loads under the CSP.
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('400 16px "Source Sans 3"'))).toBe(true)
  expect(problems).toEqual([])
})

test('blocks a browser without userAgentData (Safari, Firefox)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined })
  })
  await page.goto('./')

  await expect(page.getByRole('heading', { name: 'Bitte öffne die Wirkungshelferin in Chrome' })).toBeVisible()
  await expect(page.getByText(/localhost:\d+\/wirkungshelferin\//)).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
})
