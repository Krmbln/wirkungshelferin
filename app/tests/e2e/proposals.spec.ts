import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { readStored, replayClaude, startProject, watchProblems, writeStored } from './helpers'

// Step 12 in real Chrome against the build (CSP on): the recorded opening answer from
// `npm run contract` (a challenge update, two target groups, four stakeholders) through the card.

async function openStep1(page: Page) {
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
}

type Stored = { steps: Record<string, { block: { targetGroups: { name: string; editedByUser: boolean }[]; stakeholders: unknown[] } }> }

test('from proposal to item in the block; after a reload the next request answers the proposal', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await replayClaude(page, ['step1-opening', 'step1-reload'])
  await openStep1(page)
  const input = page.getByRole('textbox', { name: 'Deine Nachricht' })
  await input.fill('Hallo, wir fangen an.')
  await input.press('Enter')

  const card = page.getByRole('article', { name: 'Vorschlag' })
  const block = page.getByRole('region', { name: 'Baustein' })
  await expect(card).toBeVisible()
  await expect(block.getByRole('button', { name: '7 offene Änderungen im Chat' })).toBeVisible()

  // Hover outlines nothing for a NEU row (no item yet), the challenge row outlines the challenge.
  await card.getByRole('button', { name: /^Übernehmen: Ändern – Herausforderung/ }).hover()
  await expect(block.locator('[data-item-id="challenge"]')).toHaveAttribute('data-outlined', '')

  await card.getByRole('button', { name: 'Übernehmen: Neu – Zielgruppe „Stammgäste der offenen Werkstatt“' }).click()
  await expect(block.getByRole('textbox', { name: 'Name der Zielgruppe' })).toHaveValue('Stammgäste der offenen Werkstatt')
  await expect(block.locator('[data-item-id="tg1"]')).toBeInViewport()
  await card.getByRole('button', { name: 'Ablehnen: Neu – Zielgruppe „Gelegenheitsbesucher der offenen Werkstatt“' }).click()
  await expect(card.getByText('abgelehnt', { exact: true })).toBeVisible()
  await expect(block.getByRole('button', { name: '5 offene Änderungen im Chat' })).toBeVisible()

  // Saved at once: a reload soon after keeps both decisions (lessons-learned steps 9, 11).
  await page.waitForTimeout(100)
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(card.getByText('übernommen', { exact: true })).toBeVisible()
  await expect(card.getByText('abgelehnt', { exact: true })).toBeVisible()
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps[1].block.targetGroups).toEqual([expect.objectContaining({ name: 'Stammgäste der offenen Werkstatt', editedByUser: false })])

  await input.fill('Weiter.')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Senden' })).toBeVisible()
  const turn = requests[1].postDataJSON()
  const results = turn.messages.at(-1).content.filter((b: { type: string }) => b.type === 'tool_result')
  expect(results).toHaveLength(1)
  expect(results[0].content).toContain('übernommen, neue ID tg1')
  expect(results[0].content).toContain('abgelehnt')
  expect(results[0].content).toContain('offen')
  expect(problems).toEqual([])
})

test('"offene Änderungen" jumps to the card; "Alle übernehmen" fills the block', async ({ page }) => {
  await replayClaude(page, ['step1-opening'])
  await openStep1(page)
  const input = page.getByRole('textbox', { name: 'Deine Nachricht' })
  await input.fill('Hallo.')
  await input.press('Enter')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  const block = page.getByRole('region', { name: 'Baustein' })
  await expect(card).toBeVisible()
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await block.getByRole('button', { name: /offene Änderungen im Chat/ }).click()
  await expect(card).toBeFocused()
  await expect(card).toBeInViewport()

  await card.getByRole('button', { name: 'Alle übernehmen' }).click()
  await expect(card.getByText('übernommen', { exact: true })).toHaveCount(7)
  await expect(block.getByRole('button', { name: /im Chat$/ })).toHaveCount(0)
  await expect(block.getByRole('textbox', { name: 'Name der Zielgruppe' })).toHaveCount(2)
  await expect(block.getByRole('textbox', { name: 'Rolle' })).toHaveCount(4)
})
