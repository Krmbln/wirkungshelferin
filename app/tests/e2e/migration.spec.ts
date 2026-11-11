import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { SCHEMA_VERSION } from '../../src/domain/schemas/project'
import { readStored, watchProblems, writeStored } from './helpers'

// A stored document of every frozen version opens on start in real Chrome (tech design §13): the
// current one as it is, an older one migrated with its pre-migration copy kept. With v1 only, the
// migration branch waits for the first version bump; frozen.test.ts makes sure that bump adds a file.

const dir = new URL('../fixtures/schema/', import.meta.url)
const frozen = readdirSync(dir)
  .filter((f) => /^v\d+\.json$/.test(f))
  .map((f) => ({ version: Number(f.slice(1, -'.json'.length)), doc: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }))

const settings = { model: 'claude-opus-5-5', effort: 'medium', setupDone: true }

for (const { version, doc } of frozen) {
  test(`a stored v${version} document opens on start, with every step`, async ({ page }) => {
    const problems = await watchProblems(page)
    await page.goto('./')
    await page.getByRole('button', { name: 'Neu starten' }).waitFor()
    await writeStored(page, 'settings', settings)
    await writeStored(page, 'project', doc)
    await page.reload()

    await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible()
    const row = (step: number, status: string) => page.getByRole('button', { name: new RegExp(`^${step} .*, ${status}$`) })
    for (const step of [0, 1, 2]) await expect(row(step, 'bestätigt')).toBeVisible()
    for (const step of [3, 4, 5]) await expect(row(step, 'vielleicht veraltet')).toBeVisible()
    await expect(row(6, 'in Arbeit')).toBeVisible()

    // Step 3 keeps step 2's old snapshot for "Änderung prüfen lassen"; step 6 its chat and card.
    await row(3, 'vielleicht veraltet').click()
    await expect(page.locator('.outdated').getByRole('button', { name: 'Änderung prüfen lassen' })).toBeVisible()
    await row(6, 'in Arbeit').click()
    await expect(page.getByText('Erste Planzeilen für die Anwesenheitsliste stehen', { exact: false })).toBeAttached()

    const stored = (await readStored(page, 'project')) as { schemaVersion: number }
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION)
    if (version < SCHEMA_VERSION) expect(await readStored(page, `project.pre-v${version}`)).toEqual(doc)
    else expect(stored).toEqual(doc)
    expect(problems).toEqual([])
  })
}

test('a document from a newer version is left untouched, with a plain message', async ({ page }) => {
  const newest = frozen.find((f) => f.version === SCHEMA_VERSION)!.doc
  const newer = { ...newest, schemaVersion: SCHEMA_VERSION + 1, futureField: true }
  await page.goto('./')
  await page.getByRole('button', { name: 'Neu starten' }).waitFor()
  await writeStored(page, 'settings', settings)
  await writeStored(page, 'project', newer)
  await page.reload()

  await expect(page.getByRole('heading', { level: 1, name: 'Deine Daten stammen von einer neueren Version' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Seite neu laden' })).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0)
  expect(await readStored(page, 'project')).toEqual(newer)
  expect(await readStored(page, `project.pre-v${SCHEMA_VERSION}`)).toBeUndefined()
})
