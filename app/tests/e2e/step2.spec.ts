import { expect, test } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

// Step 2 by hand in real Chrome against the build (implementation plan step 16): groups from
// step 1, a core problem, causes on two levels, evidence, a removal with its children moving
// up and back, the collapsed group, and a reload soon after.

type Item = { id: string; groupId?: string; parentId?: string; text?: string; coreProblem?: string; evidence?: string; why?: string }
type Stored = { steps: Record<string, { block: Record<string, Item[]> }> }

test('fill the step 2 problem tree by hand; it survives a reload; removing a cause moves its child up and back', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)

  // Step 1: one focus group, one other group.
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  const panel = page.getByRole('region', { name: 'Baustein' })
  for (const [name, focus] of [
    ['Jugendliche 12–17', true],
    ['Eltern', false],
  ] as const) {
    await panel.getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
    await page.keyboard.type(name)
    await page.keyboard.press('Enter')
    if (focus) await panel.getByRole('checkbox', { name: 'Fokusgruppe' }).first().check()
  }

  await page.getByRole('button', { name: /^2 Problem,/ }).click()
  await expect(panel.getByText('Schritt 1 ist noch nicht bestätigt – die Gruppen können sich noch ändern.')).toBeVisible()
  await expect(page.locator('[data-group-toggle="tg1"]')).toContainText('Fokusgruppe')
  await expect(page.locator('[data-group="other"]').getByRole('heading', { name: 'Eltern' })).toBeVisible()

  await panel.getByRole('textbox', { name: 'Kernproblem: Jugendliche 12–17' }).fill('Sie schaffen nachmittags selten etwas selbst.')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'Ursache hinzufügen: Jugendliche 12–17' }).click()
  await page.keyboard.type('Viele haben kein eigenes Rad.')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: /^Ursache dafür hinzufügen: unter „Viele haben kein eigenes Rad.“/ }).click()
  await page.keyboard.type('Reparaturen sind zu teuer.')
  await page.keyboard.press('Enter')
  await panel.locator('[data-item-id="ca1"]').getByRole('combobox', { name: 'Evidenzbasis' }).selectOption('eigene_erfahrung')
  await page.waitForTimeout(100)
  await page.reload()

  await page.getByRole('button', { name: /^2 Problem,/ }).click()
  await expect(panel.getByRole('textbox', { name: 'Kernproblem: Jugendliche 12–17' })).toHaveValue('Sie schaffen nachmittags selten etwas selbst.')
  await expect(panel.locator('[data-item-id="ca2"] textarea').first()).toHaveValue('Reparaturen sind zu teuer.')
  await expect(panel.locator('[data-item-id="ca1"]').getByRole('combobox', { name: 'Evidenzbasis' })).toHaveValue('eigene_erfahrung')
  let stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps['2'].block.causes.map((c) => [c.id, c.groupId, c.parentId])).toEqual([
    ['ca1', 'tg1', ''],
    ['ca2', 'tg1', 'ca1'],
  ])

  // Remove the parent: the child moves up, the line says so; Rückgängig puts it back.
  await panel.getByRole('button', { name: 'Ursache „Viele haben kein eigenes Rad.“ entfernen' }).click()
  await expect(panel.getByText('„Viele haben kein eigenes Rad.“ entfernt. 1 Ursache darunter rückt eine Ebene hoch.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Rückgängig' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps['2'].block.causes.map((c) => [c.id, c.parentId])).toEqual([
    ['ca1', ''],
    ['ca2', 'ca1'],
  ])

  // Collapse by keyboard: the summary line; open again.
  await page.locator('[data-group-toggle="tg1"]').focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByText('Kernproblem · 2 Ursachen · 0 Folgen')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(panel.locator('[data-item-id="ca1"]')).toBeVisible()
  expect(problems).toEqual([])
})
