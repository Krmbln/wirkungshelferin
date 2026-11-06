// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { MAX_TOKENS } from '../../../src/ai/request'
import { SEGMENT_LIMITS, rolloverNeeded, summaryCall, summaryFrom, transcriptText } from '../../../src/ai/summarise'
import { makeProject } from '../../../src/domain/fixtures'
import type { ChatSegment, StoredMessage } from '../../../src/domain/schemas/project'

// Long chats (implementation plan step 10): when a segment rolls over and what the summary sees.

const AT = '2026-11-06T10:00:00.000Z'
let n = 0
const user = (text: string): StoredMessage => ({ id: `m${++n}`, at: AT, role: 'user', content: [{ type: 'text', text: '[Projektstand] …' }, { type: 'text', text }, { type: 'text', text: '[Baustein unverändert]' }] })
const claude = (text: string, extra: Partial<StoredMessage> = {}): StoredMessage => ({
  id: `m${++n}`,
  at: AT,
  role: 'assistant',
  content: [{ type: 'thinking', thinking: 'GEHEIM', signature: 's' }, { type: 'text', text }],
  ...extra,
})

function withSegment(segment: Partial<ChatSegment>) {
  const project = makeProject()
  project.steps[1].segments = [{ id: 's1', startedAt: AT, messages: [], ...segment }]
  return project
}

const pairs = (count: number) => Array.from({ length: count }, (_, i) => [user(`Frage ${i}`), claude(`Antwort ${i}`)]).flat()

describe('rolloverNeeded', () => {
  it('not for an empty step, nor a short segment on the same model', () => {
    expect(rolloverNeeded(makeProject(), 1, 'claude-opus-5-5')).toBeUndefined()
    expect(rolloverNeeded(withSegment({ model: 'claude-opus-5-5', messages: pairs(3) }), 1, 'claude-opus-5-5')).toBeUndefined()
  })

  it(`at ${SEGMENT_LIMITS.messages} messages`, () => {
    const at39 = withSegment({ model: 'm', messages: pairs(20).slice(0, 39) })
    expect(rolloverNeeded(at39, 1, 'm')).toBeUndefined()
    expect(rolloverNeeded(withSegment({ model: 'm', messages: pairs(20) }), 1, 'm')).toBe('size')
  })

  it(`when the prompt grew by ${SEGMENT_LIMITS.tokens} tokens since the segment’s first answer`, () => {
    const grown = (last: number) =>
      withSegment({
        model: 'm',
        messages: [user('a'), claude('b', { usage: { prompt: 28_000, output: 1_000 } }), user('c'), claude('d', { usage: { prompt: last, output: 1_000 } })],
      })
    expect(rolloverNeeded(grown(56_999), 1, 'm')).toBeUndefined()
    expect(rolloverNeeded(grown(57_000), 1, 'm')).toBe('size')
  })

  it('when the settings name another model; a segment from before step 10 (no model) never counts', () => {
    expect(rolloverNeeded(withSegment({ model: 'claude-opus-5-5', messages: pairs(1) }), 1, 'claude-sonnet-5-5')).toBe('model')
    expect(rolloverNeeded(withSegment({ messages: pairs(1) }), 1, 'claude-sonnet-5-5')).toBeUndefined()
  })
})

describe('the summary request', () => {
  it('is plain text: Lukas’s words and the answers, proposals as one line; no thinking, snapshots or stopped answers', () => {
    const segment: ChatSegment = {
      id: 's2',
      startedAt: AT,
      summaryOfPrevious: 'Früher: Werkstatt im Keller.',
      messages: [
        user('Wir reparieren Räder.'),
        claude('Für wen?', { content: [{ type: 'text', text: 'Für wen?' }, { type: 'tool_use', id: 't1', name: 'propose_changes', input: { summary: 'Jugendliche aufnehmen' } }] }),
        user('Jugendliche.'),
        claude('Halb fertig', { aborted: true }),
        { id: 'sys', at: AT, role: 'system', content: [{ type: 'text', text: 'Ereignis' }] },
      ],
    }
    const text = transcriptText(segment)
    expect(text).toBe(
      [
        '(Zusammenfassung des Gesprächs davor)\nFrüher: Werkstatt im Keller.',
        'Person:\nWir reparieren Räder.',
        'Wirkungshelferin:\nFür wen?\n\n(Vorschlag für den Baustein: Jugendliche aufnehmen)',
        'Person:\nJugendliche.',
      ].join('\n\n---\n\n'),
    )
    expect(text).not.toMatch(/GEHEIM|Projektstand|Baustein unverändert|Halb fertig|Ereignis/)
  })

  it('runs with effort low and the summary limit, no tools', () => {
    const call = summaryCall(withSegment({ messages: pairs(1) }), 1)
    expect(call).toMatchObject({ effort: 'low', maxTokens: MAX_TOKENS.summary })
    expect(call.tools).toBeUndefined()
    expect(call.messages).toHaveLength(1)
    expect(call.messages[0].content).toMatch(/^\[Gespräch in Schritt 1\]/)
  })

  it('takes the text of an answer; nothing from a refusal or an empty answer', () => {
    const answer = (content: unknown[], stop = 'end_turn') => ({ content, stop_reason: stop }) as unknown as BetaMessage
    expect(summaryFrom(answer([{ type: 'thinking' }, { type: 'text', text: ' - Punkt \n' }]))).toBe('- Punkt')
    expect(summaryFrom(answer([{ type: 'text', text: 'x' }], 'refusal'))).toBeUndefined()
    expect(summaryFrom(answer([{ type: 'thinking' }]))).toBeUndefined()
  })
})
