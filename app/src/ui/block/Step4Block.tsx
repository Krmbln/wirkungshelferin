import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { isEmptyItem } from '../../domain/block'
import { settled } from '../../domain/outdated'
import { CRITICAL_MAX, OUTPUT_LEVELS, activityUse, chainItems, chainOf, criticalLinks, endOf, linkState, linksUsing, skippedLevels, unlinked, type ChainItems, type End, type OutputLevel } from '../../domain/chain'
import { cut, fieldKey, type HardIssue } from '../../domain/check'
import type { Action } from '../../domain/reducer'
import type { Item } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import { ofGroup, stepGroups } from '../../domain/tree'
import { evidenceLabels, type StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { StatusIcon } from '../components/StatusIcon'
import { Term } from '../chat/IntroPanel'
import { DIRECTION, EVIDENCE } from '../proposals/describe'
import type { Applied } from './BlockPanel'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, ReferenceChip, UndoLine, WhyField } from './parts'
import { Group, ORPHANS, OTHER, blockingIn, count, useStuckHeaders } from './Step2Block'
import { useRemovals, type Removal } from './useRemovals'

// Step 4: resources and activities for the project, per focus group the chain (outputs at
// Stufen 1–3, step 3's goals read-only, links as an ordered list), then external factors and
// side effects for all focus groups (design §6.2 "Step 18"). Same multi-group layout as step 2.

type Name = 'resources' | 'activities' | 'outputs' | 'links' | 'externalFactors' | 'sideEffects'

const OUTPUT_NAME: Record<OutputLevel, string> = { 1: 'Angebot findet statt', 2: 'Gruppe wird erreicht', 3: 'Gruppe nimmt das Angebot an' }
const OUTPUT_PLACEHOLDER: Record<OutputLevel, string> = {
  1: 'Was findet statt – wie oft, wie viel?',
  2: 'Wer nimmt teil – wie viele, wie regelmäßig?',
  3: 'Woran zeigt sich, dass die Gruppe das Angebot annimmt?',
}
const OUTPUT_HINT: Record<OutputLevel, string> = {
  1: 'Noch leer – was findet für die Gruppe statt?',
  2: 'Noch leer – wen erreicht ihr?',
  3: 'Noch leer – woran merkt ihr, dass die Gruppe das Angebot annimmt?',
}

const groupLabel = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'
const textOf = (i: Item) => (i.text as string) || 'ohne Text'
/** "Aktivität", "Stufe 2", "Ziel · Stufe 5": the level prefix inside a link's chip. */
const endPrefix = (end: End) => (end.kind === 'activity' ? 'Aktivität' : end.kind === 'goal' ? `Ziel · Stufe ${end.level}` : `Stufe ${end.level}`)

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

export function Step4Block({ project, onAction, applied, issues = [], collapsed, onToggle, onOpenStep }: Props) {
  const block = project.steps[4].block
  const lists = block as unknown as Record<Name, Item[]>
  const links = lists.links
  const items = chainItems(project)
  const { focus, other, orphans } = stepGroups(project, 4)
  const groups = project.steps[1].block.targetGroups as Item[]
  const blocked = new Set(issues.map((i) => fieldKey(i.target.collection, i.target.id, i.target.field)))
  const panel = useRef<HTMLDivElement>(null)
  const focusNext = useRef<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  /** The link whose picker is open (one at a time), and whether its draft differs. */
  const [picking, setPicking] = useState<string | null>(null)
  const dirty = useRef(false)
  /** A link an Übernehmen changed while its picker was open: "Die Verbindung wurde gerade geändert …". */
  const [changedUnder, setChangedUnder] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')

  const addKey = (collection: Name, item: Item) =>
    collection === 'outputs' ? `outputs-${item.groupId as string}-${item.level as number}` : collection === 'links' ? `links-${item.groupId as string}` : collection

  const { removals, push, drop } = useRemovals((removal) => {
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (line?.contains(document.activeElement)) focusNext.current = `[data-add="${addKey(removal.collection as Name, removal.item)}"]`
  })

  useEffect(() => {
    if (!focusNext.current) return
    const target = panel.current?.querySelector<HTMLElement>(focusNext.current)
    if (target) {
      target.focus()
      focusNext.current = null
    }
  })

  // An applied ENTFERNEN shows its undo line at the row's place (focus stays in the card); an
  // applied change to the link being picked closes its picker.
  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[4].proposals.find((p) => p.id === applied.proposalId)
    for (const id of applied.changeIds) {
      const change = proposal?.changes.find((c) => c.id === id)
      if (!proposal || change?.state !== 'applied') continue
      if (picking && change.targetId === picking) {
        setPicking(null)
        dirty.current = false
        if (change.op === 'update') {
          setChangedUnder(picking)
          focusNext.current = `[data-picker-toggle="${picking}"]`
        }
      }
      if (change.op !== 'remove' || !change.undo?.before) continue
      const item = change.undo.before as Item
      const name = change.collection as Name
      push({
        collection: name,
        item,
        index: change.undo.index,
        slot: slotOf(lists[name] ?? [], item, change.undo.index),
        label: removedLabel(name, item, items),
        note: usedNote(links, item.id),
        undoAction: { type: 'change/undo', step: 4, proposalId: proposal.id, changeId: change.id },
      })
    }
  }, [applied?.n])

  useStuckHeaders(panel)

  const edit = (collection: string, id: string, fields: Record<string, unknown>) => onAction({ type: 'item/edit', step: 4, collection, id, fields })
  const nextOf = (prefix: string) => `${prefix}${(project.idCounters[prefix] ?? 0) + 1}`

  function add(collection: Name, prefix: string, fields: Record<string, unknown>, field = 'text') {
    const id = nextOf(prefix)
    onAction({ type: 'item/add', step: 4, collection, fields })
    setFresh(id)
    focusNext.current = `[data-item-id="${id}"] [data-field="${field}"] textarea`
    return id
  }

  function addLink(groupId: string) {
    const id = nextOf('li')
    onAction({ type: 'item/add', step: 4, collection: 'links', fields: { groupId, fromId: '', toId: '', evidence: 'unsicher', critical: false } })
    setFresh(id)
    openPicker(id)
  }

  /** One picker at a time: a changed draft of another one is dropped, and that is said. */
  function openPicker(id: string | null) {
    if (picking && picking !== id && dirty.current) {
      const link = links.find((l) => l.id === picking)
      if (link) setAnnounce(`Änderung an ${linkName(items, link)} verworfen`)
    }
    dirty.current = false
    setChangedUnder(null)
    setPicking(id)
  }

  function toggleGroup(key: string) {
    // Collapsing a group with an open picker counts as "Abbrechen".
    const link = links.find((l) => l.id === picking)
    if (link && link.groupId === key && !collapsed.includes(key)) openPicker(null)
    onToggle(key)
  }

  function remove(collection: Name, item: Item) {
    const list = lists[collection]
    const index = list.findIndex((i) => i.id === item.id)
    onAction({ type: 'item/remove', step: 4, collection, id: item.id })
    if (picking === item.id) openPicker(null)
    push({ collection, item, index, slot: slotOf(list, item, index), label: removedLabel(collection, item, items), note: usedNote(links, item.id) })
  }

  function undo(removal: Removal) {
    onAction(removal.undoAction ?? { type: 'item/restore', step: 4, collection: removal.collection, item: removal.item, index: removal.index })
    drop(removal.key)
    focusNext.current = `[data-item-id="${removal.item.id}"] textarea, [data-item-id="${removal.item.id}"] button`
  }

  const leave = (collection: Name, id: string) =>
    fresh === id
      ? () => {
          if (picking === id) return
          onAction({ type: 'item/discard', step: 4, collection, id })
          setFresh(null)
        }
      : undefined

  function closePicker(linkId: string) {
    setPicking(null)
    dirty.current = false
    focusNext.current = `[data-picker-toggle="${linkId}"]`
  }

  /** Rows of one list (filtered) with the undo lines of removed ones at their places. */
  function rows(collection: Name, keep: (i: Item) => boolean, row: (item: Item, index: number) => ReactNode, ordered?: Item[], tag: 'ul' | 'ol' = 'ul'): ReactNode {
    const shown = ordered ?? lists[collection].filter(keep)
    const lines = removals.filter((r) => r.collection === collection && keep(r.item) && !lists[collection].some((i) => i.id === r.item.id))
    const out: ReactNode[] = []
    for (let i = 0; i <= shown.length; i++) {
      for (const r of lines.filter((l) => Math.min(l.slot ?? shown.length, shown.length) === i))
        out.push(
          <li key={`undo-${r.key}`} data-undo-key={r.key}>
            <UndoLine label={r.label} note={r.note} onUndo={() => undo(r)} focus={!r.undoAction} />
          </li>,
        )
      if (i < shown.length) out.push(<li key={shown[i].id}>{row(shown[i], i)}</li>)
    }
    if (!out.length) return null
    return tag === 'ol' ? <ol className="blist blinks">{out}</ol> : <ul className="blist">{out}</ul>
  }

  const edited = (collection: Name, item: Item) => item.editedByUser && !isEmptyItem(4, collection, item)

  function textRow(collection: Name, item: Item, label: string, placeholder: string, children?: ReactNode): ReactNode {
    return (
      <BlockItem id={item.id} editedByUser={edited(collection, item)} removeLabel={`${label} „${cut(textOf(item), 40)}“ entfernen`} onRemove={() => remove(collection, item)} onLeave={leave(collection, item.id)}>
        <div data-field="text">
          <InlineText multiline value={item.text as string} label={label} placeholder={placeholder} invalid={blocked.has(fieldKey(collection, item.id, 'text'))} onSave={(text) => edit(collection, item.id, { text })} />
        </div>
        {children}
      </BlockItem>
    )
  }

  // ——— Ressourcen, Aktivitäten ———

  function resources(): ReactNode {
    const list = rows('resources', () => true, (r) => textRow('resources', r, 'Ressource', 'Wer oder was trägt euer Angebot? Personen, Räume, Material, Partner, Geld'))
    return (
      <BlockSection title="Ressourcen" addText="Ressource" addLabel="Ressource hinzufügen" addKey="resources" onAdd={() => add('resources', 'rs', {})}>
        {list ?? <p className="bsection__empty">Noch leer – wer oder was steht euch zur Verfügung?</p>}
      </BlockSection>
    )
  }

  function activities(): ReactNode {
    const focusIds = focus.map((g) => g.id)
    const list = rows('activities', () => true, (a) => {
      const used = activityUse(links, a.id, focusIds).map((id) => groupLabel(groups.find((g) => g.id === id)!))
      return textRow(
        'activities',
        a,
        'Aktivität',
        'Was tut ihr, und wie oft?',
        <>
          <p className="buse">{used.length ? `In der Kette von: ${used.join(', ')}` : 'Noch in keiner Kette'}</p>
          <WhyField
            value={a.why ?? ''}
            blocked={blocked.has(fieldKey('activities', a.id, 'why'))}
            context={`Aktivität „${cut(textOf(a), 40)}“`}
            placeholder="Wozu? Zu welchem Ziel trägt das bei? (nötig zum Bestätigen)"
            onSave={(why) => edit('activities', a.id, { why })}
          />
        </>,
      )
    })
    return (
      <BlockSection
        title="Aktivitäten"
        addText="Aktivität"
        addLabel="Aktivität hinzufügen"
        addKey="activities"
        onAdd={() => add('activities', 'ac', {})}
        lead={<p className="bsection__cue">Alles, was ihr tut – auch für Gruppen ohne eigene Kette.</p>}
      >
        {list ?? <p className="bsection__empty">Noch leer – was tut ihr im Projekt?</p>}
      </BlockSection>
    )
  }

  // ——— The chain of one focus group ———

  function outputSection(group: Item, level: OutputLevel, hints: boolean): ReactNode {
    const list = rows(
      'outputs',
      (i) => i.groupId === group.id && i.level === level,
      (o) => textRow('outputs', o, `Leistung · Stufe ${level} · ${groupLabel(group)}`, OUTPUT_PLACEHOLDER[level]),
    )
    return (
      <BlockSection
        key={level}
        level={4}
        title={`Stufe ${level} · ${OUTPUT_NAME[level]}`}
        addText="Leistung"
        addLabel={`Leistung hinzufügen: Stufe ${level} · ${groupLabel(group)}`}
        addKey={`outputs-${group.id}-${level}`}
        onAdd={() => add('outputs', 'ou', { groupId: group.id, level })}
      >
        {list ?? (hints ? <p className="bsection__empty">{OUTPUT_HINT[level]}</p> : null)}
      </BlockSection>
    )
  }

  function goalsSection(group: Item): ReactNode {
    const goals = ofGroup(items.goals, group.id)
    const free = new Set(unlinked(items, links, group.id).goals.map((g) => g.id))
    return (
      <BlockSection
        level={4}
        title="Stufe 4–6 · Ziele aus Schritt 3"
        actions={
          <Button variant="text" className="bsection__add" onClick={() => onOpenStep(3)}>
            Zu Schritt 3
          </Button>
        }
      >
        {goals.length ? (
          <div className="bchain__goals">
            {[4, 5, 6].map((level) => {
              const here = goals.filter((g) => g.level === level)
              const marked = items.marks.some((m) => m.groupId === group.id && m.level === level)
              if (!here.length && !marked)
                return (
                  <div key={level} className="bchain__level">
                    <p className="bchain__label">Stufe {level}</p>
                    <p className="bchain__mark">In Schritt 3 noch kein Ziel für Stufe {level}.</p>
                  </div>
                )
              return (
                <div key={level} className="bchain__level">
                  <p className="bchain__label">Stufe {level}</p>
                  {marked && !here.length ? (
                    <p className="bchain__mark">
                      Stufe {level} trifft für „{groupLabel(group)}“ nicht zu.
                    </p>
                  ) : (
                    <ul className="bchain__chips">
                      {here.map((g) => (
                        <li key={g.id}>
                          <ReferenceChip full text={textOf(g)} />
                          {free.has(g.id) && <span className="bchain__free"> · noch ohne Verbindung</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="bsection__empty">In Schritt 3 gibt es für „{groupLabel(group)}“ noch keine Ziele.</p>
        )}
      </BlockSection>
    )
  }

  function linkRow(link: Item, group: Item, first: boolean, criticalCount: number): ReactNode {
    const state = linkState(items, link)
    const name = linkName(items, link)
    const open = picking === link.id
    const complete = !!link.fromId && !!link.toId
    const skipped = skippedLevels(items, link)
    const chip = (end: End | undefined, id: unknown, empty: string) =>
      end ? (
        <span className="refchip refchip--level" title={textOf(end.item)}>
          <span className="refchip__prefix">{endPrefix(end)}</span> {textOf(end.item)}
        </span>
      ) : id ? (
        <ReferenceChip />
      ) : (
        <span className="blink__empty">{empty}</span>
      )
    return (
      <BlockItem id={link.id} editedByUser={edited('links', link)} removeLabel={`Verbindung ${name} entfernen`} onRemove={() => remove('links', link)} onLeave={leave('links', link.id)}>
        <div className="blink__arrow" data-field="ends">
          <div className="blink__line">
            {chip(state.from, link.fromId, 'Start wählen')}
            <Button
              variant="text"
              className="blink__pick"
              aria-expanded={open}
              aria-label={complete ? `Verbindung ändern: ${name}` : `Verbindung wählen: ${name}`}
              data-picker-toggle={link.id}
              onClick={() => (open ? closePicker(link.id) : openPicker(link.id))}
            >
              {complete ? 'Ändern' : 'Verbindung wählen'}
            </Button>
          </div>
          <div className="blink__line blink__line--to">
            <span className="blink__to" aria-hidden="true">
              →
            </span>
            <span className="visually-hidden">führt zu</span>
            {chip(state.to, link.toId, 'Ziel wählen')}
            {state.from && state.to && !state.upward && (
              <span className="blink__skip">
                <StatusIcon status="warn" size={14} tooltip={false} /> muss über dem Start liegen
              </span>
            )}
            {skipped.length > 0 && <span className="blink__skip">überspringt Stufe {skipped.join(' und ')}</span>}
          </div>
        </div>
        {open && (
          <LinkPicker
            link={link}
            group={group}
            items={items}
            links={links}
            onDirty={(d) => {
              dirty.current = d
            }}
            onSave={(fromId, toId) => {
              edit('links', link.id, { fromId, toId })
              closePicker(link.id)
            }}
            onCancel={() => closePicker(link.id)}
            onOpenStep={onOpenStep}
          />
        )}
        {changedUnder === link.id && <p className="blink__changed">Die Verbindung wurde gerade geändert – öffne sie neu.</p>}
        <WhyField
          label="weil …"
          field="because"
          name="weil"
          value={(link.because as string) ?? ''}
          blocked={blocked.has(fieldKey('links', link.id, 'because'))}
          context={`Verbindung ${name}`}
          placeholder="Warum führt das eine zum anderen? Der Mechanismus (nötig zum Bestätigen)"
          onSave={(because) => edit('links', link.id, { because })}
        />
        <WhyField
          label={first ? <Term term="Annahme" /> : 'Annahme'}
          field="assumption"
          name="Annahme"
          value={(link.assumption as string) ?? ''}
          blocked={blocked.has(fieldKey('links', link.id, 'assumption'))}
          context={`Verbindung ${name}`}
          placeholder="Was muss wahr sein, damit dieser Pfeil hält? (nötig zum Bestätigen)"
          onSave={(assumption) => edit('links', link.id, { assumption })}
        />
        <div className="bcontrols">
          <label className="bcontrol" data-field="evidence">
            {first ? <Term term="Evidenzbasis" /> : <span aria-hidden="true">Evidenzbasis</span>}
            <select className="bselect" aria-label={`Evidenzbasis: Verbindung ${name}`} value={link.evidence as string} onChange={(e) => edit('links', link.id, { evidence: e.target.value })}>
              {evidenceLabels.map((e) => (
                <option key={e} value={e}>
                  {EVIDENCE[e]}
                </option>
              ))}
            </select>
          </label>
          <label className="bcontrol" data-field="critical">
            <input type="checkbox" aria-label={`kritisch: Verbindung ${name}`} checked={link.critical as boolean} onChange={(e) => edit('links', link.id, { critical: e.target.checked })} />
            {first ? <Term term="Kritische Annahme" label="kritisch" /> : <span aria-hidden="true">kritisch</span>}
          </label>
          {(link.critical as boolean) && criticalCount > CRITICAL_MAX && (
            <span className="blink__over">
              <StatusIcon status="warn" size={14} tooltip={false} />
              {criticalCount} von höchstens {CRITICAL_MAX} kritisch
            </span>
          )}
        </div>
      </BlockItem>
    )
  }

  function linksSection(group: Item, hints: boolean): ReactNode {
    const chain = chainOf(items, links, group.id)
    const critical = criticalLinks(items, links, group.id).length
    const firstId = chain[0]?.id
    const list = rows('links', (i) => i.groupId === group.id, (l) => linkRow(l, group, l.id === firstId, critical), chain, 'ol')
    const free = unlinked(items, links, group.id).outputs
    const freeText = free
      .slice(0, 3)
      .map((o) => `Leistung „${cut(textOf(o), 40)}“ (Stufe ${o.level as number})`)
      .join(', ')
    return (
      <BlockSection level={4} title="Verbindungen" addText="Verbindung" addLabel={`Verbindung hinzufügen: ${groupLabel(group)}`} addKey={`links-${group.id}`} onAdd={() => addLink(group.id)}>
        {list ?? (hints ? <p className="bsection__empty">Noch keine Verbindung – was führt wozu?</p> : null)}
        {free.length > 0 && chain.length > 0 && (
          <p className="bsection__cue">
            Noch ohne Verbindung: {freeText}
            {free.length > 3 && ` + ${free.length - 3} weitere`}
          </p>
        )}
        <p className="bcritical" aria-live="polite">
          {critical > CRITICAL_MAX && (
            <>
              <StatusIcon status="warn" size={16} tooltip={false} />
              <span>
                {critical} Annahmen sind als kritisch markiert – höchstens {CRITICAL_MAX} je Gruppe. Behalte die, an denen es am ehesten hakt.
              </span>
            </>
          )}
        </p>
      </BlockSection>
    )
  }

  function focusGroup(group: Item, index: number) {
    const indicator = focus.length === 1 ? 'Fokusgruppe' : focus.length === 2 ? `Fokusgruppe ${index + 1} von 2` : `Fokusgruppe ${index + 1}`
    const outputs = ofGroup(lists.outputs, group.id)
    const own = ofGroup(links, group.id)
    const critical = criticalLinks(items, links, group.id).length
    const empty = !outputs.length && !own.length
    const summary = [
      count(outputs.length, 'Leistung', 'Leistungen'),
      count(own.length, 'Verbindung', 'Verbindungen'),
      ...(critical ? [critical > CRITICAL_MAX ? `⚠ ${critical} kritisch` : `${critical} kritisch`] : []),
    ].join(' · ')
    return (
      <Group key={group.id} id={group.id} name={groupLabel(group)} indicator={indicator} summary={empty ? 'noch leer' : summary} blocking={blockingIn(issues, group.id)} collapsed={collapsed} onToggle={toggleGroup}>
        {empty && <p className="bchain__lead">Noch leer – die Wirkungshelferin schlägt dir die ganze Kette für „{groupLabel(group)}“ vor, sobald die Aktivitäten stehen.</p>}
        {OUTPUT_LEVELS.map((level) => outputSection(group, level, !empty))}
        {goalsSection(group)}
        {linksSection(group, !empty)}
      </Group>
    )
  }

  // ——— Umfeld und Nebenwirkungen ———

  function factorRow(f: Item): ReactNode {
    const groupId = (f.groupId as string) ?? ''
    const known = groups.find((g) => g.id === groupId)
    const stale = groupId && !known?.isFocus
    const label = `Externer Faktor „${cut(textOf(f), 40)}“`
    return textRow(
      'externalFactors',
      f,
      'Externer Faktor',
      'Was wirkt auf die Kette, ohne dass ihr es steuert?',
      <div className="bcontrols">
        <label className="bcontrol" data-field="groupId">
          <span aria-hidden="true">Betrifft</span>
          <select className="bselect" aria-label={`Betrifft: ${label}`} value={groupId} onChange={(e) => edit('externalFactors', f.id, { groupId: e.target.value })}>
            <option value="">alle Fokusgruppen</option>
            {focus.map((g) => (
              <option key={g.id} value={g.id}>
                {groupLabel(g)}
              </option>
            ))}
            {stale && <option value={groupId}>{known ? `„${groupLabel(known)}“ (keine Fokusgruppe mehr)` : 'Gruppe gibt es nicht mehr'}</option>}
          </select>
        </label>
        {stale && (
          <span className="blink__over">
            <StatusIcon status="warn" size={14} tooltip={false} />
            {known ? 'Gruppe ist keine Fokusgruppe mehr' : 'Verweis fehlt'}
          </span>
        )}
      </div>,
    )
  }

  function sideEffectRow(s: Item): ReactNode {
    const label = `Unbeabsichtigte Wirkung „${cut(textOf(s), 40)}“`
    return textRow(
      'sideEffects',
      s,
      'Unbeabsichtigte Wirkung',
      'Was könnte sich nebenbei verändern?',
      <div className="bcontrols">
        <fieldset className="bcontrols__group" data-field="direction">
          <legend className="visually-hidden">Richtung: {label}</legend>
          {(['negative', 'positive'] as const).map((d) => (
            <label key={d} className="bcontrol">
              <input type="radio" name={`direction-${s.id}`} checked={s.direction === d} onChange={() => edit('sideEffects', s.id, { direction: d })} />
              {DIRECTION[d]}
            </label>
          ))}
        </fieldset>
        <span className="bcontrol bgoal__time" data-field="affectedGroup">
          <span aria-hidden="true">Betrifft</span>
          <InlineText value={s.affectedGroup as string} label={`Betrifft: ${label}`} placeholder="wen?" onSave={(affectedGroup) => edit('sideEffects', s.id, { affectedGroup })} />
        </span>
      </div>,
    )
  }

  function surroundings(): ReactNode {
    const focusIds = new Set(focus.map((g) => g.id))
    const fixed = (project.steps[2].block.causes as Item[]).filter((c) => c.notInfluenceable && focusIds.has(c.groupId as string))
    const factors = rows('externalFactors', () => true, factorRow)
    const effects = rows('sideEffects', () => true, sideEffectRow)
    return (
      <section className="bgroup bwide" aria-labelledby="surroundings-title">
        <h3 id="surroundings-title" className="bgroup__title blevel7__title">
          Umfeld und Nebenwirkungen
        </h3>
        <p className="blevel7__note">Für alle Fokusgruppen zusammen – was außer euch noch wirkt.</p>
        <BlockSection
          level={4}
          title={<Term term="Externer Faktor" label="Externe Faktoren" />}
          addText="Faktor"
          addLabel="Externen Faktor hinzufügen"
          addKey="externalFactors"
          onAdd={() => add('externalFactors', 'ef', { groupId: '' })}
          lead={
            fixed.length > 0 && (
              <div className="bchallenge">
                <p>Nicht beeinflussbar laut Schritt 2:</p>
                {fixed.map((c) => (
                  <ReferenceChip key={c.id} full text={textOf(c)} />
                ))}
              </div>
            )
          }
        >
          {factors ?? <p className="bsection__empty">Noch leer – was trägt außer euch zur Veränderung bei oder bremst sie?</p>}
        </BlockSection>
        <BlockSection
          level={4}
          title={<Term term="Unbeabsichtigte Wirkung" label="Unbeabsichtigte Wirkungen" />}
          addText="Wirkung"
          addLabel="Unbeabsichtigte Wirkung hinzufügen"
          addKey="sideEffects"
          onAdd={() => add('sideEffects', 'se', { direction: 'negative' })}
        >
          {effects ?? <p className="bsection__empty">Noch leer – wer könnte nicht profitieren oder Nachteile haben?</p>}
        </BlockSection>
      </section>
    )
  }

  // ——— Frame ———

  const step1 = project.steps[1]
  const noGroups = !groups.length
  const unconfirmed = [!settled(step1) && !noGroups ? 1 : 0, !settled(project.steps[3]) ? 3 : 0].filter(Boolean)
  const note =
    unconfirmed.length === 2
      ? 'Schritt 1 und 3 sind noch nicht bestätigt – Gruppen und Ziele können sich noch ändern.'
      : unconfirmed[0] === 1
        ? 'Schritt 1 ist noch nicht bestätigt – die Gruppen können sich noch ändern.'
        : unconfirmed[0] === 3
          ? 'Schritt 3 ist noch nicht bestätigt – die Ziele können sich noch ändern.'
          : ''
  const hiddenOf = (g: Item) => ({ outputs: ofGroup(lists.outputs, g.id).length, links: ofGroup(links, g.id).length })
  const withHidden = other.filter((g) => hiddenOf(g).outputs + hiddenOf(g).links > 0)
  const orphanItems = [...lists.outputs, ...links].filter((i) => orphans.includes(i.groupId as string))
  return (
    <div className="bpanel bgroups" ref={panel}>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      {note && <p className="bgroups__note">{note}</p>}
      {resources()}
      {activities()}
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
      {withHidden.length > 0 && (
        <Group id={OTHER} name="Weitere Zielgruppen" summary={count(withHidden.length, 'Gruppe', 'Gruppen')} collapsed={collapsed} onToggle={toggleGroup}>
          {withHidden.map((g) => (
            <BlockSection key={g.id} level={4} title={groupLabel(g)}>
              <p className="bgroups__hidden">
                {hiddenText(hiddenOf(g).outputs, hiddenOf(g).links, groupLabel(g), focus.length > 0)}
                {focus.length > 0 && (
                  <>
                    {' '}
                    <Button variant="text" onClick={() => onOpenStep(1)}>
                      Zu Schritt 1
                    </Button>
                  </>
                )}
              </p>
            </BlockSection>
          ))}
        </Group>
      )}
      {orphanItems.length > 0 && (
        <Group id={ORPHANS} name="Ohne Zielgruppe" summary={count(orphanItems.length, 'Eintrag', 'Einträge')} collapsed={collapsed} onToggle={toggleGroup}>
          <ul className="blist">
            {orphanItems.map((i) => {
              const collection: Name = i.id.startsWith('li') ? 'links' : 'outputs'
              const label = collection === 'links' ? `Verbindung ${linkName(items, i)}` : textOf(i)
              return (
                <li key={i.id}>
                  <BlockItem id={i.id} editedByUser={false} removeLabel={`${label} entfernen`} onRemove={() => onAction({ type: 'item/remove', step: 4, collection, id: i.id })}>
                    <p className="borphan">{label}</p>
                  </BlockItem>
                </li>
              )
            })}
          </ul>
        </Group>
      )}
      {surroundings()}
    </div>
  )
}

type PickerProps = {
  link: Item
  group: Item
  items: ChainItems
  links: Item[]
  onDirty: (dirty: boolean) => void
  onSave: (fromId: string, toId: string) => void
  onCancel: () => void
  onOpenStep: (step: StepId) => void
}

/**
 * "Von" / "Nach" in place under the link's arrow (design "Step 18"). A draft until "Fertig":
 * native radios check on every arrow key, so saving at once would save every option passed.
 */
function LinkPicker({ link, group, items, links, onDirty, onSave, onCancel, onOpenStep }: PickerProps) {
  const box = useRef<HTMLDivElement>(null)
  const [from, setFrom] = useState((link.fromId as string) ?? '')
  const [to, setTo] = useState((link.toId as string) ?? '')
  const fromEnd = endOf(items, group.id, from)
  const toEnd = endOf(items, group.id, to)
  const fits = (end: End | undefined) => !!end && end.kind !== 'activity' && (!fromEnd || end.level > fromEnd.level)
  const twin = (id: string) => links.some((l) => l.id !== link.id && l.groupId === group.id && l.fromId === from && l.toId === id)
  const misfit = !!to && !!toEnd && !fits(toEnd)
  const changed = from !== ((link.fromId as string) ?? '') || to !== ((link.toId as string) ?? '')

  // The row's start chip stays in view above the picker (it can be two screens tall); focus without a second scroll.
  useEffect(() => {
    box.current?.closest('[data-item-id]')?.scrollIntoView?.({ block: 'start' })
    box.current?.querySelector<HTMLElement>('input:not(:disabled), button')?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    onDirty(changed)
  }, [changed])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onCancel()
  }

  const outputs = (level: number) => items.outputs.filter((o) => o.groupId === group.id && o.level === level)
  const goals = (level: number) => items.goals.filter((g) => g.groupId === group.id && g.level === level)
  const fromGroups: [string, Item[]][] = [
    ['Aktivitäten', items.activities],
    ...OUTPUT_LEVELS.map((l): [string, Item[]] => [`Stufe ${l} · Leistungen`, outputs(l)]),
    ...[4, 5].map((l): [string, Item[]] => [`Stufe ${l} · Ziele aus Schritt 3`, goals(l)]),
  ]
  const toGroups: [string, Item[]][] = [
    ...OUTPUT_LEVELS.map((l): [string, Item[]] => [`Stufe ${l} · Leistungen`, outputs(l)]),
    ...[4, 5, 6].map((l): [string, Item[]] => [`Stufe ${l} · Ziele aus Schritt 3`, goals(l)]),
  ]

  const radios = (side: 'from' | 'to', options: [string, Item[]][]) => {
    const value = side === 'from' ? from : to
    const set = side === 'from' ? setFrom : setTo
    const name = `${side}-${link.id}`
    return options
      .filter(([, list]) => list.length)
      .map(([title, list]) => {
        const id = `${name}-${title.replace(/\W+/g, '-')}`
        return (
          <div key={title} role="group" aria-labelledby={id} className="bpicker__level">
            <p id={id} className="bpicker__levelname">
              {title}
            </p>
            <ul>
              {list.map((item) => {
                const end = endOf(items, group.id, item.id)
                const unfit = side === 'to' && !fits(end)
                const dup = side === 'to' && twin(item.id)
                const checked = value === item.id
                return (
                  <li key={item.id}>
                    <label className="bpicker__option">
                      <input type="radio" name={name} checked={checked} disabled={(unfit || dup) && !checked} onChange={() => set(item.id)} />
                      <span>
                        {textOf(item)}
                        {dup && <span className="bpicker__meta"> (gibt es schon)</span>}
                        {checked && unfit && (
                          <span className="bpicker__meta">
                            {' '}
                            <StatusIcon status="warn" size={14} tooltip={false} /> passt nicht mehr – muss über dem Start liegen
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })
  }

  const broken = (value: string) =>
    value && !endOf(items, group.id, value) ? (
      <label className="bpicker__option">
        <input type="radio" checked readOnly />
        <span>
          <StatusIcon status="warn" size={14} tooltip={false} /> Verweis fehlt (gelöscht)
        </span>
      </label>
    ) : null

  const hasFrom = fromGroups.some(([, l]) => l.length)
  const hasGoals = [4, 5, 6].some((l) => goals(l).length)
  return (
    <div className="bpicker blinkpicker" ref={box} data-picker={link.id} onKeyDown={onKeyDown}>
      <p className="blinkpicker__draft">
        Entwurf: {fromEnd ? `„${cut(textOf(fromEnd.item), 40)}“` : '„?“'} → {toEnd ? `„${cut(textOf(toEnd.item), 40)}“` : '„?“'}
      </p>
      <fieldset>
        <legend>Von</legend>
        {hasFrom ? radios('from', fromGroups) : <p className="bpicker__none">Leg zuerst eine Aktivität oder Leistung an.</p>}
        {broken(from)}
      </fieldset>
      <fieldset>
        <legend>Nach</legend>
        <p className="bpicker__levelname">Nur Stufen über dem Start.</p>
        {radios('to', toGroups)}
        {!hasGoals && (
          <p className="bpicker__none">
            In Schritt 3 gibt es für „{groupLabel(group)}“ noch keine Ziele.{' '}
            <Button variant="text" onClick={() => onOpenStep(3)}>
              Zu Schritt 3
            </Button>
          </p>
        )}
        {broken(to)}
      </fieldset>
      <div className="blinkpicker__actions">
        <p className="bpicker__meta">Gespeichert wird erst mit „Fertig“.</p>
        <Button variant="text" className="blinkpicker__cancel" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button variant="text" className="blinkpicker__done" disabledReason={misfit ? 'Wähle ein Ziel über dem Start.' : undefined} onClick={() => onSave(from, to)}>
          Fertig
        </Button>
      </div>
    </div>
  )
}

/** A link in words: „A“ → „B“ (40 characters each); a missing end is „?“. */
function linkName(items: ChainItems, link: Item): string {
  const end = (id: unknown) => {
    const found = endOf(items, link.groupId as string, id)
    return found ? `„${cut(textOf(found.item), 40)}“` : '„?“'
  }
  return `${end(link.fromId)} führt zu ${end(link.toId)}`
}

function removedLabel(collection: Name, item: Item, items: ChainItems): string {
  return collection === 'links' ? linkName(items, item).replace(' führt zu ', ' → ') : cut(textOf(item), 60)
}

/** "2 Verbindungen zeigen jetzt „Verweis fehlt“." after removing an activity or output that links use. */
function usedNote(links: Item[], id: string): string | undefined {
  const n = linksUsing(links, id).length
  if (!n) return undefined
  return n === 1 ? '1 Verbindung zeigt jetzt „Verweis fehlt“.' : `${n} Verbindungen zeigen jetzt „Verweis fehlt“.`
}

/** "2 Leistungen und 3 Verbindungen sind ausgeblendet, solange „Eltern“ keine Fokusgruppe ist. …" */
function hiddenText(outputs: number, links: number, name: string, long: boolean): string {
  const parts = [outputs && count(outputs, 'Leistung', 'Leistungen'), links && count(links, 'Verbindung', 'Verbindungen')].filter(Boolean)
  const verb = outputs + links === 1 ? 'ist' : 'sind'
  if (!long) return `${parts.join(' und ')} ${verb} ausgeblendet.`
  return `${parts.join(' und ')} ${verb} ausgeblendet, solange „${name}“ keine Fokusgruppe ist. Sie ${verb === 'ist' ? 'kommt' : 'kommen'} zurück, wenn du die Gruppe in Schritt 1 wieder als Fokusgruppe markierst.`
}

/** Where an undo line goes among the removed row's siblings: same list, same group and level. */
function slotOf(list: Item[], item: Item, index: number): number {
  return list.filter((i, n) => n < index && i.groupId === item.groupId && i.level === item.level).length
}
