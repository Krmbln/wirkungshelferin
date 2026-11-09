import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isEmptyItem } from '../../domain/block'
import { fieldKey, type HardIssue } from '../../domain/check'
import type { Action } from '../../domain/reducer'
import type { Item } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import { MAX_DEPTH, ofGroup, stepGroups, treeOf, type TreeRow } from '../../domain/tree'
import { evidenceLabels, type StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusIcon } from '../components/StatusIcon'
import { Term } from '../chat/IntroPanel'
import { EVIDENCE, movedUpText } from '../proposals/describe'
import { scrollIntoView } from '../proposals/highlight'
import type { Applied } from './BlockPanel'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, ReferenceChip, UndoLine, WhyField } from './parts'
import { useRemovals, type Removal } from './useRemovals'

// Step 2: a problem tree per focus group, core problems for the other groups (design §6.2
// "Step 16"). The multi-group layout (sticky, collapsible group headers) is shared with steps 3–4.

type TreeName = 'causes' | 'consequences'
const PREFIX: Record<TreeName, string> = { causes: 'ca', consequences: 'co' }

/** Group keys besides the focus groups' ids. */
export const OTHER = 'other'
export const ORPHANS = 'orphans'

const groupLabel = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'
const itemLabel = (i: Item) => (i.text as string) || (i.coreProblem as string) || 'ohne Text'

type Props = {
  project: Project
  onAction: (action: Action) => void
  applied?: Applied
  /** ⛔ issues on screen (gate.ts stillOpen): field markers and the collapsed groups' counts. */
  issues?: HardIssue[]
  /** Collapsed group keys (screen state, kept per step by App). */
  collapsed: string[]
  onToggle: (key: string) => void
  onOpenStep: (step: StepId) => void
}

export function Step2Block({ project, onAction, applied, issues = [], collapsed, onToggle, onOpenStep }: Props) {
  const block = project.steps[2].block
  const problems = block.problems as Item[]
  const lists: Record<TreeName, Item[]> = { causes: block.causes as Item[], consequences: block.consequences as Item[] }
  const { focus, other, orphans } = stepGroups(project, 2)
  const blocked = new Set(issues.map((i) => fieldKey(i.target.collection, i.target.id, i.target.field)))
  const panel = useRef<HTMLDivElement>(null)
  const focusNext = useRef<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)

  const { removals, push, drop } = useRemovals((removal) => {
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (line?.contains(document.activeElement)) focusNext.current = `[data-add="${removal.collection}-${removal.item.groupId}"]`
  })

  useEffect(() => {
    if (!focusNext.current) return
    const target = panel.current?.querySelector<HTMLElement>(focusNext.current)
    if (target) {
      target.focus()
      focusNext.current = null
    }
  })

  // An applied ENTFERNEN shows its undo line at the row's place, like step 1 (focus stays in the card).
  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[2].proposals.find((p) => p.id === applied.proposalId)
    for (const id of applied.changeIds) {
      const change = proposal?.changes.find((c) => c.id === id)
      if (!proposal || change?.op !== 'remove' || change.state !== 'applied' || !change.undo?.before) continue
      const item = change.undo.before as Item
      const name = change.collection as TreeName
      push({
        collection: name,
        item,
        index: change.undo.index,
        slot: siblingsBefore(lists[name] ?? [], item, change.undo.index),
        label: itemLabel(item),
        note: noteFor(name, change.undo.children?.length ?? 0),
        undoAction: { type: 'change/undo', step: 2, proposalId: proposal.id, changeId: change.id },
      })
    }
  }, [applied?.n])

  // The group header carries its bottom line only while it is stuck (design: sticky header).
  useEffect(() => {
    const box = panel.current?.closest('.workspace__scroll')
    if (!box) return
    const mark = () => {
      const top = box.getBoundingClientRect().top
      for (const head of box.querySelectorAll<HTMLElement>('.bgroup__head')) {
        const section = head.parentElement!.getBoundingClientRect()
        const stuck = section.top < top - 1 && section.bottom > top + head.offsetHeight
        head.toggleAttribute('data-stuck', stuck)
      }
    }
    mark()
    box.addEventListener('scroll', mark)
    return () => box.removeEventListener('scroll', mark)
  })

  const edit = (collection: string, id: string, fields: Record<string, unknown>) => onAction({ type: 'item/edit', step: 2, collection, id, fields })

  function add(collection: TreeName, groupId: string, parentId = '') {
    const id = `${PREFIX[collection]}${(project.idCounters[PREFIX[collection]] ?? 0) + 1}`
    onAction({ type: 'item/add', step: 2, collection, fields: { groupId, parentId } })
    setFresh(id)
    focusNext.current = `[data-item-id="${id}"] textarea`
  }

  function remove(collection: TreeName, item: Item) {
    const list = lists[collection]
    const index = list.findIndex((i) => i.id === item.id)
    const children = list.filter((i) => i.parentId === item.id).map((i) => i.id)
    onAction({ type: 'item/remove', step: 2, collection, id: item.id })
    push({ collection, item, index, slot: siblingsBefore(list, item, index), label: itemLabel(item), children, note: noteFor(collection, children.length) })
  }

  function undo(removal: Removal) {
    onAction(
      removal.undoAction ?? { type: 'item/restore', step: 2, collection: removal.collection, item: removal.item, index: removal.index, children: removal.children },
    )
    drop(removal.key)
    focusNext.current = `[data-item-id="${removal.item.id}"] textarea`
  }

  const leave = (collection: TreeName, id: string) =>
    fresh === id
      ? () => {
          onAction({ type: 'item/discard', step: 2, collection, id })
          setFresh(null)
        }
      : undefined

  /** One level of a group's tree, with the undo lines of removed rows at their places. */
  function level(collection: TreeName, groupId: string, rows: TreeRow[], parentId: string, depth: number, firstId?: string): ReactNode {
    const items = lists[collection]
    const lines = removals.filter(
      (r) => r.collection === collection && r.item.groupId === groupId && ((r.item.parentId as string) || '') === parentId && !items.some((i) => i.id === r.item.id),
    )
    const out: ReactNode[] = []
    for (let i = 0; i <= rows.length; i++) {
      for (const r of lines.filter((l) => Math.min(l.slot ?? rows.length, rows.length) === i))
        out.push(
          <li key={`undo-${r.key}`} data-undo-key={r.key}>
            <UndoLine label={r.label} note={r.note} onUndo={() => undo(r)} focus={!r.undoAction} />
          </li>,
        )
      if (i < rows.length) out.push(treeRow(collection, groupId, rows[i], depth, rows[i].item.id === firstId))
    }
    if (!out.length) return null
    return <ul className={depth === 1 ? 'blist btree' : 'btree btree--nested'}>{out}</ul>
  }

  function treeRow(collection: TreeName, groupId: string, row: TreeRow, depth: number, first: boolean): ReactNode {
    const item = row.item
    const cause = collection === 'causes'
    const noun = cause ? 'Ursache' : 'Folge'
    const deeper = depth < MAX_DEPTH
    return (
      <li key={item.id}>
        <BlockItem
          id={item.id}
          editedByUser={item.editedByUser && !isEmptyItem(2, collection, item)}
          removeLabel={`${noun} „${itemLabel(item)}“ entfernen`}
          onRemove={() => remove(collection, item)}
          onLeave={leave(collection, item.id)}
        >
          <InlineText
            multiline
            value={item.text as string}
            label={noun}
            placeholder={cause ? 'Warum besteht das Problem? Als Zustand beschreiben' : 'Was passiert, wenn sich nichts ändert?'}
            onSave={(text) => edit(collection, item.id, { text })}
          />
          {(cause || deeper) && (
            <div className="bcontrols">
              {cause && (
                <>
                  <span className="bcontrol">
                    {first ? <Term term="Evidenzbasis" /> : <span aria-hidden="true">Evidenzbasis</span>}
                    <select
                      className="bselect"
                      aria-label="Evidenzbasis"
                      value={item.evidence as string}
                      onChange={(e) => edit(collection, item.id, { evidence: e.target.value })}
                    >
                      {evidenceLabels.map((e) => (
                        <option key={e} value={e}>
                          {EVIDENCE[e]}
                        </option>
                      ))}
                    </select>
                  </span>
                  <label className="bcontrol">
                    <input type="checkbox" checked={item.notInfluenceable as boolean} onChange={(e) => edit(collection, item.id, { notInfluenceable: e.target.checked })} />
                    {first ? <Term term="nicht beeinflussbar" /> : 'nicht beeinflussbar'}
                  </label>
                </>
              )}
              {deeper && (
                <Button
                  variant="text"
                  className="bcontrols__add"
                  icon={<Icon name="plus" size={16} />}
                  aria-label={`${cause ? 'Ursache dafür' : 'Folge daraus'} hinzufügen: unter „${itemLabel(item)}“`}
                  onClick={() => add(collection, groupId, item.id)}
                >
                  {cause ? 'Ursache dafür' : 'Folge daraus'}
                </Button>
              )}
            </div>
          )}
          {cause && (
            <WhyField
              value={item.why ?? ''}
              blocked={blocked.has(fieldKey('causes', item.id, 'why'))}
              placeholder="Was hast du beobachtet, welche Daten oder Quelle? (nötig zum Bestätigen)"
              onSave={(why) => edit(collection, item.id, { why })}
            />
          )}
        </BlockItem>
        {level(collection, groupId, row.children, item.id, depth + 1)}
      </li>
    )
  }

  function problemField(group: Item) {
    const problem = problems.find((p) => p.groupId === group.id)
    const id = problem?.id ?? `problem:${group.id}`
    // Typing into the empty field (text or Why) creates the group's core problem.
    const save = (fields: Record<string, unknown>) =>
      problem ? edit('problems', problem.id, fields) : onAction({ type: 'item/add', step: 2, collection: 'problems', fields: { groupId: group.id, ...fields } })
    return (
      <BlockItem key={`problem-${group.id}`} id={id} editedByUser={!!problem?.editedByUser && !isEmptyItem(2, 'problems', problem)}>
        <div data-field="coreProblem">
          <InlineText
            multiline
            value={(problem?.coreProblem as string) ?? ''}
            label={`Kernproblem: ${groupLabel(group)}`}
            placeholder="Was ist das Problem – aus Sicht der Gruppe? Ein Satz."
            invalid={blocked.has(fieldKey('problems', id, 'coreProblem'))}
            onSave={(coreProblem) => save({ coreProblem })}
          />
        </div>
        <WhyField
          value={problem?.why ?? ''}
          blocked={blocked.has(fieldKey('problems', id, 'why'))}
          placeholder="Woran erkennst du das Problem? (nötig zum Bestätigen)"
          onSave={(why) => save({ why })}
        />
      </BlockItem>
    )
  }

  const missing = (id: string, field: string) =>
    blocked.has(fieldKey('problems', id, field)) && (
      <span className="bmissing">
        <StatusIcon status="block" size={16} tooltip={false} />
        fehlt
      </span>
    )

  function focusGroup(group: Item, index: number) {
    const problem = problems.find((p) => p.groupId === group.id)
    const trees = { causes: treeOf(ofGroup(lists.causes, group.id)), consequences: treeOf(ofGroup(lists.consequences, group.id)) }
    const challenge = project.steps[1].block.challenge.text
    const firstCause = trees.causes[0]?.item.id
    const section = (collection: TreeName) => {
      const list = level(collection, group.id, trees[collection], '', 1, collection === 'causes' ? firstCause : undefined)
      const cause = collection === 'causes'
      return (
        <BlockSection
          level={4}
          title={cause ? 'Ursachen' : 'Folgen'}
          addText={cause ? 'Ursache' : 'Folge'}
          addLabel={`${cause ? 'Ursache' : 'Folge'} hinzufügen: ${groupLabel(group)}`}
          addKey={`${collection}-${group.id}`}
          onAdd={() => add(collection, group.id)}
          empty={!list}
          emptyHint={cause ? 'Noch leer – warum besteht das Problem? Die Wirkungshelferin hilft dir, Ursachen zu sammeln.' : 'Noch leer – was passiert, wenn sich nichts ändert?'}
          lead={
            cause ? undefined : (
              <div className="bchallenge">
                <p>Die Folgen führen bis zur Herausforderung aus Schritt 1:</p>
                {challenge ? <ReferenceChip full text={challenge} /> : <p className="bchallenge__empty">In Schritt 1 ist noch keine Herausforderung eingetragen.</p>}
              </div>
            )
          }
        >
          {list}
        </BlockSection>
      )
    }
    const indicator = focus.length === 1 ? 'Fokusgruppe' : focus.length === 2 ? `Fokusgruppe ${index + 1} von 2` : `Fokusgruppe ${index + 1}`
    const summary = [
      problem && (problem.coreProblem as string) ? 'Kernproblem' : 'Kernproblem fehlt',
      count(ofGroup(lists.causes, group.id).length, 'Ursache', 'Ursachen'),
      count(ofGroup(lists.consequences, group.id).length, 'Folge', 'Folgen'),
    ]
    const empty = !problem && !ofGroup(lists.causes, group.id).length && !ofGroup(lists.consequences, group.id).length
    return (
      <Group key={group.id} id={group.id} name={groupLabel(group)} indicator={indicator} summary={empty ? 'noch leer' : summary.join(' · ')} blocking={blockingIn(issues, group.id)} collapsed={collapsed} onToggle={onToggle}>
        <BlockSection level={4} title="Kernproblem" meta={missing(problem?.id ?? `problem:${group.id}`, 'coreProblem')}>
          {problemField(group)}
        </BlockSection>
        {section('causes')}
        {section('consequences')}
      </Group>
    )
  }

  const step1 = project.steps[1]
  const noGroups = !(step1.block.targetGroups as Item[]).length
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
        <Group id={OTHER} name="Weitere Zielgruppen" summary={count(other.length, 'Gruppe', 'Gruppen')} blocking={other.reduce((n, g) => n + blockingIn(issues, g.id), 0)} collapsed={collapsed} onToggle={onToggle}>
          {other.map((g) => {
            const hidden = { causes: ofGroup(lists.causes, g.id).length, consequences: ofGroup(lists.consequences, g.id).length }
            return (
              <BlockSection key={g.id} level={4} title={groupLabel(g)} meta={missing(problems.find((p) => p.groupId === g.id)?.id ?? `problem:${g.id}`, 'coreProblem')}>
                {problemField(g)}
                {(hidden.causes > 0 || hidden.consequences > 0) && (
                  // Without any focus group the sentence above already says what to do: one short line each.
                  <p className="bgroups__hidden">
                    {focus.length ? hiddenText(hidden.causes, hidden.consequences, groupLabel(g)) : hiddenShort(hidden.causes, hidden.consequences)}
                    {focus.length > 0 && (
                      <>
                        {' '}
                        <Button variant="text" onClick={() => onOpenStep(1)}>
                          Zu Schritt 1
                        </Button>
                      </>
                    )}
                  </p>
                )}
              </BlockSection>
            )
          })}
        </Group>
      )}
      {orphans.length > 0 && (
        <Group id={ORPHANS} name="Ohne Zielgruppe" summary={count(orphanItems(), 'Eintrag', 'Einträge')} collapsed={collapsed} onToggle={onToggle}>
          <ul className="blist">
            {(['problems', 'causes', 'consequences'] as const).flatMap((collection) =>
              (block[collection] as Item[])
                .filter((i) => orphans.includes(i.groupId as string))
                .map((i) => (
                  <li key={i.id}>
                    <BlockItem
                      id={i.id}
                      editedByUser={false}
                      removeLabel={`„${itemLabel(i)}“ entfernen`}
                      onRemove={() => onAction({ type: 'item/remove', step: 2, collection, id: i.id })}
                    >
                      <p className="borphan">{itemLabel(i)}</p>
                    </BlockItem>
                  </li>
                )),
            )}
          </ul>
        </Group>
      )}
    </div>
  )

  function orphanItems() {
    return (['problems', 'causes', 'consequences'] as const).reduce((n, c) => n + (block[c] as Item[]).filter((i) => orphans.includes(i.groupId as string)).length, 0)
  }
}

type GroupProps = {
  id: string
  name: string
  indicator?: string
  summary: string
  blocking?: number
  collapsed: string[]
  onToggle: (key: string) => void
  children: ReactNode
}

/** A group of the multi-group layout: sticky header that collapses it (design §6.2 "Step 16"). */
export function Group({ id, name, indicator, summary, blocking = 0, collapsed, onToggle, children }: GroupProps) {
  const open = !collapsed.includes(id)
  const section = useRef<HTMLElement>(null)
  function toggle() {
    const head = section.current?.querySelector('.bgroup__head')
    const stuck = head?.hasAttribute('data-stuck')
    onToggle(id)
    // Collapsing while stuck: the content above would jump; bring the header to the top instead.
    if (open && stuck && section.current) requestAnimationFrame(() => section.current && scrollIntoView(section.current, 'start'))
  }
  return (
    <section className="bgroup" ref={section} data-group={id} aria-labelledby={`group-${id}`}>
      <div className="bgroup__head" data-group-header={id}>
        <h3 className="bgroup__title">
          <button type="button" id={`group-${id}`} className="bgroup__toggle" aria-expanded={open} data-group-toggle={id} onClick={toggle}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
            <span className="bgroup__name" title={name}>
              {name}
            </span>
            {indicator && <span className="bgroup__indicator">{indicator}</span>}
          </button>
        </h3>
      </div>
      {open ? (
        <div className="bgroup__body">{children}</div>
      ) : (
        <p className="bgroup__summary">
          {summary}
          {blocking > 0 && (
            <>
              {' · '}
              <span className="bmissing">
                <StatusIcon status="block" size={16} tooltip={false} />
                {blocking === 1 ? '1 blockiert' : `${blocking} blockieren`}
              </span>
            </>
          )}
        </p>
      )}
    </section>
  )
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** ⛔ issues that sit inside a group (the collapsed summary counts them). */
const blockingIn = (issues: HardIssue[], groupId: string) => issues.filter((i) => i.target.group === groupId).length

/** Where an undo line goes among the removed row's siblings. */
function siblingsBefore(list: Item[], item: Item, index: number): number {
  const parent = (item.parentId as string) || ''
  return list.filter((i, n) => n < index && i.groupId === item.groupId && ((i.parentId as string) || '') === parent).length
}

function noteFor(collection: TreeName, n: number): string | undefined {
  const [text] = movedUpText(collection, n)
  return text && `${text}.`
}

/** "4 Ursachen und 2 Folgen sind ausgeblendet." (no focus group at all) */
export function hiddenShort(causes: number, consequences: number): string {
  const parts = [causes && count(causes, 'Ursache', 'Ursachen'), consequences && count(consequences, 'Folge', 'Folgen')].filter(Boolean)
  return `${parts.join(' und ')} ${causes + consequences === 1 ? 'ist' : 'sind'} ausgeblendet.`
}

/** "3 Ursachen und 1 Folge sind ausgeblendet, solange „Eltern“ keine Fokusgruppe ist. …" */
export function hiddenText(causes: number, consequences: number, name: string): string {
  const parts = [causes && count(causes, 'Ursache', 'Ursachen'), consequences && count(consequences, 'Folge', 'Folgen')].filter(Boolean)
  const verb = causes + consequences === 1 ? 'ist' : 'sind'
  return `${parts.join(' und ')} ${verb} ausgeblendet, solange „${name}“ keine Fokusgruppe ist. Sie ${verb === 'ist' ? 'kommt' : 'kommen'} zurück, wenn du die Gruppe in Schritt 1 wieder als Fokusgruppe markierst.`
}
