import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseAnswer } from '../fakeClaude'
import { fakeClaude, startProject, watchProblems, writeStored } from './helpers'

// Step 25a-1 in real Chrome (API faked): the dry run found that a chat kept showing Claude the
// other steps as they were when it started. Now a turn after a change elsewhere carries
// "[Projektstand aktualisiert]"; a turn after no change doesn't.

const input = (page: Page) => page.getByRole('textbox', { name: 'Deine Nachricht' })

async function send(page: Page, text: string) {
  await input(page).fill(text)
  await input(page).press('Enter')
  await expect(page.locator('.chat__log').getByText(text, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Senden' })).toBeVisible()
}

/** The text blocks of the request's newest user message. */
function lastUserTexts(body: { messages: { role: string; content: { type: string; text?: string }[] }[] }): string[] {
  const last = body.messages.findLast((m) => m.role === 'user')!
  return last.content.flatMap((b) => (b.type === 'text' ? [b.text!] : []))
}

test('a group added in step 1 while the step 2 chat runs reaches Claude with the next step 2 turn', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await fakeClaude(page, () => ({ status: 200, body: sseAnswer('end_turn', 'Gut, erzähl weiter.'), contentType: 'text/event-stream' }))
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()

  await page.getByRole('button', { name: /^2 Problem,/ }).click()
  await send(page, 'Wo fangen wir an?')
  await expect.poll(() => requests.length).toBe(1)
  expect(lastUserTexts(requests[0].postDataJSON())[0]).toMatch(/^\[Projektstand\]\n/)

  // Meanwhile, step 1 changes by hand.
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await page.getByRole('region', { name: 'Baustein' }).getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
  await page.keyboard.type('Stammgäste des Sprachcafés')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)

  await page.getByRole('button', { name: /^2 Problem,/ }).click()
  await send(page, 'Ich habe die Zielgruppe ergänzt.')
  await expect.poll(() => requests.length).toBe(2)
  const second = lastUserTexts(requests[1].postDataJSON())
  const update = second.find((t) => t.startsWith('[Projektstand aktualisiert]'))
  expect(update).toContain('Stammgäste des Sprachcafés')
  expect(second.slice(-2)[0]).toBe('Ich habe die Zielgruppe ergänzt.')

  // Nothing changed since: no update.
  await send(page, 'Und weiter?')
  await expect.poll(() => requests.length).toBe(3)
  expect(lastUserTexts(requests[2].postDataJSON()).some((t) => t.startsWith('[Projektstand'))).toBe(false)
  expect(problems).toEqual([])
})
