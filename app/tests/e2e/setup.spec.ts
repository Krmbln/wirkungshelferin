import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { dummyKey } from '../dummyKey'
import { errorBody, sseAnswer } from '../fakeClaude'
import { fakeClaude, readStored, watchProblems } from './helpers'

// Step 7 in real Chrome against the build (CSP on), with api.anthropic.com answered by the test.

const answer = { status: 200, body: sseAnswer(), contentType: 'text/event-stream' }
const refused = { status: 401, body: errorBody('authentication_error'), contentType: 'application/json' }

async function toKeyScreen(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Neu starten' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Bevor es losgeht' })).toBeVisible()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Verbindung zu Claude' })).toBeVisible()
}

async function testKey(page: Page, key: string) {
  await page.getByLabel('API-Schlüssel').fill(key)
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
}

test('setup end to end: the chat options pass, the key is saved, home opens; no CSP problems', async ({ page }) => {
  const problems = await watchProblems(page)
  const requests = await fakeClaude(page, () => answer)
  await toKeyScreen(page)
  await testKey(page, dummyKey)
  await expect(page.getByText('Verbindung erfolgreich. Der Schlüssel ist gespeichert.')).toBeVisible()

  // Exactly the options a chat call will send (implementation plan, step 7).
  expect(requests).toHaveLength(1)
  const headers = await requests[0].allHeaders()
  expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  expect(requests[0].postDataJSON()).toMatchObject({
    model: 'claude-opus-5-5',
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    stream: true,
    system: [{ cache_control: { type: 'ephemeral', ttl: '1h' } }],
  })
  // Chrome's password manager has nothing to offer for this field.
  await expect(page.getByLabel('API-Schlüssel')).toHaveAttribute('type', 'text')

  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Datenschutz' })).toBeVisible()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Erstes Backup' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Backup speichern' }).click()
  const text = await readFile(await (await download).path(), 'utf8')
  expect(text).not.toContain(dummyKey)
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible()
  expect(await readStored(page, 'settings')).toMatchObject({ apiKey: dummyKey, setupDone: true })

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible()
  expect(problems).toEqual([])
})

test('a wrong key: plain message, nothing stored, the console gets codes only', async ({ page }) => {
  const problems = await watchProblems(page)
  await fakeClaude(page, () => refused)
  await toKeyScreen(page)
  await testKey(page, dummyKey)
  await expect(page.getByRole('alert')).toContainText('Claude nimmt diesen API-Schlüssel nicht an.')
  await expect(page.getByRole('button', { name: 'Weiter', exact: true })).toHaveAttribute('aria-disabled', 'true')
  expect(await readStored(page, 'settings')).toBeUndefined()
  // Chrome logs the failed request itself; the app adds one line with codes.
  expect(problems.join('\n')).not.toContain(dummyKey)
  expect(problems.some((p) => p.startsWith('console: Connection test failed'))).toBe(true)
  expect(problems.filter((p) => !p.startsWith('console: Connection test failed') && !p.includes('status of 401'))).toEqual([])
})

test('offline: "Keine Internetverbindung" at once, without a request', async ({ page, context }) => {
  const requests = await fakeClaude(page, () => answer)
  await toKeyScreen(page)
  await context.setOffline(true)
  await testKey(page, dummyKey)
  await expect(page.getByRole('alert')).toContainText('Keine Internetverbindung.')
  expect(requests).toHaveLength(0)

  await context.setOffline(false)
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.getByText(/Verbindung erfolgreich/)).toBeVisible()
})
