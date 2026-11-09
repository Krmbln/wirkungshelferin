import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { isEmptyItem } from '../../domain/block'
import { fieldKey, type HardIssue } from '../../domain/check'
import type { Action } from '../../domain/reducer'
import type { Item } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import { GOAL_LEVELS, ofGroup, stepGroups, treeOf, type GoalLevel, type TreeRow } from '../../domain/tree'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { StatusIcon } from '../components/StatusIcon'
import { Term } from '../chat/IntroPanel'
import type { Applied } from './BlockPanel'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, ReferenceChip, UndoLine, WhyField } from './parts'
import { Group, ORPHANS, OTHER, blockingIn, count, useStuckHeaders } from './Step2Block'
import { useRemovals, type Removal } from './useRemovals'

// Step 3: goals at levels 6 → 5 → 4 per focus group, at least one goal per non-focus group and
// one Stufe 7 sentence for the project (design §6.2 "Step 17"). Same multi-group layout as step 2.

type Name = 'goals' | 'levelNotApplicable'

const LEVEL_NAME: Record<GoalLevel, string> = { 6: 'Lebenslage', 5: 'Handeln', 4: 'Wissen, Einstellung, Fähigkeiten' }
const PLACEHOLDER: Record<GoalLevel, string> = {
  6: 'Was ist im Leben der Gruppe anders? Als erreichter Zustand',
  5: 'Was tut die Gruppe dann anders?',
  4: 'Was weiß, kann oder glaubt die Gruppe dann?',
}
const EMPTY_HINT: Record<GoalLevel, string> = {
  6: 'Noch leer – was ist im Leben der Gruppe anders, wenn das Projekt gewirkt hat?',
  5: 'Noch leer – was tut die Gruppe anders, wenn das Projekt gewirkt hat?',
  4: 'Noch leer – was weiß oder kann die Gruppe dann?',
}

const groupLabel = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'
const goalLabel = (g: Item) => (g.text as string) || 'ohne Text'
const goalName = (g: Item) => ((g.text as string) ? `Ziel „${g.text as string}“` : `Leeres Ziel · Stufe ${g.level as number}`)

type Props = {
  project: Project
  onAction: (action: Action) => void
  applied?: Applied
  /** ⛔ issues on screen (gate.ts stillOpen): field markers and the collapsed groups' counts. */
  issues?: HardIssue[]
  collapsed: string[]
  onToggle: (key: string) => void
  onOpenStep: (step: StepId) => void
}

export function Step3Block({ project, onAction, applied, issues = [], collapsed, onToggle, onOpenStep }: Props) {
  const block = project.steps[3].block
  const goals = block.goals as Item[]
  const marks = block.levelNotApplicable as Item[]
  const level7 = block.level7 as Item
  const step2 = project.steps[2].block
  const lists: Record<Name, Item[]> = { goals, levelNotApplicable: marks }
  const { focus, other, orphans } = stepGroups(project, 3)
  const groups = project.steps[1].block.targetGroups as Item[]
  const blocked = new Set(issues.map((i) => fieldKey(i.target.collection, i.target.id, i.target.field)))
  const panel = useRef<HTMLDivElement>(null)
  const focusNext = useRef<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  /** The goal whose cause picker is open (one at a time). */
  const [picking, setPicking] = useState<string | null>(null)

  const isFocus = (groupId: unknown) => !!groups.find((g) => g.id === groupId)?.isFocus
  /** The add button focus returns to when an undo line expires: the level's, or the non-focus group's. */
  const addKey = (item: Item) => (isFocus(item.groupId) ? `goals-${item.groupId as string}-${item.level as number}` : `goals-${item.groupId as string}`)

  const { removals, push, drop } = useRemovals((removal) => {
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (line?.contains(document.activeElement)) focusNext.current = `[data-add="${addKey(removal.item)}"]`
  })

  useEffect(() => {
    if (!focusNext.current) return
    const target = panel.current?.querySelector<HTMLElement>(focusNext.current)
    if (target) {
      target.focus()
      focusNext.current = null
    }
  })

  // An applied ENTFERNEN shows its undo line at the row's place (focus stays in the card).
  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[3].proposals.find((p) => p.id === applied.proposalId)
    for (const id of applied.changeIds) {
      const change = proposal?.changes.find((c) => c.id === id)
      if (!proposal || change?.op !== 'remove' || change.state !== 'applied' || !change.undo?.before) continue
      const item = change.undo.before as Item
      const name = change.collection as Name
      push({
        collection: name,
        item,
        index: change.undo.index,
        slot: slotOf(lists[name] ?? [], item, change.undo.index, isFocus(item.groupId)),
        label: removedLabel(name, item),
        undoAction: { type: 'change/undo', step: 3, proposalId: proposal.id, changeId: change.id },
      })
    }
  }, [applied?.n])

  useStuckHeaders(panel)

  const edit = (collection: string, id: string, fields: Record<string, unknown>) => onAction({ type: 'item/edit', step: 3, collection, id, fields })
  const nextOf = (prefix: string) => `${prefix}${(project.idCounters[prefix] ?? 0) + 1}`

  function addGoal(groupId: string, level: GoalLevel) {
    const id = nextOf('go')
    onAction({ type: 'item/add', step: 3, collection: 'goals', fields: { groupId, level, causeIds: [] } })
    setFresh(id)
    focusNext.current = `[data-item-id="${id}"] [data-field="text"] textarea`
  }

  function markLevel(groupId: string, level: GoalLevel) {
    const id = nextOf('na')
    onAction({ type: 'item/add', step: 3, collection: 'levelNotApplicable', fields: { groupId, level } })
    focusNext.current = `[data-item-id="${id}"] [data-field="why"] textarea`
  }

  function remove(collection: Name, item: Item) {
    const list = lists[collection]
    const index = list.findIndex((i) => i.id === item.id)
    onAction({ type: 'item/remove', step: 3, collection, id: item.id })
    if (picking === item.id) setPicking(null)
    push({ collection, item, index, slot: slotOf(list, item, index, isFocus(item.groupId)), label: removedLabel(collection, item) })
  }

  function undo(removal: Removal) {
    onAction(removal.undoAction ?? { type: 'item/restore', step: 3, collection: removal.collection, item: removal.item, index: removal.index })
    drop(removal.key)
    focusNext.current = `[data-item-id="${removal.item.id}"] textarea`
  }

  const leave = (id: string) =>
    fresh === id
      ? () => {
          onAction({ type: 'item/discard', step: 3, collection: 'goals', id })
          setFresh(null)
        }
      : undefined

  function closePicker(goalId: string) {
    setPicking(null)
    focusNext.current = `[data-picker-toggle="${goalId}"]`
  }

  const missing = (key: string) =>
    blocked.has(key) && (
      <span className="bmissing">
        <StatusIcon status="block" size={16} tooltip={false} />
        fehlt
      </span>
    )

  /** Goals (and undo lines of removed ones) of one group and level, or of a non-focus group. */
  function goalList(groupId: string, level: GoalLevel | undefined, focusGroup: boolean, firstLabel: boolean): ReactNode {
    const same = (i: Item) => i.groupId === groupId && (level === undefined || i.level === level)
    const rows = goals.filter(same)
    const lines = removals.filter((r) => r.collection === 'goals' && same(r.item) && !goals.some((g) => g.id === r.item.id))
    const out: ReactNode[] = []
    for (let i = 0; i <= rows.length; i++) {
      for (const r of lines.filter((l) => Math.min(l.slot ?? rows.length, rows.length) === i))
        out.push(
          <li key={`undo-${r.key}`} data-undo-key={r.key}>
            <UndoLine label={r.label} onUndo={() => undo(r)} focus={!r.undoAction} />
          </li>,
        )
      if (i < rows.length) out.push(goalRow(rows[i], focusGroup, firstLabel && i === 0))
    }
    return out.length ? <ul className="blist">{out}</ul> : null
  }

  function goalRow(goal: Item, focusGroup: boolean, firstLabel: boolean): ReactNode {
    const group = groups.find((g) => g.id === goal.groupId)
    const level = goal.level as GoalLevel
    const name = goalName(goal)
    const linked = goal.causeIds as string[]
    const open = picking === goal.id
    return (
      <li key={goal.id}>
        <BlockItem
          id={goal.id}
          editedByUser={goal.editedByUser && !isEmptyItem(3, 'goals', goal)}
          removeLabel={`${name} entfernen`}
          onRemove={() => remove('goals', goal)}
          onLeave={leave(goal.id)}
        >
          <div data-field="text">
            <InlineText
              multiline
              value={goal.text as string}
              label={`Ziel · Stufe ${level} · ${group ? groupLabel(group) : ''}`}
              placeholder={focusGroup ? PLACEHOLDER[level] : 'Was ist bei der Gruppe anders, wenn das Projekt gewirkt hat?'}
              invalid={blocked.has(fieldKey('goals', goal.id, 'text'))}
              onSave={(text) => edit('goals', goal.id, { text })}
            />
          </div>
          <div className="bcontrols bgoal__controls">
            {!focusGroup && (
              <span className="bcontrol">
                <span className="bgoal__lead" aria-hidden="true">
                  Stufe
                </span>
                <select className="bselect" aria-label={`Stufe: ${name}`} data-field="level" value={level} onChange={(e) => edit('goals', goal.id, { level: Number(e.target.value) })}>
                  {[4, 5, 6].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <span className="bcontrol bgoal__time" data-field="timeFrame">
              <span className="bgoal__lead">{firstLabel ? <Term term="Zeitrahmen" /> : <span aria-hidden="true">Zeitrahmen</span>}</span>
              <InlineText value={goal.timeFrame as string} label={`Zeitrahmen: ${name}`} placeholder="bis wann?" onSave={(timeFrame) => edit('goals', goal.id, { timeFrame })} />
            </span>
            {focusGroup && (
              <span className="bcontrol bgoal__causes" data-field="causeIds">
                <span className="bgoal__lead">Löst auf:</span>
                {linked.map((id) => (
                  <ReferenceChip key={id} text={causeText(id)} />
                ))}
                {missing(fieldKey('goals', goal.id, 'causeIds'))}
                <Button
                  variant="text"
                  className="bgoal__pick"
                  aria-expanded={open}
                  aria-label={`${linked.length ? 'Ursachen ändern' : 'Ursache wählen'}: ${name}`}
                  data-picker-toggle={goal.id}
                  onClick={() => (open ? closePicker(goal.id) : setPicking(goal.id))}
                >
                  {linked.length ? 'Ändern' : 'Ursache wählen'}
                </Button>
              </span>
            )}
          </div>
          {open && group && (
            <CausePicker
              goal={goal}
              group={group}
              causes={ofGroup(step2.causes as Item[], group.id)}
              onChange={(causeIds) => edit('goals', goal.id, { causeIds })}
              onClose={() => closePicker(goal.id)}
              onOpenStep={onOpenStep}
            />
          )}
          <WhyField
            value={goal.why ?? ''}
            blocked={blocked.has(fieldKey('goals', goal.id, 'why'))}
            context={name}
            placeholder={focusGroup ? 'Wofür ist das Ziel auf dem Weg nach oben nötig? (nötig zum Bestätigen)' : 'Warum hilft dieses Ziel dem Projekt? (nötig zum Bestätigen)'}
            onSave={(why) => edit('goals', goal.id, { why })}
          />
        </BlockItem>
      </li>
    )
  }

  function causeText(id: string): string | undefined {
    const cause = (step2.causes as Item[]).find((c) => c.id === id) ?? (step2.problems as Item[]).find((p) => p.id === id)
    if (!cause) return undefined
    return ((cause.text ?? cause.coreProblem) as string) || 'ohne Text'
  }

  function markRow(mark: Item, group: Item): ReactNode {
    const label = `Stufe ${mark.level as number} trifft für „${groupLabel(group)}“ nicht zu`
    return (
      <BlockItem key={mark.id} id={mark.id} editedByUser={false} removeLabel={`Markierung entfernen: ${label}`} onRemove={() => remove('levelNotApplicable', mark)}>
        <p className="bmark">Trifft für „{groupLabel(group)}“ nicht zu.</p>
        <WhyField
          value={mark.why ?? ''}
          blocked={blocked.has(fieldKey('levelNotApplicable', mark.id, 'why'))}
          context={label}
          placeholder="Warum gibt es auf dieser Stufe keine Veränderung? (nötig zum Bestätigen)"
          onSave={(why) => edit('levelNotApplicable', mark.id, { why })}
        />
      </BlockItem>
    )
  }

  function levelSection(group: Item, level: GoalLevel, first: boolean): ReactNode {
    const mark = marks.find((m) => m.groupId === group.id && m.level === level)
    const markLine = removals.find((r) => r.collection === 'levelNotApplicable' && r.item.groupId === group.id && r.item.level === level && !marks.some((m) => m.id === r.item.id))
    const list = goalList(group.id, level, true, first && level === GOAL_LEVELS[0])
    const hasGoals = goals.some((g) => g.groupId === group.id && g.level === level)
    return (
      <BlockSection
        key={level}
        level={4}
        title={`Stufe ${level} · ${LEVEL_NAME[level]}`}
        meta={missing(fieldKey('goals', `${group.id}-${level}`, 'add'))}
        addText="Ziel"
        addLabel={`Ziel hinzufügen: Stufe ${level} · ${groupLabel(group)}`}
        addKey={`goals-${group.id}-${level}`}
        addDisabled={mark ? 'Entferne zuerst die Markierung.' : undefined}
        onAdd={() => addGoal(group.id, level)}
      >
        {list}
        {mark && markRow(mark, group)}
        {markLine && <UndoLine label={markLine.label} onUndo={() => undo(markLine)} focus={!markLine.undoAction} />}
        {!hasGoals && !mark && !list && (
          <div className="blevel__empty">
            <p className="bsection__empty">{EMPTY_HINT[level]}</p>
            <Button variant="text" className="blevel__mark" aria-label={`Stufe ${level} trifft für „${groupLabel(group)}“ nicht zu`} onClick={() => markLevel(group.id, level)}>
              Trifft für diese Gruppe nicht zu
            </Button>
          </div>
        )}
      </BlockSection>
    )
  }

  function focusGroup(group: Item, index: number) {
    const indicator = focus.length === 1 ? 'Fokusgruppe' : focus.length === 2 ? `Fokusgruppe ${index + 1} von 2` : `Fokusgruppe ${index + 1}`
    const own = ofGroup(goals, group.id)
    const ownMarks = ofGroup(marks, group.id)
    const summary = GOAL_LEVELS.map((level) => {
      const n = own.filter((g) => g.level === level).length
      const marked = ownMarks.some((m) => m.level === level)
      return `Stufe ${level}: ${n ? count(n, 'Ziel', 'Ziele') : marked ? 'trifft nicht zu' : 'leer'}`
    }).join(' · ')
    return (
      <Group
        key={group.id}
        id={group.id}
        name={groupLabel(group)}
        indicator={indicator}
        summary={own.length || ownMarks.length ? summary : 'noch leer'}
        blocking={blockingIn(issues, group.id)}
        collapsed={collapsed}
        onToggle={onToggle}
      >
        {GOAL_LEVELS.map((level) => levelSection(group, level, index === 0))}
      </Group>
    )
  }

  function nonFocusGroup(group: Item) {
    const problem = (step2.problems as Item[]).find((p) => p.groupId === group.id)
    const list = goalList(group.id, undefined, false, false)
    return (
      <BlockSection
        key={group.id}
        level={4}
        title={groupLabel(group)}
        meta={missing(fieldKey('goals', group.id, 'add'))}
        addText="Ziel"
        addLabel={`Ziel hinzufügen: ${groupLabel(group)}`}
        addKey={`goals-${group.id}`}
        onAdd={() => addGoal(group.id, 4)}
        lead={
          <p className="bnonfocus__problem">
            {problem?.coreProblem ? (
              <>
                <span className="bgoal__lead">Kernproblem:</span> <ReferenceChip text={problem.coreProblem as string} />
              </>
            ) : (
              <>
                In Schritt 2 hat „{groupLabel(group)}“ noch kein Kernproblem.{' '}
                <Button variant="text" onClick={() => onOpenStep(2)}>
                  Zu Schritt 2
                </Button>
              </>
            )}
          </p>
        }
      >
        {list ?? <p className="bsection__empty">Noch kein Ziel – mindestens eins pro Gruppe.</p>}
      </BlockSection>
    )
  }

  const step1 = project.steps[1]
  const noGroups = !groups.length
  const challenge = step1.block.challenge.text
  const orphanItems = [...goals, ...marks].filter((i) => orphans.includes(i.groupId as string))
  return (
    <div className="bpanel bgroups" ref={panel}>
      {step1.status !== 'confirmed' && !noGroups && <p className="bgroups__note">Schritt 1 ist noch nicht bestätigt – die Gruppen können sich noch ändern.</p>}
      {noGroups || !focus.length ? (
        <div className="bgroups__none">
          <p>{noGroups ? 'Leg in Schritt 1 zuerst Zielgruppen an.' : 'Für diesen Schritt brauchst du 1–2 Fokusgruppen aus Schritt 1.'}</p>
          <Button variant="secondary" onClick={() => onOpenStep(1)}>
            Zu Schritt 1
          </Button>
        </div>
      ) : (
        focus.map(focusGroup)
      )}
      {other.length > 0 && (
        <Group
          id={OTHER}
          name="Weitere Zielgruppen"
          summary={count(other.length, 'Gruppe', 'Gruppen')}
          blocking={other.reduce((n, g) => n + blockingIn(issues, g.id), 0)}
          collapsed={collapsed}
          onToggle={onToggle}
        >
          {other.map(nonFocusGroup)}
        </Group>
      )}
      {orphanItems.length > 0 && (
        <Group id={ORPHANS} name="Ohne Zielgruppe" summary={count(orphanItems.length, 'Eintrag', 'Einträge')} collapsed={collapsed} onToggle={onToggle}>
          <ul className="blist">
            {orphanItems.map((i) => {
              const collection: Name = i.id.startsWith('na') ? 'levelNotApplicable' : 'goals'
              const label = collection === 'goals' ? goalLabel(i) : `Stufe ${i.level as number} trifft nicht zu`
              return (
                <li key={i.id}>
                  <BlockItem id={i.id} editedByUser={false} removeLabel={`„${label}“ entfernen`} onRemove={() => onAction({ type: 'item/remove', step: 3, collection, id: i.id })}>
                    <p className="borphan">{label}</p>
                  </BlockItem>
                </li>
              )
            })}
          </ul>
        </Group>
      )}
      <section className="bgroup blevel7" aria-labelledby="level7-title">
        <h3 id="level7-title" className="bgroup__title blevel7__title">
          Stufe 7 · Beitrag zur Gesellschaft
        </h3>
        <p className="blevel7__note">Der Beitrag des ganzen Projekts, über allen Gruppen.</p>
        <div className="bchallenge">
          <p>Abgeleitet aus der Herausforderung aus Schritt 1:</p>
          {challenge ? <ReferenceChip full text={challenge} /> : <p className="bchallenge__empty">In Schritt 1 ist noch keine Herausforderung eingetragen.</p>}
        </div>
        <BlockItem id={level7.id} editedByUser={level7.editedByUser && !isEmptyItem(3, 'level7', level7)}>
          <div data-field="text">
            <InlineText
              multiline
              value={level7.text as string}
              label="Stufe 7 · Beitrag zur Gesellschaft"
              placeholder="Das Projekt trägt dazu bei, dass …"
              invalid={blocked.has(fieldKey('level7', level7.id, 'text'))}
              onSave={(text) => edit('level7', level7.id, { text })}
            />
          </div>
          <WhyField
            value={level7.why ?? ''}
            blocked={blocked.has(fieldKey('level7', level7.id, 'why'))}
            placeholder="Wie hängt dieser Beitrag mit der Herausforderung zusammen? (nötig zum Bestätigen)"
            onSave={(why) => edit('level7', level7.id, { why })}
          />
        </BlockItem>
      </section>
    </div>
  )
}

type PickerProps = {
  goal: Item
  group: Item
  causes: Item[]
  onChange: (causeIds: string[]) => void
  onClose: () => void
  onOpenStep: (step: StepId) => void
}

/** "Welche Ursachen löst dieses Ziel auf?" in place under the goal's controls (design "Step 17"). */
function CausePicker({ goal, group, causes, onChange, onClose, onOpenStep }: PickerProps) {
  const box = useRef<HTMLFieldSetElement>(null)
  const linked = goal.causeIds as string[]
  const broken = linked.filter((id) => !causes.some((c) => c.id === id))

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [])

  const toggle = (id: string, on: boolean) => onChange(on ? [...linked, id] : linked.filter((l) => l !== id))
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  const rows = (list: TreeRow[]): ReactNode =>
    list.length ? (
      <ul>
        {list.map(({ item, children }) => (
          <li key={item.id}>
            <label className="bpicker__option">
              <input type="checkbox" checked={linked.includes(item.id)} onChange={(e) => toggle(item.id, e.target.checked)} />
              <span>
                {(item.text as string) || 'ohne Text'}
                {(item.notInfluenceable as boolean) && <span className="bpicker__meta"> · nicht beeinflussbar</span>}
              </span>
            </label>
            {rows(children)}
          </li>
        ))}
      </ul>
    ) : null

  return (
    <fieldset className="bpicker" ref={box} data-picker={goal.id} onKeyDown={onKeyDown}>
      <legend>Welche Ursachen löst dieses Ziel auf?</legend>
      {causes.length ? (
        <div className="bpicker__tree">{rows(treeOf(causes))}</div>
      ) : (
        <p className="bpicker__none">
          In Schritt 2 gibt es für „{groupLabel(group)}“ noch keine Ursachen.{' '}
          <Button variant="text" onClick={() => onOpenStep(2)}>
            Zu Schritt 2
          </Button>
        </p>
      )}
      {broken.length > 0 && (
        <ul className="bpicker__broken">
          {broken.map((id) => (
            <li key={id}>
              <label className="bpicker__option">
                <input type="checkbox" checked onChange={() => toggle(id, false)} />
                <span>
                  <StatusIcon status="warn" size={14} tooltip={false} /> Verweis fehlt (Ursache gelöscht)
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <Button variant="text" onClick={onClose}>
        Fertig
      </Button>
    </fieldset>
  )
}

/** "„…“ entfernt." for a goal, "„Stufe 5 trifft nicht zu“ entfernt." for a mark. */
function removedLabel(collection: Name, item: Item): string {
  return collection === 'goals' ? goalLabel(item) : `Stufe ${item.level as number} trifft nicht zu`
}

/** Where an undo line goes among the removed row's siblings: same group, and same level in a focus group. */
function slotOf(list: Item[], item: Item, index: number, byLevel: boolean): number {
  return list.filter((i, n) => n < index && i.groupId === item.groupId && (!byLevel || i.level === item.level)).length
}
