import { expect, test } from '@playwright/test'
import { readStored, startProject, watchProblems } from './helpers'

// Step 1 block by hand in real Chrome against the build (implementation plan step 11).
// Every edit is saved at once, so a reload soon after it keeps it (lessons-learned, steps 9, 11).

type Stored = { steps: Record<string, { status: string; block: Record<string, unknown> }> }

test('fill in the step 1 block by hand; every edit survives a reload soon after', async ({ page }) => {
  const problems = await watchProblems(page)
  await startProject(page)
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  const panel = page.getByRole('region', { name: 'Baustein' })

  await panel.getByRole('textbox', { name: 'Herausforderung' }).fill('Zu wenig Orte für Jugendliche am Nachmittag')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
  await expect(panel.getByRole('textbox', { name: 'Name der Zielgruppe' })).toBeFocused()
  await page.keyboard.type('Jugendliche 12–17')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Aus der Siedlung, viele ohne Rad')
  await page.keyboard.press('Enter')
  await panel.getByRole('checkbox', { name: 'Fokusgruppe' }).check()
  await panel.getByLabel('Warum?').nth(1).fill('Hier will das Projekt seine Hauptwirkung erzielen.')
  await page.keyboard.press('Escape')
  // Reload well inside the 500 ms autosave pause: only a save that starts at once survives.
  // (A reload in the same millisecond beats any IndexedDB commit; no person is that fast.)
  await page.waitForTimeout(100)
  await page.reload()

  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(panel.getByRole('textbox', { name: 'Herausforderung' })).toHaveValue('Zu wenig Orte für Jugendliche am Nachmittag')
  await expect(panel.getByRole('textbox', { name: 'Name der Zielgruppe' })).toHaveValue('Jugendliche 12–17')
  await expect(panel.getByRole('textbox', { name: 'Beschreibung der Zielgruppe' })).toHaveValue('Aus der Siedlung, viele ohne Rad')
  await expect(panel.getByRole('checkbox', { name: 'Fokusgruppe' })).toBeChecked()
  await expect(panel.getByLabel('Warum?').nth(1)).toHaveValue('Hier will das Projekt seine Hauptwirkung erzielen.')
  await expect(panel.getByText('von dir geändert')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^1 Gruppen, in Arbeit/ })).toBeVisible()

  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps[1].block.targetGroups).toEqual([
    expect.objectContaining({ id: 'tg1', name: 'Jugendliche 12–17', isFocus: true, editedByUser: true }),
  ])

  // Removal + undo, then a removal that stays through a reload.
  await panel.getByRole('button', { name: 'Zielgruppe „Jugendliche 12–17“ entfernen' }).click()
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(panel.getByRole('textbox', { name: 'Name der Zielgruppe' })).toHaveValue('Jugendliche 12–17')
  await panel.getByRole('button', { name: 'Zielgruppe „Jugendliche 12–17“ entfernen' }).click()
  await page.waitForTimeout(100)
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  await expect(panel.getByText('Noch leer – erzähl der Wirkungshelferin, für wen euer Angebot da ist.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0)

  expect(problems).toEqual([])
})
