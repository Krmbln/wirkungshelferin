import type { BetaJSONOutputFormat, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Project } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { blockText } from './prompt'
import { MAX_TOKENS, type Call } from './request'
import { transcriptText } from './summarise'

// The home card's summary (design §6.1 "Step 22", tech design §6.5 "Home summary"): where Lukas
// stands in a step and the one thing to do next, written once he has left the step.

/** How much of the newest segment Claude reads: the end is where Lukas left off. */
export const RESUME_MESSAGES = 8

/** What the prompt asks for; the card cuts beyond its own limits (ui/home.ts). */
export const RESUME_ASK = { summary: 240, nextAction: 140 } as const

const SYSTEM = `Du schreibst für die Startseite der „Wirkungshelferin“, einer Assistentin, die eine Person Schritt für Schritt durch das Wirkungsmodell ihres Projekts führt. Die Person kommt vielleicht erst nach Wochen zurück und soll auf einen Blick wissen, wo sie in diesem Schritt steht und was sie als Nächstes tut.

Du bekommst den aktuellen Baustein des Schritts und das Ende des Gesprächs dazu.

Schreib:
- summary: ein bis zwei kurze Sätze, höchstens ${RESUME_ASK.summary} Zeichen. Was in diesem Schritt schon steht und was noch offen ist – konkret, mit den Begriffen der Person.
- nextAction: ein Satz, höchstens ${RESUME_ASK.nextAction} Zeichen, beginnt mit einem Verb in der Du-Form. Die eine konkrete Sache, die die Person in diesem Schritt als Nächstes tut: meist die offene Frage der Wirkungshelferin im Chat beantworten, sonst etwas im Baustein prüfen oder ergänzen oder den Schritt bestätigen.

Regeln: Deutsch, sprich die Person mit „du“ an. Keine IDs (wie tg1 oder ca2), kein Markdown. Keine Fristen, keine Termine, nichts über Zeit oder Aufwand. Schreib nur, was im Baustein oder im Gespräch steht.`

export const RESUME_FORMAT: BetaJSONOutputFormat = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { summary: { type: 'string' }, nextAction: { type: 'string' } },
    required: ['summary', 'nextAction'],
    additionalProperties: false,
  },
}

const statusText = { not_started: 'noch nicht begonnen', in_progress: 'in Arbeit', confirmed: 'bestätigt', maybe_outdated: 'bestätigt, aber vielleicht veraltet (ein früherer Schritt hat sich geändert)' } as const

/** The summary request: the block and the newest segment's end as plain text, effort low. */
export function resumeCall(project: Project, step: StepId): Call {
  const state = project.steps[step]
  const segment = state.segments.at(-1)
  if (!segment) throw new Error(`step ${step} has no chat to sum up`)
  const tail = { ...segment, messages: segment.messages.slice(-RESUME_MESSAGES) }
  return {
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `[Schritt ${step}, Status: ${statusText[state.status]}]\n\n[Baustein]\n${blockText(step, state.block)}\n\n[Ende des Gesprächs]\n${transcriptText(tail)}\n\n[Ende]\n\nSchreib summary und nextAction für die Startseite.`,
      },
    ],
    maxTokens: MAX_TOKENS.resume,
    effort: 'low',
    format: RESUME_FORMAT,
  }
}

export type ResumeText = { summary: string; nextAction: string }

/** Both fields of a complete answer; none for a refusal, a cut-off or unusable answer. */
export function resumeFrom(message: BetaMessage): ResumeText | undefined {
  if (message.stop_reason !== 'end_turn') return undefined
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const { summary, nextAction } = (parsed ?? {}) as Record<string, unknown>
  if (typeof summary !== 'string' || typeof nextAction !== 'string' || !summary.trim() || !nextAction.trim()) return undefined
  return { summary: summary.trim(), nextAction: nextAction.trim() }
}
