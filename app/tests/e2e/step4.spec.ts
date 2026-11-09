import { expect, test, type Page } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

// Step 4 by hand in real Chrome against the build (implementation plan step 18, the plan's own
// test): build a chain for one focus group with the link picker; a third critical assumption
// gives a warning; it all survives a reload.

type Item = { id: string; groupId?: string; fromId?: string; toId?: string; critical?: boolean; because?: string }
type Stored = { steps: Record<string, { block: Record<string, Item[]> }> }

async function type(page: Page, text: string) {
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('build a chain by hand; a third critical assumption warns; it survives a reload', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)
  const panel = page.getByRole('region', { name: 'Baustein' })

  // Step 1: one focus group. Step 3: a Stufe 4 goal.
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await panel.getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
  await type(page, 'Jugendliche 12–17')
  await panel.getByRole('checkbox', { name: 'Fokusgruppe' }).first().check()
  await page.getByRole('button', { name: /^3 Ziele,/ }).click()
  await panel.getByRole('button', { name: 'Ziel hinzufügen: Stufe 4 · Jugendliche 12–17' }).click()
  await type(page, 'Sie können einen Platten flicken.')

  // Step 4: one activity, outputs at Stufe 1 and 2.
  await page.getByRole('button', { name: /^4 Logik,/ }).click()
  await panel.getByRole('button', { name: 'Aktivität hinzufügen' }).click()
  await type(page, 'Offene Werkstatt')
  await panel.getByRole('button', { name: 'Leistung hinzufügen: Stufe 1 · Jugendliche 12–17' }).click()
  await type(page, 'Zweimal pro Woche offen')
  await panel.getByRole('button', { name: 'Leistung hinzufügen: Stufe 2 · Jugendliche 12–17' }).click()
  await type(page, 'Zwölf kommen regelmäßig')

  // Three links with the picker: the keyboard moves through the draft, Fertig saves.
  const chain: [string, string][] = [
    ['Offene Werkstatt', 'Zweimal pro Woche offen'],
    ['Zweimal pro Woche offen', 'Zwölf kommen regelmäßig'],
    ['Zwölf kommen regelmäßig', 'Sie können einen Platten flicken.'],
  ]
  for (const [n, [from, to]] of chain.entries()) {
    await panel.getByRole('button', { name: 'Verbindung hinzufügen: Jugendliche 12–17' }).click()
    const picker = panel.locator(`[data-item-id="li${n + 1}"] [data-picker]`)
    await expect(picker.getByRole('radio').first()).toBeFocused()
    await picker.getByRole('group', { name: 'Von' }).getByRole('radio', { name: from, exact: true }).check()
    await picker.getByRole('group', { name: 'Nach' }).getByRole('radio', { name: to, exact: true }).check()
    await picker.getByRole('button', { name: 'Fertig' }).click()
    await expect(panel.locator(`[data-picker-toggle="li${n + 1}"]`)).toBeFocused()
    await panel.locator(`[data-item-id="li${n + 1}"] [data-field="because"] textarea`).fill(`weil Schritt ${n + 1}`)
    await page.keyboard.press('Enter')
  }
  // Arrow keys in the picker change only the draft.
  await panel.locator('[data-picker-toggle="li1"]').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')

  // The plan's test: a third critical assumption gives a warning.
  const warning = panel.locator('.bcritical')
  for (const id of ['li1', 'li2']) await panel.locator(`[data-item-id="${id}"] [data-field="critical"] input`).check()
  await expect(warning).toHaveText('')
  await panel.locator('[data-item-id="li3"] [data-field="critical"] input').check()
  await expect(warning).toHaveText('3 Annahmen sind als kritisch markiert – höchstens 2 je Gruppe. Behalte die, an denen es am ehesten hakt.')
  await expect(panel.locator('[data-item-id="li3"]').getByText('3 von höchstens 2 kritisch')).toBeVisible()
  await page.waitForTimeout(100)
  await page.reload()

  await page.getByRole('button', { name: /^4 Logik,/ }).click()
  await expect(panel.locator('.bcritical')).toContainText('3 Annahmen sind als kritisch markiert')
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps['4'].block.links.map((l) => [l.fromId, l.toId, l.critical, l.because])).toEqual([
    ['ac1', 'ou1', true, 'weil Schritt 1'],
    ['ou1', 'ou2', true, 'weil Schritt 2'],
    ['ou2', 'go1', true, 'weil Schritt 3'],
  ])
  expect(problems).toEqual([])
})
