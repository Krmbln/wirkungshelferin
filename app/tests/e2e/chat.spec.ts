import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseAnswer } from '../fakeClaude'
import { fakeClaude, readStored, replayClaude, startProject, watchProblems, writeStored } from './helpers'

// Step 9 in real Chrome against the build (CSP on): the recorded streams from `npm run contract`
// replayed through the app's real SDK client.

async function openStep1(page: Page) {
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Zielgruppen/)
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Deine Nachricht' })
const log = (page: Page) => page.locator('.chat__log')

type Segment = { messages: { role: string; aborted?: true }[] }
const storedRoles = async (page: Page) => {
  const project = (await readStored(page, 'project')) as { steps: Record<string, { segments: Segment[] }> }
  return project.steps[1].segments.flatMap((s) => s.messages.map((m) => (m.aborted ? `${m.role} (abgebrochen)` : m.role)))
}

test('a recorded answer streams in and is stored; no CSP problems', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await replayClaude(page, ['step1-opening'])
  await openStep1(page)
  await input(page).fill('Hallo, wir fangen an.')
  await input(page).press('Enter')
  await expect(log(page).getByText('Hallo, wir fangen an.')).toBeVisible()
  // The opening answer is a proposal: its card shows once the message is complete.
  await expect(log(page).getByRole('article', { name: 'Vorschlag' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Senden' })).toBeVisible()
  expect(requests).toHaveLength(1)
  const body = requests[0].postDataJSON()
  expect(body.max_tokens).toBe(16_000)
  expect(body.stream).toBe(true)
  await expect.poll(() => storedRoles(page)).toEqual(['user', 'assistant'])
  expect(problems).toEqual([])
})

test('offline: the chat says so at once, sends nothing, and "Erneut versuchen" works once back online', async ({ page, context }) => {
  const problems = await watchProblems(page)
  const requests = await replayClaude(page, ['step1-opening'])
  await openStep1(page)
  await context.setOffline(true)
  await input(page).fill('Hallo, wir fangen an.')
  await input(page).press('Enter')
  await expect(page.getByRole('alert')).toContainText('Keine Internetverbindung. Prüf dein WLAN und versuch es dann noch einmal.')
  expect(requests).toHaveLength(0)
  // The message is kept (stored before the send), so nothing has to be typed again.
  await expect(log(page).getByText('Hallo, wir fangen an.', { exact: true })).toBeVisible()
  await expect.poll(() => storedRoles(page)).toEqual(['user'])

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Erneut versuchen' }).click()
  await expect(log(page).getByRole('article', { name: 'Vorschlag' })).toBeVisible()
  expect(requests).toHaveLength(1)
  await expect.poll(() => storedRoles(page)).toEqual(['user', 'assistant'])
  expect(problems).toEqual([])
})

test('an answer with HTML entities renders under Trusted Types (no innerHTML in the Markdown renderer)', async ({ page }) => {
  const problems = await watchProblems(page)
  await fakeClaude(page, () => ({ status: 200, body: sseAnswer('end_turn', 'Werkstatt &amp; Touren, M&auml;dchen&nbsp;und Jungen. Passt das?'), contentType: 'text/event-stream' }))
  await openStep1(page)
  await input(page).fill('Hallo.')
  await input(page).press('Enter')
  await expect(log(page).getByText('Werkstatt & Touren, Mädchen\u00a0und Jungen. Passt das?', { exact: true })).toBeVisible()
  // And after a reload, from the stored message.
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(log(page).getByText('Werkstatt & Touren, Mädchen\u00a0und Jungen. Passt das?', { exact: true })).toBeVisible()
  expect(problems).toEqual([])
})

test('"Stopp" ends the answer; after a reload the chat is still there and the next message works', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await replayClaude(page, ['step1-opening', 'step1-reload'], { hold: { 0: 3_000 } })
  await openStep1(page)
  await input(page).fill('Erste Nachricht')
  await input(page).press('Enter')
  await expect(log(page).getByText('denkt nach …')).toBeVisible()
  await page.getByRole('button', { name: 'Stopp' }).click()
  await expect(log(page).getByText('abgebrochen')).toBeVisible()
  await expect.poll(() => storedRoles(page)).toEqual(['user', 'assistant (abgebrochen)'])

  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(log(page).getByText('Erste Nachricht')).toBeVisible()
  await expect(log(page).getByText('abgebrochen')).toBeVisible()

  await input(page).fill('Zweite Nachricht')
  await input(page).press('Enter')
  await expect.poll(() => storedRoles(page)).toEqual(['user', 'assistant (abgebrochen)', 'user', 'assistant'])
  // The stopped turn is not sent again: two user turns, nothing in between.
  const sent = requests.at(-1)!.postDataJSON()
  expect(sent.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'user'])
  await expect(log(page).locator('.msg--assistant').last()).not.toContainText('abgebrochen')
  expect(problems).toEqual([])
})

test('Shift+Enter makes a new line; the draft is saved while typing and survives a reload', async ({ page }) => {
  await replayClaude(page, ['step1-opening'])
  await openStep1(page)
  await input(page).pressSequentially('Zeile 1')
  await input(page).press('Shift+Enter')
  await input(page).pressSequentially('Zeile 2')
  await expect(input(page)).toHaveValue('Zeile 1\nZeile 2')
  // Stored while typing, not at unload (Chrome drops writes that start while the page unloads).
  await expect.poll(() => readStored(page, 'drafts')).toEqual({ 1: 'Zeile 1\nZeile 2' })
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(input(page)).toHaveValue('Zeile 1\nZeile 2')
})

test('a sent message survives a reload while Claude still answers (saved at once, not at unload)', async ({ page }) => {
  await replayClaude(page, ['step1-opening'], { hold: { 0: 5_000 } })
  await openStep1(page)
  await input(page).fill('Sofort neu laden')
  await input(page).press('Enter')
  await expect(log(page).getByText('Sofort neu laden')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(log(page).getByText('Sofort neu laden')).toBeVisible()
})

test('step 10: a model change in the settings starts a new segment with a summary', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await replayClaude(page, ['step1-opening', 'step1-reload', 'step1-reload'])
  await openStep1(page)
  await expect(page.getByRole('button', { name: 'Worum geht es?' })).toHaveAttribute('aria-expanded', 'true')
  await input(page).fill('Hallo, wir fangen an.')
  await input(page).press('Enter')
  await expect(page.getByRole('button', { name: 'Senden' })).toBeVisible()

  await page.getByRole('button', { name: 'Einstellungen' }).click()
  const model = page.getByRole('textbox', { name: 'Modell' })
  await model.fill('claude-sonnet-5-5')
  await model.press('Enter')
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await input(page).fill('Weiter geht’s.')
  await input(page).press('Enter')
  await expect(log(page).getByText('Neuer Gesprächsabschnitt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Senden' })).toBeVisible()

  expect(requests).toHaveLength(3)
  const summary = requests[1].postDataJSON()
  expect(summary).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 4_000, output_config: { effort: 'low' } })
  expect(summary.tools).toBeUndefined()
  expect(JSON.stringify(summary.messages)).toContain('Hallo, wir fangen an.')
  const turn = requests[2].postDataJSON()
  expect(turn.messages).toHaveLength(1)
  expect(JSON.stringify(turn.messages)).toContain('zusammengefasst]')
  expect(JSON.stringify(turn.messages)).not.toContain('tool_result')

  const project = (await readStored(page, 'project')) as { steps: Record<string, { segments: { model?: string; summaryOfPrevious?: string }[] }> }
  const segments = project.steps[1].segments
  expect(segments.map((s) => s.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
  expect(segments[1].summaryOfPrevious).toBeTruthy()
  // Survives a reload right away (saved at once, lessons-learned step 9).
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(log(page).getByText('Neuer Gesprächsabschnitt')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Worum geht es?' })).toHaveAttribute('aria-expanded', 'false')
  expect(problems).toEqual([])
})
