import { readFileSync } from 'node:fs'
import { expect, test, type Request } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { sseAnswer, sseToolUse } from '../fakeClaude'
import { outdatedProject } from '../outdated'
import { fakeClaude, readStored, startProject, watchProblems, writeStored } from './helpers'

// Change handling in real Chrome against the build (implementation plan step 21, the plan's own
// test): re-confirm step 2 after a change → steps 3, 4 and 6 show ⚠ (5 stays "in Arbeit") →
// "Änderung prüfen lassen" in step 4 sends both versions and the banner turns to "geprüft" →
// confirming step 4 again clears it, and it all survives a reload.

/** A complete check answer: every rubric criterion of the step "ok" (the guide's rubric table). */
function check(step: number): string {
  const file = { 2: 'step-2-problem.md', 4: 'step-4-impact-logic.md' }[step]!
  const text = readFileSync(new URL(`../../../method-guide/${file}`, import.meta.url), 'utf8')
  const section = text.split(/^## \d+\. Rubrik\s*$/m)[1].split(/^## /m)[0]
  const criteria = [...section.matchAll(/^\| *(\d+[a-z]?) *\|/gm)].map((m) => m[1])
  return sseToolUse('report_quality_check', { results: criteria.map((criterion) => ({ criterion, result: 'ok', note: 'Passt.' })) })
}

const ANSWER = 'In Schritt 2 steht jetzt: kein Werkzeug und kein Raum. Deine Wirkungslogik hängt daran nicht – sie passt noch. Bestätigst du Schritt 4 erneut?'

type Stored = { steps: Record<string, { status: string; outdatedBy?: Record<string, unknown> }> }

test('re-confirm step 2 → 3, 4, 6 vielleicht veraltet → Änderung prüfen lassen → confirm step 4 again', async ({ page }) => {
  const problems = await watchProblems(page)
  const answers = [check(2), sseAnswer('end_turn', ANSWER), check(4)]
  const requests: Request[] = await fakeClaude(page, () => ({ status: 200, body: answers.shift()!, contentType: 'text/event-stream' }))
  await startProject(page)
  await writeStored(page, 'project', outdatedProject({ 5: 'in_progress' }))
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const panel = page.getByRole('region', { name: 'Baustein' })
  const row = (step: number, status: string) => page.getByRole('button', { name: new RegExp(`^${step} .*, ${status}$`) })

  // Step 2: change a cause, check and confirm again.
  await row(2, 'bestätigt').click()
  await panel.getByRole('textbox', { name: 'Ursache', exact: true }).fill('Kein Werkzeug und kein Raum')
  await page.keyboard.press('Enter')
  // Editing alone marks nothing.
  await expect(row(2, 'in Arbeit')).toBeVisible()
  await expect(row(3, 'bestätigt')).toBeVisible()
  await gate.getByRole('button', { name: 'Prüfen und bestätigen' }).click()
  await expect(gate.getByText('Darauf bauen Schritt 3, 4 und 6 auf – sie sind jetzt als „vielleicht veraltet“ markiert.')).toBeVisible()
  for (const s of [3, 4, 6]) await expect(row(s, 'vielleicht veraltet')).toBeVisible()
  await expect(row(5, 'in Arbeit')).toBeVisible()

  // Step 4: the banner, the review turn with both versions, the checked banner.
  await row(4, 'vielleicht veraltet').click()
  const banner = page.locator('.outdated')
  await expect(banner).toContainText('Schritt 2 hat sich geändert, seit du diesen Schritt bestätigt hast.')
  const review = banner.getByRole('button', { name: 'Änderung prüfen lassen' })
  await review.click()
  await expect(page.getByText(ANSWER, { exact: true })).toBeVisible()
  await expect(page.locator('.chat__act').getByText('Änderung prüfen lassen: Schritt 2')).toBeVisible()
  await expect(banner).toContainText('Die Antwort der Wirkungshelferin steht im Chat. Passt alles, bestätige unten erneut.')
  await expect(banner.getByRole('button', { name: 'Nochmal prüfen lassen' })).toBeFocused()
  const sent = requests[1].postData()!
  expect(sent).toContain('[Schritt 2, wie bestätigt am 2026-11-03 – darauf baut dieser Schritt auf]')
  expect(sent).toContain('Kein Werkzeug und kein Raum')

  // Confirm step 4 again: banner gone, step 4 confirmed, 3 and 6 still outdated.
  await gate.getByRole('button', { name: 'Prüfen und bestätigen' }).click()
  await expect(row(4, 'bestätigt')).toBeVisible()
  await expect(banner).toHaveCount(0)
  await page.waitForTimeout(100)
  await page.reload()
  await expect(row(4, 'bestätigt')).toBeVisible()
  for (const s of [3, 6]) await expect(row(s, 'vielleicht veraltet')).toBeVisible()
  const stored = (await readStored(page, 'project')) as Stored
  expect(stored.steps['4'].outdatedBy).toBeUndefined()
  expect(Object.keys(stored.steps['6'].outdatedBy ?? {})).toEqual(['2'])
  expect(requests).toHaveLength(3)
  expect(problems).toEqual([])
})
