import { findItem, stepOf, type LooseBlock } from '../../domain/block'
import { endOf } from '../../domain/chain'
import { cut } from '../../domain/check'
import { canUndo, changeView, type ChangeView, type StaleReason } from '../../domain/proposals'
import { INDICATOR_MAX, PER_QUESTION_MAX, QUESTION_MAX, indicatorsOf, type Full } from '../../domain/focus'
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
const LEVELS: Record<string, string> = { 4: 'Stufe 4', 5: 'Stufe 5', 6: 'Stufe 6' }
const parent: FieldInfo = { label: 'Einordnung', ref: true }
const OUTPUT_LEVELS: Record<string, string> = { 1: 'Stufe 1', 2: 'Stufe 2', 3: 'Stufe 3' }
/** Side effect direction in words, shared with the block's radios. */
export const DIRECTION: Record<string, string> = { negative: 'negativ', positive: 'positiv' }

/** A question's reasons in words (design §6.2 "Step 19"), shared with the block's checkboxes. */
export const REASONS: Record<string, string> = { geldgeberin: 'Vorgabe der Geldgeberin', eigenes_lernen: 'eigenes Lernen', kritische_annahme: 'kritische Annahme' }
/** An indicator's level in words, shared with the block's select. */
export const STUFE: Record<string, string> = {
  1: 'Stufe 1 · Angebot findet statt',
  2: 'Stufe 2 · Gruppe wird erreicht',
  3: 'Stufe 3 · Gruppe nimmt das Angebot an',
  4: 'Stufe 4 · Wissen, Einstellung, Fähigkeiten',
  5: 'Stufe 5 · Handeln',
  6: 'Stufe 6 · Lebenslage',
  7: 'Stufe 7 · Beitrag zur Gesellschaft',
}

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
  // The level goes into the noun ("Ziel · Stufe 5 · Jugendliche"), links into the meta line.
  3: {
    goals: {
      noun: 'Ziel',
      main: 'text',
      fields: { groupId: group, level: { label: 'Stufe', values: LEVELS, ref: true }, text: { label: 'Ziel' }, causeIds: { label: 'Löst auf', ref: true }, timeFrame: { label: 'Zeitrahmen', ref: true }, why },
    },
    levelNotApplicable: { noun: 'Trifft nicht zu', main: 'level', fields: { groupId: group, level: { label: 'Stufe', values: LEVELS, ref: true }, why } },
    level7: { noun: 'Stufe 7 · Beitrag', main: 'text', fields: { text: { label: 'Beitrag' }, why } },
  },
  // Step 4 (design "Step 18"): the output's level in the noun, a link named by its two ends.
  4: {
    resources: { noun: 'Ressource', main: 'text', fields: { text: { label: 'Ressource' } } },
    activities: { noun: 'Aktivität', main: 'text', fields: { text: { label: 'Aktivität' }, why } },
    outputs: { noun: 'Leistung', main: 'text', fields: { groupId: group, level: { label: 'Stufe', values: OUTPUT_LEVELS, ref: true }, text: { label: 'Leistung' } } },
    links: {
      noun: 'Verbindung',
      main: '',
      fields: {
        groupId: group,
        fromId: { label: 'von', ref: true },
        toId: { label: 'nach', ref: true },
        because: { label: 'weil …', ref: true },
        assumption: { label: 'Annahme', ref: true },
        evidence: { label: 'Evidenzbasis', values: EVIDENCE, short: true },
        critical: { label: 'kritisch', short: true },
      },
    },
    externalFactors: { noun: 'Externer Faktor', main: 'text', fields: { groupId: group, text: { label: 'Faktor' } } },
    sideEffects: {
      noun: 'Unbeabsichtigte Wirkung',
      main: 'text',
      fields: { text: { label: 'Wirkung' }, direction: { label: 'Richtung', values: DIRECTION, short: true }, affectedGroup: { label: 'Betrifft', ref: true } },
    },
  },
  // Step 5 (design "Step 19"): never a question number (it shifts when a question goes); an
  // indicator names its question by text, a deferral by its assumption.
  5: {
    focusQuestions: {
      noun: 'Lernfrage',
      main: 'text',
      fields: {
        text: { label: 'Lernfrage' },
        reasons: { label: 'Grund', values: REASONS, ref: true },
        audience: { label: 'Für wen', ref: true },
        linkIds: { label: 'Prüft', ref: true },
        goalIds: { label: 'Prüft', ref: true },
        why,
      },
    },
    deferredCandidates: { noun: 'Zurückgestellt', main: '', fields: { linkId: { label: 'Annahme', ref: true }, reason: { label: 'weil', ref: true } } },
    indicators: {
      noun: 'Indikator',
      main: 'text',
      fields: {
        text: { label: 'Indikator' },
        level: { label: 'Stufe', values: STUFE, ref: true },
        focusQuestionId: { label: 'Frage', ref: true },
        baseline: { label: 'Ausgangswert', ref: true },
        target: { label: 'Zielwert oder Schwelle', ref: true },
        why,
      },
    },
    mandatoryFigures: {
      noun: 'Pflichtangabe',
      main: 'name',
      fields: { name: { label: 'Pflichtangabe' }, target: { label: 'Soll-Wert', ref: true }, unit: { label: 'Einheit', ref: true }, sourceNote: { label: 'Festlegung' } },
    },
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
  const values = fieldInfo(step, collection, field).values
  // Enum lists in words ("eigenes Lernen, kritische Annahme"), other lists as entries.
  if (Array.isArray(value)) return values ? value.map((v) => values[String(v)] ?? String(v)).join(', ') : value.map(String).join('; ')
  const text = String(value)
  return values?.[text] ?? text
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
    const goal = { ...goalText(project, step, change.collection, fields), ...chainText(project, step, proposal, change.collection, fields), ...focusText(project, step, proposal, change.collection, fields) }
    // A link's "weil … · Annahme" comes before its evidence and mark (design "Step 18").
    if (goal.meta) (change.collection === 'links' ? meta.unshift(goal.meta) : meta.push(goal.meta))
    return {
      kind,
      noun: groupNoun(project, goal.noun ?? noun, fields.groupId),
      main: goal.main ?? (format(mainField, fields[mainField]) || `${noun} ohne Namen`),
      meta,
      fields: lines,
    }
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
  const goal = {
    ...goalText(project, step, change.collection, before ?? {}),
    ...chainText(project, step, proposal, change.collection, before ?? {}),
    ...focusText(project, step, proposal, change.collection, before ?? {}),
  }
  // A singleton named by its own text (Stufe 7): its ÄNDERN line already shows old and new, so
  // no name line repeating the old one (design check step 17).
  const ownText = change.op === 'update' && step === 3 && change.collection === 'level7' && mainField in fields
  const name = ownText ? '' : (goal.main ?? (format(mainField, before?.[mainField]) || unnamed))
  const placement = (id: unknown) => {
    const text = parentText(project, step, proposal, change.collection, id)
    return text ? `unter „${cut(text, 40)}“` : change.collection === 'causes' ? 'direkte Ursache' : 'direkte Folge'
  }
  // Step 5: links and goals a question tests are one "Prüft" line, whichever of the two changed.
  const tests = (item: Record<string, unknown> | undefined, over: Record<string, unknown> = {}) =>
    refsText(project, proposal, over.linkIds ?? item?.linkIds, over.goalIds ?? item?.goalIds)
  const lines =
    change.op === 'update'
      ? Object.entries(fields)
          .filter(([field]) => field !== 'groupId' && !(field === 'goalIds' && 'linkIds' in fields))
          .map(([field, value]) =>
            field === 'linkIds' || field === 'goalIds'
              ? { label: 'Prüft', before: tests(before), after: tests(before, fields) || '(leer)' }
              : field === 'focusQuestionId'
                ? { label: 'Frage', before: questionText(project, proposal, before?.focusQuestionId), after: questionText(project, proposal, value) }
                : field === 'parentId'
              ? { label: parent.label, before: placement(before?.parentId), after: placement(value) }
              : field === 'causeIds'
                ? { label: 'Löst auf', before: causesText(project, before?.causeIds), after: causesText(project, value) || '(leer)' }
                : field === 'fromId' || field === 'toId'
                  ? { label: field === 'fromId' ? 'von' : 'nach', before: endText(project, proposal, before?.groupId, before?.[field]), after: endText(project, proposal, before?.groupId, value) }
                  : field === 'critical'
                    ? { label: 'kritisch', before: before?.critical ? 'kritisch' : 'nicht kritisch', after: value ? 'kritisch' : 'nicht kritisch' }
                    : { label: fieldInfo(step, change.collection, field).label, before: format(field, before?.[field]), after: format(field, value) || '(leer)' },
          )
          .filter((line) => line.before !== line.after)
      : []
  const meta = change.op === 'remove' && change.state !== 'applied' ? [...movedUp(project, step, change.collection, target), ...withIndicators(project, step, change.collection, target)] : []
  return { kind, noun: groupNoun(project, goal.noun ?? noun, before?.groupId), main: name, meta, fields: lines }
}

/**
 * Step 3 rows (design §6.2 "Step 17"): the level in the noun; a goal's meta "bis … · löst auf:
 * „…“" (a non-focus goal's link is its core problem, not said); a mark is named in words.
 */
function goalText(project: Project, step: StepId, collection: string, fields: Record<string, unknown>): { noun?: string; main?: string; meta?: string } {
  if (step !== 3 || (collection !== 'goals' && collection !== 'levelNotApplicable')) return {}
  const level = LEVELS[String(fields.level)] ?? ''
  const groupName = project.steps[1].block.targetGroups.find((g) => g.id === fields.groupId)?.name || 'Zielgruppe ohne Namen'
  if (collection === 'levelNotApplicable') return { noun: `Trifft nicht zu · ${level}`, main: `Trifft für „${cut(groupName, 40)}“ nicht zu` }
  const meta = [fields.timeFrame as string, causesText(project, fields.causeIds, 2) && `löst auf: ${causesText(project, fields.causeIds, 2)}`].filter(Boolean).join(' · ')
  return { noun: `Ziel · ${level}`, meta: meta || undefined }
}

/**
 * Step 4 rows (design §6.2 "Step 18"): an output's level in the noun; a link named by its ends
 * („A“ → „B“, 40 characters each) with "weil …" and the assumption on the meta line; an
 * external factor names its group or "alle Fokusgruppen"; a side effect whom it concerns.
 */
function chainText(project: Project, step: StepId, proposal: Proposal, collection: string, fields: Record<string, unknown>): { noun?: string; main?: string; meta?: string } {
  if (step !== 4) return {}
  if (collection === 'outputs') return { noun: `Leistung · ${OUTPUT_LEVELS[String(fields.level)] ?? 'Stufe ?'}` }
  if (collection === 'externalFactors' && !fields.groupId) return { noun: 'Externer Faktor · alle Fokusgruppen' }
  if (collection === 'sideEffects') return { meta: fields.affectedGroup ? `betrifft ${cut(fields.affectedGroup as string, 40)}` : undefined }
  if (collection !== 'links') return {}
  const main = `${endText(project, proposal, fields.groupId, fields.fromId)} → ${endText(project, proposal, fields.groupId, fields.toId)}`
  const meta = [fields.because && `weil: ${cut(fields.because as string, 60)}`, fields.assumption && `Annahme: ${cut(fields.assumption as string, 60)}`].filter(Boolean).join(' · ')
  return { main, meta: meta || undefined }
}

/**
 * Step 5 rows (design §6.2 "Step 19"): a question's meta "Grund: … · für: … · prüft: …"; an
 * indicator's noun names its question by text ("zu neuer Frage" when this proposal creates it);
 * a deferral is named by its assumption; a mandatory figure shows "Soll: …".
 */
function focusText(project: Project, step: StepId, proposal: Proposal, collection: string, fields: Record<string, unknown>): { noun?: string; main?: string; meta?: string } {
  if (step !== 5) return {}
  const join = (parts: unknown[]) => parts.filter(Boolean).join(' · ') || undefined
  if (collection === 'focusQuestions') {
    const reasons = formatValue(5, collection, 'reasons', fields.reasons)
    const refs = refsText(project, proposal, fields.linkIds, fields.goalIds, 2)
    return { meta: join([reasons && `Grund: ${reasons}`, fields.audience && `für: ${cut(fields.audience as string, 40)}`, refs && `prüft: ${refs}`]) }
  }
  if (collection === 'indicators') {
    const level = typeof fields.level === 'number' ? `Stufe ${fields.level}` : ''
    return {
      noun: `Indikator · ${questionText(project, proposal, fields.focusQuestionId, true)}`,
      meta: join([level, fields.baseline && `Ausgangswert: ${cut(fields.baseline as string, 40)}`, fields.target && `Ziel: ${cut(fields.target as string, 40)}`]),
    }
  }
  if (collection === 'deferredCandidates') {
    const link = (project.steps[4].block.links as Item[]).find((l) => l.id === fields.linkId)
    const main = !link ? 'Verweis fehlt' : (link.assumption as string) ? cut(link.assumption as string, 60) : linkText(project, proposal, link, 40)
    return { main, meta: join([fields.reason && `weil: ${cut(fields.reason as string, 60)}`]) }
  }
  if (collection === 'mandatoryFigures') return { meta: join([fields.target && `Soll: ${cut(fields.target as string, 40)}`, fields.unit && cut(fields.unit as string, 40)]) }
  return {}
}

/** "zu „Wie oft …“" — a question by its text, never its number; one this proposal creates is "zu neuer Frage". */
function questionText(project: Project, proposal: Proposal, id: unknown, prefix = false): string {
  const zu = prefix ? 'zu ' : ''
  if (typeof id !== 'string' || !id) return `${zu}keiner Frage`
  const creator = proposal.changes.find((c) => c.op === 'add' && c.tempId === id)
  const real = creator?.resultId ?? (creator ? undefined : id)
  const item = real ? (project.steps[5].block.focusQuestions as Item[]).find((q) => q.id === real) : undefined
  const text = (item?.text ?? creator?.fields?.text) as string | undefined
  if (!item && !creator) return `${zu}einer Frage, die es nicht mehr gibt`
  const quoted = text ? `„${cut(text, 40)}“` : 'ohne Text'
  return creator && !item ? `${zu}neuer Frage ${quoted}` : `${zu}${quoted}`
}

/** A link as „A“ → „B“ (each end cut at `n`). */
function linkText(project: Project, proposal: Proposal, link: Item, n: number): string {
  return `${endText(project, proposal, link.groupId, link.fromId, n)} → ${endText(project, proposal, link.groupId, link.toId, n)}`
}

/** What a question tests in words: links „A“ → „B“ and goals Ziel „…“; a deleted one is "Verweis fehlt". */
function refsText(project: Project, proposal: Proposal, linkIds: unknown, goalIds: unknown, max = Infinity): string {
  const links = project.steps[4].block.links as Item[]
  const goals = project.steps[3].block.goals as Item[]
  const names = [
    ...((Array.isArray(linkIds) ? linkIds : []) as string[]).map((id) => {
      const link = links.find((l) => l.id === id)
      return link ? linkText(project, proposal, link, 25) : 'Verweis fehlt'
    }),
    ...((Array.isArray(goalIds) ? goalIds : []) as string[]).map((id) => {
      const goal = goals.find((g) => g.id === id)
      return goal ? `Ziel „${cut((goal.text as string) || 'ohne Text', 40)}“` : 'Verweis fehlt'
    }),
  ]
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} + ${names.length - max} weitere` : shown
}

/** ENTFERNEN of a step 5 question: its indicators go with it (design "Step 19"). */
function withIndicators(project: Project, step: StepId, collection: string, id: string | undefined): string[] {
  if (step !== 5 || collection !== 'focusQuestions' || !id) return []
  const n = indicatorsOf(project.steps[5].block as unknown as LooseBlock, id).length
  return n ? [`mit ${n === 1 ? '1 Indikator' : `${n} Indikatoren`}`] : []
}

/** Why Übernehmen waits in step 5: one more question or indicator doesn't fit now. */
export function limitText(project: Project, proposal: Proposal, change: ProposalChange, full: Full): string {
  if (full === 'questions') return `Schon ${QUESTION_MAX} Lernfragen – entferne zuerst eine.`
  if (full === 'total') return `Schon ${INDICATOR_MAX} Indikatoren – entferne zuerst einen.`
  const target = change.fields?.focusQuestionId
  return `Frage ${questionText(project, proposal, target)} hat schon ${PER_QUESTION_MAX} Indikatoren.`
}

/** A link's end in words: an activity, output (also one this proposal creates) or step 3 goal; „?“ when unknown. */
function endText(project: Project, proposal: Proposal, groupId: unknown, id: unknown, n = 40): string {
  if (typeof id !== 'string' || !id) return '„?“'
  const creator = proposal.changes.find((c) => c.op === 'add' && c.tempId === id)
  const real = creator?.resultId ?? (creator ? undefined : id)
  const block = project.steps[4].block
  const known = real ? endOf({ activities: block.activities as Item[], outputs: block.outputs as Item[], goals: project.steps[3].block.goals as Item[], marks: [] }, groupId as string, real) : undefined
  const text = (known?.item.text ?? creator?.fields?.text) as string | undefined
  if (text) return `„${cut(text, n)}“`
  return known || creator ? '„ohne Text“' : 'Verweis fehlt'
}

/** Linked step 2 items in words: „A“, „B“ + 1 weitere; a deleted one is "Verweis fehlt". */
function causesText(project: Project, ids: unknown, max = Infinity): string {
  if (!Array.isArray(ids) || !ids.length) return ''
  const step2 = project.steps[2].block
  const names = ids.map((id) => {
    const item = [...step2.causes, ...step2.problems].find((i) => i.id === id)
    if (!item) return 'Verweis fehlt'
    const text = ('text' in item ? item.text : item.coreProblem) || 'ohne Text'
    return `„${cut(text, 40)}“`
  })
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} + ${names.length - max} weitere` : shown
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
  // Step 3: a removal can be in the way too (a goal on a level marked "trifft nicht zu"). Named
  // by its noun, so no quotes nest inside the quotes.
  if (creator?.op === 'remove') {
    const noun = rowText(project, step, proposal, creator, { kind: 'open' }).noun.split(' · ').slice(0, 2).join(' · ')
    return `zuerst „Entfernen: ${noun}“ übernehmen`
  }
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
