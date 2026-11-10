// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { requestParams } from '../../../src/ai/request'
import { RESUME_FORMAT, RESUME_MESSAGES, resumeCall, resumeFrom } from '../../../src/ai/resume'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { defaultSettings } from '../../../src/storage/settings'
import { dummyKey } from '../../dummyKey'
import { replayClient } from '../../replay'
import { resumeAnswer, withChat, type Line } from '../../resume'

// The home summary call (implementation plan step 22, design §6.1 "Step 22").

const at = (i: number) => new Date(Date.UTC(2026, 10, 10, 10, i)).toISOString()
const lines: Line[] = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `Nachricht ${i + 1}`, at: at(i) }))
const project = withChat(
  makeProject({ steps: { 2: { status: 'in_progress', block: { causes: [makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Kein Werkzeug', why: 'gesehen' })] } } } }),
  2,
  lines,
)

describe('resumeCall', () => {
  const call = resumeCall(project, 2)
  const text = call.messages[0].content as string

  it('effort low, 2k tokens, structured output, no tools (standing rule 6)', () => {
    expect(call).toMatchObject({ effort: 'low', maxTokens: 2_000, format: RESUME_FORMAT })
    expect(call.tools).toBeUndefined()
  })

  it('sends the block and only the newest segment’s last 8 messages, as plain text', () => {
    expect(text).toContain('Kein Werkzeug')
    expect(text).toContain('Status: in Arbeit')
    expect(text).toContain(`Nachricht ${lines.length}`)
    expect(text).toContain(`Nachricht ${lines.length - RESUME_MESSAGES + 1}`)
    expect(text).not.toContain(`Nachricht ${lines.length - RESUME_MESSAGES}\n`)
    expect(text).not.toContain('thinking')
  })

  it('the rules forbid ids, Markdown and deadlines', () => {
    expect(call.system).toContain('Keine IDs')
    expect(call.system).toContain('kein Markdown')
    expect(call.system).toContain('Keine Fristen')
  })

  it('carries the segment’s earlier summary', () => {
    const p = structuredClone(project)
    p.steps[2].segments[0].summaryOfPrevious = 'Früher besprochen: Werkstatt im Keller.'
    expect(resumeCall(p, 2).messages[0].content).toContain('Werkstatt im Keller')
  })

  it('the format reaches output_config with the effort', () => {
    const params = requestParams(defaultSettings, call)
    expect(params.output_config).toEqual({ effort: 'low', format: RESUME_FORMAT })
    // Other calls send no format.
    expect(requestParams(defaultSettings, { ...call, format: undefined }).output_config).toEqual({ effort: 'low' })
  })

  it('refuses a step without a chat', () => {
    expect(() => resumeCall(makeProject(), 3)).toThrow()
  })
})

describe('resumeFrom', () => {
  it('reads both fields, trimmed', () => {
    expect(resumeFrom(resumeAnswer({ summary: ' Zwei Ursachen stehen. ', nextAction: 'Beantworte die Frage im Chat.' }))).toEqual({
      summary: 'Zwei Ursachen stehen.',
      nextAction: 'Beantworte die Frage im Chat.',
    })
  })

  it('nothing for a refusal, a cut-off answer, broken JSON or an empty field', () => {
    const ok = { summary: 's', nextAction: 'n' }
    expect(resumeFrom(resumeAnswer(ok, 'refusal'))).toBeUndefined()
    expect(resumeFrom(resumeAnswer(ok, 'max_tokens'))).toBeUndefined()
    expect(resumeFrom(resumeAnswer('{"summary": "s"'))).toBeUndefined()
    expect(resumeFrom(resumeAnswer({ summary: ' ', nextAction: 'n' }))).toBeUndefined()
    expect(resumeFrom(resumeAnswer({ summary: 's' }))).toBeUndefined()
    expect(resumeFrom(resumeAnswer('null'))).toBeUndefined()
  })
})

describe('the recorded home summary (contract "12 · home", replayed offline)', () => {
  it('streams through the real SDK client into both fields', async () => {
    const result = await replayClient('resume-step5').send({ ...defaultSettings, apiKey: dummyKey }, resumeCall(project, 2))
    if (result.status !== 'done') throw new Error(result.status)
    const text = resumeFrom(result.message)
    expect(text?.summary).toMatch(/Ausgangswert/)
    expect(text?.nextAction).toMatch(/^Beantworte/)
  })
})
