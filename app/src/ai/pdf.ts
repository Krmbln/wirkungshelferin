import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Settings } from '../storage/settings'
import type { AiClient, SendResult } from './client'
import { MAX_TOKENS } from './request'

// PDF import for step 0 (tech design §6.6): the file goes once as a base64 document block,
// the model writes out its text; when it stops at max_tokens, a user turn asks it to go on
// (no assistant prefill on this model). The file itself is never stored.

export const PDF_SYSTEM =
  'Du überträgst Dokumente in reinen Text für die Wirkungshelferin. Gib den vollständigen Text des Dokuments wieder, ' +
  'in der Reihenfolge der Seiten, ohne Kommentar, ohne Zusammenfassung und ohne Auslassungen. ' +
  'Überschriften und Listen behältst du als Markdown bei. Tabellen gibst du Zeile für Zeile wieder.'

export const PDF_INSTRUCTION = 'Bitte gib den vollständigen Text dieses Dokuments wieder.'

export function continueInstruction(lastText: string): string {
  const tail = lastText.slice(-200)
  return `Deine Antwort wurde unterbrochen. Sie endete mit:\n„${tail}“\nMach genau dort weiter, ohne etwas zu wiederholen.`
}

export function pdfMessages(base64: string): BetaMessageParam[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        // Cached (5 min): every continuation round sends the document again.
        { type: 'text', text: PDF_INSTRUCTION, cache_control: { type: 'ephemeral' } },
      ],
    },
  ]
}

const textOf = (message: BetaMessage) =>
  message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

/** Every outcome carries the text of the rounds that finished, so Lukas can paste only the rest. */
export type PdfResult = { text: string; rounds: number } & (
  | { status: 'done' }
  /** Stopped after maxRounds. */
  | { status: 'incomplete' }
  | { status: 'refused' }
  | { status: 'aborted' }
  | { status: 'failed'; problem: Extract<SendResult, { status: 'failed' }>['problem'] }
)

type PdfOptions = { maxTokens?: number; maxRounds?: number; signal?: AbortSignal }

export async function extractPdf(
  ai: AiClient,
  settings: Settings,
  base64: string,
  { maxTokens = MAX_TOKENS.pdf, maxRounds = 4, signal }: PdfOptions = {},
): Promise<PdfResult> {
  let messages = pdfMessages(base64)
  let text = ''
  for (let round = 1; round <= maxRounds; round++) {
    const done = round - 1
    // Copying text needs no deep thinking, and thinking counts against max_tokens.
    const result = await ai.send(settings, { system: PDF_SYSTEM, messages, maxTokens, effort: 'low' }, { signal })
    if (result.status === 'failed') return { status: 'failed', problem: result.problem, text, rounds: done }
    if (result.status === 'aborted') return { status: 'aborted', text, rounds: done }
    const { message } = result
    if (message.stop_reason === 'refusal') return { status: 'refused', text, rounds: done }
    text += textOf(message)
    if (message.stop_reason !== 'max_tokens') return { status: 'done', text, rounds: round }
    // The full assistant turn goes back unchanged (thinking blocks included), then the request to go on.
    messages = [...messages, { role: 'assistant', content: message.content }, { role: 'user', content: continueInstruction(text) }]
  }
  return { status: 'incomplete', text, rounds: maxRounds }
}
