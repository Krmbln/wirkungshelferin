import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { stepOf, type LooseBlock } from '../domain/block'
import { collections, itemBase, itemSchema, type Item } from '../domain/schemas/blocks'
import type { Project, StoredMessage } from '../domain/schemas/project'
import { stepIds, type StepId } from '../domain/types'
import { guideFiles, stepGuide } from '../guide'
import { operatingRules } from './rules'

// Prompt assembly, one request = one step (tech design §6.2). Order for caching:
// tools → system (rules + guide, stable per step) → messages. The history is append-only:
// the context message and every snapshot are stored inside the user turns that carried them.

/**
 * Where app events go after an assistant turn with tool calls:
 * - `system-between`: [user: tool_results] → [system: events] → [user: text + snapshot] (tech design's first idea)
 * - `system-after`:   [user: tool_results + text + snapshot] → [system: events]
 * - `single-user`:    [user: tool_results + "[App] …" events + text + snapshot]
 * A system message must end the array or come right before an assistant turn. A stopped answer
 * is never sent, so after a stop `system-after` leaves [system] → [user], which the API refuses.
 * Decided by `npm run contract` (2026-11-05): `single-user`.
 */
export type MessageOrder = 'system-between' | 'system-after' | 'single-user'
export const MESSAGE_ORDER: MessageOrder = 'single-user'

/** 1-hour TTL on both breakpoints: Lukas often pauses longer than 5 minutes between turns. */
const CACHE = { type: 'ephemeral', ttl: '1h' } as const

export function systemPrompt(step: StepId, order: MessageOrder = MESSAGE_ORDER): string {
  const file = stepGuide(step)
  const part = (name: string, text: string) => `==================== ${name} ====================\n${text}`
  return [
    operatingRules(step, order === 'single-user' ? 'text' : 'system'),
    part('00-shared.md', guideFiles['00-shared.md']),
    part('glossary.md', guideFiles['glossary.md']),
    part(file.name, file.text),
  ].join('\n\n')
}

// ---------------------------------------------------------------- block text

/**
 * Bookkeeping first, then the fields in schema order, the Why last: stable bytes for the cache.
 * A source's text is left out (its length instead): Claude read it once in the turn that
 * brought it, and repeating it in every snapshot would cost its tokens on every turn.
 */
function itemLine(step: StepId, collection: string, item: Item): string {
  const keys = Object.keys(itemSchema(step, collection)!.shape).filter((k) => !(k in itemBase))
  const ordered: Record<string, unknown> = { id: item.id, rev: item.rev, editedByUser: item.editedByUser }
  const userOnly = (collections[step] as Record<string, { userOnly?: true }>)[collection].userOnly
  for (const key of keys) {
    if (item[key] === undefined) continue
    if (userOnly && key === 'text') ordered.chars = (item.text as string).length
    else ordered[key] = item[key]
  }
  if ((collections[step] as Record<string, { why?: true }>)[collection].why) ordered.why = item.why ?? ''
  return JSON.stringify(ordered)
}

export function blockText(step: StepId, block: LooseBlock): string {
  return Object.keys(collections[step])
    .map((name) => {
      const slot = block[name]
      if (!Array.isArray(slot)) return `${name}: ${itemLine(step, name, slot)}`
      if (!slot.length) return `${name}: (leer)`
      return `${name}:\n${slot.map((item) => `- ${itemLine(step, name, item)}`).join('\n')}`
    })
    .join('\n')
}

/** The block as the assistant sees it, at the end of the newest user turn (tech design §6.2 item 6). */
export function snapshotText(step: StepId, block: LooseBlock, previous?: LooseBlock, issues: string[] = []): string {
  if (previous && blockText(step, previous) === blockText(step, block)) return '[Baustein unverändert]'
  const open = issues.length ? `\n⛔ offen:\n${issues.map((i) => `- ${i}`).join('\n')}` : ''
  return `[Bausteinstand Schritt ${step}]\n${blockText(step, block)}${open}`
}

/** One source with its full text, as the turn that brings it and step 1's context show it. */
export function sourceText(source: Pick<Item, 'id'> & { label: string; text: string }): string {
  return `[Quelle ${source.id}: „${source.label}“]\n${source.text}`
}

/**
 * Step 0's sources in full: step 1 drafts from them (guide step 0 §2 "die Quelle für Schritt 1"),
 * and a new step 0 segment would otherwise lose them. Steps 2–6 see the profile only.
 */
export function sourcesText(block: LooseBlock): string {
  const sources = block.sources as (Item & { label: string; text: string })[]
  if (!sources.length) return ''
  return `[Quellen aus Schritt 0, voller Text]\n\n${sources.map(sourceText).join('\n\n')}`
}

/** The other steps: latest confirmed version, otherwise the draft marked "nicht bestätigt". */
export function contextText(project: Project, step: StepId): string {
  return `[Projektstand]\nDie anderen Schritte dieses Projekts. Du liest sie, änderst sie aber nie.\n\n${contextBody(project, step)}`
}

/**
 * The other steps again, mid-segment, when they changed since the segment last showed them
 * (step 25a: a step confirmed while this chat ran stayed "noch nicht begonnen" for Claude).
 */
export function contextUpdateText(project: Project, step: StepId): string {
  return `[Projektstand aktualisiert]\nDie anderen Schritte, wie sie jetzt sind. Dieser Stand ersetzt jeden früheren.\n\n${contextBody(project, step)}`
}

/**
 * Whether the newest [Projektstand…] block in these stored messages still shows the other steps as
 * they are. The body is matched between blank lines: a segment's first context can carry more
 * after it (sources, the summary of the previous segment).
 */
export function contextCurrent(stored: StoredMessage[], project: Project, step: StepId): boolean {
  const body = contextBody(project, step)
  for (const message of [...stored].reverse()) {
    if (message.role !== 'user') continue
    const block = message.content.find((b) => b.type === 'text' && String(b.text).startsWith('[Projektstand'))
    if (!block) continue
    const text = String(block.text)
    return text.endsWith(`\n\n${body}`) || text.includes(`\n\n${body}\n\n`)
  }
  return false
}

function contextBody(project: Project, step: StepId): string {
  const parts = stepIds
    .filter((s) => s !== step)
    .map((s) => {
      const state = stepOf(project, s)
      if (state.confirmed) {
        const outdated = state.status === 'maybe_outdated' ? ', vielleicht veraltet' : ''
        return `## Schritt ${s} (bestätigt am ${state.confirmed.at.slice(0, 10)}${outdated})\n${blockText(s, state.confirmed.block as LooseBlock)}`
      }
      if (state.status === 'not_started') return `## Schritt ${s}: noch nicht begonnen`
      return `## Schritt ${s} (nicht bestätigt, Entwurf)\n${blockText(s, state.block)}`
    })
  const step0 = stepOf(project, 0)
  const sources = step === 1 ? sourcesText((step0.confirmed?.block ?? step0.block) as LooseBlock) : ''
  return `${parts.join('\n\n')}${sources && `\n\n${sources}`}`
}

// ---------------------------------------------------------------- messages

/** The stored history as the API gets it: stopped turns left out, local metadata dropped. */
export function historyMessages(stored: StoredMessage[]): BetaMessageParam[] {
  return stored
    .filter((m) => !m.aborted)
    .map((m) => ({ role: m.role, content: m.content }) as unknown as BetaMessageParam)
}

/** tool_use ids of the last sent assistant turn that still need a tool_result. */
export function pendingToolUses(stored: StoredMessage[]): string[] {
  const sent = stored.filter((m) => !m.aborted && m.role !== 'system')
  const last = sent.at(-1)
  if (last?.role !== 'assistant') return []
  return last.content.filter((b) => b.type === 'tool_use').map((b) => b.id as string)
}

export type Turn = {
  /** The tool_use ids waiting for a result (pendingToolUses of the stored history). */
  pending: string[]
  /** Exactly one per pending id, in any order. */
  toolResults?: BetaToolResultBlockParam[]
  /** What Lukas did in the app since the last turn, one sentence each. */
  events?: string[]
  /** The context message: only in the first user turn of a segment. */
  context?: string
  /** A source Lukas just added (sourceText), in full, before his text. */
  source?: string
  text: string
  snapshot: string
}

type NewMessage = Pick<StoredMessage, 'role' | 'content'>

const textBlock = (text: string): BetaTextBlockParam => ({ type: 'text', text })

/**
 * The messages to append (and store) for Lukas's next turn, in the decided order.
 * Throws if the tool results don't answer exactly the pending tool calls: the API would refuse
 * the turn, and once stored it could never be fixed (append-only).
 */
export function nextTurn(turn: Turn, order: MessageOrder = MESSAGE_ORDER): NewMessage[] {
  const answered = (turn.toolResults ?? []).map((r) => r.tool_use_id)
  const expected = [...turn.pending].sort().join()
  if (answered.length !== new Set(answered).size || [...answered].sort().join() !== expected) {
    throw new Error(`tool results ${answered.join(',') || '-'} don't match pending ${turn.pending.join(',') || '-'}`)
  }
  const results: BetaContentBlockParam[] = turn.toolResults ?? []
  const events = turn.events ?? []
  const own = [...(turn.context ? [textBlock(turn.context)] : []), ...(turn.source ? [textBlock(turn.source)] : []), textBlock(turn.text), textBlock(turn.snapshot)]
  const system = (): NewMessage => ({ role: 'system', content: [textBlock(events.join('\n'))] as never })
  const user = (content: BetaContentBlockParam[]): NewMessage => ({ role: 'user', content: content as never })

  if (order === 'single-user') {
    const lines = events.length ? [textBlock(events.map((e) => `[App] ${e}`).join('\n'))] : []
    return [user([...results, ...lines, ...own])]
  }
  if (order === 'system-between' && results.length) {
    return [user(results), ...(events.length ? [system()] : []), user(own)]
  }
  return [user([...results, ...own]), ...(events.length ? [system()] : [])]
}

/**
 * What Lukas wrote in a stored user turn. nextTurn always ends his turn with [his text, snapshot],
 * so it is the text block before the last one.
 */
export function lukasText(message: Pick<StoredMessage, 'role' | 'content'>): string | undefined {
  if (message.role !== 'user' || message.content.length < 2) return undefined
  const block = message.content[message.content.length - 2]
  return block.type === 'text' ? (block.text as string) : undefined
}

/** A copy with the second breakpoint on the newest user turn, so the history caches turn by turn. */
export function withCacheBreakpoint(messages: BetaMessageParam[]): BetaMessageParam[] {
  const index = messages.findLastIndex((m) => m.role === 'user')
  if (index === -1) return messages
  const copy = structuredClone(messages)
  const content = copy[index].content as string | BetaContentBlockParam[]
  const blocks: BetaContentBlockParam[] = typeof content === 'string' ? [textBlock(content)] : content
  if (!blocks.length) return messages
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: CACHE } as BetaContentBlockParam
  copy[index] = { ...copy[index], content: blocks } as BetaMessageParam
  return copy
}
