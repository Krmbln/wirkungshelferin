import { expect, test, type Page } from '@playwright/test'

// Collects CSP violations and console errors from the moment the page starts.
async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  await page.exposeFunction('__reportCsp', (v: string) => problems.push(`csp: ${v}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __reportCsp: (v: string) => void }).__reportCsp(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    )
  })
  return problems
}

test('loads in Google Chrome without CSP violations', async ({ page }) => {
  const problems = await watchProblems(page)
  await page.goto('./')

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
