// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { prepareAct } from '../../../src/ai/chat'
import type { AiClient, SendResult } from '../../../src/ai/client'
import { scriptedAiClient } from '../../../src/ai/mock'
import { MAX_PDF_BYTES, PDF_SYSTEM, continueInstruction, extractPdf, pdfFileProblem, pdfLabel, readPdfFile } from '../../../src/ai/pdf'
import { MAX_TOKENS } from '../../../src/ai/request'
import { makeProject } from '../../../src/domain/fixtures'
import { defaultSettings } from '../../../src/storage/settings'
import { dummyKey } from '../../dummyKey'

// PDF import (tech design §6.6): one document block, continuation after max_tokens.

const settings = { ...defaultSettings, apiKey: dummyKey }

const answer = (text: string, stop: BetaMessage['stop_reason']): SendResult => ({
  status: 'done',
  message: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text }], stop_reason: stop } as BetaMessage,
})

describe('extractPdf', () => {
  it('sends the PDF once with low effort and returns the text', async () => {
    const ai = scriptedAiClient([], { replies: [answer('Seite 1', 'end_turn')] })
    expect(await extractPdf(ai, settings, 'QUJD')).toEqual({ status: 'done', text: 'Seite 1', rounds: 1 })
    const [call] = ai.sent
    expect(call).toMatchObject({ system: PDF_SYSTEM, maxTokens: MAX_TOKENS.pdf, effort: 'low' })
    expect(call.messages[0].content).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } },
      expect.objectContaining({ type: 'text' }),
    ])
  })

  it('after max_tokens: the turn goes back unchanged, then a user turn asks to go on', async () => {
    const first = answer('Teil eins', 'max_tokens')
    const ai = scriptedAiClient([], { replies: [first, answer(' und Teil zwei', 'end_turn')] })
    expect(await extractPdf(ai, settings, 'QUJD')).toEqual({ status: 'done', text: 'Teil eins und Teil zwei', rounds: 2 })
    // Each round gets its own array: round 1 sent only the document, round 2 all three turns.
    expect(ai.sent[0].messages).toHaveLength(1)
    const messages = ai.sent[1].messages
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(messages[1].content).toBe((first as { message: BetaMessage }).message.content)
    expect(messages[2].content).toBe(continueInstruction('Teil eins'))
  })

  it('caches the document, so continuation rounds read it from the cache', async () => {
    const ai = scriptedAiClient([], { replies: [answer('x', 'end_turn')] })
    await extractPdf(ai, settings, 'QUJD')
    const blocks = ai.sent[0].messages[0].content as { cache_control?: unknown }[]
    expect(blocks.at(-1)!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('a failure, stop or refusal in a later round keeps the text of the finished rounds', async () => {
    const first = answer('Teil eins', 'max_tokens')
    const failed = await extractPdf(scriptedAiClient([], { replies: [first, { status: 'failed', problem: 'busy' }] }), settings, 'QUJD')
    expect(failed).toEqual({ status: 'failed', problem: 'busy', text: 'Teil eins', rounds: 1 })
    const aborted = await extractPdf(scriptedAiClient([], { replies: [first, { status: 'aborted' }] }), settings, 'QUJD')
    expect(aborted).toEqual({ status: 'aborted', text: 'Teil eins', rounds: 1 })
    const refused = await extractPdf(scriptedAiClient([], { replies: [first, answer('', 'refusal')] }), settings, 'QUJD')
    expect(refused).toEqual({ status: 'refused', text: 'Teil eins', rounds: 1 })
  })

  it('stops after maxRounds with what it has', async () => {
    const ai = scriptedAiClient([], { replies: [answer('x', 'max_tokens')] })
    expect(await extractPdf(ai, settings, 'QUJD', { maxRounds: 3 })).toEqual({ status: 'incomplete', text: 'xxx', rounds: 3 })
  })

  it('passes a refusal and a failure on', async () => {
    expect(await extractPdf(scriptedAiClient([], { replies: [answer('', 'refusal')] }), settings, 'QUJD')).toEqual({ status: 'refused', text: '', rounds: 0 })
    const failed: SendResult = { status: 'failed', problem: 'busy' }
    expect(await extractPdf(scriptedAiClient([], { replies: [failed] }), settings, 'QUJD')).toEqual({ ...failed, text: '', rounds: 0 })
  })

  it('the continuation quotes the end of the text so far', () => {
    expect(continueInstruction('a'.repeat(300) + 'ENDE')).toContain(`„${'a'.repeat(196)}ENDE“`)
  })
})

describe('extractPdf progress (step 15)', () => {
  it('reports the streamed characters of all rounds together', async () => {
    const seen: number[] = []
    const delta = (text: string) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } }) as const
    const replies = [answer('Teil eins', 'max_tokens'), answer(' zwei', 'end_turn')]
    let round = 0
    const ai: AiClient = {
      testConnection: async () => ({ ok: true }),
      send: async (_s, _c, { onEvent } = {}) => {
        const reply = replies[round++]
        const text = ((reply as { message: BetaMessage }).message.content[1] as { text: string }).text
        // Thinking deltas don't count, only text.
        onEvent?.({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } as never)
        onEvent?.(delta(text.slice(0, 4)) as never)
        onEvent?.(delta(text.slice(4)) as never)
        return reply
      },
    }
    await extractPdf(ai, settings, 'QUJD', { onProgress: (n) => seen.push(n) })
    expect(seen).toEqual([4, 9, 13, 14])
  })
})

describe('the picked file (step 15)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)

  it('refuses an empty file, a non-PDF and one over 24 MB, judged by the first bytes', () => {
    expect(pdfFileProblem(0, bytes(''))).toBe('empty')
    expect(pdfFileProblem(10, bytes('PK\u0003\u0004x'))).toBe('type')
    expect(pdfFileProblem(MAX_PDF_BYTES + 1, bytes('%PDF-'))).toBe('size')
    expect(pdfFileProblem(MAX_PDF_BYTES, bytes('%PDF-'))).toBeUndefined()
  })

  it('reads a PDF as base64 and checks the size before reading the whole file', async () => {
    const ok = await readPdfFile(new Blob([bytes('%PDF-1.4 Hallo')]))
    expect(ok).toEqual({ ok: true, base64: btoa('%PDF-1.4 Hallo') })
    const big = new Blob([bytes('%PDF-1.4')])
    Object.defineProperty(big, 'size', { value: MAX_PDF_BYTES + 1 })
    big.arrayBuffer = () => Promise.reject(new Error('must not read it all'))
    expect(await readPdfFile(big)).toEqual({ ok: false, problem: 'size' })
    expect(await readPdfFile(new Blob([bytes('Hallo Welt')]))).toEqual({ ok: false, problem: 'type' })
  })

  it('a file that big still becomes base64 (sliced, no stack overflow)', async () => {
    const data = new Uint8Array(300_000)
    data.set(bytes('%PDF-'))
    const read = await readPdfFile(new Blob([data]))
    expect(read.ok && read.base64.length).toBe(Math.ceil(300_000 / 3) * 4)
  })

  it('labels a source by the file name without ".pdf"', () => {
    expect(pdfLabel('Projektantrag 2026.PDF')).toBe('Projektantrag 2026')
    expect(pdfLabel('konzept.pdf.pdf')).toBe('konzept.pdf')
    expect(pdfLabel('Am Ball_Projektantrag (1).pdf')).toBe('Am Ball Projektantrag')
    expect(pdfLabel('Bericht (2) final.pdf')).toBe('Bericht (2) final')
  })
})

describe('the PDF turn (step 15)', () => {
  it('stores a PDF source and sends its text once, saying it was read from a PDF', () => {
    const prepared = prepareAct(makeProject(), 0, { kind: 'pdf', label: 'Projektantrag', text: 'Der Text.' }, { at: '2026-11-08T12:00:00.000Z' })!
    const [source] = prepared.project.steps[0].block.sources as { origin: string; label: string; text: string }[]
    expect(source).toMatchObject({ origin: 'pdf', label: 'Projektantrag', text: 'Der Text.' })
    const last = prepared.project.steps[0].segments[0].messages.at(-1)!
    expect(last.act).toEqual({ kind: 'pdf', label: 'Projektantrag', chars: 9 })
    const texts = (prepared.call.messages.at(-1)!.content as { text?: string }[]).map((b) => b.text ?? '').join('\n')
    expect(texts).toContain('[Quelle src1: „Projektantrag“]')
    expect(texts).toContain('Die Person hat ein PDF hochgeladen: „Projektantrag“ (src1)')
    expect(texts.split('Der Text.').length).toBe(2)
  })

  it('an unnamed PDF gets "PDF N"', () => {
    const prepared = prepareAct(makeProject(), 0, { kind: 'pdf', label: ' ', text: 'x' }, { at: '2026-11-08T12:00:00.000Z' })!
    expect((prepared.project.steps[0].block.sources as { label: string }[])[0].label).toBe('PDF 1')
  })
})
