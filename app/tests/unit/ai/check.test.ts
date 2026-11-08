// @vitest-environment node
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { checkCall, chatCall, commitAnswer, prepareTurn } from '../../../src/ai/chat'
import { APP_CHECKED, CHECK_REQUEST, checkEvents, checkFromAnswer, parseCheck } from '../../../src/ai/check'
import { historyMessages } from '../../../src/ai/prompt'
import { MAX_TOKENS } from '../../../src/ai/request'
import { rubricCriteria } from '../../../src/ai/tools'
import { HARD_CRITERIA } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project, type QualityCheck } from '../../../src/domain/schemas/project'
import { stepGuide } from '../../../src/guide'

// The gate's check request, Claude's check in the chat, and what Claude hears about a check
// or a confirm in the next turn (implementation plan step 13).

const AT = '2026-11-08T10:00:00.000Z'
const LATER = '2026-11-08T10:05:00.000Z'
let n = 0
const meta = (at = AT) => ({ at, newId: () => `id${++n}` })

const allOk = rubricCriteria(1).map((c) => ({ criterion: c.id, result: 'ok' as const, note: `Satz ${c.id}` }))

function project(why = 'Hier wirkt das Projekt.'): Project {
  return makeProject({
    steps: {
      1: {
        status: 'in_progress',
        block: {
          challenge: makeItem(1, 'challenge', { text: 'Zu wenig Orte am Nachmittag', why: 'Daran hängt alles.' }),
          targetGroups: [makeItem(1, 'targetGroups', { name: 'Jugendliche', description: '', reach: 'direct', isFocus: true, why }, { id: 'tg1' })],
          stakeholders: [],
        },
      },
    },
  })
}

function answer(content: BetaContentBlock[]): BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as BetaMessage
}
const checkUse = (input: unknown, id = 'tu_check') => ({ type: 'tool_use', id, name: 'report_quality_check', input }) as unknown as BetaContentBlock

/** Lukas sends a turn, Claude answers with `content`. */
function turn(p: Project, text: string, content: BetaContentBlock[], at = AT): Project {
  const prepared = prepareTurn(p, 1, text, meta(at))
  return commitAnswer(prepared.project, 1, { status: 'done', message: answer(content) }, prepared.shown, meta(at))
}

const lastUserBlocks = (p: Project) => p.steps[1].segments.at(-1)!.messages.findLast((m) => m.role === 'user')!.content as unknown as BetaContentBlockParam[]
const texts = (blocks: BetaContentBlockParam[]) => blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text)

describe('rubric criteria and hard rules', () => {
  it('the hard rules own exactly the criteria whose rubric row names ⛔', () => {
    const rubric = stepGuide(1).text.split(/^## \d+\. Rubrik\s*$/m)[1].split(/^## /m)[0]
    const hard = [...rubric.matchAll(/^\| *(\d+[a-z]?) *\|.*⛔.*$/gm)].map((m) => m[1]).sort()
    expect(hard).toEqual(Object.values(HARD_CRITERIA[1]!).sort())
    expect(rubricCriteria(1).map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
})

describe('parseCheck', () => {
  it('returns the results in rubric order', () => {
    const shuffled = [...allOk].reverse()
    expect(parseCheck(1, { results: shuffled })).toEqual({ ok: true, results: allOk })
  })

  it('refuses a missing or doubled criterion, an unknown id and a wrong result', () => {
    expect(parseCheck(1, { results: allOk.slice(1) })).toEqual({ ok: false, errors: ['Es fehlen die Kriterien 1.'] })
    expect(parseCheck(1, { results: [...allOk, allOk[0]] })).toMatchObject({ ok: false, errors: ['Kriterium 1 kommt mehrfach vor.'] })
    expect(parseCheck(1, { results: [...allOk, { criterion: '99', result: 'ok', note: '' }] }).ok).toBe(false)
    expect(parseCheck(1, { results: [{ ...allOk[0], result: 'block' }, ...allOk.slice(1)] }).ok).toBe(false)
  })

  it('the criteria the hard rules own may be left out: they count as ✓ from the app', () => {
    const without = allOk.filter((r) => r.criterion !== '5' && r.criterion !== '8')
    const parsed = parseCheck(1, { results: without })
    expect(parsed.ok && parsed.results.map((r) => r.criterion)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(parsed.ok && parsed.results[4]).toEqual({ criterion: '5', result: 'ok', note: APP_CHECKED })
  })

  it('checkFromAnswer finds the newest valid check among other blocks; none or a cut-off answer = no result', () => {
    const done = (content: BetaContentBlock[], stop_reason: BetaMessage['stop_reason'] = 'tool_use') => ({ content, stop_reason })
    expect(checkFromAnswer(1, done([{ type: 'text', text: 'Hm' } as BetaContentBlock, checkUse({ results: allOk })]))).toEqual(allOk)
    expect(checkFromAnswer(1, done([{ type: 'text', text: 'Alles gut.' } as BetaContentBlock]))).toBeUndefined()
    expect(checkFromAnswer(1, done([checkUse({ results: [] })]))).toBeUndefined()
    // An invalid first try, then a valid one.
    expect(checkFromAnswer(1, done([checkUse({ results: [] }, 'a'), checkUse({ results: allOk }, 'b')]))).toEqual(allOk)
    // Cut off by max_tokens: the last note may be half a sentence, even if the JSON parses.
    expect(checkFromAnswer(1, done([checkUse({ results: allOk })], 'max_tokens'))).toBeUndefined()
  })
})

describe('checkCall', () => {
  it('is the chat request plus one user turn asking for the check, 8k, nothing stored', () => {
    const p = turn(project(), 'Hallo', [{ type: 'text', text: 'Erzähl.' } as BetaContentBlock])
    const before = structuredClone(p)
    const { call, shown } = checkCall(p, 1, LATER)
    expect(p).toEqual(before)
    const chat = chatCall(p, 1)
    expect(call.tools).toEqual(chat.tools)
    expect(call.system).toBe(chat.system)
    expect(call.maxTokens).toBe(MAX_TOKENS.check)
    // Byte for byte the history the next chat turn sends (the cached prefix), breakpoint
    // included, plus one more user turn without one: it is never sent again.
    expect(call.messages.slice(0, -1)).toEqual(chat.messages)
    expect(JSON.stringify(call.messages.at(-1))).not.toContain('cache_control')
    const last = call.messages.at(-1)!
    expect(last.role).toBe('user')
    expect(texts(last.content as BetaContentBlockParam[])).toContain(`[App] ${CHECK_REQUEST}`)
    expect(shown).toEqual(p.steps[1].block)
  })

  it('after a turn without answer (failed call): user → user, nothing stored', () => {
    const failed = prepareTurn(project(), 1, 'Hallo', meta()).project
    const before = structuredClone(failed)
    const { call } = checkCall(failed, 1, LATER)
    expect(failed).toEqual(before)
    expect(call.messages.map((m) => m.role)).toEqual(['user', 'user'])
    // The unanswered turn is the cached prefix, exactly as a retry would send it.
    expect(call.messages[0]).toEqual(chatCall(failed, 1).messages[0])
    expect(historyMessages(failed.steps[1].segments[0].messages)).toHaveLength(1)
  })

  it('with an empty chat it carries the context, so Claude knows the project', () => {
    const { call } = checkCall(project(), 1, AT)
    expect(call.messages).toHaveLength(1)
    expect(texts(call.messages[0].content as BetaContentBlockParam[])[0]).toMatch(/^\[Projektstand\]/)
  })

  it('answers a pending proposal first (no orphan tool_use)', () => {
    const propose = { type: 'tool_use', id: 'tu_p', name: 'propose_changes', input: { summary: 'x', changes: [] } } as unknown as BetaContentBlock
    const p = turn(project(), 'Hallo', [propose])
    const last = checkCall(p, 1, LATER).call.messages.at(-1)!
    expect((last.content as BetaContentBlockParam[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_p' })
  })
})

describe('a check Claude reports in the chat', () => {
  it('fills the gate with the block that turn showed', () => {
    const p = turn(project(), 'Prüf mal', [checkUse({ results: allOk })])
    expect(p.steps[1].qualityCheck).toEqual({ at: AT, source: 'chat', block: project().steps[1].block, results: allOk })
    projectSchema.parse(p)
  })

  it('an invalid one is not shown and comes back to Claude as an error', () => {
    const p = turn(project(), 'Prüf mal', [checkUse({ results: allOk.slice(2) })])
    expect(p.steps[1].qualityCheck).toBeUndefined()
    const next = prepareTurn(p, 1, 'Und?', meta(LATER)).project
    const result = lastUserBlocks(next)[0] as { type: string; is_error?: boolean; content: string }
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_check', is_error: true })
    expect(result.content).toContain('Es fehlen die Kriterien 1, 2.')
  })

  it('a cut-off one (max_tokens) is not shown and goes back as an error', () => {
    const prepared = prepareTurn(project(), 1, 'Prüf mal', meta())
    const message = { ...answer([checkUse({ results: allOk })]), stop_reason: 'max_tokens' } as BetaMessage
    const p = commitAnswer(prepared.project, 1, { status: 'done', message }, prepared.shown, meta())
    expect(p.steps[1].qualityCheck).toBeUndefined()
    expect(p.steps[1].segments[0].messages.at(-1)!.toolErrors).toEqual({ tu_check: ['Die Antwort wurde abgeschnitten.'] })
  })

  it('a valid one is answered "angezeigt"', () => {
    const p = turn(project(), 'Prüf mal', [checkUse({ results: allOk })])
    const result = lastUserBlocks(prepareTurn(p, 1, 'Und?', meta(LATER)).project)[0] as { is_error?: boolean; content: string }
    expect(result.is_error).toBeUndefined()
    expect(result.content).toBe('Qualitätscheck wird der Person angezeigt.')
  })
})

describe('what Claude hears in the next turn', () => {
  const storeCheck = (p: Project, at: string, results: QualityCheck['results'] = allOk) =>
    reducer(p, { type: 'check/store', step: 1, check: { at, source: 'app', block: structuredClone(p.steps[1].block), results } })

  it('a gate check since the last turn: one [App] line with ⛔, ⚠ and ✓', () => {
    let p = turn(project(''), 'Hallo', [{ type: 'text', text: 'Erzähl.' } as BetaContentBlock])
    p = storeCheck(p, LATER, allOk.map((r) => (r.criterion === '2' ? { ...r, result: 'warn' as const, note: 'Zu allgemein.' } : r)))
    const events = checkEvents(p, 1)
    expect(events).toHaveLength(1)
    expect(events[0]).toContain('⛔ Warum fehlt: Zielgruppe „Jugendliche“')
    expect(events[0]).toContain('⚠ 2 Zielgruppen präzise: Zu allgemein.')
    expect(events[0]).toContain('✓ 1 Herausforderung als Zustand')
    // Criterion 8 is blocked, so Claude's ✓ on it is left out.
    expect(events[0]).not.toContain('✓ 8')
    const next = prepareTurn(p, 1, 'Weiter.', meta('2026-11-08T10:10:00.000Z')).project
    expect(texts(lastUserBlocks(next)).some((t) => t.startsWith('[App] Die Person hat den Qualitätscheck'))).toBe(true)
    // Once told, never again.
    expect(checkEvents(next, 1)).toEqual([])
  })

  it('a confirm since the last turn, with the ⚠ points confirmed anyway', () => {
    let p = turn(project(), 'Hallo', [{ type: 'text', text: 'Erzähl.' } as BetaContentBlock])
    p = storeCheck(p, LATER, allOk.map((r) => (r.criterion === '4' ? { ...r, result: 'warn' as const } : r)))
    p = reducer(p, { type: 'step/confirm', step: 1, at: LATER })
    expect(checkEvents(p, 1)[1]).toBe('Die Person hat den Schritt bestätigt, mit offenen Punkten (⚠ 4).')
  })

  it('a confirm is told even after an edit since, with the ⚠ points stored at the confirm', () => {
    let p = turn(project(), 'Hallo', [{ type: 'text', text: 'Erzähl.' } as BetaContentBlock])
    p = storeCheck(p, LATER, allOk.map((r) => (r.criterion === '4' ? { ...r, result: 'warn' as const } : r)))
    p = reducer(p, { type: 'step/confirm', step: 1, at: LATER })
    // A newer check from the chat judges differently; the stored fact stays.
    p = reducer(p, { type: 'check/store', step: 1, check: { at: '2026-11-08T10:06:00.000Z', source: 'chat', block: structuredClone(p.steps[1].block), results: allOk } })
    p = reducer(p, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Anders' } })
    expect(checkEvents(p, 1)).toEqual(['Die Person hat den Schritt bestätigt, mit offenen Punkten (⚠ 4).'])
  })

  it('a gate check of an older block says so', () => {
    let p = turn(project(), 'Hallo', [{ type: 'text', text: 'Erzähl.' } as BetaContentBlock])
    p = storeCheck(p, LATER)
    p = reducer(p, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Anders' } })
    expect(checkEvents(p, 1)[0]).toMatch(/^Die Person hat den Qualitätscheck in der App ausgeführt \(für einen älteren Stand des Bausteins\)\./)
  })

  it('a check in an earlier segment counts against the newest turn of any segment', () => {
    let p = turn(project(), 'Hallo', [{ type: 'text', text: 'Erzähl.' } as BetaContentBlock])
    p = storeCheck(p, LATER)
    p.steps[1].segments.push({ id: 's2', startedAt: '2026-11-08T11:00:00.000Z', messages: [] })
    expect(checkEvents(p, 1)).toHaveLength(1)
    // A check at exactly the last turn's time was before it.
    expect(checkEvents(storeCheck(turn(project(), 'Hallo', [], AT), AT), 1)).toEqual([])
  })

  it('a check from the chat is not reported back', () => {
    const p = turn(project(), 'Prüf mal', [checkUse({ results: allOk })])
    expect(checkEvents(p, 1)).toEqual([])
  })

  it('the snapshot lists the open ⛔ points', () => {
    const next = prepareTurn(project(''), 1, 'Hallo', meta()).project
    expect(texts(lastUserBlocks(next)).at(-1)).toContain('⛔ offen:\n- Warum fehlt: Zielgruppe „Jugendliche“')
  })
})
