import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseAnswer, sseToolUse } from '../fakeClaude'
import { madeUpPdf } from '../madeUpPdf'
import { fakeClaude, readStored, startProject, watchProblems, writeStored } from './helpers'

// Step 15 in real Chrome against the build (CSP on): a made-up PDF through the real file
// input → reading with one continuation → the text as a PDF source → the profile draft card.

const draft = sseToolUse('propose_changes', {
  summary: 'Ein erstes Profil aus deinem Bericht.',
  changes: [{ op: 'update', collection: 'profile', id: 'profile', fields: { name: 'Schraubzeit', organisation: 'Nachbarschaftshaus Am Weidengrund e. V.', projectBoundary: 'offen', location: 'offen', activities: ['offen'], participants: 'offen', team: 'offen', duration: 'offen', funder: 'offen', budgetRange: '', statedGoals: ['offen'], otherOffers: ['offen'], openQuestions: [] } }],
})

type Body = { messages: { role: string; content: string | { type: string; text?: string; source?: { data: string } }[] }[] }
type Stored = { steps: Record<string, { block: { sources: { origin: string; label: string; text: string }[] } }> }

async function seed(page: Page) {
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
  await page.getByRole('button', { name: /^0 Projekt,/ }).click()
}

test('PDF → reading with a continuation → PDF source → draft card → reload', async ({ page }) => {
  const problems = await watchProblems(page)
  const answers = [sseAnswer('max_tokens', 'Sachbericht Schraubzeit, Teil eins. '), sseAnswer('end_turn', 'Teil zwei. ENDE'), draft]
  const requests = await fakeClaude(page, () => ({ status: 200, body: answers.shift() ?? sseAnswer(), contentType: 'text/event-stream' }))
  await seed(page)

  const pdf = Buffer.from(madeUpPdf())
  await page.locator('.start [data-pdf-input]').setInputFiles({ name: 'Schraubzeit-Bericht.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(page.getByText('PDF gelesen: „Schraubzeit-Bericht“ · 51 Zeichen')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Vorschlag' })).toBeVisible()
  expect(requests).toHaveLength(3)

  const [reading, continued, turn] = requests.map((r) => r.postDataJSON() as Body)
  const doc = (reading.messages[0].content as { type: string; source?: { data: string } }[])[0]
  expect(doc.type).toBe('document')
  expect(doc.source!.data).toBe(pdf.toString('base64'))
  expect(continued.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  const sent = (turn.messages.at(-1)!.content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('\n')
  expect(sent).toContain('[Quelle src1: „Schraubzeit-Bericht“]')
  expect(sent).toContain('Sachbericht Schraubzeit, Teil eins. Teil zwei. ENDE')

  const block = page.getByRole('region', { name: 'Baustein' })
  await expect(block.getByText(/^aus PDF am /)).toBeVisible()
  await page.waitForTimeout(100)
  await page.reload()
  await page.getByRole('button', { name: /^0 Projekt,/ }).click()
  await expect(page.getByText('PDF gelesen: „Schraubzeit-Bericht“ · 51 Zeichen')).toBeVisible()
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps[0].block.sources).toEqual([expect.objectContaining({ origin: 'pdf', label: 'Schraubzeit-Bericht' })])
  expect(problems).toEqual([])
})

test('a file that is not a PDF is refused in the browser; nothing goes to Claude', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await fakeClaude(page, () => ({ status: 200, body: sseAnswer(), contentType: 'text/event-stream' }))
  await seed(page)
  await page.locator('.start [data-pdf-input]').setInputFiles({ name: 'antrag.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Nur Text, kein PDF.') })
  await expect(page.getByRole('alert')).toContainText('„antrag.pdf“ ist keine echte PDF-Datei')
  await page.getByRole('alert').getByRole('button', { name: 'Text einfügen' }).click()
  await expect(page.getByRole('form', { name: 'Text einfügen' })).toBeVisible()
  expect(requests).toHaveLength(0)
  expect(problems).toEqual([])
})
