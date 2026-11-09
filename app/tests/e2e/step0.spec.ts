import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseAnswer, sseToolUse } from '../fakeClaude'
import { fakeClaude, readStored, startProject, watchProblems, writeStored } from './helpers'

// Step 14 in real Chrome against the build (CSP on): paste a text → the first-draft card →
// "Alle übernehmen" → reload → check → confirm → step 1's first draft → "Weiter zu Schritt 1".

const profile = {
  name: 'Schraubzeit – offene Fahrradwerkstatt',
  organisation: 'Nachbarschaftshaus Am Weidengrund e. V.',
  projectBoundary: 'Die offene Werkstatt dienstags und donnerstags',
  location: 'Weidengrund-Siedlung',
  activities: ['Offene Werkstatt zweimal pro Woche'],
  participants: 'Jugendliche aus der Siedlung',
  team: 'offen',
  duration: '2026–2027',
  funder: 'Stiftung Stadtteil Morgen',
  budgetRange: '',
  statedGoals: ['Die Jugendlichen werden mobiler'],
  otherOffers: ['offen'],
  openQuestions: ['Wer macht die Werkstatt? – weiß der Träger'],
}
const frame = { purpose: 'beides', audience: 'Stiftung und Team', requiredFormat: 'offen', requiredFigures: ['Teilnahmen pro Halbjahr'], existingData: ['Anwesenheitsliste'] }
const draft = sseToolUse('propose_changes', {
  summary: 'Ein erstes Profil und der Messrahmen aus deiner Skizze.',
  question: 'Stimmt das so?',
  changes: [
    { op: 'update', collection: 'profile', id: 'profile', fields: profile },
    { op: 'update', collection: 'frame', id: 'frame', fields: frame },
  ],
})
const check = sseToolUse('report_quality_check', {
  results: ['2', '3', '4', '5', '6', '7', '8'].map((criterion) => ({ criterion, result: 'ok', note: 'Passt.' })),
})

type Stored = { steps: Record<string, { status: string; block: Record<string, Record<string, unknown> | unknown[]> }> }

async function seed(page: Page) {
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
}

test('paste → draft → apply → reload → check → confirm → step 1 opens with its draft', async ({ page }) => {
  const problems = await watchProblems(page)
  const answers = [draft, check, sseAnswer()]
  const requests = await fakeClaude(page, () => ({ status: 200, body: answers.shift() ?? sseAnswer(), contentType: 'text/event-stream' }))
  await seed(page)
  await page.getByRole('button', { name: /^0 Projekt,/ }).click()

  await page.locator('.start').getByRole('button', { name: 'Text einfügen' }).click()
  // The text area has focus on open (pasting is the main act).
  await expect(page.getByLabel('Text', { exact: true })).toBeFocused()
  await page.keyboard.insertText('Schraubzeit ist eine offene Fahrradwerkstatt für Jugendliche in der Weidengrund-Siedlung.')
  await page.getByLabel('Bezeichnung').fill('Projektskizze 2026')
  await page.getByLabel('Text', { exact: true }).focus()
  await page.keyboard.press('Meta+Enter')
  await expect(page.getByText('Text eingefügt: „Projektskizze 2026“', { exact: false })).toBeVisible()
  // The app line shows when the turn is stored; the request reaches the route only after the preflight.
  await expect.poll(() => requests.length).toBe(1)
  const body = requests[0].postDataJSON() as { messages: { content: { text?: string }[] }[] }
  expect(body.messages[0].content[1].text).toContain('[Quelle src1: „Projektskizze 2026“]')

  const card = page.getByRole('article', { name: 'Vorschlag' })
  await card.getByRole('button', { name: 'Alle übernehmen' }).click()
  const block = page.getByRole('region', { name: 'Baustein' })
  await expect(block.getByRole('button', { name: /^Team/ })).toContainText('offen')
  // Saved at once: a reload right away keeps the source and the profile (lessons-learned, step 9).
  await page.waitForTimeout(100)
  await page.reload()
  await page.getByRole('button', { name: /^0 Projekt,/ }).click()
  await expect(block.getByRole('textbox', { name: 'Name des Projekts' })).toHaveValue(profile.name)
  await expect(block.getByLabel('Bezeichnung der Quelle')).toHaveValue('Projektskizze 2026')

  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  await gate.getByRole('button', { name: 'Prüfen und bestätigen' }).click()
  const next = gate.getByRole('button', { name: 'Weiter zu Schritt 1' })
  await expect(next).toBeFocused()
  await expect(gate.getByText('Schritt 0 bestätigt. Der erste Entwurf für Schritt 1 ist fertig.')).toBeVisible()
  expect(requests).toHaveLength(3)
  const opening = requests[2].postDataJSON() as { messages: { content: { text?: string }[] }[] }
  expect(opening.messages[0].content[0].text).toContain('[Quellen aus Schritt 0, voller Text]')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(page.getByText('Schritt 0 bestätigt', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Worum geht es?' })).toHaveAttribute('aria-expanded', 'true')

  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps[0].status).toBe('confirmed')
  expect((stored.steps[0].block.profile as Record<string, unknown>).team).toBe('offen')
  expect(problems).toEqual([])
})
