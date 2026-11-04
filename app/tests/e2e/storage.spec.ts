import { expect, test, type Page } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

const home = (page: Page) => page.getByRole('heading', { level: 1, name: 'Übersicht' })
const secondTab = (page: Page) =>
  page.getByRole('heading', { name: 'Die Wirkungshelferin ist schon in einem anderen Tab offen' })

test('"Neu starten" survives a reload, without CSP violations or console errors', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)
  await expect(page.getByText('Gespeichert')).toBeVisible()
  await page.reload()
  await expect(home(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Neu starten' })).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a second tab is refused; after the first closes, it works on reload', async ({ page, context }) => {
  await startProject(page)

  const second = await context.newPage()
  const problems = await watchProblems(second)
  await second.goto('./')
  await expect(secondTab(second)).toBeVisible()
  await expect(second.getByRole('navigation')).toHaveCount(0)

  // The first tab can still reload: its old page released the lock on unload.
  await page.reload()
  await expect(home(page)).toBeVisible()

  // Closing a tab shows its neighbour before the closing page has released the lock.
  // So the "came back" event fires first, then the first tab closes.
  await second.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.close()
  await expect(home(second)).toBeVisible({ timeout: 5000 })
  expect(problems).toEqual([])
})

test('a refused tab opens after a reload once the first tab is closed', async ({ page, context }) => {
  await startProject(page)
  const second = await context.newPage()
  await second.goto('./')
  await expect(secondTab(second)).toBeVisible()
  await page.close()
  await second.reload()
  await expect(home(second)).toBeVisible()
})

test('reloading the working tab keeps it, even with a refused tab in the background', async ({ page, context }) => {
  await startProject(page)
  const second = await context.newPage()
  await second.goto('./')
  await expect(secondTab(second)).toBeVisible()
  await page.bringToFront()
  await page.reload()
  await expect(home(page)).toBeVisible()
  await expect(secondTab(second)).toBeVisible()
})

test('"Backup laden" on the empty state restores a saved project', async ({ page, context }) => {
  await startProject(page)
  const project = await readStored(page, 'project')
  await page.close()

  // A fresh profile: nothing stored.
  const fresh = await context.browser()!.newContext({ baseURL: test.info().project.use.baseURL })
  const other = await fresh.newPage()
  await other.goto('./')
  const chooser = other.waitForEvent('filechooser')
  await other.getByRole('button', { name: 'Backup laden' }).click()
  await (await chooser).setFiles({
    name: 'wirkungshelferin-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  // A new Chrome runs setup first (step 7); the project is already restored underneath.
  const setup = other.getByRole('heading', { level: 1, name: 'Bevor es losgeht' })
  await expect(setup).toBeVisible()
  expect(await readStored(other, 'project')).toEqual(project)
  await other.reload()
  await expect(setup).toBeVisible()
  await fresh.close()
})

test('Chrome is asked to keep the data (persistent storage)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __persistAsked: boolean }
    w.__persistAsked = false
    const persist = navigator.storage.persist.bind(navigator.storage)
    navigator.storage.persist = () => {
      w.__persistAsked = true
      return persist()
    }
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Neu starten' }).waitFor()
  expect(await page.evaluate(() => (window as unknown as { __persistAsked: boolean }).__persistAsked)).toBe(true)
})
