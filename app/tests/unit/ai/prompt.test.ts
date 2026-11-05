// @vitest-environment node
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import {
  MESSAGE_ORDER,
  contextText,
  historyMessages,
  nextTurn,
  pendingToolUses,
  snapshotText,
  systemPrompt,
  withCacheBreakpoint,
  type Turn,
} from '../../../src/ai/prompt'
import { stepOf } from '../../../src/domain/block'
import { demoProject } from '../../../src/domain/demo'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import type { StoredMessage } from '../../../src/domain/schemas/project'
import { stepIds } from '../../../src/domain/types'
import { guideFiles } from '../../../src/guide'

// Prompt assembly (tech design §6.2): a stable prefix and the decided order.

const result = { type: 'tool_result' as const, tool_use_id: 'toolu_1', content: 'Vorschlag p1: …' }
const turn: Turn = { pending: ['toolu_1'], toolResults: [result], events: ['Die Person hat Änderung 1 übernommen.'], text: 'Weiter.', snapshot: '[Baustein unverändert]' }

let n = 0
const msg = (role: StoredMessage['role'], content: Record<string, unknown>[], aborted?: true): StoredMessage => ({
  id: `m${++n}`,
  at: '2026-11-05T10:00:00.000Z',
  role,
  content,
  ...(aborted && { aborted }),
})
const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string) => ({ type: 'tool_use', id, name: 'propose_changes', input: {} })

describe('system prompt', () => {
  it('is the same for every project and every call (cached prefix)', () => {
    for (const step of stepIds) expect(systemPrompt(step)).toBe(systemPrompt(step))
    expect(systemPrompt(1)).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('has rules, then 00-shared, glossary and the step file, in that order', () => {
    const prompt = systemPrompt(1)
    const at = (s: string) => prompt.indexOf(s)
    expect(prompt.startsWith('# Wirkungshelferin – Bedienung der App')).toBe(true)
    expect(at('==================== 00-shared.md')).toBeGreaterThan(at('Bedienung der App'))
    expect(at('==================== glossary.md')).toBeGreaterThan(at('==================== 00-shared.md'))
    expect(at('==================== step-1-target-groups.md')).toBeGreaterThan(at('==================== glossary.md'))
    expect(prompt).toContain(guideFiles['step-1-target-groups.md'])
    expect(prompt).not.toContain(guideFiles['step-2-problem.md'])
    expect(prompt).not.toContain('<BAUSTEIN>')
  })

  it('describes the event channel of the order in use', () => {
    expect(systemPrompt(1, 'system-after')).toContain('Rolle `system`')
    expect(systemPrompt(1, 'single-user')).toContain('„[App]“')
  })
})

describe('next turn: the three orders', () => {
  it('system-between: [user: results] → [system: events] → [user: text + snapshot]', () => {
    const messages = nextTurn(turn, 'system-between')
    expect(messages.map((m) => m.role)).toEqual(['user', 'system', 'user'])
    expect(messages[0].content).toEqual([result])
    expect(messages[2].content).toEqual([text('Weiter.'), text('[Baustein unverändert]')])
  })

  it('system-after: [user: results + text + snapshot] → [system: events]', () => {
    const messages = nextTurn(turn, 'system-after')
    expect(messages.map((m) => m.role)).toEqual(['user', 'system'])
    expect(messages[0].content).toEqual([result, text('Weiter.'), text('[Baustein unverändert]')])
    expect(messages[1].content).toEqual([text('Die Person hat Änderung 1 übernommen.')])
  })

  it('single-user: results first, then the events as "[App]" text, then text + snapshot', () => {
    const [message, ...rest] = nextTurn(turn, 'single-user')
    expect(rest).toEqual([])
    expect(message.content).toEqual([result, text('[App] Die Person hat Änderung 1 übernommen.'), text('Weiter.'), text('[Baustein unverändert]')])
  })

  it('no events → no system message; the context only opens a segment', () => {
    expect(nextTurn({ pending: [], text: 'Hallo', snapshot: 's' }, 'system-after')).toEqual([{ role: 'user', content: [text('Hallo'), text('s')] }])
    expect(nextTurn({ pending: [], context: 'c', text: 'Hallo', snapshot: 's' })[0].content).toEqual([text('c'), text('Hallo'), text('s')])
  })

  it('refuses tool results that do not answer exactly the pending calls', () => {
    const base = { text: 'x', snapshot: 's' }
    const r = (id: string) => ({ ...result, tool_use_id: id })
    expect(() => nextTurn({ ...base, pending: ['t1'] })).toThrow(/don't match/)
    expect(() => nextTurn({ ...base, pending: ['t1'], toolResults: [r('t2')] })).toThrow(/don't match/)
    expect(() => nextTurn({ ...base, pending: ['t1'], toolResults: [r('t1'), r('t1')] })).toThrow(/don't match/)
    expect(() => nextTurn({ ...base, pending: [], toolResults: [r('t1')] })).toThrow(/don't match/)
    expect(nextTurn({ ...base, pending: ['t2', 't1'], toolResults: [r('t1'), r('t2')] })).toHaveLength(1)
  })

  it('uses the decided order by default', () => {
    expect(nextTurn(turn)).toEqual(nextTurn(turn, MESSAGE_ORDER))
  })
})

describe('history', () => {
  it('leaves stopped turns and local metadata out', () => {
    const stored = [msg('user', [text('a')]), msg('assistant', [{ type: 'thinking', thinking: '' }], true), msg('user', [text('b')])]
    expect(historyMessages(stored)).toEqual([
      { role: 'user', content: [text('a')] },
      { role: 'user', content: [text('b')] },
    ])
  })

  it('pending tool uses: those of the last sent assistant turn, none after a stopped one', () => {
    const answered = [msg('user', [text('a')]), msg('assistant', [text('x'), toolUse('t1'), toolUse('t2')])]
    expect(pendingToolUses(answered)).toEqual(['t1', 't2'])
    // A system message after the answer doesn't hide it.
    expect(pendingToolUses([...answered, msg('system', [text('e')])])).toEqual(['t1', 't2'])
    // The stopped turn's user message already carried the results.
    const stopped = [...answered, msg('user', [{ type: 'tool_result', tool_use_id: 't1' }]), msg('assistant', [toolUse('t3')], true)]
    expect(pendingToolUses(stopped)).toEqual([])
  })

  it('append-only: each request starts with the previous one, byte for byte', () => {
    const stored: StoredMessage[] = []
    const requests: BetaMessageParam[][] = []
    const add = (messages: Pick<StoredMessage, 'role' | 'content'>[], aborted?: true) =>
      messages.forEach((m) => stored.push(msg(m.role, m.content, aborted)))
    const send = (t: Omit<Turn, 'pending'>) => {
      add(nextTurn({ ...t, pending: pendingToolUses(stored) }))
      requests.push(historyMessages(stored))
    }
    send({ context: 'c', text: 'eins', snapshot: 's1' })
    add([{ role: 'assistant', content: [text('a'), toolUse('t1')] }])
    send({ toolResults: [{ ...result, tool_use_id: 't1' }], events: ['e'], text: 'zwei', snapshot: 's2' })
    add([{ role: 'assistant', content: [{ type: 'thinking', thinking: '' }] }], true)
    send({ text: 'drei', snapshot: '[Baustein unverändert]' })
    for (let i = 1; i < requests.length; i++) {
      expect(JSON.stringify(requests[i]).startsWith(JSON.stringify(requests[i - 1]).slice(0, -1))).toBe(true)
    }
  })

  it('cache breakpoint: on the last block of the newest user turn, input untouched', () => {
    const messages = historyMessages([...nextTurn(turn, 'system-after').map((m) => msg(m.role, m.content as never))])
    const before = JSON.stringify(messages)
    const marked = withCacheBreakpoint(messages)
    expect(JSON.stringify(messages)).toBe(before)
    const user = marked[0].content as unknown as Record<string, unknown>[]
    expect(user.at(-1)!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect(user.slice(0, -1).every((b) => !b.cache_control)).toBe(true)
    expect(marked[1]).toEqual(messages[1])
  })
})

describe('cache breakpoint edge cases', () => {
  it('string content becomes a marked text block; an empty turn is left alone', () => {
    const marked = withCacheBreakpoint([{ role: 'user', content: 'Hallo' }])
    expect(marked[0].content).toEqual([{ type: 'text', text: 'Hallo', cache_control: { type: 'ephemeral', ttl: '1h' } }])
    const empty: BetaMessageParam[] = [{ role: 'user', content: [] }]
    expect(withCacheBreakpoint(empty)).toBe(empty)
  })
})

describe('block snapshot and context', () => {
  it('lists every item with id, rev, editedByUser, fields in schema order and the Why', () => {
    const project = makeProject({
      steps: { 1: { block: { targetGroups: [makeItem(1, 'targetGroups', { name: 'Jugendliche', isFocus: true }, { rev: 2, editedByUser: true })] } } },
    })
    const snapshot = snapshotText(1, stepOf(project, 1).block)
    expect(snapshot).toContain('[Bausteinstand Schritt 1]')
    expect(snapshot).toContain(
      '- {"id":"tg1","rev":2,"editedByUser":true,"name":"Jugendliche","description":"","reach":"direct","isFocus":true,"why":""}',
    )
    expect(snapshot).toContain('challenge: {"id":"challenge","rev":1,"editedByUser":false,"text":"","why":""}')
    expect(snapshot).toContain('stakeholders: (leer)')
    // Stakeholders carry no Why.
    expect(snapshotText(1, stepOf(project, 1).block, undefined, ['Warum fehlt bei tg1'])).toContain('⛔ offen:\n- Warum fehlt bei tg1')
  })

  it('says "unverändert" when the block is the one sent last', () => {
    const block = stepOf(demoProject(), 1).block
    expect(snapshotText(1, block, structuredClone(block))).toBe('[Baustein unverändert]')
  })

  it('context: confirmed version of other steps, drafts marked, empty steps named', () => {
    const project = demoProject()
    // Step 0 confirmed, then edited again: the context still shows the confirmed version.
    const draft = stepOf(project, 0)
    draft.status = 'in_progress'
    ;(draft.block.profile as unknown as { name: string }).name = 'Neuer Entwurfsname'
    stepOf(project, 2).status = 'in_progress'
    const context = contextText(project, 1)
    expect(context).toContain('## Schritt 0 (bestätigt am 2026-11-02)')
    expect(context).toContain('Schraubzeit – offene Fahrradwerkstatt')
    expect(context).not.toContain('Neuer Entwurfsname')
    expect(context).toContain('## Schritt 2 (nicht bestätigt, Entwurf)')
    expect(context).toContain('## Schritt 3: noch nicht begonnen')
    expect(context).not.toContain('## Schritt 1')
  })
})
