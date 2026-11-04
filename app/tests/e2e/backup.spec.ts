import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseAnswer } from '../fakeClaude'
import { completeSetup, fakeClaude, readStored, startProject, watchProblems } from './helpers'

// Step 6 (PRD F7 "done when"): clearing browser data + loading the latest backup restores
// the exact state, except the API key, which is entered again.
test('backup → clear site data → "Backup laden" restores everything except the key', async ({ page, context }) => {
  const problems = await watchProblems(page)
  // The real first start, so the key is stored as setup stores it.
  await completeSetup(page, dummyKey)
  expect(await readStored(page, 'settings')).toMatchObject({ apiKey: dummyKey })
  await page.getByRole('navigation').getByRole('button', { name: 'Einstellungen' }).click()
  await expect(page.getByText('••••••••c3AA')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Backup speichern' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^wirkungshelferin-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const text = await readFile(await file.path(), 'utf8')
  expect(text).not.toContain(dummyKey)
  expect(text).not.toContain('apiKey')
  await expect(page.getByRole('navigation')).toContainText('Backup: heute')
  // Autosave has the backup time too: the stored project is exactly the file.
  await expect.poll(() => readStored(page, 'project')).toEqual(JSON.parse(text))
  expect(problems).toEqual([])
  await page.close()

  // "Delete site data" in Chrome, for this browser context only: the tab is closed (lock
  // released), then the database goes from a same-origin page before the app loads again.
  // (CDP's Storage.clearDataForOrigin isn't scoped to one context and stalls parallel tests.)
  const fresh = await context.newPage()
  await fresh.goto('./favicon.svg')
  await fresh.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.deleteDatabase('wirkungshelferin')
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
        r.onblocked = () => reject(new Error('database still open'))
      }),
  )
  expect(await fresh.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('wirkungshelferin')
  const freshProblems = await watchProblems(fresh)
  await fakeClaude(fresh, () => ({ status: 200, body: sseAnswer(), contentType: 'text/event-stream' }))
  await fresh.goto('./')
  const chooser = fresh.waitForEvent('filechooser')
  await fresh.getByRole('button', { name: 'Backup laden' }).click()
  await (await chooser).setFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) })

  // Everything except the key: a new Chrome has no settings, so setup asks for the key, and
  // only for the key (privacy note and backup are in the file).
  await expect(fresh.getByRole('heading', { level: 1, name: 'Verbindung zu Claude' })).toBeVisible()
  expect(await readStored(fresh, 'project')).toEqual(JSON.parse(text))
  await expect(fresh.getByLabel('API-Schlüssel')).toHaveValue('')
  await expect(fresh.getByRole('list', { name: 'Einrichtung' })).toHaveCount(0)
  expect(await readStored(fresh, 'settings')).toBeUndefined()
  await fresh.getByLabel('API-Schlüssel').fill(dummyKey)
  await fresh.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(fresh.getByText(/Verbindung erfolgreich/)).toBeVisible()
  await fresh.getByRole('button', { name: 'Fertig' }).click()
  await expect(fresh.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible()
  await expect(fresh.getByRole('navigation')).toContainText('Backup: heute')
  await fresh.getByRole('navigation').getByRole('button', { name: 'Einstellungen' }).click()
  await expect(fresh.getByLabel('Modell')).toHaveValue('claude-opus-5-5')

  await fresh.reload()
  await expect(fresh.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible()
  expect(freshProblems).toEqual([])
})

test('"Backup laden" over existing data asks first; "Abbrechen" keeps it', async ({ page }) => {
  await startProject(page)
  const before = await readStored(page, 'project')
  await page.getByRole('navigation').getByRole('button', { name: 'Einstellungen' }).click()
  const backup = { ...(before as object), lastBackupAt: '2026-11-03T10:00:00.000Z' }
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Backup laden' }).click()
  await (await chooser).setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  const dialog = page.getByRole('dialog', { name: 'Backup laden?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await readStored(page, 'project')).toEqual(before)
})
