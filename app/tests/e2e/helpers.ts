import type { Page, Request } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { sseAnswer } from '../fakeClaude'

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/sse/', import.meta.url))

// Every test starts with an empty browser profile, so the app opens on the empty state.
// Setup (step 7) is marked as done first, so the project opens on home; setup.spec.ts
// covers setup itself.
export async function startProject(page: Page): Promise<void> {
  await page.goto('./')
  await page.getByRole('button', { name: 'Neu starten' }).waitFor()
  await writeStored(page, 'settings', { model: 'claude-opus-5-5', effort: 'medium', setupDone: true })
  await page.reload()
  await page.getByRole('button', { name: 'Neu starten' }).click()
  await page.getByRole('heading', { level: 1, name: 'Übersicht' }).waitFor()
}

/** The real first start: Neu starten → setup with the given key (API faked) → home. */
export async function completeSetup(page: Page, key: string): Promise<void> {
  await fakeClaude(page, () => ({ status: 200, body: sseAnswer(), contentType: 'text/event-stream' }))
  await page.goto('./')
  await page.getByRole('button', { name: 'Neu starten' }).click()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByLabel('API-Schlüssel').fill(key)
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await page.getByText(/Verbindung erfolgreich/).waitFor()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Datenschutz' }).waitFor()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Backup speichern' }).click()
  await download
  await page.getByRole('button', { name: 'Fertig' }).click()
  await page.getByRole('heading', { level: 1, name: 'Übersicht' }).waitFor()
}

type Answer = { status: number; body: string; contentType: string }

/** The home summary every fake answers by default (step 22): made-up, valid structured output. */
export const FAKE_RESUME = { summary: 'Zwei Zielgruppen stehen, die Beteiligten fehlen noch.', nextAction: 'Beantworte im Chat, wer bei euch mitredet.' }

/**
 * Answers every request to api.anthropic.com from the test; returns the requests made. The home
 * summary (a request with `output_config.format`, written in the background after Lukas leaves a
 * step) gets `FAKE_RESUME` and is collected in `resumes` instead, so specs count chat turns only.
 */
export async function fakeClaude(
  page: Page,
  respond: () => Answer | Promise<Answer>,
  resumes: Request[] = [],
): Promise<Request[]> {
  const requests: Request[] = []
  await page.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request()
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      // "*" doesn't cover Authorization, so the preflight gets the names back.
      'access-control-allow-headers': (await request.headerValue('access-control-request-headers')) ?? '*',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if ((request.postDataJSON() as { output_config?: { format?: unknown } }).output_config?.format) {
      resumes.push(request)
      const body = sseAnswer('end_turn', JSON.stringify(FAKE_RESUME))
      return route.fulfill({ status: 200, body, headers: { ...cors, 'content-type': 'text/event-stream' } }).catch(() => undefined)
    }
    requests.push(request)
    const { status, body, contentType } = await respond()
    // A request the page stopped meanwhile ("Stopp") can't be answered any more.
    await route.fulfill({ status, body, headers: { ...cors, 'content-type': contentType } }).catch(() => undefined)
  })
  return requests
}

/**
 * The SSE-replay harness: answers the n-th chat request with the n-th recorded stream from
 * tests/fixtures/sse (made-up content, recorded by `npm run contract`); the last one repeats.
 * `hold` keeps a request open that long first, so the test can press "Stopp" in between.
 */
export async function replayClaude(page: Page, names: string[], { hold = {}, resumes }: { hold?: Record<number, number>; resumes?: Request[] } = {}) {
  let n = 0
  return fakeClaude(
    page,
    async () => {
      const i = n++
      if (hold[i]) await new Promise((resolve) => setTimeout(resolve, hold[i]))
      const body = await readFile(`${FIXTURE_DIR}${names[Math.min(i, names.length - 1)]}.sse`, 'utf8')
      return { status: 200, body, contentType: 'text/event-stream' }
    },
    resumes,
  )
}

// Collects CSP violations and console errors from the moment the page starts.
export async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  await page.exposeFunction('__reportCsp', (v: string) => problems.push(`csp: ${v}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __reportCsp: (v: string) => void }).__reportCsp(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    )
  })
  return problems
}

// Reads one key from the app's IndexedDB, as the app stored it.
export async function readStored(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('wirkungshelferin')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const value = await new Promise<unknown>((resolve) => {
      const r = db.transaction('data').objectStore('data').get(key)
      r.onsuccess = () => resolve(r.result)
    })
    db.close()
    return value
  }, key)
}

// Writes one key into the app's IndexedDB (the app must have opened it once).
export async function writeStored(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    async ([key, value]) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('wirkungshelferin')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('data', 'readwrite')
        tx.objectStore('data').put(value, key as string)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    [key, value] as const,
  )
}
