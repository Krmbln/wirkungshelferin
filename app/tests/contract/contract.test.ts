// @vitest-environment node
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BetaMessage, BetaToolResultBlockParam, BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sdkAiClient, type SendOptions, type SendResult } from '../../src/ai/client'
import { commitAnswer, prepareAct, prepareTurn } from '../../src/ai/chat'
import { extractPdf } from '../../src/ai/pdf'
import {
  MESSAGE_ORDER,
  contextText,
  historyMessages,
  nextTurn,
  pendingToolUses,
  snapshotText,
  systemPrompt,
  withCacheBreakpoint,
  type MessageOrder,
  type Turn,
} from '../../src/ai/prompt'
import { checkToolResult, errorToolResult, proposalToolResult, toProposal } from '../../src/ai/proposal'
import { MAX_TOKENS } from '../../src/ai/request'
import { CHECK, PROPOSE, stepTools } from '../../src/ai/tools'
import { stepOf, type LooseBlock } from '../../src/domain/block'
import type { Item } from '../../src/domain/schemas/blocks'
import { demoProject } from '../../src/domain/demo'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { formFields, isOffen } from '../../src/domain/profile'
import { reducer } from '../../src/domain/reducer'
import { changeView } from '../../src/domain/proposals'
import { projectSchema, type Project, type Proposal, type StoredMessage } from '../../src/domain/schemas/project'
import { stepIds } from '../../src/domain/types'
import type { Settings } from '../../src/storage/settings'
import { PDF_FIRST_LINE, PDF_LAST_LINE, PDF_ROWS, madeUpPdfBase64 } from '../madeUpPdf'
import { FIXTURES, recorder } from './recorder'

// `npm run contract` (implementation plan step 8): the real ai/ layer against the real API.
// Manual only, costs a few cents per run. Each check is one test; the report at the end
// states the decided message order and what the run cost.

const REPORT = fileURLToPath(new URL('./REPORT.md', import.meta.url))
const AT = '2026-11-05T10:00:00.000Z'

// ---------------------------------------------------------------- setup

let settings: Settings
const rec = recorder()
const ai = sdkAiClient({ fetch: rec.fetch, online: () => true })

beforeAll(() => {
  const env = fileURLToPath(new URL('../../.env.local', import.meta.url))
  if (!existsSync(env)) throw new Error('app/.env.local fehlt (ANTHROPIC_API_KEY=…).')
  process.loadEnvFile(env)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt in app/.env.local.')
  // The app's defaults: the contract tests what Lukas will run.
  settings = { apiKey, model: 'claude-opus-5-5', effort: 'medium', setupDone: true }
})

// ---------------------------------------------------------------- report

type Row = { check: string; ok: boolean; note: string }
const rows: Row[] = []
const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, write1h: 0, write5m: 0 }
const facts: string[] = []

function count(message: BetaMessage | undefined) {
  if (!message) return
  const u = message.usage
  usage.calls++
  usage.input += u.input_tokens ?? 0
  usage.output += u.output_tokens ?? 0
  usage.cacheRead += u.cache_read_input_tokens ?? 0
  const creation = u.cache_creation
  usage.write1h += creation?.ephemeral_1h_input_tokens ?? 0
  usage.write5m += creation?.ephemeral_5m_input_tokens ?? 0
}

/** Opus 5.5 per million tokens: $4 in, $20 out, $0.20 cache read, cache writes 2× (1 h) / 1.25× (5 min). */
const dollars = () =>
  (usage.input * 4 + usage.output * 20 + usage.cacheRead * 0.2 + usage.write1h * 8 + usage.write5m * 5) / 1e6

/** Runs a check, then records ✓ or ✗ (with the reason) for the report. */
async function check(name: string, run: () => Promise<string | void>) {
  try {
    const note = (await run()) ?? ''
    rows.push({ check: name, ok: true, note })
  } catch (error) {
    rows.push({ check: name, ok: false, note: (error as Error).message.split('\n')[0] })
    throw error
  }
}

afterAll(() => {
  const lines = [
    '# Live API contract — last run',
    '',
    `Run: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · model ${settings?.model} · effort ${settings?.effort}`,
    '',
    '| | Check | Note |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.ok ? '✓' : '✗'} | ${r.check} | ${r.note.replace(/\|/g, '/')} |`),
    '',
    ...facts.map((f) => `- ${f}`),
    '',
    `Usage: ${usage.calls} calls · input ${usage.input} · output ${usage.output} · cache read ${usage.cacheRead} · ` +
      `cache write 1 h ${usage.write1h} / 5 min ${usage.write5m} · **≈ $${dollars().toFixed(2)}**`,
    '',
  ]
  writeFileSync(REPORT, lines.join('\n'))
  console.log(`\n${lines.join('\n')}`)
})

// ---------------------------------------------------------------- helpers

/** Fails a check with the API's error text when a call didn't come back done. */
function done(result: SendResult): BetaMessage {
  if (result.status === 'done') {
    count(result.message)
    const dropped = (result.message as BetaMessage & { input_transformations?: { type: string }[] }).input_transformations ?? []
    expect(dropped.filter((t) => t.type === 'thinking_dropped'), 'thinking blocks were dropped').toEqual([])
    return result.message
  }
  if (result.status === 'aborted') throw new Error('aborted')
  throw new Error(`${result.problem}: ${rec.lastError() ?? ''}`)
}

const toolUses = (message: BetaMessage) => message.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')

// ---------------------------------------------------------------- 1. strict mode

describe('1 · tool schemas in strict mode', () => {
  for (const step of stepIds) {
    it(`step ${step}: both tools are accepted with strict: true`, () =>
      check(`Strict schemas step ${step}`, async () => {
        const message = done(
          await ai.send(settings, {
            system: 'Vertragstest der Wirkungshelferin.',
            tools: stepTools(step),
            messages: [{ role: 'user', content: 'Antworte nur mit „OK“. Benutze kein Werkzeug.' }],
            maxTokens: 512,
            effort: 'low',
          }),
        )
        return `stop: ${message.stop_reason}`
      }))
  }
})

// ---------------------------------------------------------------- 2. step 1 conversation

describe('2 · step 1 conversation (demo project)', () => {
  const step = 1 as const
  let project: Project = demoProject()
  let stored: StoredMessage[] = []
  let seen: LooseBlock | undefined
  let proposals: Proposal[] = []
  let decided: MessageOrder | undefined
  const cacheReads: number[] = []
  let n = 0

  const block = () => stepOf(project, step).block
  const store = (messages: Pick<StoredMessage, 'role' | 'content' | 'aborted'>[]) => {
    for (const m of messages) stored.push({ id: `m${++n}`, at: AT, ...m } as StoredMessage)
  }

  /** Answers every pending tool_use: proposals with what Lukas did, broken calls with the errors. */
  function toolResults(): BetaToolResultBlockParam[] {
    return pendingToolUses(stored).map((id) => {
      const proposal = proposals.find((p) => p.toolUseId === id)
      if (proposal) return proposalToolResult(project, step, proposal)
      const use = stored.flatMap((m) => m.content).find((b) => b.id === id)
      return use?.name === CHECK ? checkToolResult(id) : errorToolResult(id, invalid.get(id) ?? ['Vorschlag war ungültig.'])
    })
  }

  /** Sends Lukas's next turn; `keep` stores it (append-only) together with the answer. */
  async function send(
    turn: Omit<Turn, 'snapshot' | 'pending'>,
    opts: { order?: MessageOrder; maxTokens?: number; record?: string; keep?: boolean } & SendOptions = {},
  ) {
    const at = structuredClone(project)
    // What the snapshot shows is what Claude saw, even if the block changes while it answers.
    const shown = structuredClone(block())
    const snapshot = snapshotText(step, shown, seen)
    const appended = nextTurn({ ...turn, pending: pendingToolUses(stored), snapshot }, opts.order)
    const messages = withCacheBreakpoint(historyMessages([...stored, ...appended] as StoredMessage[]))
    if (opts.record) rec.recordNext(opts.record)
    const result = await ai.send(
      settings,
      { system: systemPrompt(step), tools: stepTools(step), messages, maxTokens: opts.maxTokens ?? MAX_TOKENS.chat },
      { signal: opts.signal, onEvent: opts.onEvent },
    )
    await rec.flushed()
    if (opts.keep !== false && result.status !== 'failed') {
      seen = shown
      const answer = result.status === 'done' ? result.message : result.partial
      store([...appended, ...(answer ? [{ role: 'assistant' as const, content: answer.content as never, ...(result.status === 'aborted' && { aborted: true as const }) }] : [])])
    }
    // The project as the recorded request saw it: replay tests convert the answer against it.
    if (opts.record) writeFileSync(`${FIXTURES}${opts.record}.json`, JSON.stringify({ step, project: at }, null, 2))
    return result
  }

  /** Invalid calls, answered with an error tool_result in the next turn (tool_use id → errors). */
  const invalid = new Map<string, string[]>()

  /** Turns every propose_changes call of the answer into a stored proposal; invalid calls are kept for the error result. */
  function takeProposals(message: BetaMessage): Proposal[] {
    const found: Proposal[] = []
    for (const use of toolUses(message).filter((u) => u.name === PROPOSE)) {
      const result = toProposal(step, use.input, { seen: seen!, toolUseId: use.id, proposalId: `p${proposals.length + 1}`, at: AT })
      if (!result.ok) {
        invalid.set(use.id, result.errors)
        continue
      }
      project = reducer(project, { type: 'proposal/add', step, proposal: result.proposal })
      proposals.push(result.proposal)
      found.push(result.proposal)
    }
    return found
  }
  const latest = (proposal: Proposal) => project.steps[step].proposals.find((p) => p.id === proposal.id)!
  const syncProposals = () => (proposals = proposals.map(latest))

  it('opening: valid propose_changes, temp ids resolve to real ids', () =>
    check('Step 1 opening: tool call valid, temp ids → real ids', async () => {
      const message = done(
        await send(
          {
            context: contextText(project, step),
            text: 'Hallo! Schritt 0 ist bestätigt. Mach mir bitte gleich einen ersten Vorschlag für die Herausforderung, die Zielgruppen und die Beteiligten.',
          },
          { record: 'step1-opening' },
        ),
      )
      cacheReads.push(message.usage.cache_read_input_tokens ?? 0)
      let [proposal] = takeProposals(message)
      let note = ''
      if (!proposal && invalid.size) {
        // The designed path for a broken call: the errors go back, Claude corrects it.
        note = `first call invalid (${[...invalid.values()].flat().join(' ')}), corrected after the error tool_result; `
        facts.push(`Opening: ${note.slice(0, -2)}`)
        const retry = done(await send({ toolResults: toolResults(), text: 'Bitte korrigiere den Vorschlag.' }, { record: 'step1-opening-corrected' }))
        ;[proposal] = takeProposals(retry)
      }
      expect(proposal, 'no valid propose_changes call').toBeDefined()
      const adds = proposal.changes.filter((c) => c.op === 'add')
      expect(adds.length).toBeGreaterThan(1)
      // Lukas takes all but the last change, rejects that one.
      const last = proposal.changes.at(-1)!
      project = reducer(project, { type: 'change/reject', step, proposalId: proposal.id, changeId: last.id })
      project = reducer(project, { type: 'change/applyAll', step, proposalId: proposal.id })
      syncProposals()
      const applied = latest(proposal).changes.filter((c) => c.state === 'applied')
      for (const c of applied.filter((c) => c.op === 'add')) expect(c.resultId).toMatch(/^[a-z]+\d+$/)
      projectSchema.parse(project)
      return `${note}${proposal.changes.length} changes (${adds.length} adds), ${applied.length} applied, 1 rejected`
    }))

  it('message order: the documented shapes against the real API', () =>
    check('Message order', async () => {
      // Lukas edits a target group himself, then writes.
      const tg = (block().targetGroups as Item[])[0] as Item & { description: string }
      project = reducer(project, {
        type: 'item/edit',
        step,
        collection: 'targetGroups',
        id: tg.id,
        fields: { description: `${tg.description} Vor allem aus den Hochhäusern am Weidengrund.` },
      })
      const proposal = proposals[0]
      const appliedCount = proposal.changes.filter((c) => c.state === 'applied').length
      const turn = {
        toolResults: toolResults(),
        events: [
          `Die Person hat ${appliedCount} Änderungen aus Vorschlag ${proposal.id} übernommen und 1 abgelehnt.`,
          `Die Person hat die Beschreibung von ${tg.id} selbst geändert.`,
        ],
        text: `Bitte grenz ${tg.id} auf die 12- bis 14-Jährigen ein, die Älteren kommen kaum.`,
      }

      // A, B and C on the same history, not stored: does the API accept the shape?
      const shape = async (order: MessageOrder) => {
        const result = await send(turn, { order, maxTokens: 512, keep: false })
        if (result.status === 'done') count(result.message)
        return result.status === 'failed' ? `refused (${(rec.lastError() ?? '').slice(0, 200)})` : 'accepted'
      }
      const a = await shape('system-between')
      const b = await shape('system-after')
      const c = await shape('single-user')
      // B after a stopped answer: the stop leaves [user] → [system: events] → [user].
      const probe = await ai.send(settings, {
        system: 'Vertragstest der Wirkungshelferin.',
        messages: [
          { role: 'user', content: 'Hallo.' },
          { role: 'system', content: 'Die Person hat eine Änderung übernommen.' },
          { role: 'user', content: 'Antworte nur mit „OK“.' },
        ],
        maxTokens: 256,
        effort: 'low',
      })
      if (probe.status === 'done') count(probe.message)
      const afterStop = probe.status === 'failed' ? `refused (${(rec.lastError() ?? '').slice(0, 200)})` : 'accepted'

      facts.push(`Shape A \`system-between\` ([user: tool_results] → [system: events] → [user: text]): ${a}`)
      facts.push(`Shape B \`system-after\` ([user: tool_results + text] → [system: events]): ${b}`)
      facts.push(`Shape B after a stopped answer ([user] → [system] → [user]): ${afterStop}`)
      facts.push(`Shape C \`single-user\` ([user: tool_results + "[App] …" + text]): ${c}`)
      decided = b === 'accepted' && afterStop === 'accepted' ? 'system-after' : c === 'accepted' ? 'single-user' : undefined
      facts.push(`**Decided message order: \`${decided}\`** (MESSAGE_ORDER in src/ai/prompt.ts)`)
      expect(decided, `set MESSAGE_ORDER to '${decided}' in src/ai/prompt.ts and run the contract again`).toBe(MESSAGE_ORDER)

      // The real turn, in the decided order.
      cacheReads.push(done(await send(turn, { record: 'step1-update' })).usage.cache_read_input_tokens ?? 0)
      return String(decided)
    }))

  it('short ids: an update to an existing item applies against the rev Claude saw', () =>
    check('Step 1 update by short id + baseRev', async () => {
      // `seen` is still the block the update request showed.
      const answer = stored.filter((m) => m.role === 'assistant').at(-1)!
      const found = takeProposals({ content: answer.content } as unknown as BetaMessage)
      const updates = found.flatMap((p) => p.changes.filter((c) => c.op === 'update').map((c) => ({ p, c })))
      expect(updates.length, 'no update in the answer').toBeGreaterThan(0)
      for (const { p, c } of updates) {
        expect(changeView(project, step, p.id, c.id).kind).toBe('open')
        project = reducer(project, { type: 'change/apply', step, proposalId: p.id, changeId: c.id })
      }
      syncProposals()
      const { p, c } = updates[0]
      expect(latest(p).changes.find((x) => x.id === c.id)!.state).toBe('applied')
      return `${updates.map(({ c }) => `${c.targetId} (baseRev ${c.baseRev})`).join(', ')} applied`
    }))

  it('stop during thinking: left out of the next payload', () =>
    check('Stopped during thinking (turn with an app event)', async () => {
      const controller = new AbortController()
      // The event makes the hard case: its system message is followed by Lukas's next turn,
      // because the stopped answer between them is never sent.
      const result = await send(
        {
          toolResults: toolResults(),
          events: [`Die Person hat die Änderung an ${proposals.at(-1)!.changes[0].targetId} übernommen.`],
          text: 'Was meinst du: Sind die Eltern eine eigene Zielgruppe?',
        },
        { record: 'step1-stopped-thinking', signal: controller.signal, onEvent: (e) => e.type === 'content_block_start' && controller.abort() },
      )
      expect(result.status).toBe('aborted')
      if (result.status === 'aborted') count(result.partial)
      return `first block: ${result.status === 'aborted' ? result.partial?.content[0]?.type ?? 'none' : '-'}`
    }))

  it('stop during tool_use: left out of the next payload', () =>
    check('Stopped during tool_use', async () => {
      const controller = new AbortController()
      let sawToolUse = false
      const result = await send(
        { toolResults: toolResults(), text: 'Lass das. Schlag bitte die Hausverwaltung der Siedlung als Beteiligte vor.' },
        {
          record: 'step1-stopped-tool',
          signal: controller.signal,
          onEvent: (e) => {
            if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') (sawToolUse = true), controller.abort()
          },
        },
      )
      expect(sawToolUse, 'the answer had no tool_use to stop in').toBe(true)
      expect(result.status).toBe('aborted')
      if (result.status === 'aborted') count(result.partial)
      return 'stopped at tool_use start'
    }))

  it('after both stops: history accepted, no aborted content sent', () =>
    check('History after stopped turns accepted (strict history check)', async () => {
      const kept = stored.filter((m) => !m.aborted).length
      const result = await send(
        { toolResults: toolResults(), text: 'Sorry, ich hab zweimal abgebrochen. Schlag bitte die Hausverwaltung als Beteiligte vor.' },
        { record: 'step1-after-stop' },
      )
      const sent = rec.lastRequest()!.messages as { role: string; content: { type: string }[] }[]
      // Everything stored and not stopped, plus the new turn (one user message, no events).
      expect(sent.length).toBe(kept + 1)
      const message = done(result)
      cacheReads.push(message.usage.cache_read_input_tokens ?? 0)
      // Orphans would be a tool_use without a tool_result in the next user turn.
      for (let i = 0; i < sent.length - 1; i++) {
        const ids = sent[i].content.filter((b) => b.type === 'tool_use').length
        if (ids && sent[i].role === 'assistant') expect(sent[i + 1].content.filter((b) => b.type === 'tool_result').length).toBe(ids)
      }
      const found = takeProposals(message)
      return `${sent.length} messages sent, ${stored.filter((m) => m.aborted).length} stopped turns left out, ${found.length} new proposal(s)`
    }))

  it('reload with an open proposal: tool_result "offen" accepted', () =>
    check('Reload with open proposal', async () => {
      // A reload = the stored document and history read back from JSON.
      project = projectSchema.parse(JSON.parse(JSON.stringify(project)))
      stored = JSON.parse(JSON.stringify(stored)) as StoredMessage[]
      syncProposals()
      const results = toolResults()
      const open = results.some((r) => String(r.content).includes('offen'))
      const message = done(
        await send(
          { toolResults: results, text: 'Ich schau mir den Vorschlag gleich an. Was ist für dich gerade der unsicherste Punkt?' },
          { record: 'step1-reload' },
        ),
      )
      cacheReads.push(message.usage.cache_read_input_tokens ?? 0)
      return `${results.length} tool_result(s)${open ? ', with open changes' : ''}; stop: ${message.stop_reason}`
    }))

  it('cache hits: system prompt and history are read from the cache', () =>
    check('Cache hits', async () => {
      expect(cacheReads.length).toBeGreaterThan(2)
      const [first, ...later] = cacheReads
      for (const read of later) expect(read).toBeGreaterThan(0)
      // The history caches turn by turn, so later turns read more than the first cached one.
      expect(later.at(-1)!).toBeGreaterThan(later[0])
      facts.push(`Cache reads per turn: ${cacheReads.join(' → ')} tokens`)
      return `first turn ${first}, then ${later.join(', ')}`
    }))
})

// ---------------------------------------------------------------- 3. PDF

describe('3 · PDF smoke check (made-up PDF)', () => {
  it('extracts the text, continuing after max_tokens', () =>
    check('PDF extraction with continuation', async () => {
      let round = 0
      // The real client, recording each round and counting its usage.
      const recording: typeof ai = {
        ...ai,
        async send(s, call, o) {
          rec.recordNext(`pdf-round${++round}`)
          const result = await ai.send(s, call, o)
          await rec.flushed()
          if (result.status === 'done') count(result.message)
          return result
        },
      }
      const result = await extractPdf(recording, settings, madeUpPdfBase64(), { maxTokens: 700, maxRounds: 6 })
      if (result.status !== 'done') throw new Error(`PDF: ${result.status} ${rec.lastError() ?? ''}`)
      expect(result.rounds, 'no continuation happened').toBeGreaterThan(1)
      expect(result.text).toContain(PDF_FIRST_LINE.split(' - ')[0])
      const missing = Array.from({ length: PDF_ROWS }, (_, i) => i + 1).filter((i) => !result.text.includes(`Nachmittag ${i}:`))
      expect(missing, 'rows missing in the extracted text').toEqual([])
      expect(result.text).toContain(PDF_LAST_LINE)
      return `${result.rounds} rounds, ${result.text.length} characters, all ${PDF_ROWS} rows`
    }))
})

// ---------------------------------------------------------------- 4. step 0 (step 14)

describe('4 · step 0: paste and interview (made-up text)', () => {
  // Made up, unlike the guide's examples and the real case. It leaves the team and similar
  // offers out (→ "offen") and names a report deadline (never captured, PO 2026-10-10).
  const SKETCH = [
    'Projektskizze „Schraubzeit – offene Fahrradwerkstatt für Jugendliche“',
    'Träger: Nachbarschaftshaus Am Weidengrund e. V. Ort: Weidengrund-Siedlung, Großwohnsiedlung am Stadtrand.',
    'Zweimal pro Woche (dienstags und donnerstags, 15–18 Uhr) reparieren Jugendliche ihre eigenen Räder unter Anleitung. Wer 20 Stunden mitarbeitet, darf ein aufbereitetes Spendenrad behalten.',
    'Ziele: Die Jugendlichen werden mobiler und kommen auch in andere Stadtteile. Sie können ihr Rad selbst instand halten.',
    'Laufzeit 2026–2027, gefördert von der Stiftung Stadtteil Morgen. Der Sachbericht ist jeweils bis zum 31. März fällig und nennt die Teilnahmen pro Halbjahr.',
  ].join('\n\n')

  it('paste: a valid profile proposal; what the text leaves out is "offen"; no deadline', () =>
    check('Step 0 paste: profile proposal valid, unknown = "offen", no deadline', async () => {
      const prepared = prepareAct(makeProject(), 0, { kind: 'paste', label: 'Projektskizze', text: SKETCH }, { at: AT })!
      rec.recordNext('step0-paste')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      writeFileSync(`${FIXTURES}step0-paste.json`, JSON.stringify({ step: 0, project: prepared.project }, null, 2))
      // Text first, then the card: a tool call ends the turn (rules, step 14 PO test).
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use')
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no text before the proposal').toContain('?')
      let project = commitAnswer(prepared.project, 0, { status: 'done', message }, prepared.shown, { at: AT })
      const errors = project.steps[0].segments.at(-1)!.messages.at(-1)!.toolErrors
      const [proposal] = project.steps[0].proposals
      expect(proposal, `no valid propose_changes call ${JSON.stringify(errors ?? {})}`).toBeDefined()
      project = reducer(project, { type: 'change/applyAll', step: 0, proposalId: proposal.id })
      const block = project.steps[0].block
      expect(block.profile.name).toContain('Schraubzeit')
      const offen = formFields('profile').filter((f) => isOffen((block.profile as Record<string, unknown>)[f]))
      expect(offen.length, 'nothing marked "offen"').toBeGreaterThan(0)
      expect(JSON.stringify([block.profile, block.frame]), 'a deadline went into the block').not.toMatch(/31\. ?März|fällig/)
      projectSchema.parse(project)
      return `text first (${textBefore.length} chars), ${proposal.changes.length} change(s); offen: ${offen.join(', ')}; frame purpose "${block.frame.purpose}"`
    }))

  it('opening (step 1 after step 0\'s confirm): text with one question before the draft card', () =>
    check('Step 1 opening after the hand-off: text + question first, then the card', async () => {
      const prepared = prepareAct(demoProject(), 1, { kind: 'opening' }, { at: AT })!
      rec.recordNext('step1-handoff')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use' && b.name === PROPOSE)
      expect(firstTool, 'no draft card').toBeGreaterThan(-1)
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no question before the card').toContain('?')
      return textBefore.split('\n').filter((l) => l.includes('?')).at(-1)!.slice(0, 140)
    }))

  it('interview: one first question, no proposal yet', () =>
    check('Step 0 interview: first question', async () => {
      const prepared = prepareAct(makeProject(), 0, { kind: 'interview' }, { at: AT })!
      rec.recordNext('step0-interview')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(text).toContain('?')
      expect(toolUses(message).filter((u) => u.name === PROPOSE)).toEqual([])
      return text.split('\n').filter(Boolean).at(-1)!.slice(0, 120)
    }))
})

// ---------------------------------------------------------------- 5. step 0 PDF (step 15)

describe('5 · step 0: PDF upload (made-up PDF)', () => {
  it('reads the PDF with a live count, then the PDF turn drafts the profile (text first, unknown = "offen")', () =>
    check('Step 0 PDF: read → PDF source → profile proposal valid', async () => {
      const counts: number[] = []
      const recording: typeof ai = {
        ...ai,
        async send(s, call, o) {
          rec.recordNext('pdf-full')
          const result = await ai.send(s, call, o)
          await rec.flushed()
          if (result.status === 'done') count(result.message)
          return result
        },
      }
      const read = await extractPdf(recording, settings, madeUpPdfBase64(), { onProgress: (n) => counts.push(n) })
      if (read.status !== 'done') throw new Error(`PDF: ${read.status} ${rec.lastError() ?? ''}`)
      expect(counts.length, 'no live count while the text streamed').toBeGreaterThan(1)
      expect(counts.at(-1)).toBe(read.text.length)

      const prepared = prepareAct(makeProject(), 0, { kind: 'pdf', label: 'Sachbericht Schraubzeit', text: read.text.trim() }, { at: AT })!
      rec.recordNext('step0-pdf')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      writeFileSync(`${FIXTURES}step0-pdf.json`, JSON.stringify({ step: 0, project: prepared.project }, null, 2))
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use')
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no text with a question before the proposal').toContain('?')
      let project = commitAnswer(prepared.project, 0, { status: 'done', message }, prepared.shown, { at: AT })
      const errors = project.steps[0].segments.at(-1)!.messages.at(-1)!.toolErrors
      const [proposal] = project.steps[0].proposals
      expect(proposal, `no valid propose_changes call ${JSON.stringify(errors ?? {})}`).toBeDefined()
      project = reducer(project, { type: 'change/applyAll', step: 0, proposalId: proposal.id })
      const block = project.steps[0].block
      expect(block.profile.name).toContain('Schraubzeit')
      const offen = formFields('profile').filter((f) => isOffen((block.profile as Record<string, unknown>)[f]))
      expect(offen.length, 'nothing marked "offen"').toBeGreaterThan(0)
      projectSchema.parse(project)
      return `${read.text.length} chars in ${counts.length} updates; text first; offen: ${offen.join(', ')}`
    }))
})

// ---------------------------------------------------------------- 6. step 2 (step 16)

describe('6 · step 2: problem tree per focus group (made-up project)', () => {
  /** demo.ts with step 1 confirmed: two focus groups and one other group, step 2 empty. */
  function step2Start(): Project {
    const p = demoProject()
    p.steps[1].block = {
      challenge: makeItem(1, 'challenge', { text: 'Jugendliche aus der Weidengrund-Siedlung kommen selten aus ihrer Siedlung heraus.', why: 'Aus Schritt 0.' }),
      targetGroups: [
        makeItem(1, 'targetGroups', { name: 'Jugendliche 12–17', description: 'Kommen nach der Schule in die offene Werkstatt, viele ohne eigenes Rad.', isFocus: true, why: 'Hauptwirkung.' }, { id: 'tg1' }),
        makeItem(1, 'targetGroups', { name: 'Mädchen 11–14', description: 'Kommen seltener, schauen oft erst zu.', isFocus: true, why: 'Sollen gezielt erreicht werden.' }, { id: 'tg2' }),
        makeItem(1, 'targetGroups', { name: 'Eltern', description: 'Erlauben das Kommen.', reach: 'indirect', why: 'Ohne sie kommen die Jüngeren nicht.' }, { id: 'tg3' }),
      ],
      stakeholders: [],
    } as never
    p.steps[1].status = 'confirmed'
    p.steps[1].confirmed = { at: AT, block: structuredClone(p.steps[1].block) as never, basis: { 0: AT } }
    p.idCounters = { ...p.idCounters, tg: 3 }
    return projectSchema.parse(p)
  }

  it('a first proposal for one focus group: valid groupIds, a cause of a cause via parentId, text and a question first', () =>
    check('Step 2: problem tree proposal valid (groupId, parentId, ≤ 3 levels), text + question first', async () => {
      const text = 'Fang mit den Jugendlichen an: Schlag mir das Kernproblem und ein paar Ursachen vor. Eine davon liegt tiefer: Reparaturen sind für die Familien zu teuer, deshalb fahren viele kein Rad.'
      const prepared = prepareTurn(step2Start(), 2, text, { at: AT })
      rec.recordNext('step2-tree')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      writeFileSync(`${FIXTURES}step2-tree.json`, JSON.stringify({ step: 2, project: prepared.project }, null, 2))
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use' && b.name === PROPOSE)
      expect(firstTool, 'no proposal').toBeGreaterThan(-1)
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no question before the card').toContain('?')
      let project = commitAnswer(prepared.project, 2, { status: 'done', message }, prepared.shown, { at: AT })
      const errors = project.steps[2].segments.at(-1)!.messages.at(-1)!.toolErrors
      const [proposal] = project.steps[2].proposals
      expect(proposal, `no valid propose_changes call ${JSON.stringify(errors ?? {})}`).toBeDefined()
      project = reducer(project, { type: 'change/applyAll', step: 2, proposalId: proposal.id })
      const block = project.steps[2].block
      expect(block.problems.filter((x) => x.groupId === 'tg1'), 'no core problem for the group').toHaveLength(1)
      expect(block.causes.length, 'no causes').toBeGreaterThan(1)
      expect(block.causes.every((c) => c.groupId === 'tg1'), 'causes for another group').toBe(true)
      const nested = block.causes.filter((c) => c.parentId)
      expect(nested.length, 'no cause of a cause').toBeGreaterThan(0)
      projectSchema.parse(project)
      const evidence = [...new Set(block.causes.map((c) => c.evidence))].join('/')
      after = project
      return `${proposal.changes.length} changes; ${block.causes.length} causes (${nested.length} nested), ${block.consequences.length} consequences; evidence ${evidence}; question: ${textBefore.split('\n').filter((l) => l.includes('?')).at(-1)!.slice(0, 90)}`
    }))

  // The step 16 PO run: a big second proposal came as a card with no text, and the challenge
  // was added as a consequence (the app shows it above Folgen itself).
  let after: Project | undefined
  it('a big follow-up proposal: text + question first; the challenge is never a consequence', () =>
    check('Step 2 follow-up: second group + consequences, text first, no challenge as a consequence', async () => {
      expect(after, 'needs the first step 2 case').toBeDefined()
      const text = 'Ja, das trifft es. Jetzt die Mädchen: Sie trauen sich nicht an das Werkzeug, wenn viele Jungen da sind. Und bitte auch Folgen für beide Gruppen und ein Kernproblem für die Eltern.'
      const prepared = prepareTurn(after!, 2, text, { at: AT })
      rec.recordNext('step2-followup')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use' && b.name === PROPOSE)
      expect(firstTool, 'no proposal').toBeGreaterThan(-1)
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no question before the card').toContain('?')
      let project = commitAnswer(prepared.project, 2, { status: 'done', message }, prepared.shown, { at: AT })
      const [, proposal] = project.steps[2].proposals
      expect(proposal, `no valid propose_changes call ${JSON.stringify(project.steps[2].segments.at(-1)!.messages.at(-1)!.toolErrors ?? {})}`).toBeDefined()
      project = reducer(project, { type: 'change/applyAll', step: 2, proposalId: proposal.id })
      const block = project.steps[2].block
      const challenge = project.steps[1].block.challenge.text
      const echo = block.consequences.filter((c) => /Herausforderung/i.test(c.text) || c.text.includes(challenge.slice(0, 40)))
      expect(echo.map((c) => c.text), 'the challenge was added as a consequence').toEqual([])
      expect(block.consequences.length, 'no consequences').toBeGreaterThan(1)
      expect(new Set(block.consequences.map((c) => c.groupId)).size, 'consequences for one group only').toBe(2)
      projectSchema.parse(project)
      return `${proposal.changes.length} changes; ${block.consequences.length} consequences; text first (${textBefore.length} chars): ${textBefore.split('\n').filter((l) => l.includes('?')).at(-1)!.slice(0, 90)}`
    }))
})

/** An item id in Claude's chat text (step 17 contract run: "ein funktionierendes Rad (ca1)"). Lukas never sees ids. */
const SHOWN_ID = /\b(?:tg|sh|pb|ca|co|go|na|new:)\d+\b/g

describe('7 · step 3: goals per focus group (made-up project)', () => {
  /** demo.ts with steps 1 and 2 confirmed: one focus group with a small problem tree, one other group. */
  function step3Start(): Project {
    const p = demoProject()
    p.steps[1].block = {
      challenge: makeItem(1, 'challenge', { text: 'Jugendliche aus der Weidengrund-Siedlung kommen selten aus ihrer Siedlung heraus.', why: 'Aus Schritt 0.' }),
      targetGroups: [
        makeItem(1, 'targetGroups', { name: 'Jugendliche 12–17', description: 'Kommen nach der Schule in die offene Werkstatt, viele ohne eigenes Rad.', isFocus: true, why: 'Hauptwirkung.' }, { id: 'tg1' }),
        makeItem(1, 'targetGroups', { name: 'Eltern', description: 'Erlauben das Kommen.', reach: 'indirect', why: 'Ohne sie kommen die Jüngeren nicht.' }, { id: 'tg2' }),
      ],
      stakeholders: [],
    } as never
    const cause = (id: string, parentId: string, text: string, notInfluenceable = false) =>
      makeItem(2, 'causes', { groupId: 'tg1', parentId, text, evidence: 'eigene_erfahrung', notInfluenceable, why: 'Beobachtung in der Werkstatt.' }, { id })
    p.steps[2].block = {
      problems: [
        makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Jugendliche aus der Siedlung verbringen die Nachmittage drinnen und erleben selten, dass sie etwas selbst schaffen.', why: 'Erzählen sie selbst.' }, { id: 'pb1' }),
        makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Eltern wissen wenig darüber, was ihre Kinder nachmittags lernen.', why: 'Fragen beim Sommerfest.' }, { id: 'pb2' }),
      ],
      causes: [
        cause('ca1', '', 'Viele haben kein funktionierendes Rad.'),
        cause('ca2', 'ca1', 'Reparaturen sind für die Familien zu teuer.'),
        cause('ca3', 'ca2', 'Viele Familien leben von Sozialleistungen.', true),
        cause('ca4', '', 'Kaum Erwachsene zeigen ihnen handwerkliche Dinge.'),
      ],
      consequences: [makeItem(2, 'consequences', { groupId: 'tg1', parentId: '', text: 'Sie trauen sich wenig zu.' }, { id: 'co1' })],
    } as never
    for (const step of [1, 2] as const) {
      p.steps[step].status = 'confirmed'
      p.steps[step].confirmed = { at: AT, block: structuredClone(p.steps[step].block) as never, basis: { 0: AT } }
    }
    p.idCounters = { ...p.idCounters, tg: 2, pb: 2, ca: 4, co: 1 }
    return projectSchema.parse(p)
  }

  let after: Project | undefined
  it('goals for the focus group: links only to its causes, levels 4–6, text and a question first', () =>
    check('Step 3: goals proposal valid (causeIds of the group, levels), text + question first', async () => {
      const text = 'Fang mit den Jugendlichen an. Wir setzen beim fehlenden Rad und beim fehlenden Handwerk an, nicht beim Geld der Familien. Schlag mir Ziele für die Stufen 6, 5 und 4 vor.'
      const prepared = prepareTurn(step3Start(), 3, text, { at: AT })
      rec.recordNext('step3-goals')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      writeFileSync(`${FIXTURES}step3-goals.json`, JSON.stringify({ step: 3, project: prepared.project }, null, 2))
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use' && b.name === PROPOSE)
      expect(firstTool, 'no proposal').toBeGreaterThan(-1)
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no question before the card').toContain('?')
      expect(textBefore.match(SHOWN_ID) ?? [], 'ids in the visible text').toEqual([])
      let project = commitAnswer(prepared.project, 3, { status: 'done', message }, prepared.shown, { at: AT })
      const [proposal] = project.steps[3].proposals
      expect(proposal, `no valid propose_changes call ${JSON.stringify(project.steps[3].segments.at(-1)!.messages.at(-1)!.toolErrors ?? {})}`).toBeDefined()
      project = reducer(project, { type: 'change/applyAll', step: 3, proposalId: proposal.id })
      const goals = project.steps[3].block.goals.filter((g) => g.groupId === 'tg1')
      expect(new Set(goals.map((g) => g.level)), 'not all three levels').toEqual(new Set([4, 5, 6]))
      expect(goals.every((g) => g.causeIds.length > 0), 'a focus goal without a cause').toBe(true)
      expect(goals.some((g) => g.causeIds.includes('ca3')), 'a goal on the not influenceable cause').toBe(false)
      projectSchema.parse(project)
      after = project
      const links = goals.map((g) => `${g.level}:${g.causeIds.join('+')}`).join(' ')
      return `${proposal.changes.length} changes; goals ${links}; time frames ${goals.filter((g) => g.timeFrame).length}/${goals.length}; question: ${textBefore.split('\n').filter((l) => l.includes('?')).at(-1)!.slice(0, 90)}`
    }))

  // Guide 00 §7: a gap in an earlier step is named and offered as "[Zu Schritt 2](#schritt-2)".
  it('a goal without a matching cause: Claude offers the link to step 2 instead of an unlinked goal', () =>
    check('Step 3: gap in step 2 → "[Zu Schritt 2](#schritt-2)" in the text', async () => {
      expect(after, 'needs the first step 3 case').toBeDefined()
      const text = 'Passt so weit. Uns ist noch wichtig, dass sich die Jugendlichen in der Werkstatt sicher und willkommen fühlen. Mach daraus bitte auch ein Ziel.'
      const prepared = prepareTurn(after!, 3, text, { at: AT })
      rec.recordNext('step3-gap')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      const visible = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(visible, 'no step link').toContain('(#schritt-2)')
      expect(visible.match(SHOWN_ID) ?? [], 'ids in the visible text').toEqual([])
      const project = commitAnswer(prepared.project, 3, { status: 'done', message }, prepared.shown, { at: AT })
      projectSchema.parse(project)
      const line = visible.split('\n').find((l) => l.includes('#schritt-2'))!
      return `link: ${line.slice(0, 120)}; proposal: ${project.steps[3].proposals.length > 1 ? 'yes' : 'no'}`
    }))
})

describe('8 · step 4: the chain of one focus group (made-up project)', () => {
  /** demo.ts with steps 1–3 confirmed: one focus group with goals at 4–6, its causes, one other group; step 4 has the activities. */
  function step4Start(): Project {
    const p = demoProject()
    p.steps[1].block = {
      challenge: makeItem(1, 'challenge', { text: 'Jugendliche aus der Weidengrund-Siedlung kommen selten aus ihrer Siedlung heraus.', why: 'Aus Schritt 0.' }),
      targetGroups: [
        makeItem(1, 'targetGroups', { name: 'Jugendliche 12–17', description: 'Kommen nach der Schule in die offene Werkstatt, viele ohne eigenes Rad.', isFocus: true, why: 'Hauptwirkung.' }, { id: 'tg1' }),
        makeItem(1, 'targetGroups', { name: 'Eltern', description: 'Erlauben das Kommen.', reach: 'indirect', why: 'Ohne sie kommen die Jüngeren nicht.' }, { id: 'tg2' }),
      ],
      stakeholders: [],
    } as never
    p.steps[2].block = {
      problems: [
        makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Jugendliche aus der Siedlung verbringen die Nachmittage drinnen und erleben selten, dass sie etwas selbst schaffen.', why: 'Erzählen sie selbst.' }, { id: 'pb1' }),
        makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Eltern wissen wenig darüber, was ihre Kinder nachmittags lernen.', why: 'Fragen beim Sommerfest.' }, { id: 'pb2' }),
      ],
      causes: [
        makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Viele haben kein funktionierendes Rad.', evidence: 'eigene_erfahrung', why: 'Beobachtung.' }, { id: 'ca1' }),
        makeItem(2, 'causes', { groupId: 'tg1', parentId: 'ca1', text: 'Der Bus fährt nachmittags nur stündlich.', evidence: 'eigene_daten', notInfluenceable: true, why: 'Fahrplan.' }, { id: 'ca2' }),
        makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Kaum Erwachsene zeigen ihnen handwerkliche Dinge.', evidence: 'unsicher', why: 'Vermutung.' }, { id: 'ca3' }),
      ],
      consequences: [],
    } as never
    const goal = (id: string, level: 4 | 5 | 6, text: string, causeIds: string[]) => makeItem(3, 'goals', { groupId: 'tg1', level, text, causeIds, timeFrame: 'bis Ende 2027', why: 'Aus dem Problembaum.' }, { id })
    p.steps[3].block = {
      goals: [
        goal('go1', 4, 'Die Jugendlichen können einen Platten flicken und die Bremsen einstellen.', ['ca3']),
        goal('go2', 5, 'Die Jugendlichen reparieren ihr Rad selbst, statt es stehen zu lassen.', ['ca1', 'ca3']),
        goal('go3', 6, 'Die Jugendlichen sind nachmittags mit dem eigenen Rad unterwegs.', ['ca1']),
        makeItem(3, 'goals', { groupId: 'tg2', level: 4, text: 'Eltern wissen, was ihre Kinder in der Werkstatt lernen.', causeIds: [], timeFrame: 'bis Ende 2026', why: 'Dann lassen sie die Jüngeren kommen.' }, { id: 'go4' }),
      ],
      levelNotApplicable: [],
      level7: makeItem(3, 'level7', { text: 'Das Projekt trägt dazu bei, dass Jugendliche in der Siedlung eigene Wege gehen.', why: 'Aus der Herausforderung.' }, { id: 'level7' }),
    } as never
    p.steps[4].block = {
      resources: [makeItem(4, 'resources', { text: 'Zwei Ehrenamtliche aus dem Fahrradclub' }, { id: 'rs1' }), makeItem(4, 'resources', { text: 'Kellerraum mit Werkbank' }, { id: 'rs2' })],
      activities: [
        makeItem(4, 'activities', { text: 'Offene Werkstatt dienstags und donnerstags, 15–18 Uhr', why: 'Damit die Jugendlichen einen festen Ort zum Schrauben haben.' }, { id: 'ac1' }),
        makeItem(4, 'activities', { text: 'Elternbrief zu Beginn des Halbjahrs', why: 'Damit die Eltern wissen, was ihre Kinder lernen.' }, { id: 'ac2' }),
      ],
      outputs: [],
      links: [],
      externalFactors: [],
      sideEffects: [],
    } as never
    for (const step of [1, 2, 3] as const) {
      p.steps[step].status = 'confirmed'
      p.steps[step].confirmed = { at: AT, block: structuredClone(p.steps[step].block) as never, basis: { 0: AT } }
    }
    p.idCounters = { ...p.idCounters, tg: 2, pb: 2, ca: 3, go: 4, rs: 2, ac: 2 }
    return projectSchema.parse(p)
  }

  let after: Project | undefined
  it('the chain for the focus group: outputs 1–3, links upwards to its goals, "weil" and assumption, ≤ 2 critical, text first', () =>
    check('Step 4: chain proposal valid (own group, upwards, ends at goals), text + question first, no ids', async () => {
      const text = 'Die Aktivitäten stimmen so. Schlag mir jetzt die Kette für die Jugendlichen vor.'
      const prepared = prepareTurn(step4Start(), 4, text, { at: AT })
      rec.recordNext('step4-chain')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      writeFileSync(`${FIXTURES}step4-chain.json`, JSON.stringify({ step: 4, project: prepared.project }, null, 2))
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use' && b.name === PROPOSE)
      expect(firstTool, 'no proposal').toBeGreaterThan(-1)
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no question before the card').toContain('?')
      expect(textBefore.match(SHOWN_ID_4) ?? [], 'ids in the visible text').toEqual([])
      let project = commitAnswer(prepared.project, 4, { status: 'done', message }, prepared.shown, { at: AT })
      const [proposal] = project.steps[4].proposals
      expect(proposal, `no valid propose_changes call ${JSON.stringify(project.steps[4].segments.at(-1)!.messages.at(-1)!.toolErrors ?? {})}`).toBeDefined()
      project = reducer(project, { type: 'change/applyAll', step: 4, proposalId: proposal.id })
      const { outputs, links } = project.steps[4].block
      expect(new Set(outputs.filter((o) => o.groupId === 'tg1').map((o) => o.level)), 'not all three output levels').toEqual(new Set([1, 2, 3]))
      expect(links.length, 'no links').toBeGreaterThan(0)
      expect(links.every((l) => l.because.trim() && l.assumption.trim()), 'a link without "weil" or assumption').toBe(true)
      expect(links.filter((l) => l.critical).length, 'more than 2 critical').toBeLessThanOrEqual(2)
      expect(links.some((l) => ['go1', 'go2', 'go3'].includes(l.toId)), 'no link reaches a goal').toBe(true)
      projectSchema.parse(project)
      after = project
      const chain = links.map((l) => `${l.fromId}→${l.toId}${l.critical ? '!' : ''}`).join(' ')
      return `${proposal.changes.length} changes; ${outputs.length} outputs; links ${chain}; question: ${textBefore.split('\n').filter((l) => l.includes('?')).at(-1)!.slice(0, 90)}`
    }))

  it('external factors and side effects: for all or the focus group, text first', () =>
    check('Step 4: factors (groupId "" or tg1) and side effects with direction, text first', async () => {
      expect(after, 'needs the first step 4 case').toBeDefined()
      const text = 'Passt. Was wirkt außer uns noch auf die Kette, und was könnte nebenbei passieren?'
      const prepared = prepareTurn(after!, 4, text, { at: AT })
      rec.recordNext('step4-surroundings')
      const message = done(await ai.send(settings, prepared.call))
      await rec.flushed()
      const firstTool = message.content.findIndex((b) => b.type === 'tool_use' && b.name === PROPOSE)
      expect(firstTool, 'no proposal').toBeGreaterThan(-1)
      const textBefore = message.content.slice(0, firstTool).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      expect(textBefore, 'no question before the card').toContain('?')
      expect(textBefore.match(SHOWN_ID_4) ?? [], 'ids in the visible text').toEqual([])
      let project = commitAnswer(prepared.project, 4, { status: 'done', message }, prepared.shown, { at: AT })
      const proposal = project.steps[4].proposals.at(-1)!
      expect(project.steps[4].proposals.length, `no valid propose_changes call ${JSON.stringify(project.steps[4].segments.at(-1)!.messages.at(-1)!.toolErrors ?? {})}`).toBe(2)
      project = reducer(project, { type: 'change/applyAll', step: 4, proposalId: proposal.id })
      const { externalFactors, sideEffects } = project.steps[4].block
      expect(externalFactors.length, 'no external factor').toBeGreaterThan(0)
      expect(externalFactors.every((f) => !f.groupId || f.groupId === 'tg1'), 'a factor for a non-focus group').toBe(true)
      expect(sideEffects.length, 'no side effect').toBeGreaterThan(0)
      projectSchema.parse(project)
      const bus = externalFactors.some((f) => /bus/i.test(f.text))
      return `${externalFactors.length} factors (${externalFactors.map((f) => f.groupId || 'alle').join(', ')}; bus named: ${bus}); ${sideEffects.length} side effects (${sideEffects.map((s) => s.direction).join(', ')})`
    }))
})

const SHOWN_ID_4 = /\b(?:tg|sh|pb|ca|co|go|na|rs|ac|ou|li|ef|se|new:)\d+\b/g
