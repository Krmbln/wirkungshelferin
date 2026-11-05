// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import type { SendResult } from '../../../src/ai/client'
import { scriptedAiClient } from '../../../src/ai/mock'
import { PDF_SYSTEM, continueInstruction, extractPdf } from '../../../src/ai/pdf'
import { MAX_TOKENS } from '../../../src/ai/request'
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
