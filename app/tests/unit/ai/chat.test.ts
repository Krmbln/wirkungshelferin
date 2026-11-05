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
