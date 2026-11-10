import { expect, test, type Request } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { FAKE_RESUME, readStored, replayClaude, startProject, watchProblems, writeStored } from './helpers'

// Step 22 in real Chrome against the build (CSP on): work in a step → home shows where Lukas left
// off → after a reload too → "Weiter" lands in that step (implementation plan "Your test").

test('work in step 1 → home summary (structured output) → survives a reload → Weiter opens step 1', async ({ page }) => {
  const problems = await watchProblems(page)
  const resumes: Request[] = []
  await replayClaude(page, ['step1-opening'], { resumes })
  await startProject(page)
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true, apiKey: dummyKey })
  await page.reload()
  await page.getByRole('button', { name: /^1 Gruppen,/ }).click()
  const input = page.getByRole('textbox', { name: 'Deine Nachricht' })
  await input.fill('Wir sind eine offene Fahrradwerkstatt.')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Senden' })).toBeVisible()
  // Still in the step: nothing written yet.
  expect(resumes).toHaveLength(0)

  await page.getByRole('button', { name: 'Übersicht', exact: true }).click()
  const card = page.getByRole('region', { name: 'Wo du aufgehört hast' })
  await expect(card.getByText(FAKE_RESUME.summary, { exact: true })).toBeVisible()
  await expect(card).toContainText(`Zum Weitermachen: ${FAKE_RESUME.nextAction}`)
  expect(resumes).toHaveLength(1)
  expect(resumes[0].postDataJSON()).toMatchObject({ max_tokens: 2_000, output_config: { effort: 'low', format: { type: 'json_schema' } } })

  // Saved at once with the project: a reload right away keeps it, and nothing is asked again.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Wo du aufgehört hast' }).getByText(FAKE_RESUME.summary, { exact: true })).toBeVisible()
  expect(resumes).toHaveLength(1)
  const project = (await readStored(page, 'project')) as { lastActive: { stepId: number }; steps: Record<string, { resume?: { summary: string } }> }
  expect(project.lastActive.stepId).toBe(1)
  expect(project.steps[1].resume?.summary).toBe(FAKE_RESUME.summary)

  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Zielgruppen/)
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  expect(problems).toEqual([])
})
