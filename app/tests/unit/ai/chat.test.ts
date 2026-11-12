// @vitest-environment node
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { chatCall, commitAnswer, prepareRetry, prepareTurn, unanswered, type Prepared } from '../../../src/ai/chat'
import type { SendResult } from '../../../src/ai/client'
import { lukasText } from '../../../src/ai/prompt'
import { MAX_TOKENS } from '../../../src/ai/request'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import { defaultSettings } from '../../../src/storage/settings'
import { dummyKey } from '../../dummyKey'
import { fixtureState, pacedClient, replayClient } from '../../replay'

// One chat turn end to end on the recorded streams (implementation plan step 9): Lukas's turn
// is stored first, the answer is appended, stopped answers never reach a later request.

const settings = { ...defaultSettings, apiKey: dummyKey }
const AT = '2026-11-06T10:00:00.000Z'
let n = 0
const meta = { at: AT, newId: () => `id${++n}` }
const start = () => projectSchema.parse(fixtureState('step1-opening')!.project)
const messagesOf = (p: Project) => p.steps[1].segments.flatMap((s) => s.messages)
const blocks = (m: BetaMessageParam) => m.content as BetaContentBlockParam[]

async function answer(prepared: Prepared, client = replayClient('step1-opening')) {
  return client.send(settings, prepared.call)
}

function commit(prepared: Prepared, result: SendResult) {
  if (result.status === 'failed') throw new Error(result.problem)
  return commitAnswer(prepared.project, 1, result, prepared.shown, meta)
}

/** Every tool_use in the request has its tool_result in the next message (no orphan). */
function expectNoOrphans(messages: BetaMessageParam[]) {
  messages.forEach((m, i) => {
    if (m.role !== 'assistant') return
    for (const use of blocks(m).filter((b) => b.type === 'tool_use')) {
      const next = messages[i + 1]
      expect(next && blocks(next).some((b) => b.type === 'tool_result' && b.tool_use_id === (use as { id: string }).id)).toBe(true)
    }
  })
}

describe('prepareTurn', () => {
  it('stores the first turn with context, text and full snapshot, and sends it with the chat options', () => {
    const project = start()
    const before = structuredClone(project)
    const { project: next, call } = prepareTurn(project, 1, 'Hallo, wir starten.', meta)
    expect(project).toEqual(before)
    const [turn] = messagesOf(next)
    expect(turn.role).toBe('user')
    expect(turn.content.map((b) => (b.text as string).split('\n')[0])).toEqual(['[Projektstand]', 'Hallo, wir starten.', '[Bausteinstand Schritt 1]'])
    expect(lukasText(turn)).toBe('Hallo, wir starten.')
    expect(next.steps[1].sentBlock).toEqual(project.steps[1].block)
    expect(call.maxTokens).toBe(MAX_TOKENS.chat)
    expect(call.tools?.map((t) => t.name)).toEqual(['propose_changes', 'report_quality_check'])
    expect(call.messages).toHaveLength(1)
    expect(blocks(call.messages[0]).at(-1)).toMatchObject({ cache_control: { type: 'ephemeral', ttl: '1h' } })
    projectSchema.parse(next)
  })

  it('later turns say "unverändert" until the block changes, and carry no second context', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    let project = commit(first, await answer(first))
    const second = prepareTurn(project, 1, 'Weiter.', meta)
    const turn = messagesOf(second.project).at(-1)!
    expect(turn.content.at(-1)!.text).toBe('[Baustein unverändert]')
    expect(turn.content.some((b) => String(b.text ?? '').startsWith('[Projektstand]'))).toBe(false)

    project = reducer(second.project, { type: 'change/applyAll', step: 1, proposalId: 'p1' })
    const third = prepareTurn(project, 1, 'Und jetzt?', meta)
    expect(String(messagesOf(third.project).at(-1)!.content.at(-1)!.text)).toMatch(/^\[Bausteinstand Schritt 1\]/)
  })

  it('a hand edit sends the full snapshot with the short id, the new rev and editedByUser (step 11)', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    let project = commit(first, await answer(first))
    project = reducer(project, { type: 'change/applyAll', step: 1, proposalId: 'p1' })
    project = prepareTurn(project, 1, 'Übernommen.', meta).project
    const group = project.steps[1].block.targetGroups[0]
    project = reducer(project, { type: 'item/edit', step: 1, collection: 'targetGroups', id: group.id, fields: { name: 'Von Hand umbenannt' } })

    const edited = prepareTurn(project, 1, 'Ich habe etwas geändert.', meta)
    const snapshot = String(messagesOf(edited.project).at(-1)!.content.at(-1)!.text)
    const line = snapshot.split('\n').find((l) => l.includes('Von Hand umbenannt'))!
    expect(JSON.parse(line.slice(2))).toMatchObject({ id: group.id, rev: group.rev + 1, editedByUser: true, name: 'Von Hand umbenannt' })

    const again = prepareTurn(edited.project, 1, 'Und weiter.', meta)
    expect(messagesOf(again.project).at(-1)!.content.at(-1)!.text).toBe('[Baustein unverändert]')
  })
})

/** Step 0 confirmed with this project name: another step changing while the step 1 chat runs. */
function confirmStep0(p: Project, name: string, at = '2026-11-06T11:00:00.000Z'): Project {
  const next = structuredClone(p)
  const s0 = next.steps[0]
  ;(s0.block as { profile: { name: string } }).profile.name = name
  s0.status = 'confirmed'
  s0.confirmed = { at, block: structuredClone(s0.block), basis: {} }
  return next
}

const texts = (p: Project) => messagesOf(p).at(-1)!.content.map((b) => String(b.text ?? ''))
const updates = (p: Project) => texts(p).filter((t) => t.startsWith('[Projektstand aktualisiert]'))

// Step 25a: a step confirmed while this chat ran stayed "noch nicht begonnen" for Claude.
describe('the other steps change mid-segment', () => {
  it('the next turn carries "[Projektstand aktualisiert]" with the new state, before Lukas’s text', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    const project = confirmStep0(commit(first, await answer(first)), 'Sprachcafé Nordstadt')
    const next = prepareTurn(project, 1, 'Schritt 0 ist jetzt bestätigt.', meta)
    const [update] = updates(next.project)
    expect(update).toMatch(/^\[Projektstand aktualisiert\]\nDie anderen Schritte, wie sie jetzt sind\. Dieser Stand ersetzt jeden früheren\./)
    expect(update).toContain('## Schritt 0 (bestätigt am 2026-11-06)')
    expect(update).toContain('Sprachcafé Nordstadt')
    expect(texts(next.project).slice(-2)).toEqual(['Schritt 0 ist jetzt bestätigt.', '[Baustein unverändert]'])
    expect(lukasText(messagesOf(next.project).at(-1)!)).toBe('Schritt 0 ist jetzt bestätigt.')
    // Stored inside the new turn and sent with it; the stored history before it is untouched (append-only).
    expect(JSON.stringify(next.call.messages.at(-1))).toContain('[Projektstand aktualisiert]')
    expect(messagesOf(next.project).slice(0, -1)).toEqual(messagesOf(project))
  })

  it('no change, no update — and after an update the same state isn’t sent again', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    let project = commit(first, await answer(first))
    const same = prepareTurn(project, 1, 'Weiter.', meta)
    expect(updates(same.project)).toEqual([])

    project = commit(same, await answer(same))
    const changed = prepareTurn(confirmStep0(project, 'Sprachcafé Nordstadt'), 1, 'Bestätigt.', meta)
    expect(updates(changed.project)).toHaveLength(1)
    project = commit(changed, await answer(changed))
    const after = prepareTurn(project, 1, 'Und jetzt?', meta)
    expect(updates(after.project)).toEqual([])
  })

  it('a second change sends a second update; only the newest block is compared', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    let project = commit(first, await answer(first))
    const one = prepareTurn(confirmStep0(project, 'Name eins'), 1, 'Eins.', meta)
    project = commit(one, await answer(one))
    const two = prepareTurn(confirmStep0(project, 'Name zwei'), 1, 'Zwei.', meta)
    expect(updates(two.project)).toHaveLength(1)
    expect(updates(two.project)[0]).toContain('Name zwei')
    expect(updates(two.project)[0]).not.toContain('Name eins')
    // Back to the first state: it differs from the newest block, so it goes out again.
    project = commit(two, await answer(two))
    const back = prepareTurn(confirmStep0(project, 'Name eins'), 1, 'Doch eins.', meta)
    expect(updates(back.project)[0]).toContain('Name eins')
  })

  it('a new segment’s first context (with the summary after it) counts as current: no update next turn', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    let project = confirmStep0(commit(first, await answer(first)), 'Sprachcafé Nordstadt')
    const rolled = prepareTurn(project, 1, 'Weiter.', { ...meta, newSegment: { summary: 'Kurz zusammengefasst.' } })
    expect(updates(rolled.project)).toEqual([])
    expect(texts(rolled.project).find((t) => t.startsWith('[Projektstand]'))).toContain('Sprachcafé Nordstadt')
    project = commit(rolled, await answer(rolled))
    const next = prepareTurn(project, 1, 'Und weiter.', meta)
    expect(updates(next.project)).toEqual([])
  })

  it('app turns (the check request) carry the update too', async () => {
    const first = prepareTurn(start(), 1, 'Hallo.', meta)
    const project = confirmStep0(commit(first, await answer(first)), 'Sprachcafé Nordstadt')
    const check = prepareTurn(project, 1, '[App] Bitte prüfe den Baustein.', meta)
    expect(updates(check.project)).toHaveLength(1)
  })
})

describe('commitAnswer', () => {
  it('stores the answer unchanged, thinking signature included, and its proposal', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const result = await answer(prepared)
    if (result.status !== 'done') throw new Error(result.status)
    const project = commit(prepared, result)
    const stored = messagesOf(project).at(-1)!
    expect(stored.role).toBe('assistant')
    expect(stored.content).toEqual(JSON.parse(JSON.stringify(result.message.content)))
    expect(stored.content.find((b) => b.type === 'thinking')?.signature).toBeTruthy()
    expect(project.steps[1].proposals.map((p) => p.toolUseId)).toEqual(
      result.message.content.filter((b) => b.type === 'tool_use').map((b) => (b as { id: string }).id),
    )
    projectSchema.parse(project)
  })

  it('answers the proposal in the next turn with Lukas’s decisions', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const project = commit(prepared, await answer(prepared))
    const next = prepareTurn(project, 1, 'Danke.', meta)
    const results = messagesOf(next.project).at(-1)!.content.filter((b) => b.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0].tool_use_id).toBe(project.steps[1].proposals[0].toolUseId)
    expect(results[0].content).toMatch(/offen/)
    expectNoOrphans(next.call.messages)
  })

  it('keeps an invalid tool call’s errors and sends them as an error result next turn', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const result = await answer(prepared)
    if (result.status !== 'done') throw new Error(result.status)
    const use = result.message.content.find((b) => b.type === 'tool_use')!
    const broken = { ...result, message: { ...result.message, content: result.message.content.map((b) => (b === use ? { ...use, input: { summary: 'x' } } : b)) } }
    const project = commit(prepared, broken)
    expect(project.steps[1].proposals).toHaveLength(0)
    expect(Object.keys(messagesOf(project).at(-1)!.toolErrors ?? {})).toEqual([(use as { id: string }).id])
    const next = prepareTurn(project, 1, 'Und?', meta)
    const [error] = messagesOf(next.project).at(-1)!.content.filter((b) => b.type === 'tool_result')
    expect(error).toMatchObject({ is_error: true, tool_use_id: (use as { id: string }).id })
    expectNoOrphans(next.call.messages)
  })
})

describe('Stopp', () => {
  // Abort as soon as a block of the given type starts streaming.
  async function stopAt(fixture: string, type: 'thinking' | 'tool_use') {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const controller = new AbortController()
    const result = await pacedClient(fixture).send(settings, prepared.call, {
      signal: controller.signal,
      onEvent: (e) => e.type === 'content_block_start' && e.content_block.type === type && setTimeout(() => controller.abort(), 0),
    })
    expect(result.status).toBe('aborted')
    return commit(prepared, result)
  }

  it.each([
    ['step1-stopped-thinking', 'thinking'],
    ['step1-stopped-tool', 'tool_use'],
  ] as const)('%s: stored as "abgebrochen", left out of the next request', async (fixture, type) => {
    const project = await stopAt(fixture, type)
    const stopped = messagesOf(project).at(-1)!
    expect(stopped).toMatchObject({ role: 'assistant', aborted: true })
    expect(stopped.content.some((b) => b.type === type)).toBe(true)
    expect(project.steps[1].proposals).toHaveLength(0)
    expect(unanswered(project, 1)).toBe(false)

    const next = prepareTurn(project, 1, 'Weiter.', meta)
    const sent = next.call.messages.flatMap(blocks)
    // No incomplete thinking and no tool_use without a result reach the API.
    expect(sent.some((b) => b.type === 'thinking' || b.type === 'tool_use')).toBe(false)
    expect(sent.some((b) => b.type === 'tool_result')).toBe(false)
    expect(next.call.messages.map((m) => m.role)).toEqual(['user', 'user'])
    projectSchema.parse(next.project)
  })
})

describe('failed turns and "Erneut versuchen"', () => {
  it('Lukas’s turn stays stored; the retry sends exactly the same request and stores nothing new', () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    expect(unanswered(prepared.project, 1)).toBe(true)
    const retry = prepareRetry(prepared.project, 1)!
    expect(retry.project).toBe(prepared.project)
    expect(retry.call).toEqual(prepared.call)
    expect(retry.shown).toEqual(prepared.shown)
  })

  it('there is nothing to retry after an answer or a stop', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const project = commit(prepared, await answer(prepared))
    expect(prepareRetry(project, 1)).toBeUndefined()
    expect(prepareRetry(start(), 1)).toBeUndefined()
  })
})

describe('append-only history', () => {
  it('no stored message is ever changed by later turns, stops or retries', async () => {
    let project = start()
    const snapshots: string[] = []
    const keep = () => snapshots.push(...messagesOf(project).slice(snapshots.length).map((m) => JSON.stringify(m)))
    const expectPrefix = () => expect(messagesOf(project).slice(0, snapshots.length).map((m) => JSON.stringify(m))).toEqual(snapshots)

    let prepared = prepareTurn(project, 1, 'Eins.', meta)
    project = commit(prepared, await answer(prepared))
    keep()
    project = reducer(project, { type: 'change/applyAll', step: 1, proposalId: 'p1' })
    prepared = prepareTurn(project, 1, 'Zwei.', meta)
    project = prepared.project
    expectPrefix()
    keep()
    project = prepareRetry(project, 1)!.project
    project = commit({ ...prepared, project }, { status: 'aborted' })
    expectPrefix()
    keep()
    prepared = prepareTurn(project, 1, 'Drei.', meta)
    project = commit(prepared, await answer(prepared, replayClient('step1-update')))
    expectPrefix()
    // The request is always the stored history, in order.
    expect(chatCall(project, 1).messages.length).toBe(messagesOf(project).filter((m) => !m.aborted).length)
  })
})

describe('new segment (step 10)', () => {
  it('starts a segment that carries the summary; open tool calls of the old one become app lines', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', { ...meta, model: 'claude-opus-5-5' })
    const project = commit(prepared, await answer(prepared))
    const old = structuredClone(project.steps[1].segments[0])
    expect(old.model).toBe('claude-opus-5-5')

    const next = prepareTurn(project, 1, 'Weiter geht’s.', { ...meta, model: 'claude-sonnet-5-5', newSegment: { summary: 'Die Person leitet eine Fahrradwerkstatt.' } })
    const segments = next.project.steps[1].segments
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual(old)
    expect(segments[1]).toMatchObject({ model: 'claude-sonnet-5-5', summaryOfPrevious: 'Die Person leitet eine Fahrradwerkstatt.' })

    // Only the new segment is sent: one user turn, no tool_result (no tool_use to answer).
    expect(next.call.messages).toHaveLength(1)
    const content = blocks(next.call.messages[0])
    expect(content.some((b) => b.type === 'tool_result')).toBe(false)
    const texts = content.map((b) => (b as { text: string }).text)
    expect(texts[0]).toMatch(/^\[App\] Zu deinem letzten Werkzeugaufruf im vorigen Abschnitt: .*offen/s)
    expect(texts[1]).toMatch(/^\[Projektstand\]/)
    expect(texts[1]).toMatch(/\[Bisheriges Gespräch in diesem Schritt, zusammengefasst\]\nDie Person leitet eine Fahrradwerkstatt\./)
    expect(texts.at(-2)).toBe('Weiter geht’s.')
    expect(texts.at(-1)).toMatch(/^\[Bausteinstand Schritt 1\]/)
    expectNoOrphans(next.call.messages)
    expect(lukasText(messagesOf(next.project).at(-1)!)).toBe('Weiter geht’s.')
  })

  it('without a summary the new segment says the old conversation is gone', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const project = commit(prepared, await answer(prepared))
    const next = prepareTurn(project, 1, 'Und jetzt?', { ...meta, model: 'claude-sonnet-5-5', newSegment: {} })
    expect(next.project.steps[1].segments[1].summaryOfPrevious).toBeUndefined()
    expect(JSON.stringify(next.call.messages)).toMatch(/liegt dir nicht vor/)
  })

  it('a complete answer keeps its token usage; a stopped one has none', async () => {
    const prepared = prepareTurn(start(), 1, 'Hallo.', meta)
    const result = await answer(prepared)
    if (result.status !== 'done') throw new Error(result.status)
    const project = commit(prepared, result)
    const u = result.message.usage
    expect(messagesOf(project).at(-1)!.usage).toEqual({
      prompt: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output: u.output_tokens,
    })
    const stopped = commitAnswer(prepareTurn(project, 1, 'x', meta).project, 1, { status: 'aborted' }, prepared.shown, meta)
    expect(messagesOf(stopped).at(-1)!.usage).toBeUndefined()
    expect(projectSchema.safeParse(stopped).success).toBe(true)
  })
})
