import { findItem, stepOf, type LooseBlock } from '../../domain/block'
import { canUndo, changeView, type ChangeView, type StaleReason } from '../../domain/proposals'
import { collectionMeta, type Item } from '../../domain/schemas/blocks'
import type { Project, Proposal, ProposalChange } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import type { ChipKind } from '../components/Chip'
import { FORM_LABELS, FORMS, formEmpty, isBlank, isOffen, type FormName } from '../../domain/profile'

// What a proposal row says (design §6.2 "Proposal card"). Pure, so the wording is tested
// without rendering. Field labels for steps 2–6 follow with their blocks (steps 16–20).

type FieldInfo = {
  label: string
  /** Display text per stored value (enums). */
  values?: Record<string, string>
  /** Short field shown on a NEU row's meta line: an enum's value, a true boolean's label. */
  short?: true
  /** A reference the row says in its own words (group in the noun, parent in the meta), never as a field. */
  ref?: true
}

type CollectionInfo = { noun: string; main: string; fields?: Record<string, FieldInfo> }

const why: FieldInfo = { label: 'Warum?' }

/** Evidence labels in words (PRD F5), shared with the block's select. */
export const EVIDENCE: Record<string, string> = {
  unsicher: 'unsicher',
  eigene_erfahrung: 'eigene Erfahrung',
  eigene_daten: 'eigene Daten',
  forschung: 'Forschung/andere Projekte',
}

const group: FieldInfo = { label: 'Zielgruppe', ref: true }
const parent: FieldInfo = { label: 'Einordnung', ref: true }

/** "Wofür?" in words (design §6.2, step 14). */
export const PURPOSE: Record<string, string> = { geldgeberin: 'Bericht an die Geldgeberin', lernen: 'eigenes Lernen', beides: 'beides', offen: 'offen' }

function labelled(form: FormName): Record<string, FieldInfo> {
  return Object.fromEntries(Object.entries(FORM_LABELS[form]).map(([field, label]) => [field, { label }]))
}

const isForm = (step: StepId, collection: string) => step === 0 && (FORMS as string[]).includes(collection)

// `main` = the field that names an item; the other steps get their labels with their blocks.
const info: { [S in StepId]: Record<string, CollectionInfo> } = {
  // The forms are named by their noun alone: their rows list fields, not one name (step 14).
  0: {
    profile: { noun: 'Projektprofil', main: '', fields: labelled('profile') },
    frame: {
      noun: 'Messrahmen',
      main: '',
      fields: { ...labelled('frame'), purpose: { label: FORM_LABELS.frame.purpose, values: PURPOSE } },
    },
    sources: { noun: 'Quelle', main: 'label' },
  },
  1: {
    challenge: { noun: 'Herausforderung', main: 'text', fields: { text: { label: 'Herausforderung' }, why } },
    targetGroups: {
      noun: 'Zielgruppe',
      main: 'name',
      fields: {
        name: { label: 'Name' },
        description: { label: 'Beschreibung' },
        reach: { label: 'Erreicht', values: { direct: 'direkt', indirect: 'indirekt' }, short: true },
        isFocus: { label: 'Fokusgruppe', short: true },
        sizeEstimate: { label: 'Größe' },
        why,
      },
    },
    stakeholders: { noun: 'Beteiligte', main: 'role', fields: { role: { label: 'Rolle' }, expectations: { label: 'Erwartungen' } } },
  },
  2: {
    problems: { noun: 'Kernproblem', main: 'coreProblem', fields: { groupId: group, coreProblem: { label: 'Kernproblem' }, why } },
    causes: {
      noun: 'Ursache',
      main: 'text',
      fields: {
        groupId: group,
        parentId: parent,
        text: { label: 'Ursache' },
        evidence: { label: 'Evidenzbasis', values: EVIDENCE, short: true },
        notInfluenceable: { label: 'nicht beeinflussbar', short: true },
        why,
      },
    },
    consequences: { noun: 'Folge', main: 'text', fields: { groupId: group, parentId: parent, text: { label: 'Folge' } } },
  },
  3: {
    goals: { noun: 'Wirkungsziel', main: 'text' },
    levelNotApplicable: { noun: 'Stufe nicht zutreffend', main: 'level' },
    level7: { noun: 'Stufe 7', main: 'text' },
  },
  4: {
    resources: { noun: 'Ressource', main: 'text' },
    activities: { noun: 'Aktivität', main: 'text' },
    outputs: { noun: 'Leistung', main: 'text' },
    links: { noun: 'Verbindung', main: 'because' },
    externalFactors: { noun: 'Einflussfaktor', main: 'text' },
    sideEffects: { noun: 'Nebenwirkung', main: 'text' },
  },
  5: {
    focusQuestions: { noun: 'Lernfrage', main: 'text' },
    deferredCandidates: { noun: 'Zurückgestellt', main: 'reason' },
    indicators: { noun: 'Indikator', main: 'text' },
    mandatoryFigures: { noun: 'Pflichtangabe', main: 'name' },
  },
  6: { planRows: { noun: 'Erhebung', main: 'method' } },
}

function collectionInfo(step: StepId, collection: string): CollectionInfo {
  return info[step][collection] ?? { noun: 'Eintrag', main: 'text' }
}

function fieldInfo(step: StepId, collection: string, field: string): FieldInfo {
  return collectionInfo(step, collection).fields?.[field] ?? (field === 'why' ? why : { label: field })
}

export function formatValue(step: StepId, collection: string, field: string, value: unknown): string {
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return ''
  if (typeof value === 'boolean') return value ? 'ja' : 'nein'
  if (Array.isArray(value)) return value.map(String).join('; ')
  const text = String(value)
  return fieldInfo(step, collection, field).values?.[text] ?? text
}

/**
 * `before`: ÄNDERN only; '' = the field was empty ("bisher leer"). A form's field that was empty
 * has no `before`: it is listed compactly like a NEU row's field (design §6.2, step 14).
 * `offen`: the new value is the word "offen" (shown as the chip).
 */
export type FieldLine = { label: string; before?: string; after: string; offen?: boolean }

export type RowText = {
  kind: ChipKind
  /** The collection's singular noun, e.g. "Zielgruppe". */
  noun: string
  /** The item's name: its main field. '' for a singleton that is still empty (the noun names it). */
  main: string
  /** NEU: short facts ("direkt · Fokusgruppe"). */
  meta: string[]
  /** NEU: the other filled fields; ÄNDERN: each changed field, old and new. */
  fields: FieldLine[]
  /** A first draft into an empty form: one NEU row whose fields show right away, cut to 2 lines. */
  draft?: true
  /** A form's changed fields, for outline and highlight in the block (data-field). */
  changedFields?: string[]
}

/** The item a change points to: in the block, as it was before an applied change, or as last seen. */
function knownItem(project: Project, step: StepId, change: ProposalChange, id: string | undefined): Item | undefined {
  if (!id) return undefined
  const state = stepOf(project, step)
  const from = (block: LooseBlock | undefined) => (block ? findItem(block, change.collection, id)?.item : undefined)
  return (
    from(state.block) ??
    (change.undo?.before as Item | undefined) ??
    from(state.sentBlock as LooseBlock | undefined) ??
    from(state.confirmed?.block as LooseBlock | undefined)
  )
}

/** The block item a change creates or changes (temp ids resolved once their add is applied). */
export function targetItemId(proposal: Proposal, change: ProposalChange): string | undefined {
  if (change.op === 'add') return change.resultId
  const creator = proposal.changes.find((c) => c.op === 'add' && c.tempId === change.targetId)
  return creator ? creator.resultId : change.targetId
}

export function rowText(project: Project, step: StepId, proposal: Proposal, change: ProposalChange, view: ChangeView): RowText {
  const { noun, main: mainField } = collectionInfo(step, change.collection)
  const kind: ChipKind = view.kind === 'stale' ? 'stale' : change.op === 'add' ? 'new' : change.op === 'update' ? 'change' : 'remove'
  const fields = (change.fields ?? {}) as Record<string, unknown>
  const format = (field: string, value: unknown) => formatValue(step, change.collection, field, value)

  if (change.op === 'add') {
    const meta: string[] = []
    const lines: FieldLine[] = []
    for (const [field, value] of Object.entries(fields)) {
      if (field === mainField) continue
      const fi = fieldInfo(step, change.collection, field)
      if (fi.ref) continue
      if (fi.short) {
        if (typeof value === 'boolean') value && meta.push(fi.label)
        else if (format(field, value)) meta.push(format(field, value))
      } else if (format(field, value)) lines.push({ label: fi.label, after: format(field, value) })
    }
    const under = parentText(project, step, proposal, change.collection, fields.parentId)
    if (under) meta.push(`unter „${cut(under, 40)}“`)
    return { kind, noun: groupNoun(project, noun, fields.groupId), main: format(mainField, fields[mainField]) || `${noun} ohne Namen`, meta, fields: lines }
  }

  // The item before an applied update; otherwise as it is now (or was last seen), or as the
  // add of the same proposal creates it.
  const target = targetItemId(proposal, change)
  const creator = proposal.changes.find((c) => c.op === 'add' && c.tempId === change.targetId)
  const before =
    change.state === 'applied' && change.op === 'update'
      ? (change.undo?.before as Item | undefined)
      : (knownItem(project, step, change, target) ?? (creator?.fields as Item | undefined))
  // Never an internal id on screen (an empty singleton is named by its noun alone).
  if (change.op === 'update' && isForm(step, change.collection)) return formRow(step, change, before, view)
  const unnamed = collectionMeta(step, change.collection)?.singleton ? '' : `${noun} ohne Namen`
  const name = format(mainField, before?.[mainField]) || unnamed
  const placement = (id: unknown) => {
    const text = parentText(project, step, proposal, change.collection, id)
    return text ? `unter „${cut(text, 40)}“` : change.collection === 'causes' ? 'direkte Ursache' : 'direkte Folge'
  }
  const lines =
    change.op === 'update'
      ? Object.entries(fields)
          .filter(([field]) => field !== 'groupId')
          .map(([field, value]) =>
            field === 'parentId'
              ? { label: parent.label, before: placement(before?.parentId), after: placement(value) }
              : { label: fieldInfo(step, change.collection, field).label, before: format(field, before?.[field]), after: format(field, value) || '(leer)' },
          )
          .filter((line) => line.before !== line.after)
      : []
  const meta = change.op === 'remove' && change.state !== 'applied' ? movedUp(project, step, change.collection, target) : []
  return { kind, noun: groupNoun(project, noun, before?.groupId), main: name, meta, fields: lines }
}

/** Cut at `n` characters, at the last word boundary when one is near (design check step 16). */
function cut(text: string, n: number): string {
  if (text.length <= n) return text
  const head = text.slice(0, n - 1)
  const space = head.lastIndexOf(' ')
  return `${(space > n / 2 ? head.slice(0, space) : head).trimEnd()} …`
}

/** "Ursache · Kinder 8–12": steps 2–4 name the group an item hangs on (cut at 40 characters). */
function groupNoun(project: Project, noun: string, groupId: unknown): string {
  if (typeof groupId !== 'string' || !groupId) return noun
  const g = project.steps[1].block.targetGroups.find((t) => t.id === groupId)
  return `${noun} · ${cut(g?.name || 'Zielgruppe ohne Namen', 40)}`
}

/** The text of a parent: an item of the block, or one this proposal creates (by temp id). */
function parentText(project: Project, step: StepId, proposal: Proposal, collection: string, id: unknown): string | undefined {
  if (typeof id !== 'string' || !id) return undefined
  const creator = proposal.changes.find((c) => c.op === 'add' && c.tempId === id)
  const real = creator?.resultId ?? (creator ? undefined : id)
  const item = real ? findItem(stepOf(project, step).block, collection, real)?.item : undefined
  const text = (item?.text ?? creator?.fields?.text) as string | undefined
  return text || (item || creator ? 'ohne Text' : undefined)
}

/** ENTFERNEN of a tree item: "2 Ursachen darunter rücken eine Ebene hoch" (design §6.2, step 16). */
function movedUp(project: Project, step: StepId, collection: string, id: string | undefined): string[] {
  const list = stepOf(project, step).block[collection]
  if (!id || !Array.isArray(list) || !list.some((i) => 'parentId' in i)) return []
  return movedUpText(collection, list.filter((i) => i.parentId === id).length)
}

/** Shared with the block's undo line. */
export function movedUpText(collection: string, n: number): string[] {
  if (!n) return []
  const noun = collection === 'causes' ? (n === 1 ? 'Ursache' : 'Ursachen') : n === 1 ? 'Folge' : 'Folgen'
  return [`${n} ${noun} darunter ${n === 1 ? 'rückt' : 'rücken'} eine Ebene hoch`]
}

/**
 * An update of a step 0 form. Into a still empty form it reads as one NEU row (a first draft);
 * otherwise as ÄNDERN, where fields that were empty are listed compactly and only filled ones
 * show old → new, so a draft after Lukas typed just the name stays short.
 */
function formRow(step: StepId, change: ProposalChange, before: Item | undefined, view: ChangeView): RowText {
  const form = change.collection as FormName
  const fields = Object.entries((change.fields ?? {}) as Record<string, unknown>)
  const draft = !before || formEmpty(before, form)
  // A list's entries on their own lines (an entry may contain "; " itself).
  const format = (field: string, value: unknown) => (Array.isArray(value) ? value.map(String).join('\n') : formatValue(step, form, field, value))
  const lines: FieldLine[] = fields
    .filter(([field, value]) => format(field, before?.[field]) !== format(field, value))
    .map(([field, value]) => {
      const line: FieldLine = { label: fieldInfo(step, form, field).label, after: format(field, value) || '(leer)' }
      if (isOffen(value)) line.offen = true
      if (!draft && !isBlank(before?.[field])) line.before = format(field, before?.[field])
      return line
    })
  const kind: ChipKind = view.kind === 'stale' ? 'stale' : draft ? 'new' : 'change'
  return { kind, noun: collectionInfo(step, form).noun, main: '', meta: [], fields: lines, changedFields: fields.filter(([f, v]) => format(f, before?.[f]) !== format(f, v)).map(([f]) => f), ...(draft && { draft: true as const }) }
}

export function staleText(project: Project, step: StepId, proposal: Proposal, change: ProposalChange, reason: StaleReason): string {
  switch (reason) {
    case 'edited': {
      const item = knownItem(project, step, change, targetItemId(proposal, change))
      return item?.editedByUser ? 'du hast das inzwischen geändert' : 'hat sich inzwischen geändert'
    }
    case 'removed':
      return 'gibt es nicht mehr'
    case 'unknown_target':
      return 'Eintrag nicht gefunden'
    case 'creator_unavailable':
      return 'hängt an einer abgelehnten oder veralteten Änderung'
    case 'invalid':
      return 'passt nicht zum Baustein'
    case 'hidden':
      return 'gehört zu einer Gruppe, die keine Fokusgruppe mehr ist'
  }
}

/** "zuerst ‚Neu: Stammgäste' übernehmen" for a change that needs another one first. */
export function blockedText(project: Project, step: StepId, proposal: Proposal, needs: string): string {
  const creator = proposal.changes.find((c) => c.id === needs)
  const name = creator ? rowText(project, step, proposal, creator, { kind: 'open' }).main : 'die andere Änderung'
  return `zuerst ‚Neu: ${name}‘ übernehmen`
}

export type Row = { change: ProposalChange; view: ChangeView; text: RowText; undoable: boolean }

export function proposalRows(project: Project, step: StepId, proposal: Proposal): Row[] {
  return proposal.changes.map((change) => {
    const view = changeView(project, step, proposal.id, change.id)
    return { change, view, text: rowText(project, step, proposal, change, view), undoable: canUndo(project, step, proposal.id, change.id) }
  })
}

const isOpen = (view: ChangeView) => view.kind === 'open' || view.kind === 'blocked'

/** Open changes of a proposal ("Alle übernehmen" from two on). */
export function openCount(project: Project, step: StepId, proposal: Proposal): number {
  return proposal.changes.filter((c) => isOpen(changeView(project, step, proposal.id, c.id))).length
}

/** Open changes in the step's chat, and the oldest proposal that has one ("offene Änderungen" line). */
export function openProposals(project: Project, step: StepId): { count: number; first?: string } {
  let count = 0
  let first: string | undefined
  for (const proposal of project.steps[step].proposals) {
    const n = openCount(project, step, proposal)
    if (n && !first) first = proposal.id
    count += n
  }
  return { count, first }
}
