import { expect, test } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

// Step 3 by hand in real Chrome against the build (implementation plan step 17): a goal linked to
// a step 2 cause with the picker, a "trifft nicht zu" mark, a reload soon after, and the plan's
// own test: delete the cause in step 2 → the goal shows "Verweis fehlt".

type Item = { id: string; groupId?: string; level?: number; text?: string; causeIds?: string[]; timeFrame?: string; why?: string }
type Stored = { steps: Record<string, { block: Record<string, Item[]> }> }

test('fill step 3 by hand; it survives a reload; deleting the linked cause shows "Verweis fehlt"', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)
  const panel = page.getByRole('region', { name: 'Baustein' })

  // Step 1: one focus group. Step 2: two causes.
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await panel.getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
  await page.keyboard.type('Jugendliche 12–17')
  await page.keyboard.press('Enter')
  await panel.getByRole('checkbox', { name: 'Fokusgruppe' }).first().check()
  await page.getByRole('button', { name: /^2 Problem,/ }).click()
  for (const text of ['Viele haben kein eigenes Rad.', 'Kaum jemand zeigt ihnen Handwerk.']) {
    await panel.getByRole('button', { name: 'Ursache hinzufügen: Jugendliche 12–17' }).click()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }

  // Step 3: a Stufe 5 goal linked to the first cause, with a time frame; Stufe 6 does not apply.
  await page.getByRole('button', { name: /^3 Ziele,/ }).click()
  await panel.getByRole('button', { name: 'Ziel hinzufügen: Stufe 5 · Jugendliche 12–17' }).click()
  await page.keyboard.type('Die Jugendlichen reparieren ihr Rad selbst.')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'Ursache wählen: Ziel „Die Jugendlichen reparieren ihr Rad selbst.“' }).click()
  await expect(panel.getByRole('checkbox', { name: 'Viele haben kein eigenes Rad.' })).toBeFocused()
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await panel.getByRole('textbox', { name: 'Zeitrahmen: Ziel „Die Jugendlichen reparieren ihr Rad selbst.“' }).fill('bis Ende 2027')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'Stufe 6 trifft für „Jugendliche 12–17“ nicht zu' }).click()
  await page.keyboard.type('Die Lebenslage ändert die Werkstatt allein nicht.')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  await page.reload()

  await page.getByRole('button', { name: /^3 Ziele,/ }).click()
  await expect(panel.locator('[data-item-id="go1"] .bgoal__causes .refchip')).toHaveText(['Viele haben kein eigenes Rad.'])
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps['3'].block.goals).toMatchObject([{ id: 'go1', groupId: 'tg1', level: 5, causeIds: ['ca1'], timeFrame: 'bis Ende 2027' }])
  expect(stored.steps['3'].block.levelNotApplicable).toMatchObject([{ groupId: 'tg1', level: 6, why: 'Die Lebenslage ändert die Werkstatt allein nicht.' }])

  // The plan's test: delete the cause in step 2 → the goal shows "Verweis fehlt".
  await page.getByRole('button', { name: /^2 Problem,/ }).click()
  await panel.getByRole('button', { name: 'Ursache „Viele haben kein eigenes Rad.“ entfernen' }).click()
  await page.getByRole('button', { name: /^3 Ziele,/ }).click()
  await expect(panel.locator('[data-item-id="go1"] .refchip--missing')).toHaveText('Verweis fehlt')
  expect(problems).toEqual([])
})
