import type { BetaMessage, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { stepOf, type LooseBlock } from '../domain/block'
import { reducer } from '../domain/reducer'
import type { Project, StoredMessage } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { contextText, historyMessages, nextTurn, pendingToolUses, snapshotText, systemPrompt, withCacheBreakpoint } from './prompt'
import { checkToolResult, errorToolResult, proposalToolResult, toProposal } from './proposal'
import { MAX_TOKENS, type Call } from './request'
import { carriedText } from './summarise'
import { CHECK, PROPOSE, stepTools } from './tools'

// One chat turn as pure functions (tech design §6.2): Lukas's turn is stored before the
// request goes out, so nothing he typed is lost when the answer fails or the tab reloads.
// The history is append-only; every function returns a new project.

export type Prepared = {
  /** The project with Lukas's turn stored. */
  project: Project
  call: Call
  /** The block exactly as this request's snapshot showed it (baseRev for proposals). */
  shown: LooseBlock
}

type Meta = { at: string; newId?: () => string }

const defaultId = () => crypto.randomUUID()

/** The segment new messages go into; the step's first message starts one. */
function currentSegment(project: Project, step: StepId, at: string, newId: () => string, model?: string) {
  const segments = project.steps[step].segments
  if (!segments.length) segments.push({ id: newId(), startedAt: at, ...(model && { model }), messages: [] })
  return segments[segments.length - 1]
}

const storedOf = (project: Project, step: StepId): StoredMessage[] => project.steps[step].segments.at(-1)?.messages ?? []

/** The request for the stored history of the current segment, as it stands. */
export function chatCall(project: Project, step: StepId): Call {
  return {
    system: systemPrompt(step),
    tools: stepTools(step),
    messages: withCacheBreakpoint(historyMessages(storedOf(project, step))),
    maxTokens: MAX_TOKENS.chat,
  }
}

/** The answer to each pending tool call: Lukas's decisions so far, or the errors found. */
export function toolResultsFor(project: Project, step: StepId, pending: string[]): BetaToolResultBlockParam[] {
  const lastAnswer = storedOf(project, step).findLast((m) => m.role === 'assistant' && !m.aborted)
  return pending.map((id) => {
    const proposal = project.steps[step].proposals.find((p) => p.toolUseId === id)
    if (proposal) return proposalToolResult(project, step, proposal)
    const use = lastAnswer?.content.find((b) => b.type === 'tool_use' && b.id === id)
    if (use?.name === CHECK) return checkToolResult(id)
    return errorToolResult(id, lastAnswer?.toolErrors?.[id] ?? ['Unbekannter Werkzeugaufruf.'])
  })
}

type TurnMeta = Meta & {
  /** The model of the settings; a segment this turn starts records it. */
  model?: string
  /** Start a new segment that carries this summary of the old one (summarise.ts); none = it failed. */
  newSegment?: { summary?: string }
}

/** The answers to the old segment's open tool calls, as app lines: the new segment has no tool_use to answer. */
function carriedResults(project: Project, step: StepId): string[] {
  const pending = pendingToolUses(storedOf(project, step))
  return toolResultsFor(project, step, pending).map((r) => `Zu deinem letzten Werkzeugaufruf im vorigen Abschnitt: ${typeof r.content === 'string' ? r.content : ''}`)
}

/** Stores Lukas's turn (pending tool results, context in a segment's first turn, snapshot) and builds the request. */
export function prepareTurn(project: Project, step: StepId, text: string, { at, newId = defaultId, model, newSegment }: TurnMeta): Prepared {
  const next = structuredClone(project)
  const state = stepOf(next, step)
  const rolled = Boolean(newSegment && state.segments.length)
  const events = rolled ? carriedResults(project, step) : []
  if (rolled) state.segments.push({ id: newId(), startedAt: at, ...(model && { model }), ...(newSegment?.summary && { summaryOfPrevious: newSegment.summary }), messages: [] })
  const segment = currentSegment(next, step, at, newId, model)
  const first = !segment.messages.length
  const pending = pendingToolUses(segment.messages)
  const shown = structuredClone(state.block)
  const context = rolled ? `${contextText(project, step)}\n\n${carriedText(newSegment?.summary)}` : contextText(project, step)
  const appended = nextTurn({
    pending,
    toolResults: rolled ? [] : toolResultsFor(project, step, pending),
    events,
    context: first ? context : undefined,
    text,
    // A new segment always gets the full block.
    snapshot: snapshotText(step, shown, first ? undefined : (state.sentBlock as LooseBlock | undefined)),
  })
  segment.messages.push(...appended.map((m) => ({ ...m, id: newId(), at })))
  state.sentBlock = structuredClone(shown) as never
  return { project: next, call: chatCall(next, step), shown }
}

/** The newest stored turn is Lukas's and has no answer yet (failed, or the tab closed while it ran). */
export function unanswered(project: Project, step: StepId): boolean {
  const last = storedOf(project, step).at(-1)
  return last?.role === 'user'
}

/** "Erneut versuchen": the same history once more, nothing new stored. */
export function prepareRetry(project: Project, step: StepId): Prepared | undefined {
  if (!unanswered(project, step)) return undefined
  const shown = structuredClone(stepOf(project, step).sentBlock ?? stepOf(project, step).block) as LooseBlock
  return { project, call: chatCall(project, step), shown }
}

export type Answer = { status: 'done'; message: BetaMessage } | { status: 'aborted'; partial?: BetaMessage }

/**
 * Appends the answer. A complete answer's propose_changes calls become proposals (invalid ones
 * keep their errors for the next turn's tool_result). A stopped answer is stored for display
 * only, with whatever had arrived, and never becomes a proposal.
 */
export function commitAnswer(project: Project, step: StepId, answer: Answer, shown: LooseBlock, { at, newId = defaultId }: Meta): Project {
  let next = structuredClone(project)
  const segment = currentSegment(next, step, at, newId)
  if (answer.status === 'aborted') {
    const content = structuredClone(answer.partial?.content ?? []) as unknown as StoredMessage['content']
    segment.messages.push({ id: newId(), at, role: 'assistant', content, aborted: true })
    return next
  }
  const content = structuredClone(answer.message.content) as unknown as StoredMessage['content']
  const toolErrors: Record<string, string[]> = {}
  for (const block of answer.message.content) {
    if (block.type !== 'tool_use') continue
    if (block.name === CHECK) continue
    if (block.name !== PROPOSE) {
      toolErrors[block.id] = [`Das Werkzeug ${block.name} gibt es hier nicht.`]
      continue
    }
    const proposalId = `p${next.steps[step].proposals.length + 1}`
    const result = toProposal(step, block.input, { seen: shown, toolUseId: block.id, proposalId, at })
    if (result.ok) next = reducer(next, { type: 'proposal/add', step, proposal: result.proposal })
    else toolErrors[block.id] = result.errors
  }
  const message: StoredMessage = { id: newId(), at, role: 'assistant', content }
  const usage = answer.message.usage
  if (usage) {
    const prompt = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    message.usage = { prompt, output: usage.output_tokens }
  }
  if (Object.keys(toolErrors).length) message.toolErrors = toolErrors
  next.steps[step].segments.at(-1)!.messages.push(message)
  return next
}
