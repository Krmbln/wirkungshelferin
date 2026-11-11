import { expect, test, type Page } from '@playwright/test'
import { outdatedProject } from '../outdated'
import { startProject, watchProblems, writeStored } from './helpers'

// Copy output in real Chrome against the build (implementation plan step 23, PRD F8): "Alles
// kopieren" puts HTML and plain text on the real clipboard under the app's CSP, and a field
// still being edited is in the block's copy.

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })
// The system clipboard is one for all workers: two copies at once would read each other's text.
test.describe.configure({ mode: 'serial' })

async function readClipboard(page: Page): Promise<{ types: string[]; html: string; text: string }> {
  return page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { types: [...item.types], html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() }
  })
}

async function seed(page: Page) {
  await startProject(page)
  await writeStored(page, 'project', outdatedProject({ 6: 'in_progress' }))
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true })
  await page.reload()
}

test('"Alles kopieren" on Home writes headings and lists as HTML and plain text', async ({ page }) => {
  const problems = await watchProblems(page)
  await seed(page)
  const result = page.getByRole('region', { name: 'Ergebnis' })
  await expect(result.getByText('Noch nicht bestätigt: Schritt 6 – er wird so kopiert, wie er gerade ist.')).toBeVisible()
  await result.getByRole('button', { name: 'Alles kopieren' }).click()
  // While it says "Kopiert" the button is named so: hold it by its marker.
  const button = result.locator('[data-copy="all"]')
  await expect(button).toHaveAttribute('data-copied', 'true')
  await expect(result.getByRole('status')).toHaveText('Kopiert. Du kannst den Text jetzt in Google Docs oder Word einfügen.')
  await expect(button).toBeFocused()
  const copied = await readClipboard(page)
  expect(copied.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']))
  expect(copied.html).toContain('<h1>Wirkungsmodell: Schraubzeit</h1>')
  expect(copied.html).toContain('<h2>Fokusgruppe: Gruppe tg1</h2>')
  expect(copied.html).toContain('<li>Kein Werkzeug (Evidenzbasis: unsicher)<ul><li><strong>Warum: </strong>beobachtet</li></ul></li>')
  expect(copied.text).toContain('Wirkungsmodell: Schraubzeit\n===========================')
  expect(copied.text).toContain('- Ort: Nordstadt')
  expect(copied.html).toContain('<li><strong>Ort: </strong>Nordstadt</li>')
  // "Kopiert" goes again after 2 s.
  await expect(button).not.toHaveAttribute('data-copied', /./, { timeout: 4000 })
  expect(problems).toEqual([])
})

test('a field still being edited is in the block copy', async ({ page }) => {
  const problems = await watchProblems(page)
  await seed(page)
  await page.getByRole('button', { name: /^1 .*, bestätigt$/ }).click()
  const panel = page.getByRole('region', { name: 'Baustein' })
  const field = panel.getByRole('textbox', { name: 'Herausforderung' })
  await field.click()
  await field.fill('Kaum Orte, an denen Jugendliche selbst etwas schaffen')
  // No Enter, no blur: the click on "Kopieren" ends the edit.
  await panel.getByRole('button', { name: 'Baustein kopieren: Schritt 1 · Herausforderung, Zielgruppen & Beteiligte' }).click()
  await expect(panel.locator('.copy [role="status"]')).toHaveText(/^Kopiert\./)
  const copied = await readClipboard(page)
  expect(copied.text).toMatch(/^Schritt 1 · Herausforderung, Zielgruppen & Beteiligte\n=+\n\n\(noch nicht bestätigt\)\n\nHerausforderung\n-+\n\nKaum Orte, an denen Jugendliche selbst etwas schaffen/)
  expect(problems).toEqual([])
})
