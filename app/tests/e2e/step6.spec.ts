import { expect, test, type Page } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

// Step 6 by hand in real Chrome against the build (implementation plan step 20, the plan's own
// test): two KPIs and two mandatory figures from step 5 each get a plan row via "Planzeile
// anlegen"; the coverage list then folds away; it all survives a reload.

type Item = Record<string, unknown> & { id: string }
type Stored = { steps: Record<string, { block: Record<string, Item[]> }> }

async function type(page: Page, text: string) {
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('one plan row per KPI and per mandatory figure; the coverage list folds away; it survives a reload', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)
  const panel = page.getByRole('region', { name: 'Baustein' })

  // Step 5: one question with two KPIs, two mandatory figures.
  await page.getByRole('button', { name: /^5 Messen,/ }).click()
  await panel.getByRole('button', { name: 'Lernfrage hinzufügen' }).click()
  await type(page, 'Reparieren die Jugendlichen wirklich selbst?')
  for (const text of ['Anteil der Stammgäste, die einen Platten selbst flicken', 'Zahl der Räder, die Jugendliche ohne Hilfe reparieren']) {
    await panel.getByRole('button', { name: 'Indikator hinzufügen: Frage 1' }).click()
    await type(page, text)
  }
  for (const name of ['Teilnehmende nach Geschlecht', 'Anzahl offener Werkstatttage']) {
    await panel.getByRole('button', { name: 'Pflichtangabe hinzufügen' }).click()
    await type(page, name)
  }

  // Step 6: each one still needs a row.
  await page.getByRole('button', { name: /^6 Plan,/ }).click()
  await expect(panel.getByText('Mit Planzeile: 0 von 2 Indikatoren · 0 von 2 Pflichtangaben')).toBeVisible()
  const sources: [string, string][] = [
    ['in1', 'Kurzbefragung der Stammgäste'],
    ['in2', 'Reparaturbuch'],
    ['mf1', 'Anmeldebogen'],
    ['mf2', 'Anwesenheitsliste'],
  ]
  for (const [n, [id, source]] of sources.entries()) {
    await panel.locator(`[data-coverage="${id}"]`).getByRole('button', { name: /^Planzeile anlegen/ }).click()
    await expect(panel.locator(`[data-item-id="pr${n + 1}"] [data-field="dataSource"] textarea`)).toBeFocused()
    await type(page, source)
    if (n < sources.length - 1) await expect(panel.locator(`[data-coverage="${id}"]`)).toContainText(`In Zeile ${n + 1}`)
  }
  await expect(panel.getByText('Alle 2 Indikatoren und 2 Pflichtangaben haben eine Planzeile.')).toBeVisible()
  await expect(panel.locator('[data-coverage]')).toHaveCount(0)
  await page.waitForTimeout(100)
  await page.reload()

  await page.getByRole('button', { name: /^6 Plan,/ }).click()
  await expect(panel.getByText('Alle 2 Indikatoren und 2 Pflichtangaben haben eine Planzeile.')).toBeVisible()
  // Four rows after a reload: all start closed, the summary shows the source.
  await expect(panel.locator('[data-row-toggle="pr1"]')).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.locator('[data-item-id="pr2"]')).toContainText('Reparaturbuch')
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps['6'].block.planRows.map((r) => [r.indicatorIds, r.mandatoryFigureIds, r.dataSource])).toEqual([
    [['in1'], [], 'Kurzbefragung der Stammgäste'],
    [['in2'], [], 'Reparaturbuch'],
    [[], ['mf1'], 'Anmeldebogen'],
    [[], ['mf2'], 'Anwesenheitsliste'],
  ])
  expect(problems).toEqual([])
})
