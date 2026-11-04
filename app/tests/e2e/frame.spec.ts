import { expect, test } from '@playwright/test'
import { startProject } from './helpers'

const stepRow = (n: number) => `nav [aria-label^="${n} "]`

test('Tab follows reading order in Chrome: sidebar, then the page', async ({ page }) => {
  await startProject(page)

  const names: string[] = []
  for (let i = 0; i < 11; i++) {
    await page.keyboard.press('Tab')
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        return el.getAttribute('aria-label') ?? el.innerText.split('\n')[0]
      }),
    )
  }
  expect(names).toEqual([
    'Übersicht',
    '0 Projekt, noch nicht begonnen',
    '1 Gruppen, noch nicht begonnen',
    '2 Problem, noch nicht begonnen',
    '3 Ziele, noch nicht begonnen',
    '4 Logik, noch nicht begonnen',
    '5 Messen, noch nicht begonnen',
    '6 Plan, noch nicht begonnen',
    'Einstellungen',
    'Weiter',
    '0 · Projektkontext & Messrahmen',
  ])
})

test('a focused sidebar row shows its status tooltip beside the row; Enter opens the step', async ({ page }) => {
  // The bubble is placed via element.style (CSSOM), which the CSP allows; prove it.
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(e.violatedDirective),
    )
  })
  await startProject(page)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const bubble = page.locator(stepRow(0)).locator('.tooltip__bubble')
  await expect(bubble).toBeVisible()
  await expect(bubble).toHaveText('noch nicht begonnen')
  // Beside the row, so it doesn't cover the next one.
  const row = await page.locator(stepRow(0)).boundingBox()
  const box = await bubble.boundingBox()
  expect(row && box && box.x >= row.x + row.width).toBe(true)
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([])

  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Projektkontext & Messrahmen' })).toBeVisible()
  await expect(page.locator(stepRow(0))).toHaveAttribute('aria-current', 'page')
})

test('two columns hold down to 960 px; below that the hint appears', async ({ page }) => {
  const hint = page.getByText('Zieh das Fenster etwas breiter')
  await page.setViewportSize({ width: 960, height: 800 })
  await startProject(page)
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(hint).toBeHidden()

  const chat = await page.getByRole('region', { name: 'Chat' }).boundingBox()
  const block = await page.getByRole('region', { name: 'Baustein' }).boundingBox()
  expect(chat && block && block.x >= chat.x + chat.width - 1).toBe(true)
  expect(chat && block && Math.abs(block.y - chat.y) < 1).toBe(true)

  await page.setViewportSize({ width: 900, height: 800 })
  await expect(hint).toBeVisible()
})

test('chat and block scroll independently; the page itself does not scroll', async ({ page }) => {
  await startProject(page)
  await page.getByRole('button', { name: 'Weiter' }).click()
  const scroll = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight <= window.innerHeight,
    columns: [...document.querySelectorAll('.workspace__scroll')].map((el) => getComputedStyle(el).overflowY),
  }))
  expect(scroll).toEqual({ page: true, columns: ['auto', 'auto'] })
})
