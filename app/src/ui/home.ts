import { cut } from '../domain/check'
import { resumeCurrent } from '../domain/resume'
import type { Project, Proposal, StoredMessage } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { closingQuestion } from './chat/question'
import { dayText } from './chat/sessions'
import { recommendedStep, statusesOf } from './steps'

// What the home card shows (design §6.1 "Step 22"). Pure, so every state has a unit test.

/** The card's limits: the prompt asks for less (ai/resume.ts), this guards the layout. */
export const CARD_LIMITS = { summary: 320, nextAction: 180, question: 240 } as const

export type CardBody =
  /** B: the step's summary covers its newest activity. */
  | { kind: 'summary'; summary: string; nextAction: string }
  /** C: the last answer's question. */
  | { kind: 'question'; question: string }
  /** C: Lukas's last message has no answer (failed or stopped). */
  | { kind: 'unanswered' }
  /** A, C without a question, E for a step not begun: the step's lead. */
  | { kind: 'lead' }
  /** E: the recommended step may be outdated. */
  | { kind: 'outdated' }

export type HomeCard =
  /** B, C (D = C while the summary is written): the last active step isn't confirmed. */
  | { kind: 'resume'; step: StepId; body: CardBody }
  /** A (fresh), E (with the step just confirmed): the recommended step. */
  | { kind: 'next'; step: StepId; body: CardBody; fresh: boolean; confirmed?: { step: StepId; at: string } }
  /** F */
  | { kind: 'done' }

/** Chat markup the card doesn't show: a link there would be a second action (UI/UX M2). */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/^[ \t]*(?:#+|[-•]|\d+\.)[ \t]+/gm, '')
    .trim()
}

const texts = (message: StoredMessage) =>
  message.content.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))

/** The question an answer asked: its card's question (step 18b), else its last sentence ending in "?". */
export function questionOf(message: StoredMessage, proposals: Proposal[]): string | undefined {
  const ids = new Set(message.content.flatMap((b) => (b.type === 'tool_use' && typeof b.id === 'string' ? [b.id] : [])))
  const asked = closingQuestion(proposals.filter((p) => ids.has(p.toolUseId)))
  if (asked) return plainText(asked)
  const sentences = plainText(texts(message).join('\n\n')).split(/(?<=[.!?…])\s+|\n+/)
  return sentences.findLast((s) => s.trim().endsWith('?'))?.trim()
}

/** B or C for a step with a chat. */
function bodyOf(project: Project, step: StepId): CardBody {
  const resume = resumeCurrent(project, step)
  // Plain text even if Claude ignored "kein Markdown": a link or asterisks don't belong on the card.
  if (resume) return { kind: 'summary', summary: cut(plainText(resume.summary), CARD_LIMITS.summary), nextAction: cut(plainText(resume.nextAction), CARD_LIMITS.nextAction) }
  const state = project.steps[step]
  const last = state.segments.at(-1)?.messages.findLast((m) => m.role !== 'system')
  if (!last) return { kind: 'lead' }
  if (last.role === 'user' || last.aborted) return { kind: 'unanswered' }
  const question = questionOf(last, state.proposals)
  return question ? { kind: 'question', question: cut(question, CARD_LIMITS.question) } : { kind: 'lead' }
}

export function homeCard(project: Project): HomeCard {
  const active = project.lastActive
  const statuses = statusesOf(project)
  if (active && statuses[active.stepId] !== 'done') return { kind: 'resume', step: active.stepId, body: bodyOf(project, active.stepId) }
  const next = recommendedStep(statuses)
  if (next === null) return { kind: 'done' }
  const state = project.steps[next]
  const body: CardBody =
    statuses[next] === 'stale' ? { kind: 'outdated' } : state.segments.some((s) => s.messages.length) ? bodyOf(project, next) : { kind: 'lead' }
  const at = active && project.steps[active.stepId].confirmed?.at
  return {
    kind: 'next',
    step: next,
    body,
    fresh: !active && Object.values(statuses).every((s) => s === 'todo'),
    ...(active && at && { confirmed: { step: active.stepId, at } }),
  }
}

/** "heute" / "gestern" / "am 05.11." */
const onDay = (at: string, now: Date) => {
  const day = dayText(at, now)
  return day === 'heute' || day === 'gestern' ? day : `am ${day}`
}

/** "Schritt 2 hast du heute bestätigt." (state E) */
export const confirmedLine = (step: StepId, at: string, now: Date) => `Schritt ${step} hast du ${onDay(at, now)} bestätigt.`

/** A step row's status line (design §6.1 item 3): the confirmed one carries its date. */
export function rowStatus(project: Project, step: StepId, now: Date): string {
  const state = project.steps[step]
  switch (state.status) {
    case 'confirmed':
      return state.confirmed ? `bestätigt ${onDay(state.confirmed.at, now)}` : 'bestätigt'
    case 'in_progress':
      return 'in Arbeit'
    case 'maybe_outdated':
      return 'vielleicht veraltet – prüfen'
    default:
      return 'noch nicht begonnen'
  }
}
