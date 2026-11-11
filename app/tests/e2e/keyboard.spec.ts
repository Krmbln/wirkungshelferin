import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { readStored, replayClaude, startProject, watchProblems, writeStored } from './helpers'

// Keyboard only (design §10, step 24): from the sidebar into step 1, a glossary term's tooltip (Enter),
// one change of the recorded opening card applied, then the rest with "Alle übernehmen".
// The gate's keyboard path (Zum Feld → Why → check → confirm) is in check.spec.ts.

/** Name of the focused element (aria-label, else its <label>, else its text). */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    if (el === document.body) return '(body)'
    const label = (el as HTMLTextAreaElement).labels?.[0]?.textContent
    return (el.getAttribute('aria-label') ?? label ?? el.textContent ?? '').trim()
  })

/** Presses `key` until the focused element's name matches, at most `max` times. */
async function pressUntil(page: Page, key: string, name: RegExp, max = 40) {
  for (let i = 0; i < max; i++) {
    if (name.test(await focused(page))) return
    await page.keyboard.press(key)
  }
  throw new Error(`${key} never reached ${name}; last: ${await focused(page)}`)
}

type Stored = { steps: Record<string, { block: { targetGroups: { name: string }[] } }> }

test('keyboard only: step 1 → term tooltip → apply one change → Alle übernehmen', async ({ page }) => {
  const problems = await watchProblems(page)
  await replayClaude(page, ['step1-opening'])
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
  await page.getByRole('heading', { level: 1, name: 'Übersicht' }).waitFor()

  await pressUntil(page, 'Tab', /^1 Gruppen,/)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Zielgruppen/)

  // A glossary term in the intro: Enter opens its bubble, which is really on top (step 10 lesson).
  await pressUntil(page, 'Tab', /^Fokusgruppe$/)
  await expect(page.getByRole('tooltip').filter({ visible: true })).toHaveCount(0)
  await page.keyboard.press('Enter')
  const bubble = page.getByRole('tooltip').filter({ visible: true })
  await expect(bubble).toHaveCount(1)
  const box = (await bubble.boundingBox())!
  const onTop = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[role="tooltip"]')),
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(onTop).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip').filter({ visible: true })).toHaveCount(0)

  // On to the message box, send with Enter.
  await pressUntil(page, 'Tab', /^Deine Nachricht$/)
  await page.keyboard.type('Hallo, wir fangen an.')
  await page.keyboard.press('Enter')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Deine Nachricht' })).toBeFocused()

  // Back into the card: apply one new target group with Enter.
  const group = 'Stammgäste der Werkstatt (12–17 Jahre)'
  await pressUntil(page, 'Shift+Tab', new RegExp(`^Übernehmen: Neu – Zielgruppe „${group.replace(/[()]/g, '\\$&')}“$`))
  await page.keyboard.press('Enter')
  const block = page.getByRole('region', { name: 'Baustein' })
  await expect(block.getByRole('textbox', { name: 'Name der Zielgruppe' })).toHaveValue(group)
  // Design §6.2 proposal card: focus moves to the row's "Rückgängig", inside the card.
  const inCard = () => page.evaluate(() => Boolean(document.activeElement?.closest('.pcard')))
  expect(await focused(page)).toMatch(/^Rückgängig/)
  expect(await inCard()).toBe(true)

  await pressUntil(page, 'Tab', /^Alle übernehmen$/)
  await page.keyboard.press('Enter')
  await expect(card.getByText('übernommen', { exact: true })).toHaveCount(8)
  // … and after "Alle übernehmen" to the first row's "Rückgängig".
  expect(await focused(page)).toMatch(/^Rückgängig/)
  expect(await inCard()).toBe(true)
  await expect
    .poll(async () => ((await readStored(page, 'project')) as Stored).steps[1].block.targetGroups.map((g) => g.name))
    .toContain(group)
  expect(problems).toEqual([])
})
