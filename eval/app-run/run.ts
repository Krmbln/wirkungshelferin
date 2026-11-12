// Step 25a: blocker pass. Drives the live app in real Chrome with a simulated first-time user
// (Haiku, persona from eval/cases/<case>) through steps 0–6, with Lukas's settings (Opus 5.5,
// effort medium). Logs every action, screenshot, console error and stuck point, and prices every
// API call. Resumable: the Chrome profile and state.json live in eval/runs/app-run/<run>/.
//
//   node eval/app-run/run.ts --fake                 free smoke run (API faked, scripted user)
//   caffeinate -i node eval/app-run/run.ts          the paid run (key from app/.env.local)
//   node eval/app-run/run.ts --run <id>             resume a run
//
// Options: --case dev-1 · --cap 8 ($) · --max-actions 18 (per step) · --steps 0-6 · --url · --headed
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { StuckWatch, cost, describe, invalidReason, parseElements, redact, stepFromLabel, usageOf, type Action, type Element } from './lib.ts'
import { HaikuUser, ScriptedUser, USER_MODEL, type User } from './user.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(`${ROOT}app/package.json`)
const { chromium } = require('playwright')
const Anthropic = require('@anthropic-ai/sdk').default

const { values: opt } = parseArgs({
  options: {
    run: { type: 'string' },
    case: { type: 'string', default: 'dev-1' },
    cap: { type: 'string', default: '8' },
    'max-actions': { type: 'string', default: '18' },
    steps: { type: 'string', default: '0-6' },
    url: { type: 'string', default: 'https://krmbln.github.io/wirkungshelferin/' },
    fake: { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
  },
})

const FAKE = opt.fake
const CAP = Number(opt.cap)
const MAX_ACTIONS = Number(opt['max-actions'])
const [from, to] = opt.steps!.split('-').map(Number)
const STEPS = Array.from({ length: (to ?? from) - from + 1 }, (_, i) => from + i)
const IDLE_TIMEOUT = 8 * 60_000
const HISTORY = 12

const runId = opt.run ?? `${FAKE ? 'fake' : 'run'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`
const DIR = `${ROOT}eval/runs/app-run/${runId}/`
const PROFILE = `${DIR}profile`
for (const d of ['shots', 'downloads']) mkdirSync(DIR + d, { recursive: true })

const caseDir = `${ROOT}eval/cases/${opt.case}/`
const facts = readFileSync(`${caseDir}facts.md`, 'utf8')
const application = readFileSync(`${caseDir}application.md`, 'utf8')

function readKey(): string {
  if (FAKE) return 'sk-' + 'ant-fake-smoke-0000000000'
  const env = readFileSync(`${ROOT}app/.env.local`, 'utf8')
  const key = /^ANTHROPIC_API_KEY=(.+)$/m.exec(env)?.[1]?.trim()
  if (!key) throw new Error('ANTHROPIC_API_KEY missing in app/.env.local')
  return key
}
const KEY = readKey()
const clean = (s: string) => redact(s, [KEY])

// ---- State (saved after every action) ----

type Finding = { step: number | null; n: number; type: string; detail: string }
type State = {
  runId: string
  case: string
  url: string
  setupDone: boolean
  at: number
  steps: Record<number, { actions: number; result?: string }>
  history: string[]
  findings: Finding[]
  cost: Record<string, number>
  calls: number
  unpriced: number
  stopped?: string
}

const STATE = `${DIR}state.json`
const state: State = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, 'utf8'))
  : { runId, case: opt.case!, url: opt.url!, setupDone: false, at: 0, steps: {}, history: [], findings: [], cost: {}, calls: 0, unpriced: 0 }
const total = () => Object.values(state.cost).reduce((a, b) => a + b, 0)
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2))
const log = (entry: object) => appendFileSync(`${DIR}log.jsonl`, clean(JSON.stringify({ t: new Date().toISOString(), ...entry })) + '\n')
const say = (s: string) => console.log(clean(s))

function addCost(model: string, usd: number) {
  state.cost[model] = (state.cost[model] ?? 0) + usd
  state.calls++
}

// ---- Browser ----

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: !opt.headed,
  viewport: { width: 1390, height: 880 },
  acceptDownloads: true,
  locale: 'de-DE',
})
const page = context.pages()[0] ?? (await context.newPage())

let current: number | null = null
let actionNo = 0
const problems: string[] = []
page.on('console', (m: { type(): string; text(): string }) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`))
await context.exposeFunction('__reportCsp', (v: string) => problems.push(`csp: ${v}`))
await context.addInitScript(() =>
  document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __reportCsp(v: string): void }).__reportCsp(`${e.violatedDirective} ${e.blockedURI}`)),
)
page.on('dialog', async (d: { message(): string; accept(): Promise<void> }) => {
  state.findings.push({ step: current, n: actionNo, type: 'native-dialog', detail: d.message() })
  await d.accept()
})
page.on('download', async (d: { suggestedFilename(): string; saveAs(p: string): Promise<void> }) => {
  await d.saveAs(`${DIR}downloads/${d.suggestedFilename()}`)
  log({ event: 'download', file: d.suggestedFilename() })
})
context.on('page', async (p: { url(): string; close(): Promise<void>; waitForLoadState(): Promise<void> }) => {
  if (p === page) return
  await p.waitForLoadState().catch(() => {})
  state.findings.push({ step: current, n: actionNo, type: 'new-tab', detail: p.url() })
  await p.close()
})

// API traffic: in-flight count (for "idle") and the price of every answer.
const API = 'https://api.anthropic.com/'
let inflight = 0
const pricing = new Set<Promise<void>>()
type Req = { url(): string; method(): string }
const isApi = (r: Req) => r.url().startsWith(API) && r.method() === 'POST'
context.on('request', (r: Req) => isApi(r) && inflight++)
context.on('requestfinished', (r: Req) => isApi(r) && inflight--)
context.on('requestfailed', (r: Req) => isApi(r) && inflight--)
context.on('response', (res: { request(): Req; text(): Promise<string>; status(): number }) => {
  if (!isApi(res.request()) || !res.request().url().includes('/v1/messages')) return
  const job = res
    .text()
    .then((body) => {
      const u = usageOf(body)
      if (!u) {
        if (res.status() === 200) state.unpriced++
        return
      }
      const c = cost(u.model, u.usage)
      if (!c.known) state.findings.push({ step: current, n: actionNo, type: 'unknown-model', detail: u.model })
      addCost(u.model, FAKE ? 0 : c.usd)
      log({ event: 'api', model: u.model, usd: c.usd, usage: u.usage })
    })
    .catch(() => {
      state.unpriced++
    })
    .finally(() => pricing.delete(job))
  pricing.add(job)
})

if (FAKE) await fakeApi()

async function fakeApi() {
  const ev = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`
  const sse = (text: string) =>
    ev({ type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }) +
    ev({ type: 'content_block_stop', index: 0 }) +
    ev({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
    ev({ type: 'message_stop' })
  await context.route(`${API}**`, async (route: { request(): { method(): string; headerValue(n: string): Promise<string | null>; postDataJSON(): { output_config?: { format?: unknown } } }; fulfill(o: object): Promise<void> }) => {
    const r = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': (await r.headerValue('access-control-request-headers')) ?? '*' }
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const structured = Boolean(r.postDataJSON()?.output_config?.format)
    const body = sse(structured ? JSON.stringify({ summary: 'Smoke.', nextAction: 'Weiter.' }) : 'Erzähl mal: Wer kommt zu euch ins Sprachcafé?')
    await route.fulfill({ status: 200, body, headers: { ...cors, 'content-type': 'text/event-stream' } }).catch(() => {})
  })
}

// ---- Page helpers ----

const stopButton = () => page.getByRole('button', { name: 'Stopp', exact: true })

/** Waits until no API call runs, every answer is priced and no "Stopp" shows, for 750 ms in a row. */
async function idle(): Promise<boolean> {
  const end = Date.now() + IDLE_TIMEOUT
  let quiet = 0
  await page.waitForTimeout(300)
  while (Date.now() < end) {
    const busy = inflight > 0 || pricing.size > 0 || (await stopButton().isVisible().catch(() => false))
    quiet = busy ? 0 : quiet + 1
    if (quiet >= 3) return true
    await page.waitForTimeout(250)
  }
  return false
}

const snapshot = async (): Promise<string> => clean(await page.locator('body').ariaSnapshot({ timeout: 10_000 }))

async function currentStep(): Promise<number | null> {
  const row = page.locator('.sidebar__step[aria-current="page"]')
  return (await row.count()) ? stepFromLabel(await row.first().getAttribute('aria-label')) : null
}

async function openStep(n: number) {
  await page.locator('.sidebar__step').filter({ has: page.locator('.sidebar__num', { hasText: new RegExp(`^${n}$`) }) }).first().click()
  await idle()
}

type Stored = { steps: Record<string, { status: string; block: unknown; segments: { messages: { role: string; content: Record<string, unknown>[]; act?: { kind: string } }[] }[]; confirmed?: { block: unknown } }> }

async function readProject(): Promise<Stored | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('wirkungshelferin')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const value = await new Promise<unknown>((resolve) => {
      const r = db.transaction('data').objectStore('data').get('project')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(null)
    })
    db.close()
    return value as never
  })
}

/** The settings without the key: model, effort, and whether a key is stored. */
async function readSettings(): Promise<unknown> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('wirkungshelferin')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const s = await new Promise<Record<string, unknown> | undefined>((resolve) => {
      const r = db.transaction('data').objectStore('data').get('settings')
      r.onsuccess = () => resolve(r.result as Record<string, unknown> | undefined)
    })
    db.close()
    return { model: s?.model, effort: s?.effort, setupDone: s?.setupDone, hasKey: Boolean(s?.apiKey ?? s?.key) }
  })
}

function locate(e: Element, elements: Element[]) {
  if (e.name) return page.getByRole(e.role, { name: e.name, exact: true }).nth(e.nth)
  return page.getByRole(e.role).nth(elements.filter((x) => x.role === e.role && x.i < e.i).length)
}

async function act(a: Action, elements: Element[]): Promise<string> {
  if (a.kind === 'wait') {
    await page.waitForTimeout(3000)
    return 'gewartet'
  }
  if (a.kind === 'stuck') return 'weiß nicht weiter'
  const e = elements[a.element]
  const loc = locate(e, elements)
  try {
    if (a.kind === 'click') await loc.click({ timeout: 5000 })
    else if (a.kind === 'type') {
      await loc.fill(a.text, { timeout: 5000 })
      await loc.press('Enter')
    } else await loc.fill(application, { timeout: 5000 })
    return 'ok'
  } catch (err) {
    return `fehlgeschlagen: ${(err as Error).message.split('\n')[0]}`
  }
}

function flushProblems() {
  for (const p of problems.splice(0)) state.findings.push({ step: current, n: actionNo, type: 'console', detail: clean(p) })
}

async function shot(name: string) {
  await page.screenshot({ path: `${DIR}shots/${name}.png` }).catch(() => {})
}

// ---- Setup (by the script, so the key never reaches the user model) ----

async function setup() {
  await page.goto(state.url)
  await page.getByRole('button', { name: 'Neu starten' }).click()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByLabel('API-Schlüssel').fill(KEY)
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await page.getByText(/Verbindung erfolgreich/).waitFor({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByRole('heading', { level: 1, name: 'Datenschutz' }).waitFor()
  await page.getByRole('button', { name: 'Weiter', exact: true }).click()
  await page.getByRole('button', { name: 'Backup speichern' }).click()
  await page.getByRole('button', { name: 'Fertig' }).click()
  await page.getByRole('heading', { level: 1, name: 'Übersicht' }).waitFor()
  await idle()
  state.setupDone = true
  log({ event: 'setup', settings: await readSettings() })
  save()
}

// ---- Report ----

function textOf(content: Record<string, unknown>[]): string {
  return content
    .flatMap((b) => {
      // Context the app adds to a user turn ("[Projektstand] …", "[Bausteinstand …") isn't what Lukas typed.
      if (b.type === 'text') return /^\[[^\]\n]+\]\n/.test(String(b.text)) ? [] : [String(b.text)]
      if (b.type === 'tool_use') return [`[Werkzeug ${String(b.name)}] ${JSON.stringify(b.input).slice(0, 1500)}`]
      if (b.type === 'tool_result') return [`[Ergebnis] ${JSON.stringify(b.content).slice(0, 300)}`]
      if (b.type === 'document') return ['[PDF]']
      return []
    })
    .join('\n')
}

async function report() {
  const project = await readProject().catch(() => null)
  if (project) writeFileSync(`${DIR}project.json`, JSON.stringify(project, null, 1))
  const lines = [
    `# App run ${state.runId}`,
    '',
    `Case ${state.case} · ${state.url} · ${state.stopped ?? 'running'}`,
    `Cost: $${total().toFixed(2)} (${Object.entries(state.cost).map(([m, c]) => `${m} $${c.toFixed(2)}`).join(', ')}) · ${state.calls} priced calls · ${state.unpriced} unpriced`,
    '',
    '| Step | Actions | Result | Status in app |',
    '|---|---|---|---|',
    ...STEPS.map((n) => `| ${n} | ${state.steps[n]?.actions ?? 0} | ${state.steps[n]?.result ?? '–'} | ${project?.steps[n]?.status ?? '?'} |`),
    '',
    '## Findings',
    ...(state.findings.length ? state.findings.map((f) => `- step ${f.step ?? '–'} #${f.n} **${f.type}**: ${f.detail}`) : ['(none)']),
  ]
  for (const n of STEPS) {
    const s = project?.steps[n]
    if (!s) continue
    lines.push('', `## Step ${n} — chat`)
    for (const seg of s.segments)
      for (const m of seg.messages) {
        const who = m.act ? `App (${m.act.kind})` : m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Claude' : 'System'
        const body = textOf(m.content)
        if (body.trim()) lines.push('', `**${who}:** ${m.act?.kind === 'paste' ? '(Antragstext)' : body}`)
      }
    lines.push('', `### Step ${n} — block`, '```json', JSON.stringify(s.block), '```')
  }
  writeFileSync(`${DIR}report.md`, clean(lines.join('\n')))
}

// ---- Main loop ----

const user: User = FAKE ? new ScriptedUser() : new HaikuUser(new Anthropic({ apiKey: KEY, maxRetries: 4 }), facts)
let interrupted = false
process.on('SIGINT', () => (interrupted = true))

try {
  if (!state.setupDone) await setup()
  else {
    await page.goto(state.url)
    await page.getByRole('heading', { level: 1 }).first().waitFor()
    await idle()
  }
  say(`run ${runId} · setup done · cost so far $${total().toFixed(3)}`)

  for (; state.at < STEPS.length; state.at++) {
    const target = STEPS[state.at]
    const rec = (state.steps[target] ??= { actions: 0 })
    const stuck = new StuckWatch()
    let offTarget = 0
    let gaveUp = 0
    let note: string | undefined
    const previous = state.at > 0 ? state.steps[STEPS[state.at - 1]]?.result : 'confirmed'
    if (previous !== 'confirmed' && rec.actions === 0) {
      log({ event: 'script-opens-step', step: target })
      await openStep(target)
    }

    while (true) {
      const project = await readProject()
      if (project?.steps[target]?.status === 'confirmed') {
        rec.result = 'confirmed'
        break
      }
      if (rec.actions >= MAX_ACTIONS) {
        rec.result = 'turn cap'
        state.findings.push({ step: target, n: actionNo, type: 'turn-cap', detail: `${MAX_ACTIONS} actions without a confirmed step` })
        break
      }
      if (total() >= CAP) throw Object.assign(new Error('budget'), { budget: true })
      if (interrupted) throw new Error('interrupted')

      current = await currentStep()
      if (current === target) offTarget = 0
      else if (++offTarget > 3) {
        state.findings.push({ step: target, n: actionNo, type: 'off-target', detail: `3 actions without reaching step ${target} (on ${current ?? 'a non-step view'}); script opened it` })
        await openStep(target)
        offTarget = 0
        current = await currentStep()
      }

      const before = await snapshot()
      const elements = parseElements(before)
      const decision = await user.next({ snapshot: before, elements, history: state.history, note })
      if (decision.usage && !FAKE) addCost(decision.model ?? USER_MODEL, cost(decision.model ?? USER_MODEL, decision.usage).usd)
      const a = decision.action
      actionNo++
      rec.actions++

      const invalid = invalidReason(a, elements)
      const target_ = elements[a.element]
      const label = target_ ? describe(target_) : ''
      const result = invalid ? `ungültig: ${invalid}` : await act(a, elements)
      if (!invalid) await idle().then((ok) => ok || state.findings.push({ step: target, n: actionNo, type: 'timeout', detail: `still busy after ${IDLE_TIMEOUT / 60000} min` }))
      const after = await snapshot()
      flushProblems()

      const textShown = a.kind === 'type' ? ` „${a.text}“` : a.kind === 'paste_application' ? ' (Antrag eingefügt)' : ''
      state.history.push(`- ${a.kind}${label ? ` ${label}` : ''}${textShown} → ${result}. (${a.thought})`)
      state.history = state.history.slice(-HISTORY)
      if (a.kind === 'stuck') {
        state.findings.push({ step: target, n: actionNo, type: 'stuck', detail: `${a.thought} [screen: ${(await page.locator('h1').first().textContent().catch(() => '')) ?? ''}]` })
        gaveUp++
      }
      if (invalid || result.startsWith('fehlgeschlagen')) state.findings.push({ step: target, n: actionNo, type: invalid ? 'invalid-action' : 'action-failed', detail: `${a.kind} ${label}: ${result}` })

      await shot(`s${target}-${String(rec.actions).padStart(2, '0')}`)
      log({ event: 'action', step: target, on: current, n: actionNo, action: a, element: label, result, cost: Number(total().toFixed(4)) })
      say(`step ${target} #${rec.actions} ${a.kind} ${label}${textShown} → ${result} · $${total().toFixed(2)}`)
      save()

      note = undefined
      if (stuck.record(before, after)) {
        state.findings.push({ step: target, n: actionNo, type: 'no-change', detail: `screen unchanged after ${stuck.limit} actions in a row` })
        rec.result = 'stuck'
        break
      }
      if (gaveUp >= 2) {
        rec.result = 'stuck (user)'
        break
      }
      if (before === after && a.kind !== 'wait') note = 'Nach deiner letzten Aktion hat sich am Bildschirm nichts geändert.'
      if (!FAKE && state.unpriced >= 3) throw new Error('3 API answers could not be priced; the budget cap is blind')
    }
    say(`step ${target}: ${rec.result}`)
    save()
    await report()
    // After a confirm the user finds the way on; after a give-up the script opens the next step.
  }
  state.stopped = 'finished'
} catch (err) {
  state.stopped = (err as { budget?: boolean }).budget ? `budget cap $${CAP} reached` : `error: ${clean((err as Error).message.split('\n')[0])}`
  await shot('error')
  say(state.stopped)
} finally {
  flushProblems()
  save()
  await report().catch((e) => say(`report failed: ${e}`))
  await context.close()
  // A finished run needs no profile; it holds the key. An aborted one stays for --run.
  if (state.stopped === 'finished') rmSync(PROFILE, { recursive: true, force: true })
  say(`report: ${DIR}report.md · $${total().toFixed(2)}`)
}
