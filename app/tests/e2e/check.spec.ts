import { expect, test, type Locator, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseToolUse } from '../fakeClaude'
import { fakeClaude, readStored, startProject, watchProblems, writeStored } from './helpers'

// Step 13 in real Chrome against the build (CSP on): the quality gate with the keyboard only,
// from an empty Why (blocked) to the confirmed step and the backup prompt.

const criteria = ['1', '2', '3', '4', '5', '6', '7', '8']
const check = sseToolUse('report_quality_check', {
  results: criteria.map((criterion) => ({ criterion, result: criterion === '4' ? 'warn' : 'ok', note: criterion === '4' ? 'Nur Defizite genannt.' : 'Passt.' })),
})

type Stored = { steps: Record<string, { status: string; block: Record<string, unknown>; confirmedWarnings: string[] }>; idCounters: Record<string, number> }

/** A step 1 block that is complete except for the target group's Why. */
async function seedStep1(page: Page) {
  await startProject(page)
  const project = (await readStored(page, 'project')) as Stored
  project.steps[1].status = 'in_progress'
  project.steps[1].block = {
    challenge: { id: 'challenge', rev: 2, editedByUser: true, text: 'Jugendliche haben nachmittags kaum Orte zum Schrauben.', why: 'Daran hängt alles Weitere.' },
    targetGroups: [{ id: 'tg1', rev: 1, editedByUser: true, name: 'Jugendliche 12–17', description: 'Kommen nach der Schule.', reach: 'direct', isFocus: true, why: '' }],
    stakeholders: [],
  }
  project.idCounters.tg = 1
  await writeStored(page, 'project', project)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
}

/** Presses Tab until `target` has focus (the keyboard path, no clicks). */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('target never got focus')
}

test('keyboard only: blocked → Zum Feld → Why → check → confirm anyway → backup', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await fakeClaude(page, () => ({ status: 200, body: check, contentType: 'text/event-stream' }))
  await seedStep1(page)
  const row = page.getByRole('button', { name: /^1 Gruppen,/ })
  await tabTo(page, row)
  await page.keyboard.press('Enter')

  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  await tabTo(page, gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
  await page.keyboard.press('Enter')
  const toField = gate.getByRole('button', { name: 'Zum Feld: Warum fehlt: Zielgruppe „Jugendliche 12–17“' })
  await expect(toField).toBeFocused()
  await expect(gate.getByRole('button', { name: 'Bestätigen', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await expect(gate.getByText('Noch 1 Punkt blockiert das Bestätigen', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)

  await page.keyboard.press('Enter')
  const why = page.locator('[data-item-id="tg1"] [data-field="why"] textarea')
  await expect(why).toBeFocused()
  await expect(why).toBeInViewport()
  await page.keyboard.type('Bei ihnen will die Werkstatt etwas verändern.')
  await page.keyboard.press('Enter')
  await expect(gate.getByText('Geändert seit der Prüfung – erneut prüfen')).toBeVisible()

  await tabTo(page, gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
  await page.keyboard.press('Enter')
  const yes = gate.getByRole('group', { name: 'Trotzdem bestätigen?' }).getByRole('button', { name: 'Bestätigen' })
  await expect(yes).toBeFocused()
  await expect(gate.getByText('1 offener Punkt wird mit gespeichert. Trotzdem bestätigen?')).toBeVisible()
  await page.keyboard.press('Enter')

  const save = gate.getByRole('button', { name: 'Backup speichern' })
  await expect(save).toBeFocused()
  await expect(page.getByRole('button', { name: '1 Gruppen, bestätigt' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  await download
  await expect(gate.getByText('Backup ist in deinen Downloads.')).toBeFocused()

  // Saved at once (lessons-learned steps 9, 11): a reload soon after keeps the confirm.
  await page.waitForTimeout(100)
  await page.reload()
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps[1].status).toBe('confirmed')
  expect(stored.steps[1].confirmedWarnings).toEqual(['4'])
  expect(requests).toHaveLength(2)
  expect(problems).toEqual([])
})
