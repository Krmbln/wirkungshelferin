import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Act } from '../../ai/chat'
import type { AiProblem } from '../../ai/errors'
import type { StoredMessage } from '../../domain/schemas/project'

// What the chat shows while an answer streams. Deltas stay in memory: only the finished
// (or stopped) message reaches the project and autosave.

/** Text blocks carry their text; thinking and tool calls only mark that Claude is busy. */
export type StreamBlock = { type: 'text'; text: string } | { type: 'other' }

export type ChatRun =
  | { kind: 'running'; blocks: StreamBlock[] }
  /** The summary before a new segment (summarise.ts); `text` / `act` = Lukas's turn, not stored yet. */
  | { kind: 'summarising'; text: string; act?: undefined }
  | { kind: 'summarising'; act: Act; text?: undefined }
  /** `partial`: text that arrived before the stream broke, shown until the next try. */
  | { kind: 'failed'; problem: AiProblem; partial: string }

export function applyEvent(blocks: StreamBlock[], event: BetaRawMessageStreamEvent): StreamBlock[] {
  if (event.type === 'content_block_start') {
    const block = event.content_block
    return [...blocks, block.type === 'text' ? { type: 'text', text: block.text } : { type: 'other' }]
  }
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    const target = blocks[event.index]
    if (target?.type !== 'text') return blocks
    const next = [...blocks]
    next[event.index] = { type: 'text', text: target.text + event.delta.text }
    return next
  }
  return blocks
}

/** "denkt nach …" shows until text streams, and again while Claude thinks or writes a tool call. */
export const isThinking = (blocks: StreamBlock[]) => blocks.at(-1)?.type !== 'text'

export const streamTexts = (blocks: StreamBlock[]) =>
  blocks.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : []))

/** The text blocks of a stored or streamed message, in order. */
export function messageTexts(message: Pick<StoredMessage, 'content'> | BetaMessage | undefined): string[] {
  const content = (message?.content ?? []) as { type: string; text?: unknown }[]
  return content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' && b.text ? [b.text] : []))
}
