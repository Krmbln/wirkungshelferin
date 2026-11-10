import { expect, test, type Page } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

// Step 5 by hand in real Chrome against the build (implementation plan step 19, the plan's own
// test): a critical, unsure assumption from step 4 shows as a candidate; it becomes a learning
// question with two outcome indicators; two mandatory figures get their targets and don't count
// toward the 6; it all survives a reload.

type Item = Record<string, unknown> & { id: string }
type Stored = { steps: Record<string, { block: Record<string, Item[]> }> }

async function type(page: Page, text: string) {
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('a candidate becomes a question with two indicators; mandatory figures with targets; it survives a reload', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)
  const panel = page.getByRole('region', { name: 'Baustein' })

  // Steps 1, 3, 4: one focus group, a Stufe 5 goal, a critical link with weak evidence.
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await panel.getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
  await type(page, 'Jugendliche 12–17')
  await panel.getByRole('checkbox', { name: 'Fokusgruppe' }).first().check()
  await page.getByRole('button', { name: /^3 Ziele,/ }).click()
  await panel.getByRole('button', { name: 'Ziel hinzufügen: Stufe 5 · Jugendliche 12–17' }).click()
  await type(page, 'Sie reparieren ihr Rad selbst.')
  await page.getByRole('button', { name: /^4 Logik,/ }).click()
  await panel.getByRole('button', { name: 'Aktivität hinzufügen' }).click()
  await type(page, 'Offene Werkstatt')
  await panel.getByRole('button', { name: 'Verbindung hinzufügen: Jugendliche 12–17' }).click()
  const picker = panel.locator('[data-item-id="li1"] [data-picker]')
  await picker.getByRole('group', { name: 'Von' }).getByRole('radio', { name: 'Offene Werkstatt', exact: true }).check()
  await picker.getByRole('group', { name: 'Nach' }).getByRole('radio', { name: 'Sie reparieren ihr Rad selbst.', exact: true }).check()
  await picker.getByRole('button', { name: 'Fertig' }).click()
  await panel.locator('[data-item-id="li1"] [data-field="assumption"] textarea').fill('Die Ehrenamtlichen lassen sie selbst machen')
  await page.keyboard.press('Enter')
  await panel.locator('[data-item-id="li1"] [data-field="evidence"] select').selectOption('eigene_erfahrung')
  await panel.locator('[data-item-id="li1"] [data-field="critical"] input').check()

  // Step 5: the candidate is there, undecided.
  await page.getByRole('button', { name: /^5 Messen,/ }).click()
  const candidate = panel.locator('[data-candidate="li1"]')
  await expect(candidate).toContainText('Die Ehrenamtlichen lassen sie selbst machen')
  await expect(candidate).toContainText('noch offen')
  await candidate.getByRole('button', { name: /^Als Lernfrage aufnehmen/ }).click()
  await expect(panel.getByRole('textbox', { name: 'Lernfrage 1' })).toBeFocused()
  await type(page, 'Reparieren die Jugendlichen wirklich selbst?')
  await expect(candidate).toContainText('Aufgenommen in Frage 1')

  // Two outcome indicators; then "+ Indikator" says why it can't be used.
  const indicators: [string, string, string][] = [
    ['Anteil der Stammgäste, die einen Platten selbst flicken – zum Jahresende', 'nachträglich im Dezember', 'mindestens die Hälfte'],
    ['Zahl der Räder, die Jugendliche ohne Hilfe wieder fahrbereit machen – je Quartal', 'ab jetzt', '10 je Quartal'],
  ]
  for (const [n, [text, baseline, target]] of indicators.entries()) {
    await panel.getByRole('button', { name: 'Indikator hinzufügen: Frage 1' }).click()
    await type(page, text)
    const row = panel.locator(`[data-item-id="in${n + 1}"]`)
    await row.locator('[data-field="baseline"] textarea').fill(baseline)
    await page.keyboard.press('Enter')
    await row.locator('[data-field="target"] textarea').fill(target)
    await page.keyboard.press('Enter')
    await expect(row.getByRole('combobox', { name: 'Stufe' })).toHaveValue('5')
  }
  await expect(panel.getByRole('button', { name: 'Indikator hinzufügen: Frage 1' })).toHaveAttribute('aria-disabled', 'true')
  await expect(panel.getByText('Höchstens 2 je Frage.')).toBeVisible()

  // Two mandatory figures with their targets: the indicator count stays at 2.
  const figures: [string, string][] = [
    ['Teilnehmende nach Geschlecht', '15, davon 6 Mädchen'],
    ['Anzahl offener Werkstatttage', '80'],
  ]
  for (const [n, [name, target]] of figures.entries()) {
    await panel.getByRole('button', { name: 'Pflichtangabe hinzufügen' }).click()
    await type(page, name)
    await panel.locator(`[data-item-id="mf${n + 1}"] [data-field="target"] textarea`).fill(target)
    await page.keyboard.press('Enter')
  }
  await expect(panel.getByText('1 von höchstens 3 Fragen · 2 von höchstens 6 Indikatoren')).toBeVisible()
  await page.waitForTimeout(100)
  await page.reload()

  await page.getByRole('button', { name: /^5 Messen,/ }).click()
  await expect(panel.locator('[data-candidate="li1"]')).toContainText('Aufgenommen in Frage 1')
  const stored = (await readStored(page, 'project')) as Stored
  const block = stored.steps['5'].block
  expect(block.focusQuestions.map((q) => [q.text, q.reasons, q.linkIds])).toEqual([['Reparieren die Jugendlichen wirklich selbst?', ['kritische_annahme'], ['li1']]])
  expect(block.indicators.map((i) => [i.focusQuestionId, i.level, i.baseline, i.target])).toEqual([
    ['fq1', 5, 'nachträglich im Dezember', 'mindestens die Hälfte'],
    ['fq1', 5, 'ab jetzt', '10 je Quartal'],
  ])
  expect(block.mandatoryFigures.map((f) => [f.name, f.target])).toEqual(figures)
  expect(block.deferredCandidates).toEqual([])
  expect(problems).toEqual([])
})
