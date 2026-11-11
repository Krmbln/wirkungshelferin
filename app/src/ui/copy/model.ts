import { rubricCriteria } from '../../ai/tools'
import type { LooseBlock } from '../../domain/block'
import { chainItems, chainOf, endOf, OUTPUT_LEVELS, type ChainItems } from '../../domain/chain'
import { sameBlock } from '../../domain/check'
import { indicatorsOf, orphanIndicators, questionsOf, refsOf, type Ref } from '../../domain/focus'
import { needs, PLAN_FIELDS, planRefsOf, planRowsOf, type PlanRef } from '../../domain/plan'
import { FORM_LABELS, formFields, isBlank, type FormName } from '../../domain/profile'
import type { Item } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import { GOAL_LEVELS, ofGroup, stepGroups, targetGroups, treeOf, type TreeRow } from '../../domain/tree'
import { stepIds, type StepId } from '../../domain/types'
import { DIRECTION, EVIDENCE, PURPOSE, REASONS, STUFE } from '../proposals/describe'
import { steps } from '../steps'
import { render, type Copied, type ListItem, type Node } from './render'

// What "Kopieren" and "Alles kopieren" put on the clipboard (design §6.5, PRD F8): every block as
// it is now, in words (never an id), references as the referenced item's text, hidden items left
// out. Built as sections first, so emptiness and status notes follow one rule everywhere.

/** A heading with its content; `steps` = where the content comes from (its status note), `optional` = left out when empty. */
type Section = { title: string; steps?: StepId[]; content?: Node[]; sub?: Section[]; optional?: true }

/** In place of a reference that points nowhere; U+FE0E keeps ⚠ a text glyph, not a colour emoji (UI/UX M9). */
export const BROKEN = '⚠︎ Verweis fehlt'
export const UNTOUCHED = 'Noch nicht bearbeitet.'

/** A section's name in "Bewusst offen gelassene Punkte": the funder doesn't know step numbers (UI/UX H2). */
const SECTION_NAME: Record<StepId, string> = {
  0: 'Projekt und Messrahmen',
  1: 'Herausforderung, Zielgruppen und Beteiligte',
  2: 'Problem',
  3: 'Wirkungsziele',
  4: 'Wirkungslogik',
  5: 'Messfokus und Indikatoren',
  6: 'Datenerhebungsplan',
}

const LEVEL_NAME: Record<number, string> = { 6: 'Lebenslage', 5: 'Handeln', 4: 'Wissen, Einstellung, Fähigkeiten' }

const filled = (value: unknown) => typeof value === 'string' && !!value.trim()
const list = (block: unknown, name: string) => ((block as LooseBlock)[name] as Item[] | undefined) ?? []
const quoted = (text: unknown) => `„${filled(text) ? (text as string).trim() : 'ohne Text'}“`
const groupName = (g: Item) => (filled(g.name) ? (g.name as string).trim() : 'Zielgruppe ohne Namen')

const why = (item: Item): ListItem[] => (filled(item.why) ? [{ text: [{ strong: 'Warum: ' }, (item.why as string).trim()] }] : [])
const whyP = (item: Item): Node[] => (filled(item.why) ? [{ kind: 'p', text: [{ strong: 'Warum: ' }, (item.why as string).trim()] }] : [])
/** "**Label:** value" (every label bold, like Warum), or nothing when the value is empty. */
const labelled = (label: string, text: string): ListItem => ({ text: [{ strong: `${label}: ` }, text] })
const line = (label: string, value: unknown): ListItem[] => (filled(value) ? [labelled(label, (value as string).trim())] : [])
const ul = (items: ListItem[]): Node[] => (items.length ? [{ kind: 'list', items }] : [])

// ── Step 0 ────────────────────────────────────────────────────────────────────

function formItems(project: Project, form: FormName): ListItem[] {
  const item = project.steps[0].block[form] as unknown as Item
  return formFields(form).flatMap((field): ListItem[] => {
    const value = item[field]
    const label = FORM_LABELS[form][field]
    if (isBlank(value)) return []
    if (Array.isArray(value)) {
      const entries = value.filter(filled).map((v) => (v as string).trim())
      return entries.length === 1 ? [labelled(label, entries[0])] : [{ text: [{ strong: `${label}:` }], children: entries.map((e) => ({ text: [e] })) }]
    }
    return [labelled(label, field === 'purpose' ? (PURPOSE[value as string] ?? (value as string)) : (value as string).trim())]
  })
}

const step0Sections = (project: Project): Section[] => [
  { title: 'Projekt', content: ul(formItems(project, 'profile')) },
  { title: 'Messrahmen', content: ul(formItems(project, 'frame')) },
]

// ── Step 1 ────────────────────────────────────────────────────────────────────

function challenge(project: Project): Node[] {
  const item = project.steps[1].block.challenge as unknown as Item
  return filled(item.text) ? [{ kind: 'p', text: [(item.text as string).trim()] }, ...whyP(item)] : []
}

function groupItems(project: Project): ListItem[] {
  return targetGroups(project).map((g) => {
    const facts = [g.reach === 'indirect' ? 'indirekt' : 'direkt', ...(g.isFocus ? ['Fokusgruppe'] : []), ...(filled(g.sizeEstimate) ? [`Größe: ${(g.sizeEstimate as string).trim()}`] : [])]
    return { text: [{ strong: groupName(g) }, ` (${facts.join(' · ')})`], children: [...(filled(g.description) ? [{ text: [(g.description as string).trim()] }] : []), ...why(g)] }
  })
}

function stakeholderItems(project: Project): ListItem[] {
  return list(project.steps[1].block, 'stakeholders').map((s) => ({
    text: [{ strong: filled(s.role) ? (s.role as string).trim() : 'Beteiligte ohne Rolle' }],
    children: (s.expectations as string[]).filter(filled).map((e) => ({ text: [e.trim()] })),
  }))
}

const step1Lists = (project: Project): Section[] => [
  { title: 'Zielgruppen', content: ul(groupItems(project)) },
  { title: 'Beteiligte', content: ul(stakeholderItems(project)) },
]

// ── Steps 2–4: per group ──────────────────────────────────────────────────────

function treeItems(rows: TreeRow[], facts: (item: Item) => string[]): ListItem[] {
  return rows.map(({ item, children }) => {
    const meta = facts(item)
    return { text: [(filled(item.text) ? (item.text as string).trim() : 'ohne Text') + (meta.length ? ` (${meta.join(' · ')})` : '')], children: [...why(item), ...treeItems(children, facts)] }
  })
}

// "(unsicher)" alone read as the author being unsure (design check): the label goes with it, as on links.
const causeFacts = (c: Item) => [...(EVIDENCE[c.evidence as string] ? [`Evidenzbasis: ${EVIDENCE[c.evidence as string]}`] : []), ...(c.notInfluenceable ? ['nicht beeinflussbar'] : [])]

/** The core problem with its causes and consequences; a non-focus group shows only the content (its causes are hidden, design §6.2). */
function problemSection(project: Project, groupId: string): Section {
  const block = project.steps[2].block
  const problem = ofGroup(list(block, 'problems'), groupId)[0]
  const content: Node[] = problem && filled(problem.coreProblem) ? [{ kind: 'p', text: [{ strong: 'Kernproblem: ' }, (problem.coreProblem as string).trim()] }, ...whyP(problem)] : []
  const sub: Section[] = [
    { title: 'Ursachen', content: ul(treeItems(treeOf(ofGroup(list(block, 'causes'), groupId)), causeFacts)), optional: true },
    { title: 'Folgen', content: ul(treeItems(treeOf(ofGroup(list(block, 'consequences'), groupId)), () => [])), optional: true },
  ]
  return { title: 'Problem', steps: [2], content, sub }
}

function goalItem(project: Project, goal: Item, withLevel: boolean): ListItem {
  const causes = list(project.steps[2].block, 'causes')
  const solves = (goal.causeIds as string[]).map((id) => {
    // Only the goal's own group's causes: another group's cause is hidden or wrong here (the block shows "Verweis fehlt").
    const cause = causes.find((c) => c.id === id && c.groupId === goal.groupId)
    return cause ? quoted(cause.text) : BROKEN
  })
  return {
    text: [(withLevel ? `Stufe ${goal.level as number}: ` : '') + (filled(goal.text) ? (goal.text as string).trim() : 'ohne Text')],
    children: [...line('Zeitrahmen', goal.timeFrame), ...(solves.length ? [labelled('Löst auf', solves.join(', '))] : []), ...why(goal)],
  }
}

/** A focus group's goals by level, top down; a level marked "trifft nicht zu" says so with its Why. */
function goalsSection(project: Project, groupId: string): Section {
  const block = project.steps[3].block
  const goals = ofGroup(list(block, 'goals'), groupId)
  const marks = ofGroup(list(block, 'levelNotApplicable'), groupId)
  const sub = GOAL_LEVELS.map((level): Section => {
    const mark = marks.find((m) => m.level === level)
    const own = goals.filter((g) => g.level === level)
    const content: Node[] = [...ul(own.map((g) => goalItem(project, g, false))), ...(mark ? [{ kind: 'p', text: ['Trifft für diese Gruppe nicht zu.'] } as Node, ...whyP(mark)] : [])]
    return { title: `Stufe ${level} · ${LEVEL_NAME[level]}`, content, optional: true }
  })
  return { title: 'Wirkungsziele', steps: [3], sub }
}

/** An end of a link: "Aktivität „…“" / "Stufe 2 „…“", or the broken mark. */
function endText(items: ChainItems, groupId: string, id: unknown): string {
  const end = endOf(items, groupId, id)
  if (!end) return BROKEN
  return `${end.kind === 'activity' ? 'Aktivität' : `Stufe ${end.level}`} ${quoted(end.item.text)}`
}

const linkText = (items: ChainItems, link: Item) => `${endText(items, link.groupId as string, link.fromId)} → ${endText(items, link.groupId as string, link.toId)}`

function chainSection(project: Project, groupId: string): Section {
  const items = chainItems(project)
  const block = project.steps[4].block
  const outputs = ofGroup(list(block, 'outputs'), groupId)
  const outputItems = OUTPUT_LEVELS.flatMap((level) => outputs.filter((o) => o.level === level).map((o): ListItem => ({ text: [`Stufe ${level}: ${filled(o.text) ? (o.text as string).trim() : 'ohne Text'}`] })))
  const linkItems = chainOf(items, list(block, 'links'), groupId).map(
    (link): ListItem => ({
      text: [linkText(items, link) + (link.critical ? ' (kritisch)' : '')],
      children: [...line('Weil', link.because), ...line('Annahme', link.assumption), ...line('Evidenzbasis', EVIDENCE[link.evidence as string])],
    }),
  )
  return {
    title: 'Wirkungslogik',
    steps: [4],
    sub: [
      { title: 'Leistungen', content: ul(outputItems), optional: true },
      { title: 'Verbindungen', content: ul(linkItems), optional: true },
    ],
  }
}

/** A non-focus group as the blocks show it: its core problem and its goals (step 2 and 3 keep these). */
function otherGroupSection(project: Project, group: Item): Section {
  const problem = problemSection(project, group.id)
  const goals = ofGroup(list(project.steps[3].block, 'goals'), group.id)
  return { title: groupName(group), steps: [2, 3], content: [...(problem.content ?? []), ...ul(goals.map((g) => goalItem(project, g, true)))] }
}

/** Items whose group no longer exists at all: shown in full, so nothing in the block silently drops out. */
function orphanSections(project: Project, ids: string[]): Section[] {
  return ids.map((id) => ({ title: ids.length > 1 ? `Ohne Zielgruppe (${ids.indexOf(id) + 1})` : 'Ohne Zielgruppe', sub: [problemSection(project, id), goalsSection(project, id), chainSection(project, id)] }))
}

const orphanIds = (project: Project) => [...new Set(([2, 3, 4] as const).flatMap((s) => stepGroups(project, s).orphans))]

// ── Project-wide (steps 3 and 4) ──────────────────────────────────────────────

function level7(project: Project): Node[] {
  const item = project.steps[3].block.level7 as unknown as Item
  return filled(item.text) ? [{ kind: 'p', text: [(item.text as string).trim()] }, ...whyP(item)] : []
}

const textItems = (items: Item[], withWhy: boolean): ListItem[] => items.filter((i) => filled(i.text) || filled(i.why)).map((i) => ({ text: [filled(i.text) ? (i.text as string).trim() : 'ohne Text'], children: withWhy ? why(i) : [] }))

function surroundings(project: Project): ListItem[] {
  const block = project.steps[4].block
  const groups = targetGroups(project)
  const factors = list(block, 'externalFactors').map((f): ListItem => {
    const group = filled(f.groupId) ? groups.find((g) => g.id === f.groupId) : undefined
    const affects = !filled(f.groupId) ? 'alle Fokusgruppen' : group ? `„${groupName(group)}“` : BROKEN
    return { text: [`Einflussfaktor: ${filled(f.text) ? (f.text as string).trim() : 'ohne Text'} (betrifft ${affects})`] }
  })
  const effects = list(block, 'sideEffects').map((e): ListItem => {
    const meta = [DIRECTION[e.direction as string], ...(filled(e.affectedGroup) ? [`betrifft ${(e.affectedGroup as string).trim()}`] : [])]
    return { text: [`Nebenwirkung: ${filled(e.text) ? (e.text as string).trim() : 'ohne Text'} (${meta.join(' · ')})`] }
  })
  return [...factors, ...effects]
}

const resources = (project: Project) => ul(textItems(list(project.steps[4].block, 'resources'), false))
const activities = (project: Project) => ul(textItems(list(project.steps[4].block, 'activities'), true))

// ── Step 5 ────────────────────────────────────────────────────────────────────

function refText(items: ChainItems, ref: Ref): string {
  if (!ref.item) return BROKEN
  return ref.kind === 'goal' ? `Ziel Stufe ${ref.item.level as number} ${quoted(ref.item.text)}` : linkText(items, ref.item)
}

function questionItems(project: Project): ListItem[] {
  const items = chainItems(project)
  return questionsOf(project.steps[5].block as unknown as LooseBlock).map((q, n) => {
    const reasons = (q.reasons as string[]).map((r) => REASONS[r] ?? r)
    const refs = refsOf(project, q).map((r) => refText(items, r))
    return {
      text: [{ strong: `Frage ${n + 1}: ` }, filled(q.text) ? (q.text as string).trim() : 'ohne Text'],
      children: [
        ...(reasons.length ? [labelled('Grund', reasons.join(', '))] : []),
        ...line('Für wen', q.audience),
        ...(refs.length ? [labelled('Prüft', refs.join('; '))] : []),
        ...why(q),
      ],
    }
  })
}

function deferralItems(project: Project): ListItem[] {
  const items = chainItems(project)
  const links = list(project.steps[4].block, 'links')
  return list(project.steps[5].block, 'deferredCandidates').map((d) => {
    const link = links.find((l) => l.id === d.linkId)
    return { text: [link ? linkText(items, link) : BROKEN], children: line('Zurückgestellt, weil', d.reason) }
  })
}

function figureItems(project: Project): ListItem[] {
  return list(project.steps[5].block, 'mandatoryFigures').map((f) => ({
    text: [{ strong: filled(f.name) ? (f.name as string).trim() : 'Pflichtangabe ohne Namen' }],
    children: [...line('Soll-Wert', f.target), ...line('Einheit', f.unit), ...line('Festlegung', f.sourceNote)],
  }))
}

const indicatorItems = (indicators: Item[]): ListItem[] =>
  indicators.map((i) => ({
    text: [filled(i.text) ? (i.text as string).trim() : 'ohne Text'],
    children: [{ text: [STUFE[i.level as number] ?? `Stufe ${i.level as number}`] }, ...line('Ausgangswert', i.baseline), ...line('Zielwert oder Schwelle', i.target), ...why(i)],
  }))

function indicatorSections(project: Project): Section[] {
  const block = project.steps[5].block as unknown as LooseBlock
  return [
    ...questionsOf(block).map((q, n): Section => ({ title: `Zu Frage ${n + 1}: ${filled(q.text) ? (q.text as string).trim() : 'ohne Text'}`, content: ul(indicatorItems(indicatorsOf(block, q.id))) })),
    { title: 'Ohne Lernfrage', content: ul(indicatorItems(orphanIndicators(block))), optional: true },
  ]
}

// ── Step 6 ────────────────────────────────────────────────────────────────────

function planRefText(ref: PlanRef): string {
  if (!ref.need) return BROKEN
  return ref.need.kind === 'indicator' ? quoted(ref.need.item.text) : `Pflichtangabe ${quoted(ref.need.item.name)}`
}

function planSections(project: Project): Section[] {
  const all = needs(project)
  return planRowsOf(project).map((row, n): Section => {
    const refs = planRefsOf(all, row).map(planRefText)
    // "Wer erhebt?" reads "Wer erhebt: …" in a list.
    const fields = PLAN_FIELDS.flatMap((f) => line(f.label.replace(/\?$/, ''), row[f.field]))
    return { title: `Planzeile ${n + 1}`, content: ul([...(refs.length ? [labelled('Für', refs.join(', '))] : []), ...fields, ...why(row)]) }
  })
}

// ── Confirmed despite ⚠ ───────────────────────────────────────────────────────

/** The ⚠ rows a step was confirmed with, while that confirmed version stands (the gate's "trotzdem bestätigt"). */
function confirmedAnyway(project: Project, step: StepId): { name: string; note: string }[] {
  const state = project.steps[step]
  const kept = state.status === 'confirmed' || (state.status === 'maybe_outdated' && !!state.confirmed && sameBlock(state.confirmed.block, state.block))
  if (!kept || !state.qualityCheck || !state.confirmedWarnings.length) return []
  const names = new Map(rubricCriteria(step).map((c) => [c.id, c.name]))
  return state.qualityCheck.results
    .filter((r) => r.result === 'warn' && state.confirmedWarnings.includes(r.criterion))
    .map((r) => ({ name: names.get(r.criterion) ?? `Kriterium ${r.criterion}`, note: r.note.trim() }))
}

const OPEN_POINTS = 'Bewusst offen gelassene Punkte'
const OPEN_LEAD: Node = { kind: 'p', text: ['Die Prüfung hat hier etwas angemerkt; bestätigt wurde trotzdem.'] }

function openPoints(project: Project, only?: StepId): Section {
  const items = (only === undefined ? stepIds : [only]).flatMap((step) =>
    confirmedAnyway(project, step).map((row): ListItem => ({ text: [`${only === undefined ? `${SECTION_NAME[step]} · ` : ''}${row.name}${row.note ? `: ${row.note}` : ''}`] })),
  )
  return { title: OPEN_POINTS, content: items.length ? [OPEN_LEAD, ...ul(items)] : [], optional: true }
}

// ── Assembly ──────────────────────────────────────────────────────────────────

const hasContent = (s: Section): boolean => !!s.content?.length || !!s.sub?.some(hasContent)

/** "(noch nicht bestätigt)" wins over "(vielleicht veraltet)" when a section draws on several steps. */
function statusNote(project: Project, from: StepId[]): string | undefined {
  const statuses = from.map((s) => project.steps[s].status)
  if (statuses.some((s) => s === 'not_started' || s === 'in_progress')) return '(noch nicht bestätigt)'
  if (statuses.includes('maybe_outdated')) return '(vielleicht veraltet)'
  return undefined
}

/** The steps a section draws on: its own, else its parent's, else those of its parts. */
const stepsOf = (s: Section, inherited: StepId[]): StepId[] => s.steps ?? (inherited.length ? inherited : [...new Set((s.sub ?? []).flatMap((sub) => stepsOf(sub, [])))])

/**
 * An empty section reads "Noch nicht bearbeitet." only while its steps are untouched; in a step
 * that was worked on, an empty part is simply left out (design check: a confirmed step without
 * Beteiligte must not say "nicht bearbeitet").
 */
function flatten(project: Project, sections: Section[], level: number, inherited: StepId[] = []): Node[] {
  return sections.flatMap((s): Node[] => {
    const from = stepsOf(s, inherited)
    const heading: Node = { kind: 'h', level: Math.min(level, 4) as 1 | 2 | 3 | 4, text: s.title }
    if (!hasContent(s)) {
      const untouched = from.length > 0 && from.every((step) => project.steps[step].status === 'not_started')
      return s.optional || !untouched ? [] : [heading, { kind: 'p', text: [UNTOUCHED] }]
    }
    const note = s.steps && statusNote(project, s.steps)
    return [heading, ...(note ? [{ kind: 'p', text: [note] } as Node] : []), ...(s.content ?? []), ...flatten(project, s.sub ?? [], level + 1, from)]
  })
}

/** The PRD F8 order for "Alles kopieren". */
function allSections(project: Project): Section[] {
  const groups = stepGroups(project, 2)
  const other = targetGroups(project).filter((g) => !g.isFocus)
  return [
    { title: 'Projekt und Messrahmen', steps: [0], sub: step0Sections(project) },
    { title: 'Herausforderung, Zielgruppen und Beteiligte', steps: [1], content: challenge(project), sub: step1Lists(project) },
    ...groups.focus.map((g): Section => ({ title: `Fokusgruppe: ${groupName(g)}`, sub: [problemSection(project, g.id), goalsSection(project, g.id), chainSection(project, g.id)] })),
    { title: 'Weitere Zielgruppen', sub: [...other.map((g) => otherGroupSection(project, g)), ...orphanSections(project, orphanIds(project))], optional: true },
    {
      title: 'Für das ganze Projekt',
      sub: [
        { title: 'Stufe 7 · Beitrag zur Gesellschaft', steps: [3], content: level7(project) },
        { title: 'Ressourcen', steps: [4], content: resources(project) },
        { title: 'Aktivitäten', steps: [4], content: activities(project) },
        { title: 'Umfeld und Nebenwirkungen', steps: [4], content: ul(surroundings(project)) },
      ],
    },
    {
      title: 'Messfokus',
      steps: [5],
      sub: [
        { title: 'Lernfragen', content: ul(questionItems(project)), optional: true },
        { title: 'Zurückgestellte Kandidaten', content: ul(deferralItems(project)), optional: true },
      ],
    },
    { title: 'Pflichtangaben der Geldgeberin', steps: [5], content: ul(figureItems(project)) },
    { title: 'Indikatoren', steps: [5], sub: indicatorSections(project) },
    { title: 'Datenerhebungsplan', steps: [6], sub: planSections(project) },
    openPoints(project),
  ]
}

/** One step's block in its own order (per-block "Kopieren"). A group's part takes the group's name as its heading. */
function stepSections(project: Project, step: StepId): Section[] {
  const groups = stepGroups(project, step)
  const named = (title: string, section: Section): Section => ({ ...section, title, steps: undefined })
  const focus = (pick: (id: string) => Section) => groups.focus.map((g) => named(`Fokusgruppe: ${groupName(g)}`, pick(g.id)))
  const orphans = (pick: (id: string) => Section) => groups.orphans.map((id, n) => named(groups.orphans.length > 1 ? `Ohne Zielgruppe (${n + 1})` : 'Ohne Zielgruppe', pick(id)))
  const others = (content: (g: Item) => Node[]): Section => ({ title: 'Weitere Zielgruppen', sub: groups.other.map((g) => ({ title: groupName(g), content: content(g) })), optional: true })
  switch (step) {
    case 0:
      return step0Sections(project)
    case 1:
      return [{ title: 'Herausforderung', content: challenge(project) }, ...step1Lists(project)]
    case 2:
      return [
        ...focus((id) => problemSection(project, id)),
        others((g) => problemSection(project, g.id).content ?? []),
        ...orphans((id) => problemSection(project, id)),
      ]
    case 3:
      return [
        ...focus((id) => goalsSection(project, id)),
        others((g) => ul(ofGroup(list(project.steps[3].block, 'goals'), g.id).map((goal) => goalItem(project, goal, true)))),
        ...orphans((id) => goalsSection(project, id)),
        { title: 'Stufe 7 · Beitrag zur Gesellschaft', content: level7(project) },
      ]
    case 4:
      return [
        { title: 'Ressourcen', content: resources(project) },
        { title: 'Aktivitäten', content: activities(project) },
        ...focus((id) => chainSection(project, id)),
        ...orphans((id) => chainSection(project, id)),
        { title: 'Umfeld und Nebenwirkungen', content: ul(surroundings(project)) },
      ]
    case 5:
      return [
        { title: 'Lernfragen', content: ul(questionItems(project)) },
        { title: 'Zurückgestellte Kandidaten', content: ul(deferralItems(project)), optional: true },
        { title: 'Indikatoren', sub: indicatorSections(project), optional: true },
        { title: 'Pflichtangaben (Geldgeberin)', content: ul(figureItems(project)) },
      ]
    case 6:
      return planSections(project)
  }
}

/** True when "Kopieren" would copy something (the button hides otherwise, design §6.5). */
export const stepHasContent = (project: Project, step: StepId) => stepSections(project, step).some(hasContent)

/** True when "Alles kopieren" would copy something. */
export const projectHasContent = (project: Project) => stepIds.some((s) => stepHasContent(project, s))

const projectName = (project: Project) => {
  const name = (project.steps[0].block.profile as unknown as Item).name
  return filled(name) && (name as string).trim().toLowerCase() !== 'offen' ? (name as string).trim() : undefined
}

const dateText = (now: Date) => now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function allNodes(project: Project, now: Date): Node[] {
  const name = projectName(project)
  return [
    { kind: 'h', level: 1, text: name ? `Wirkungsmodell: ${name}` : 'Wirkungsmodell' },
    { kind: 'p', text: [`Stand: ${dateText(now)} · erstellt mit der Wirkungshelferin`] },
    ...flatten(project, allSections(project), 2),
  ]
}

export function stepNodes(project: Project, step: StepId): Node[] {
  const sections = stepSections(project, step)
  const heading: Node = { kind: 'h', level: 1, text: `Schritt ${step} · ${steps[step].title}` }
  if (!sections.some(hasContent)) return [heading, { kind: 'p', text: [UNTOUCHED] }]
  const note = statusNote(project, [step])
  return [heading, ...(note ? [{ kind: 'p', text: [note] } as Node] : []), ...flatten(project, [...sections, openPoints(project, step)], 2)]
}

export const copyAll = (project: Project, now: Date): Copied => render(allNodes(project, now))
export const copyStep = (project: Project, step: StepId): Copied => render(stepNodes(project, step))

/** Home's line under "Alles kopieren" (design §6.5), or undefined when every step is confirmed. */
export function unconfirmedLine(project: Project): string | undefined {
  const open = stepIds.filter((s) => ['not_started', 'in_progress'].includes(project.steps[s].status))
  const outdated = stepIds.filter((s) => project.steps[s].status === 'maybe_outdated')
  if (!open.length && !outdated.length) return undefined
  const tail = 'sie werden so kopiert, wie sie gerade sind.'
  if (open.length + outdated.length >= 4) return `Noch nicht alle Schritte sind bestätigt – ${tail}`
  const names = (ids: StepId[]) => (ids.length === 1 ? `Schritt ${ids[0]}` : `Schritt ${ids.slice(0, -1).join(', ')} und ${ids.at(-1)}`)
  const parts = [...(open.length ? [`Noch nicht bestätigt: ${names(open)}`] : []), ...(outdated.length ? [`Vielleicht veraltet: ${names(outdated)}`] : [])]
  const one = open.length + outdated.length === 1
  return `${parts.join('. ')} – ${one ? 'er wird so kopiert, wie er gerade ist.' : tail}`
}

