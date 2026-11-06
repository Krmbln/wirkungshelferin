import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { ChatSegment, Project, StoredMessage } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { lukasText } from './prompt'
import { MAX_TOKENS, type Call } from './request'
import { CHECK, PROPOSE } from './tools'

// Long chats (tech design §6.5): when a step's segment gets long, or the model changed, the
// app asks for a summary and starts a new segment that carries it. The old segment stays
// stored and visible; the history itself is never rewritten.

/** A segment rolls over at either limit (tech design §6.5). */
export const SEGMENT_LIMITS = { messages: 40, tokens: 30_000 } as const

export type Rollover = 'size' | 'model'

/**
 * Why the next turn should start a new segment, if it should. Tokens = how far the prompt grew
 * since the segment's first answer (the system prompt and context message don't count).
 * A segment from before step 10 has no model and never counts as a model change.
 */
export function rolloverNeeded(project: Project, step: StepId, model: string): Rollover | undefined {
  const segment = project.steps[step].segments.at(-1)
  if (!segment?.messages.length) return undefined
  if (segment.model && segment.model !== model) return 'model'
  if (segment.messages.length >= SEGMENT_LIMITS.messages) return 'size'
  const answers = segment.messages.filter((m) => m.usage)
  const first = answers[0]?.usage
  const last = answers.at(-1)?.usage
  if (first && last && last.prompt + last.output - first.prompt >= SEGMENT_LIMITS.tokens) return 'size'
  return undefined
}

const SYSTEM = `Du fasst ein Gespräch zusammen, das die „Wirkungshelferin“ (eine Assistentin für Wirkungsmodelle) mit einer Person über einen Schritt ihres Projekts geführt hat.

Die Zusammenfassung ersetzt das Gespräch: Die Wirkungshelferin führt es danach nur mit ihr weiter. Den aktuellen Baustein und die anderen Schritte sieht sie ohnehin; wiederhole deren Inhalt nicht.

Halte in knappen Stichpunkten fest:
- was die Person über ihr Projekt erzählt hat, das wichtig bleibt,
- was ihr entschieden habt und warum,
- was offen, unsicher oder strittig ist,
- woran ihr zuletzt gearbeitet habt und was die Wirkungshelferin zuletzt gefragt hat.

Höchstens 250 Wörter. Schreib nur die Zusammenfassung, ohne Einleitung und ohne Überschrift.`

function assistantText(message: StoredMessage): string {
  return message.content
    .flatMap((b) => {
      if (b.type === 'text' && typeof b.text === 'string' && b.text) return [b.text]
      if (b.type === 'tool_use' && b.name === PROPOSE) {
        const summary = (b.input as { summary?: unknown } | undefined)?.summary
        return [`(Vorschlag für den Baustein: ${typeof summary === 'string' ? summary : 'ohne Beschreibung'})`]
      }
      if (b.type === 'tool_use' && b.name === CHECK) return ['(Qualitätscheck gemeldet)']
      return []
    })
    .join('\n\n')
}

/**
 * The segment as plain text: what the person wrote and what the assistant answered. No
 * thinking, no tool results, no snapshots, so it works with any model and has no open tool
 * calls. Stopped answers were never sent, so they stay out. An earlier summary comes first.
 */
export function transcriptText(segment: ChatSegment): string {
  const turns = segment.messages.flatMap((m) => {
    if (m.aborted || m.role === 'system') return []
    const text = m.role === 'user' ? lukasText(m) : assistantText(m)
    return text ? [`${m.role === 'user' ? 'Person' : 'Wirkungshelferin'}:\n${text}`] : []
  })
  const earlier = segment.summaryOfPrevious ? [`(Zusammenfassung des Gesprächs davor)\n${segment.summaryOfPrevious}`] : []
  return [...earlier, ...turns].join('\n\n---\n\n')
}

/** The summary request for the step's newest segment: effort low, 4k (tech design §6.1). */
export function summaryCall(project: Project, step: StepId): Call {
  const segment = project.steps[step].segments.at(-1)
  if (!segment) throw new Error(`step ${step} has no segment to summarise`)
  return {
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `[Gespräch in Schritt ${step}]\n\n${transcriptText(segment)}\n\n[Ende des Gesprächs]\n\nFass dieses Gespräch zusammen.`,
      },
    ],
    maxTokens: MAX_TOKENS.summary,
    effort: 'low',
  }
}

/** The summary text of a finished answer; none for a refusal or an empty answer. */
export function summaryFrom(message: BetaMessage): string | undefined {
  if (message.stop_reason === 'refusal') return undefined
  const text = message.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('\n\n')
    .trim()
  return text || undefined
}

/** What the new segment's first message says about the conversation before it. */
export function carriedText(summary: string | undefined): string {
  return summary
    ? `[Bisheriges Gespräch in diesem Schritt, zusammengefasst]\n${summary}`
    : '[Neuer Gesprächsabschnitt]\nDas bisherige Gespräch in diesem Schritt liegt dir nicht vor. Der Bausteinstand am Ende dieser Nachricht ist aktuell.'
}
