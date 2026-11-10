import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { findItem, type LooseBlock } from '../domain/block'
import { changeView } from '../domain/proposals'
import { TEMP_ID, proposal as proposalSchema, type Project, type Proposal, type ProposalChange } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { FOCUS_REASONS, type Item } from '../domain/schemas/blocks'
import { endOf } from '../domain/chain'
import { INDICATOR_MAX, PER_QUESTION_MAX, QUESTION_MAX, isCandidate } from '../domain/focus'
import { MAX_DEPTH, NON_FOCUS_KEEPS, TREES, depthOf, heightOf } from '../domain/tree'
import { proposeInput, type ProposeInput } from './tools'

// From a propose_changes call to a Proposal, and from Lukas's decisions back to the
// tool_result (tech design §6.3, §6.4). The input is checked before anything is shown:
// a broken call becomes an error tool_result, never a broken card.

export type ToProposal = {
  /** The block exactly as the snapshot sent with the request showed it. */
  seen: LooseBlock
  toolUseId: string
  proposalId: string
  at: string
  /** Step 1's target groups now: steps 2–4 hang items on them (checked by `groupErrors`). */
  groups?: Item[]
  /** Step 2's block now: step 3's goals point to its causes and core problems. */
  step2?: LooseBlock
  /** Step 3's block now: step 4's links end at its goals; step 5's questions test them. */
  step3?: LooseBlock
  /** Step 4's block now: step 5's questions test its links, deferrals name its candidates. */
  step4?: LooseBlock
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; errors: string[] }

export function toProposal(step: StepId, input: unknown, { seen, toolUseId, proposalId, at, groups = [], step2, step3, step4 }: ToProposal): ProposalResult {
  const parsed = proposeInput(step).safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`) }
  }
  const { summary, changes, question } = parsed.data as ProposeInput
  const errors: string[] = []
  const temps = new Set<string>()
  /** Fields of the items this proposal creates, as its earlier changes leave them. */
  const created = new Map<string, Record<string, unknown>>()
  const result: ProposalChange[] = []

  changes.forEach((change, index) => {
    const n = index + 1
    // Step 5: reasons in the checkboxes' order, so a mere reordering is no change.
    if (Array.isArray(change.fields?.reasons)) change.fields.reasons = FOCUS_REASONS.filter((r) => (change.fields!.reasons as string[]).includes(r))
    const base = { id: `${proposalId}c${result.length + 1}`, collection: change.collection, state: 'open' as const }
    if (change.op === 'add') {
      if (!TEMP_ID.test(change.id)) return void errors.push(`Änderung ${n}: add braucht eine vorläufige ID wie new:1, nicht "${change.id}".`)
      if (temps.has(change.id)) return void errors.push(`Änderung ${n}: die vorläufige ID ${change.id} kommt doppelt vor.`)
      temps.add(change.id)
      created.set(change.id, change.fields!)
      result.push({ ...base, op: 'add', tempId: change.id, fields: change.fields })
      return
    }
    if (TEMP_ID.test(change.id)) {
      // A change to an item this proposal creates: diffed against the fields it is created with,
      // so the tool's required "" values never clear what the add just set.
      if (!temps.has(change.id)) return void errors.push(`Änderung ${n}: ${change.id} wird in diesem Vorschlag nicht vorher angelegt.`)
      if (change.op === 'remove') return void errors.push(`Änderung ${n}: ein neues Element im selben Vorschlag wieder zu entfernen ist nicht nötig.`)
      const before = created.get(change.id)!
      const fields = changedFields(before, change.fields!)
      if (!Object.keys(fields).length) return
      created.set(change.id, { ...before, ...fields })
      result.push({ ...base, op: 'update', targetId: change.id, fields })
      return
    }
    const found = findItem(seen, change.collection, change.id)
    if (!found) return void errors.push(`Änderung ${n}: ${change.id} gibt es in „${change.collection}“ nicht.`)
    if (change.op === 'remove') {
      // Step 5: removing a question takes its indicators with it, so their own removals would only show "veraltet".
      const withQuestion = step === 5 && change.collection === 'indicators' && changes.some((c) => c.op === 'remove' && c.collection === 'focusQuestions' && c.id === found.item.focusQuestionId)
      if (withQuestion) return
      result.push({ ...base, op: 'remove', targetId: change.id, baseRev: found.item.rev })
      return
    }
    const fields = changedFields(found.item, change.fields!)
    // Nothing differs from what Claude saw: no change to show.
    if (!Object.keys(fields).length) return
    result.push({ ...base, op: 'update', targetId: change.id, baseRev: found.item.rev, fields })
  })

  // A temp id in fields must be created in this proposal, or the card would only show "veraltet".
  result.forEach((change, i) => {
    for (const temp of tempIdsIn(change.fields)) {
      if (!temps.has(temp)) errors.push(`Änderung ${i + 1}: ${temp} wird in diesem Vorschlag nicht angelegt.`)
    }
  })

  if (!errors.length) errors.push(...groupErrors(step, seen, result, groups, step2, step3))
  if (!errors.length && step === 5) errors.push(...focusErrors(seen, result, groups, step3, step4))
  if (errors.length) return { ok: false, errors }
  if (!result.length) return { ok: false, errors: ['Der Vorschlag ändert nichts am Baustein.'] }
  // An empty question is no reason to lose the card (design §6.2 "Step 18b"): it just shows no line.
  const asked = question.trim()
  const proposal = proposalSchema.safeParse({ id: proposalId, toolUseId, at, summary, ...(asked && { question: asked }), changes: result })
  if (!proposal.success) return { ok: false, errors: proposal.error.issues.map((i) => i.message) }
  return { ok: true, proposal: proposal.data }
}

/**
 * Steps 2–4 (design §6.2 "Step 16"): every item the proposal touches hangs on a step 1 target
 * group; a non-focus group keeps only its core problem; one core problem per group; a parent
 * is in the same list and group, at most three levels deep. Judged on the block as it would
 * look with every change applied, so the order of changes doesn't matter.
 */
function groupErrors(step: StepId, seen: LooseBlock, changes: ProposalChange[], groups: Item[], step2?: LooseBlock, step3?: LooseBlock): string[] {
  const keeps = NON_FOCUS_KEEPS[step]
  if (!keeps) return []
  const { after, touched } = applied(seen, changes)
  const errors: string[] = []
  for (const { n, collection, id } of touched) {
    const list = after[collection]
    const item = list.find((x) => x.id === id)
    if (!item || typeof item.groupId !== 'string') continue
    // Step 4: an external factor with groupId "" concerns all focus groups (design "Step 18").
    if (collection === 'externalFactors' && !item.groupId) continue
    const group = groups.find((g) => g.id === item.groupId)
    if (!group) {
      errors.push(`Änderung ${n}: groupId "${item.groupId}" ist keine Zielgruppe aus Schritt 1.`)
      continue
    }
    if (!group.isFocus && !keeps.includes(collection)) errors.push(`Änderung ${n}: „${group.name}“ ist keine Fokusgruppe; dafür gibt es hier nur ${keeps.join(', ')}.`)
    if (collection === 'problems' && list.filter((x) => x.groupId === item.groupId).length > 1) {
      errors.push(`Änderung ${n}: „${group.name}“ hat schon ein Kernproblem. Ändere das vorhandene (update), statt ein zweites anzulegen.`)
    }
    if (step === 3) errors.push(...goalErrors(n, collection, item, group, after, step2))
    if (step === 4) errors.push(...chainErrors(n, collection, item, group, after, step3))
    if (!TREES[step]?.includes(collection)) continue
    const parent = item.parentId as string
    if (parent) {
      const p = list.find((x) => x.id === parent)
      if (!p) errors.push(`Änderung ${n}: parentId "${parent}" gibt es in „${collection}“ nicht.`)
      else if (p.groupId !== item.groupId) errors.push(`Änderung ${n}: parentId "${parent}" gehört zu einer anderen Gruppe.`)
    }
    if (depthOf(list, item) + heightOf(list, item) > MAX_DEPTH) errors.push(`Änderung ${n}: höchstens ${MAX_DEPTH} Ebenen (direkt, darunter, darunter).`)
  }
  return errors
}

/** The lists as they would look with every change applied, and the items the changes add or update. */
function applied(seen: LooseBlock, changes: ProposalChange[]) {
  const after: Record<string, Item[]> = {}
  for (const [name, slot] of Object.entries(seen)) if (Array.isArray(slot)) after[name] = slot.map((i) => ({ ...i }))
  const touched: { n: number; collection: string; id: string }[] = []
  changes.forEach((c, i) => {
    const list = after[c.collection]
    if (!list) return
    const id = c.op === 'add' ? c.tempId! : c.targetId!
    if (c.op === 'remove') {
      list.splice(list.findIndex((x) => x.id === id), 1)
      // Step 5: a question's indicators go with it (domain/focus.ts).
      if (c.collection === 'focusQuestions' && after.indicators) after.indicators = after.indicators.filter((x) => x.focusQuestionId !== id)
      return
    }
    if (c.op === 'add') list.push({ id, rev: 1, editedByUser: false, ...c.fields } as Item)
    else Object.assign(list.find((x) => x.id === id) ?? {}, c.fields)
    touched.push({ n: i + 1, collection: c.collection, id })
  })
  return { after, touched }
}

/**
 * Step 5 (design §6.2 "Step 19"): a question tests step 4 links and step 3 goals of focus
 * groups; at most 3 questions, 2 indicators each, 6 in total; an indicator's question exists; a
 * deferral names a current candidate, once, and never a link a question tests. Counted on the
 * block as it would look with every change applied.
 */
function focusErrors(seen: LooseBlock, changes: ProposalChange[], groups: Item[], step3?: LooseBlock, step4?: LooseBlock): string[] {
  const { after, touched } = applied(seen, changes)
  const focus = new Set(groups.filter((g) => g.isFocus).map((g) => g.id))
  const links = ((step4?.links as Item[]) ?? []).filter((l) => focus.has(l.groupId as string))
  const goals = ((step3?.goals as Item[]) ?? []).filter((g) => focus.has(g.groupId as string))
  const questions = after.focusQuestions ?? []
  const indicators = after.indicators ?? []
  const deferrals = after.deferredCandidates ?? []
  const errors: string[] = []
  const counts = touched.some((t) => t.collection === 'focusQuestions' || t.collection === 'indicators')
  if (counts && questions.length > QUESTION_MAX)
    errors.push(`Höchstens ${QUESTION_MAX} Lernfragen; der Vorschlag ergäbe ${questions.length}. Ergänze eine vorhandene Frage (update) oder entferne eine im selben Vorschlag.`)
  if (counts && indicators.length > INDICATOR_MAX) errors.push(`Höchstens ${INDICATOR_MAX} Indikatoren insgesamt; der Vorschlag ergäbe ${indicators.length}. Pflichtangaben gehören in mandatoryFigures, nicht unter die Indikatoren.`)
  for (const { n, collection, id } of touched) {
    const item = after[collection]?.find((x) => x.id === id)
    if (!item) continue
    if (collection === 'focusQuestions') {
      for (const ref of item.linkIds as string[]) {
        if (!links.some((l) => l.id === ref)) errors.push(`Änderung ${n}: linkIds "${ref}" ist keine Verbindung einer Fokusgruppe aus Schritt 4.`)
        const deferral = deferrals.find((d) => d.linkId === ref)
        if (deferral) errors.push(`Änderung ${n}: Die Annahme von ${ref} ist zurückgestellt (${deferral.id}). Nimmst du sie auf, entferne die Zurückstellung im selben Vorschlag (remove).`)
      }
      for (const ref of item.goalIds as string[]) if (!goals.some((g) => g.id === ref)) errors.push(`Änderung ${n}: goalIds "${ref}" ist kein Ziel einer Fokusgruppe aus Schritt 3.`)
    }
    if (collection === 'indicators') {
      const question = item.focusQuestionId as string
      if (!questions.some((q) => q.id === question)) errors.push(`Änderung ${n}: focusQuestionId "${question}" ist keine Lernfrage (auch keine, die dieser Vorschlag anlegt).`)
      else if (indicators.filter((i) => i.focusQuestionId === question).length > PER_QUESTION_MAX) errors.push(`Änderung ${n}: Höchstens ${PER_QUESTION_MAX} Indikatoren je Lernfrage (${question}).`)
    }
    if (collection === 'deferredCandidates') {
      const link = links.find((l) => l.id === item.linkId)
      if (!link || !isCandidate(link)) errors.push(`Änderung ${n}: linkId "${item.linkId}" ist kein Kandidat (eine kritische Verbindung einer Fokusgruppe mit Evidenz unsicher oder eigene Erfahrung).`)
      if (deferrals.filter((d) => d.linkId === item.linkId).length > 1) errors.push(`Änderung ${n}: ${item.linkId} ist schon zurückgestellt. Ändere die vorhandene Zurückstellung (update).`)
      if (questions.some((q) => (q.linkIds as string[]).includes(item.linkId as string)))
        errors.push(`Änderung ${n}: Eine Lernfrage prüft ${item.linkId} schon; eine Annahme ist aufgenommen oder zurückgestellt, nicht beides.`)
    }
  }
  return [...new Set(errors)]
}

/**
 * Step 3 (design §6.2 "Step 17"): a focus group's goal points to causes of that group, a
 * non-focus group's goal to its core problem (or causes it kept from being a focus group); a
 * level is either marked "trifft nicht zu" or has goals, never both, and is marked once.
 */
function goalErrors(n: number, collection: string, item: Item, group: Item, after: Record<string, Item[]>, step2?: LooseBlock): string[] {
  const errors: string[] = []
  const name = group.name as string
  const sameLevel = (list: Item[]) => list.filter((x) => x.groupId === item.groupId && x.level === item.level)
  if (collection === 'goals') {
    const causes = ((step2?.causes as Item[]) ?? []).filter((c) => c.groupId === group.id)
    const problem = ((step2?.problems as Item[]) ?? []).find((p) => p.groupId === group.id)
    const allowed = new Set([...causes.map((c) => c.id), ...(group.isFocus || !problem ? [] : [problem.id])])
    for (const id of item.causeIds as string[]) {
      if (allowed.has(id)) continue
      errors.push(
        group.isFocus
          ? `Änderung ${n}: causeIds "${id}" ist keine Ursache von „${name}“ aus Schritt 2 (mehr). Verweise nur auf deren Ursachen; einen Verweis, den es nicht mehr gibt, lässt du weg.`
          : `Änderung ${n}: causeIds "${id}" passt nicht. „${name}“ ist keine Fokusgruppe; die App verknüpft ihre Ziele selbst mit ihrem Kernproblem – causeIds ist [].`,
      )
    }
    const mark = sameLevel(after.levelNotApplicable ?? [])[0]
    if (group.isFocus && mark && (item.text as string)) {
      errors.push(`Änderung ${n}: Stufe ${item.level} ist für „${name}“ als „trifft nicht zu“ markiert (${mark.id}). Gibt es doch ein Ziel, entferne die Markierung im selben Vorschlag (remove).`)
    }
  }
  if (collection === 'levelNotApplicable') {
    if (sameLevel(after.levelNotApplicable).length > 1) errors.push(`Änderung ${n}: Stufe ${item.level} ist für „${name}“ schon als „trifft nicht zu“ markiert.`)
    if (sameLevel(after.goals ?? []).some((g) => g.text)) {
      errors.push(`Änderung ${n}: Stufe ${item.level} hat für „${name}“ schon Ziele. Eine Stufe hat Ziele oder ist „trifft nicht zu“, nicht beides.`)
    }
  }
  return errors
}

/**
 * Step 4 (design §6.2 "Step 18"): an external factor names all or a focus group; a link starts
 * at an activity or at an output / Stufe 4–5 goal of its own group, ends at an output or goal of
 * its own group at a higher level, and no two links of a group share start and end. Goals come
 * from step 3 (read-only here); outputs may be created in the same proposal (temp ids).
 */
function chainErrors(n: number, collection: string, item: Item, group: Item, after: Record<string, Item[]>, step3?: LooseBlock): string[] {
  const name = group.name as string
  if (collection === 'externalFactors') {
    return group.isFocus ? [] : [`Änderung ${n}: „${name}“ ist keine Fokusgruppe. Ein externer Faktor gilt für alle Fokusgruppen (groupId "") oder für eine davon.`]
  }
  if (collection !== 'links') return []
  const items = { activities: after.activities ?? [], outputs: after.outputs ?? [], goals: (step3?.goals as Item[]) ?? [], marks: [] }
  const from = endOf(items, group.id, item.fromId)
  const to = endOf(items, group.id, item.toId)
  const errors: string[] = []
  if (!from) errors.push(`Änderung ${n}: fromId "${item.fromId}" ist keine Aktivität und keine Leistung oder kein Ziel von „${name}“.`)
  else if (from.kind === 'goal' && from.level === 6) errors.push(`Änderung ${n}: Ein Ziel auf Stufe 6 ist das Ende der Kette; von dort geht keine Verbindung weiter.`)
  if (!to || to.kind === 'activity') errors.push(`Änderung ${n}: toId "${item.toId}" ist keine Leistung und kein Ziel von „${name}“.`)
  else if (from && to.level <= from.level) errors.push(`Änderung ${n}: Eine Verbindung führt nach oben – das Ende (Stufe ${to.level}) muss über dem Start (${from.level ? `Stufe ${from.level}` : 'Aktivität'}) liegen.`)
  const twins = (after.links ?? []).filter((l) => l.groupId === item.groupId && l.fromId === item.fromId && l.toId === item.toId)
  if (twins.length > 1) errors.push(`Änderung ${n}: Diese Verbindung gibt es für „${name}“ schon. Ändere die vorhandene (update).`)
  return errors
}

/** Fields where "" is a value, not a lazy blank: `parentId` "" = directly at the core problem (step 2). */
const MEANINGFUL_EMPTY = new Set(['parentId'])

const isEmpty = (value: unknown) => value === '' || (Array.isArray(value) && !value.length)

/**
 * Only the fields whose value differs from the seen item. An empty value never clears a
 * filled field: a lazily sent "" must not wipe what Lukas wrote (he can clear it himself).
 */
function changedFields(item: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => {
      const before = item[key] ?? ''
      if (isEmpty(value) && !isEmpty(before) && !MEANINGFUL_EMPTY.has(key)) return false
      return JSON.stringify(before) !== JSON.stringify(value)
    }),
  )
}

function tempIdsIn(value: unknown): string[] {
  if (typeof value === 'string') return TEMP_ID.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(tempIdsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(tempIdsIn)
  return []
}

const OP = { add: 'hinzufügen', update: 'ändern', remove: 'entfernen' } as const

/** What Lukas did with each change so far: the tool_result sent with his next message. */
export function proposalResultText(project: Project, step: StepId, proposal: Proposal): string {
  const lines = proposal.changes.map((change, i) => {
    const what = `${OP[change.op]} ${change.op === 'add' ? change.tempId : change.targetId} (${change.collection})`
    const view = changeView(project, step, proposal.id, change.id)
    const state = {
      applied: `übernommen${change.op === 'add' && change.resultId ? `, neue ID ${change.resultId}` : ''}`,
      rejected: 'abgelehnt',
      open: 'offen',
      blocked: 'offen',
      stale: 'veraltet',
    }[view.kind]
    return `${i + 1}. ${what}: ${state}`
  })
  return `Vorschlag ${proposal.id}:\n${lines.join('\n')}`
}

export function proposalToolResult(project: Project, step: StepId, proposal: Proposal): BetaToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: proposal.toolUseId, content: proposalResultText(project, step, proposal) }
}

export function errorToolResult(toolUseId: string, errors: string[]): BetaToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: `Vorschlag nicht angezeigt. Bitte korrigieren und neu vorschlagen:\n${errors.map((e) => `- ${e}`).join('\n')}`,
  }
}

/** A report_quality_check the app couldn't show. */
export function checkErrorToolResult(toolUseId: string, errors: string[]): BetaToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: `Qualitätscheck nicht angezeigt. Bitte korrigieren und neu melden:\n${errors.map((e) => `- ${e}`).join('\n')}`,
  }
}

/** The answer to report_quality_check. */
export function checkToolResult(toolUseId: string): BetaToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content: 'Qualitätscheck wird der Person angezeigt.' }
}
