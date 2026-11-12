import type { BetaMessage, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { stepOf, type LooseBlock } from '../domain/block'
import { reducer } from '../domain/reducer'
import type { Project, StoredMessage } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { groupsOf, hardIssues, issueContext } from '../domain/check'
import { scrubContacts } from '../domain/contacts'
import { earlierChanges, stepList, type EarlierChange } from '../domain/outdated'
import { CHECK_REQUEST, checkEvents, parseCheck } from './check'
import { blockText, contextCurrent, contextText, contextUpdateText, historyMessages, nextTurn, pendingToolUses, snapshotText, sourceText, sourcesText, systemPrompt, withCacheBreakpoint } from './prompt'
import { checkErrorToolResult, checkToolResult, errorToolResult, proposalToolResult, toProposal } from './proposal'
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
    const errors = lastAnswer?.toolErrors?.[id]
    if (use?.name === CHECK) return errors ? checkErrorToolResult(id, errors) : checkToolResult(id)
    return errorToolResult(id, lastAnswer?.toolErrors?.[id] ?? ['Unbekannter Werkzeugaufruf.'])
  })
}

type TurnMeta = Meta & {
  /** The model of the settings; a segment this turn starts records it. */
  model?: string
  /** Start a new segment that carries this summary of the old one (summarise.ts); none = it failed. */
  newSegment?: { summary?: string }
  /** A source's full text, sent before the turn's text (a paste). */
  source?: string
  /** The button behind an app turn; stored on the turn so the chat shows an app line. */
  act?: StoredMessage['act']
}

/** The answers to the old segment's open tool calls, as app lines: the new segment has no tool_use to answer. */
function carriedResults(project: Project, step: StepId): string[] {
  const pending = pendingToolUses(storedOf(project, step))
  return toolResultsFor(project, step, pending).map((r) => `Zu deinem letzten Werkzeugaufruf im vorigen Abschnitt: ${typeof r.content === 'string' ? r.content : ''}`)
}

/** Stores Lukas's turn (pending tool results, context in a segment's first turn or when the other steps changed, snapshot) and builds the request. */
export function prepareTurn(project: Project, step: StepId, text: string, { at, newId = defaultId, model, newSegment, source, act }: TurnMeta): Prepared {
  const next = structuredClone(project)
  const state = stepOf(next, step)
  const rolled = Boolean(newSegment && state.segments.length)
  const events = [...(rolled ? carriedResults(project, step) : []), ...checkEvents(project, step)]
  if (rolled) state.segments.push({ id: newId(), startedAt: at, ...(model && { model }), ...(newSegment?.summary && { summaryOfPrevious: newSegment.summary }), messages: [] })
  const segment = currentSegment(next, step, at, newId, model)
  const first = !segment.messages.length
  const pending = pendingToolUses(segment.messages)
  const shown = structuredClone(state.block)
  // A new step 0 segment would lose the sources Claude read in the old one.
  const carried = step === 0 && sourcesText(state.block) ? `\n\n${sourcesText(state.block)}` : ''
  const context = rolled ? `${contextText(project, step)}${carried}\n\n${carriedText(newSegment?.summary)}` : contextText(project, step)
  const appended = nextTurn({
    pending,
    toolResults: rolled ? [] : toolResultsFor(project, step, pending),
    events,
    // Later turns carry the other steps again only when they changed since the segment last showed them.
    context: first ? context : contextCurrent(segment.messages, project, step) ? undefined : contextUpdateText(project, step),
    source,
    text,
    // A new segment always gets the full block.
    snapshot: snapshotText(
      step,
      shown,
      first ? undefined : (state.sentBlock as LooseBlock | undefined),
      hardIssues(step, shown, ...issueContext(next)).map((i) => i.text),
    ),
  })
  segment.messages.push(...appended.map((m, i) => ({ ...m, id: newId(), at, ...(act && i === appended.length - 1 && { act }) })))
  state.sentBlock = structuredClone(shown) as never
  return { project: next, call: chatCall(next, step), shown }
}

// ---------------------------------------------------------------- app turns (step 14)

/** Longest text a paste may carry (design §6.2, step 14): ~40k tokens. */
export const MAX_PASTE = 150_000

/** A button that sends a turn on Lukas's behalf (design §6.2 "App lines"). */
export type Act = { kind: 'paste' | 'pdf'; label: string; text: string } | { kind: 'interview' } | { kind: 'opening' } | { kind: 'review' }

/** True when a step's chat has no message yet. */
export const chatEmpty = (project: Project, step: StepId) => !project.steps[step].segments.some((s) => s.messages.length)

/**
 * The turn for a button: a paste or a read PDF (step 0) stores the source, then sends it in full once; the
 * interview (step 0, empty chat) and the opening (step 1 after step 0's confirm, empty chat)
 * tell Claude how to begin; the review (an outdated step) brings the changed earlier steps. Undefined when the act doesn't fit the step's state.
 */
export function prepareAct(project: Project, step: StepId, act: Act, meta: TurnMeta): Prepared | undefined {
  if (act.kind === 'opening') {
    if (step !== 1 || !chatEmpty(project, 1) || project.steps[0].status !== 'confirmed') return undefined
    return prepareTurn(project, step, `[App] ${OPENING}`, { ...meta, act: { kind: 'opening' } })
  }
  if (act.kind === 'review') {
    const changes = earlierChanges(project, step)
    if (!changes.length) return undefined
    return prepareTurn(project, step, `[App] ${REVIEW}`, { ...meta, source: changesText(changes), act: { kind: 'review', label: stepList(changes.map((c) => c.step)) } })
  }
  if (step !== 0) return undefined
  if (act.kind === 'interview') {
    if (!chatEmpty(project, 0)) return undefined
    return prepareTurn(project, step, `[App] ${INTERVIEW}`, { ...meta, act: { kind: 'interview' } })
  }
  if (act.text.trim().length > MAX_PASTE) return undefined
  // Contact data never reaches the store or a later request (PO 2026-11-08).
  const text = scrubContacts(act.text.trim()).text
  if (!text) return undefined
  const n = (project.idCounters.src ?? 0) + 1
  const label = act.label.trim() || (act.kind === 'pdf' ? `PDF ${n}` : `Eingefügter Text ${n}`)
  const added = reducer(project, { type: 'item/add', step: 0, collection: 'sources', fields: { origin: act.kind, label, text, at: meta.at } })
  if (added === project) return undefined
  const source = (added.steps[0].block.sources as { id: string }[]).at(-1)!.id
  const what =
    act.kind === 'pdf'
      ? `Die Person hat ein PDF hochgeladen: „${label}“ (${source}). Die App hat seinen Text ausgelesen; er steht direkt über dieser Zeile.`
      : `Die Person hat einen Text eingefügt: „${label}“ (${source}). Er steht direkt über dieser Zeile.`
  return prepareTurn(added, step, `[App] ${what}`, {
    ...meta,
    source: sourceText({ id: source, label, text }),
    act: { kind: act.kind, label, chars: text.length },
  })
}

const INTERVIEW = 'Die Person hat nichts Schriftliches und hat das Interview gestartet. Beginne mit dem Interview (Leitfaden Schritt 0, Abschnitt 4.1 „Ohne Dokument“).'
const OPENING =
  'Die Person hat Schritt 0 gerade bestätigt und öffnet jetzt Schritt 1. Beginne mit deiner Eröffnung (Leitfaden Schritt 1, Abschnitt 4.1): der erste Entwurf als Vorschlag und eine Frage.'

const REVIEW =
  'Die Person hat „Änderung prüfen lassen“ gedrückt: Seit dieser Schritt bestätigt wurde, wurde ein früherer Schritt geändert und neu bestätigt. Beide Fassungen stehen direkt über dieser Zeile. Sag knapp, was sich geändert hat und was das für diesen Baustein bedeutet. Muss hier etwas angepasst werden, schlag es als Vorschlag vor. Passt alles noch, sag das und bitte die Person, den Schritt erneut zu bestätigen. Den früheren Schritt änderst du nicht.'

/** Per changed earlier step: the version this step was built on and the one confirmed now (tech design §9). */
export function changesText(changes: EarlierChange[]): string {
  const day = (at: string) => at.slice(0, 10)
  return changes
    .map(
      (c) =>
        `[Schritt ${c.step}, wie bestätigt am ${day(c.then.at)} – darauf baut dieser Schritt auf]\n${blockText(c.step, c.then.block as LooseBlock)}\n\n` +
        `[Schritt ${c.step} jetzt, bestätigt am ${day(c.now.at)}]\n${blockText(c.step, c.now.block as LooseBlock)}`,
    )
    .join('\n\n')
}

/**
 * The gate's check request (design §6.2): the stored history plus one more user turn asking for
 * report_quality_check, so it reads the cached prefix. Nothing of it is stored; `shown` is the
 * block it judges.
 */
export function checkCall(project: Project, step: StepId, at: string): { call: Call; shown: LooseBlock } {
  const prepared = prepareTurn(project, step, `[App] ${CHECK_REQUEST}`, { at })
  // The breakpoint stays on the last stored turn: the check turn is never sent again, so
  // caching it would only pay for a write nothing reads.
  const history = historyMessages(storedOf(prepared.project, step))
  const messages = [...withCacheBreakpoint(history.slice(0, -1)), ...history.slice(-1)]
  return { call: { ...prepared.call, messages, maxTokens: MAX_TOKENS.check }, shown: prepared.shown }
}

/** The newest stored turn is Lukas's and has no answer yet (failed, or the tab closed while it ran). */
export function unanswered(project: Project, step: StepId): boolean {
  const last = storedOf(project, step).at(-1)
  return last?.role === 'user'
}

/**
 * The newest "Änderung prüfen lassen" turn is newer than the newest change it covers and got a
 * complete answer (design "Step 21"): a failed or stopped turn doesn't count.
 */
export function reviewed(project: Project, step: StepId): boolean {
  const newest = earlierChanges(project, step).map((c) => c.now.at).sort().at(-1)
  if (!newest) return false
  const messages = project.steps[step].segments.flatMap((s) => s.messages)
  const turn = messages.findLastIndex((m) => m.act?.kind === 'review')
  if (turn === -1 || messages[turn].at < newest) return false
  // Only the answer to this turn counts, not a later answer to another question.
  const answer = messages.slice(turn + 1).find((m) => m.role === 'assistant')
  return !!answer && !answer.aborted
}

/** A "Änderung prüfen lassen" turn is waiting for its answer. */
export const reviewPending = (project: Project, step: StepId) => storedOf(project, step).at(-1)?.act?.kind === 'review'

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
    if (block.name === CHECK) {
      // Claude checked on its own in the chat: the gate shows it for the block this turn showed.
      const check: ReturnType<typeof parseCheck> =
        answer.message.stop_reason === 'max_tokens' ? { ok: false, errors: ['Die Antwort wurde abgeschnitten.'] } : parseCheck(step, block.input)
      if (check.ok) next = reducer(next, { type: 'check/store', step, check: { at, source: 'chat', block: structuredClone(shown), results: check.results } as never })
      else toolErrors[block.id] = check.errors
      continue
    }
    if (block.name !== PROPOSE) {
      toolErrors[block.id] = [`Das Werkzeug ${block.name} gibt es hier nicht.`]
      continue
    }
    const proposalId = `p${next.steps[step].proposals.length + 1}`
    const result = toProposal(step, block.input, { seen: shown, toolUseId: block.id, proposalId, at, groups: groupsOf(project), step2: project.steps[2].block as unknown as LooseBlock, step3: project.steps[3].block as unknown as LooseBlock, step4: project.steps[4].block as unknown as LooseBlock, step5: project.steps[5].block as unknown as LooseBlock })
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
