import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Settings } from '../storage/settings'
import type { AiClient, SendOptions, SendResult } from './client'
import { MAX_TOKENS } from './request'

// PDF import for step 0 (tech design §6.6): the file goes once as a base64 document block,
// the model writes out its text; when it stops at max_tokens, a user turn asks it to go on
// (no assistant prefill on this model). The file itself is never stored.

export const PDF_SYSTEM =
  'Du überträgst Dokumente in reinen Text für die Wirkungshelferin. Gib den vollständigen Text des Dokuments wieder, ' +
  'in der Reihenfolge der Seiten, ohne Kommentar, ohne Zusammenfassung und ohne Auslassungen. ' +
  'Überschriften und Listen behältst du als Markdown bei. Tabellen gibst du Zeile für Zeile wieder. ' +
  // PO 2026-11-08: personal data stays out of what the app stores and sends again.
  'Einzige Ausnahme, aus Datenschutzgründen: Angaben zu einzelnen Personen ersetzt du durch Platzhalter – ' +
  'Namen von Personen durch [Name], Telefonnummern durch [Telefon], E-Mail-Adressen durch [E-Mail], ' +
  'Privat- und Postadressen durch [Adresse], Unterschriften durch [Unterschrift], Bankverbindungen durch [Bankverbindung], ' +
  'Geburtsdaten durch [Geburtsdatum]. Rollen (z. B. „Projektleitung“), Namen von Organisationen und Orte des Projekts behältst du bei.'

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

type PdfOptions = {
  maxTokens?: number
  maxRounds?: number
  signal?: AbortSignal
  /** Characters of text so far, all rounds together, as it streams (the reading panel's count). */
  onProgress?: (chars: number) => void
}

export async function extractPdf(
  ai: AiClient,
  settings: Settings,
  base64: string,
  { maxTokens = MAX_TOKENS.pdf, maxRounds = 4, signal, onProgress }: PdfOptions = {},
): Promise<PdfResult> {
  let messages = pdfMessages(base64)
  let text = ''
  for (let round = 1; round <= maxRounds; round++) {
    const done = round - 1
    // Copying text needs no deep thinking, and thinking counts against max_tokens.
    let streamed = 0
    const onEvent: SendOptions['onEvent'] = onProgress
      ? (event) => {
          if (event.type !== 'content_block_delta' || event.delta.type !== 'text_delta') return
          streamed += event.delta.text.length
          onProgress(text.length + streamed)
        }
      : undefined
    const result = await ai.send(settings, { system: PDF_SYSTEM, messages, maxTokens, effort: 'low' }, { signal, onEvent })
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

// ---------------------------------------------------------------- the file (step 15)

/** The 32 MB request limit minus base64's third (tech design §6.6). */
export const MAX_PDF_BYTES = 24_000_000

export type FileProblem = 'empty' | 'type' | 'size' | 'unreadable'

/** Why a file can't go to Claude, judged before anything is sent; undefined when it can. */
export function pdfFileProblem(size: number, head: Uint8Array): FileProblem | undefined {
  if (size === 0) return 'empty'
  // "%PDF-": the name and the browser's type can lie, the first bytes can't.
  if (String.fromCharCode(...head.slice(0, 5)) !== '%PDF-') return 'type'
  if (size > MAX_PDF_BYTES) return 'size'
  return undefined
}

/** The source's label: the file name without ".pdf", a download copy's " (1)" and underscores. */
export const pdfLabel = (name: string) =>
  name
    .replace(/\.pdf$/i, '')
    .replace(/ \(\d+\)$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Reads a picked file: its base64, or why it can't be sent. The size is checked before reading it all. */
export async function readPdfFile(file: Blob): Promise<{ ok: true; base64: string } | { ok: false; problem: FileProblem }> {
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    const problem = pdfFileProblem(file.size, head)
    if (problem) return { ok: false, problem }
    return { ok: true, base64: toBase64(new Uint8Array(await file.arrayBuffer())) }
  } catch {
    return { ok: false, problem: 'unreadable' }
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // In slices: String.fromCharCode with millions of arguments overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
