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

test('the CSP refuses HTML written by script (Trusted Types)', async ({ page }) => {
  await startProject(page)
  const result = await page.evaluate(() => {
    try {
      document.createElement('div').innerHTML = '<img src=x>'
      return 'allowed'
    } catch (e) {
      return (e as Error).name
    }
  })
  expect(result).toBe('TypeError')
})

test('embedded in another page, the app loads no data and points to its own tab', async ({ page, baseURL, context }) => {
  const problems = await watchProblems(page)
  // Another origin embeds the app. Chrome treats the routed page as public, so it may only frame
  // localhost with the local network permission (the live site is public itself).
  await context.grantPermissions(['local-network-access'])
  const embed = 'http://localhost:4199/embed.html'
  await page.route(embed, (route) =>
    route.fulfill({ contentType: 'text/html', body: `<iframe src="${baseURL}" width="900" height="600"></iframe>` }),
  )
  await page.goto(embed)
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: 'Bitte öffne die Wirkungshelferin direkt' })).toBeVisible()
  await expect(frame.getByRole('link', { name: 'In einem eigenen Tab öffnen' })).toHaveAttribute('href', baseURL!)
  await expect(frame.getByRole('navigation')).toHaveCount(0)
  expect(problems).toEqual([])
})
