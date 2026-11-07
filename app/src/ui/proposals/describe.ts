import { findItem, stepOf, type LooseBlock } from '../../domain/block'
import { canUndo, changeView, type ChangeView, type StaleReason } from '../../domain/proposals'
import { collectionMeta, type Item } from '../../domain/schemas/blocks'
import type { Project, Proposal, ProposalChange } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import type { ChipKind } from '../components/Chip'

// What a proposal row says (design §6.2 "Proposal card"). Pure, so the wording is tested
// without rendering. Field labels for steps 0 and 2–6 follow with their blocks (steps 14–20).

type FieldInfo = {
  label: string
  /** Display text per stored value (enums). */
  values?: Record<string, string>
  /** Short field shown on a NEU row's meta line: an enum's value, a true boolean's label. */
  short?: true
}

type CollectionInfo = { noun: string; main: string; fields?: Record<string, FieldInfo> }

const why: FieldInfo = { label: 'Warum?' }

// `main` = the field that names an item; the other steps get their labels with their blocks.
const info: { [S in StepId]: Record<string, CollectionInfo> } = {
  0: {
    profile: { noun: 'Projektprofil', main: 'name' },
    frame: { noun: 'Messrahmen', main: 'audience' },
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
    problems: { noun: 'Kernproblem', main: 'coreProblem' },
    causes: { noun: 'Ursache', main: 'text' },
    consequences: { noun: 'Folge', main: 'text' },
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

/** `before`: ÄNDERN only; '' = the field was empty ("bisher leer"). */
export type FieldLine = { label: string; before?: string; after: string }

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
      if (fi.short) {
        if (typeof value === 'boolean') value && meta.push(fi.label)
        else if (format(field, value)) meta.push(format(field, value))
      } else if (format(field, value)) lines.push({ label: fi.label, after: format(field, value) })
    }
    return { kind, noun, main: format(mainField, fields[mainField]) || `${noun} ohne Namen`, meta, fields: lines }
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
  const unnamed = collectionMeta(step, change.collection)?.singleton ? '' : `${noun} ohne Namen`
  const name = format(mainField, before?.[mainField]) || unnamed
  const lines =
    change.op === 'update'
      ? Object.entries(fields)
          .map(([field, value]) => ({
            label: fieldInfo(step, change.collection, field).label,
            before: format(field, before?.[field]),
            after: format(field, value) || '(leer)',
          }))
          .filter((line) => line.before !== line.after)
      : []
  return { kind, noun, main: name, meta: [], fields: lines }
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
