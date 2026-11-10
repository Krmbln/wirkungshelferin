import { settled } from '../../domain/outdated'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cut, fieldKey, type HardIssue } from '../../domain/check'
import {
  COVERAGE_KEY,
  allCovered,
  coverage,
  missingFields,
  needText,
  needs,
  planRefsOf,
  rowName,
  rowsCovering,
  summaryFacts,
  type Coverage,
  type Need,
  type PlanRef,
} from '../../domain/plan'
import type { Action } from '../../domain/reducer'
import type { Item } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusIcon } from '../components/StatusIcon'
import { scrollIntoView } from '../proposals/highlight'
import type { Applied, CollapsedChange } from './BlockPanel'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, UndoLine, WhyField } from './parts'
import { useRemovals, type Removal } from './useRemovals'

// Step 6 (design §6.2 "Step 20"): project-wide, two sections — what needs a plan row (derived
// from step 5, a disclosure itself) and the plan rows, each a disclosure record. Open/closed is
// screen state: the closed keys live in App's collapsed list (row ids + COVERAGE_KEY).

const quoted = (text: string, n = 40) => `„${cut(text, n)}“`
const rowList = (nums: number[]) => (nums.length === 1 ? `Zeile ${nums[0]}` : `Zeile ${nums.slice(0, -1).join(', ')} und ${nums[nums.length - 1]}`)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The form's fields in the guide's order with their placeholders (design "Step 20"). */
const FIELDS = [
  { field: 'dataSource', label: 'Datenquelle', placeholder: 'Wer oder was kennt die Antwort? Vorhandene Listen zuerst' },
  { field: 'method', label: 'Methode und Instrument', placeholder: 'Fragen, beobachten, testen oder nachlesen – und womit? z. B. Kurzbefragung mit 3 Fragen' },
  { field: 'collector', label: 'Wer erhebt?', placeholder: 'Eine Rolle, keine Namen – möglichst nicht die Person, die das Angebot macht' },
  { field: 'frequency', label: 'Wann und wie oft?', placeholder: 'An feste Gelegenheiten gekoppelt, z. B. Start, Halbjahr, Ende' },
  { field: 'firstCollection', label: 'Erster Termin', placeholder: 'Die erste Erhebung – bei einem Ausgangswert: wann ihr ihn erhebt' },
  {
    field: 'consentNote',
    label: 'Einwilligung und Datenschutz',
    placeholder: 'Wer wird informiert und gefragt? Anonym oder vertraulich? Bei Minderjährigen: Eltern und Kind – oder „entfällt, keine Angaben von Personen“',
  },
  { field: 'analysis', label: 'Auswertung und Nutzung', placeholder: 'Wer schaut sich die Ergebnisse an, wann – und was entscheidet ihr damit?' },
] as const

type Props = {
  project: Project
  onAction: (action: Action) => void
  applied?: Applied
  /** ⛔ issues on screen (gate.ts stillOpen): field markers. */
  issues?: HardIssue[]
  /** Closed rows (their ids) and the closed coverage list (COVERAGE_KEY). */
  collapsed: string[]
  onCollapsedChange: (change: CollapsedChange) => void
  onOpenStep: (step: StepId) => void
}

export function Step6Block({ project, onAction, applied, issues = [], collapsed, onCollapsedChange, onOpenStep }: Props) {
  const rows = project.steps[6].block.planRows as Item[]
  const all = needs(project)
  const covered = allCovered(project, rows)
  const blocked = new Set(issues.map((i) => fieldKey(i.target.collection, i.target.id, i.target.field)))
  const panel = useRef<HTMLDivElement>(null)
  const focusNext = useRef<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  /** The row whose Bezug picker is open (one at a time). */
  const [picking, setPicking] = useState<string | null>(null)
  const latest = useRef(collapsed)
  latest.current = collapsed
  const setClosed = (key: string, closed: boolean) => {
    const update = (keys: string[]) => (closed ? [...keys.filter((k) => k !== key), key] : keys.filter((k) => k !== key))
    latest.current = update(latest.current)
    onCollapsedChange(update)
  }

  const { removals, push, drop } = useRemovals((removal) => {
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (line?.contains(document.activeElement)) focusNext.current = '[data-add="planRows"]'
  })

  useEffect(() => {
    if (!focusNext.current) return
    const target = panel.current?.querySelector<HTMLElement>(focusNext.current)
    if (target) {
      target.focus()
      focusNext.current = null
    }
  })

  // The coverage list closes when everything gets covered and opens when something loses its row
  // (design "Step 20"); the first state comes from App (initialClosed).
  const wasCovered = useRef(covered)
  useEffect(() => {
    if (wasCovered.current === covered) return
    wasCovered.current = covered
    setClosed(COVERAGE_KEY, covered)
  }, [covered])

  // An applied ENTFERNEN shows its undo line at the row's place (focus stays in the card).
  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[6].proposals.find((p) => p.id === applied.proposalId)
    for (const id of applied.changeIds) {
      const change = proposal?.changes.find((c) => c.id === id)
      if (!proposal || change?.state !== 'applied' || change.op !== 'remove' || !change.undo?.before) continue
      const item = change.undo.before as Item
      push({
        collection: 'planRows',
        item,
        index: change.undo.index,
        slot: change.undo.index,
        label: `Planzeile ${rowName(all, item, 60)}`,
        quoted: false,
        undoAction: { type: 'change/undo', step: 6, proposalId: proposal.id, changeId: change.id },
      })
      if (picking === item.id) setPicking(null)
    }
  }, [applied?.n])

  const edit = (id: string, fields: Record<string, unknown>) => onAction({ type: 'item/edit', step: 6, collection: 'planRows', id, fields })

  function add(fields: Record<string, unknown>, focus: string) {
    const id = `pr${(project.idCounters.pr ?? 0) + 1}`
    onAction({ type: 'item/add', step: 6, collection: 'planRows', fields })
    setFresh(id)
    focusNext.current = `[data-item-id="${id}"] ${focus}`
  }

  function remove(row: Item) {
    const index = rows.findIndex((r) => r.id === row.id)
    const name = rowName(all, row, 60)
    onAction({ type: 'item/remove', step: 6, collection: 'planRows', id: row.id })
    if (picking === row.id) setPicking(null)
    push({ collection: 'planRows', item: row, index, slot: index, label: `Planzeile ${name}`, quoted: false })
  }

  function undo(removal: Removal) {
    onAction(removal.undoAction ?? { type: 'item/restore', step: 6, collection: 'planRows', item: removal.item, index: removal.index })
    drop(removal.key)
    focusNext.current = `[data-row-toggle="${removal.item.id}"]`
  }

  const leave = (id: string) =>
    fresh === id
      ? () => {
          onAction({ type: 'item/discard', step: 6, collection: 'planRows', id })
          setFresh(null)
        }
      : undefined

  function goToRow(id: string) {
    setClosed(id, false)
    const el = panel.current?.querySelector<HTMLElement>(`[data-row-toggle="${id}"]`)
    if (!el) return
    scrollIntoView(el)
    el.focus({ preventScroll: true })
  }

  // ——— Indikatoren und Pflichtangaben aus Schritt 5 ———

  function coverageRow({ need, rows: nums }: Coverage): ReactNode {
    const text = needText(need)
    const label = text.trim() ? quoted(text) : need.kind === 'indicator' ? 'Indikator ohne Text' : 'Pflichtangabe ohne Namen'
    const meta =
      need.kind === 'indicator'
        ? [
            `zu ${(need.question.text as string)?.trim() ? quoted(need.question.text as string) : 'Frage ohne Text'}`,
            `Stufe ${need.item.level as number}`,
            (need.item.baseline as string)?.trim() ? `Ausgangswert: ${cut(need.item.baseline as string, 30)}` : 'Ausgangswert fehlt',
          ]
        : [(need.item.target as string)?.trim() && `Soll: ${cut(need.item.target as string, 40)}`, (need.item.unit as string)?.trim() && cut(need.item.unit as string, 30)].filter(Boolean)
    const ref = need.kind === 'indicator' ? { indicatorIds: [need.item.id] } : { mandatoryFigureIds: [need.item.id] }
    return (
      <div className="bcand" data-coverage={need.item.id}>
        <p className={text.trim() ? 'bcand__text bfigure__name' : 'bcand__text bcand__text--empty bfigure__name'}>
          {need.kind === 'figure' && <span className="offen-chip">Pflichtangabe</span>}
          <span>{text.trim() || (need.kind === 'indicator' ? 'Indikator noch leer' : 'Pflichtangabe noch leer')}</span>
        </p>
        {meta.length > 0 && <p className="bcand__meta">{meta.join(' · ')}</p>}
        <div className="bdecide" data-field="create">
          {nums.length ? (
            <>
              <span>In {rowList(nums)}</span>
              <Button variant="text" className="bdecide__btn" aria-label={`Zur Zeile ${nums[0]}: ${label}`} onClick={() => goToRow(rows[nums[0] - 1].id)}>
                Zur Zeile
              </Button>
            </>
          ) : (
            <>
              <span className="bdecide__open">
                <StatusIcon status="warn" size={16} tooltip={false} />
                noch ohne Planzeile
              </span>
              <Button variant="text" className="bdecide__btn" aria-label={`Planzeile anlegen: ${label}`} onClick={() => add(ref, '[data-field="dataSource"] textarea')}>
                Planzeile anlegen
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  function countText(list: Coverage[]): string {
    const ind = list.filter((c) => c.need.kind === 'indicator')
    const fig = list.filter((c) => c.need.kind === 'figure')
    const done = (l: Coverage[]) => l.filter((c) => c.rows.length).length
    if (covered) {
      if (list.length === 1) return ind.length ? 'Der Indikator hat eine Planzeile.' : 'Die Pflichtangabe hat eine Planzeile.'
      const parts = [ind.length && plural(ind.length, 'Indikator', 'Indikatoren'), fig.length && plural(fig.length, 'Pflichtangabe', 'Pflichtangaben')].filter(Boolean)
      return `Alle ${parts.join(' und ')} haben eine Planzeile.`
    }
    const parts = [
      ind.length && `${done(ind)} von ${plural(ind.length, 'Indikator', 'Indikatoren')}`,
      fig.length && `${done(fig)} von ${plural(fig.length, 'Pflichtangabe', 'Pflichtangaben')}`,
    ].filter(Boolean)
    return `Mit Planzeile: ${parts.join(' · ')}`
  }

  function coverageSection(): ReactNode {
    const title = 'Indikatoren und Pflichtangaben aus Schritt 5'
    if (!all.length) {
      return (
        <section className="bsection bcoverage bcoverage--none" aria-labelledby="coverage-title">
          <div className="bsection__head">
            <h3 id="coverage-title">{title}</h3>
          </div>
          <div className="bgroups__none">
            <p>In Schritt 5 gibt es noch keine Indikatoren oder Pflichtangaben – die Planzeilen gehören zu ihnen.</p>
            <Button variant="secondary" onClick={() => onOpenStep(5)}>
              Zu Schritt 5
            </Button>
          </div>
        </section>
      )
    }
    const list = coverage(project, rows)
    const open = !collapsed.includes(COVERAGE_KEY)
    return (
      <section className="bsection bcoverage" aria-labelledby="coverage-title" data-group={COVERAGE_KEY}>
        <div className="bsection__head" data-group-header={COVERAGE_KEY}>
          <h3>
            <button type="button" id="coverage-title" className="bgroup__toggle" aria-expanded={open} aria-controls="coverage-body" onClick={() => setClosed(COVERAGE_KEY, open)}>
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
              <span>{title}</span>
            </button>
          </h3>
        </div>
        <p className="bsection__cue bcount tabular" role="status">
          {countText(list)}
        </p>
        {open && (
          <div id="coverage-body">
            <p className="bsection__cue">Jeder Indikator und jede Pflichtangabe braucht eine Planzeile. Eine Zeile kann mehrere abdecken.</p>
            <ul className="blist">
              {list.map((c) => (
                <li key={`${c.need.kind}-${c.need.item.id}`}>{coverageRow(c)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    )
  }

  // ——— Planzeilen ———

  function chip(r: PlanRef, closed: boolean): ReactNode {
    if (!r.need)
      return (
        <span className="refchip refchip--missing">
          <StatusIcon status="warn" size={14} tooltip={false} />
          Verweis fehlt
        </span>
      )
    const prefix = r.need.kind === 'indicator' ? `Indikator · Stufe ${r.need.item.level as number}` : 'Pflichtangabe (Geldgeberin)'
    const text = needText(r.need).trim() || (r.need.kind === 'indicator' ? 'Indikator noch leer' : 'Pflichtangabe noch leer')
    return (
      <span className="refchip refchip--level" title={closed ? text : undefined}>
        <span className="refchip__prefix">{prefix}</span> {text}
      </span>
    )
  }

  function formField(row: Item, field: string, label: string, placeholder: string, context: string, hint?: ReactNode) {
    return (
      <div className="bform__field" data-field={field} key={field}>
        <label className="bfield__label" htmlFor={`${row.id}-${field}`}>
          {label}
        </label>
        <InlineText
          id={`${row.id}-${field}`}
          multiline
          label={`${label.replace(/\?$/, '')}: ${context}`}
          value={(row[field] as string) ?? ''}
          placeholder={placeholder}
          invalid={blocked.has(fieldKey('planRows', row.id, field))}
          onSave={(text) => edit(row.id, { [field]: text })}
        />
        {hint}
      </div>
    )
  }

  function planRow(row: Item, n: number): ReactNode {
    const name = `Zeile ${n + 1}`
    const refs = planRefsOf(all, row)
    const open = !collapsed.includes(row.id)
    const choosing = picking === row.id
    const headId = `${row.id}-head`
    const bodyId = `${row.id}-body`
    const refsName = refs.length ? refs.map((r) => (r.need ? needText(r.need).trim() || 'ohne Text' : 'Verweis fehlt')).join(', ') : 'noch ohne Bezug'
    const named = rowName(all, row)
    const removeLabel = named === 'ohne Bezug' ? `Planzeile ohne Bezug entfernen: ${name}` : `Planzeile ${named} entfernen`
    const facts = summaryFacts(row)
    const missing = missingFields(row)
    const existing = project.steps[0].block.frame.existingData.filter((t) => t.trim() && t !== 'offen')
    const indicators = refs.flatMap((r) => (r.need?.kind === 'indicator' ? [r.need.item] : []))
    const baselines = indicators.map((i) => {
      const baseline = (i.baseline as string)?.trim()
      const ind = quoted((i.text as string) || 'ohne Text', 30)
      return baseline ? `Ausgangswert laut Schritt 5: ${cut(baseline, 40)} – ${ind}` : `Ausgangswert in Schritt 5 noch leer – ${ind}`
    })
    return (
      <article className={open ? 'bquestion bprow' : 'bquestion bprow bprow--closed'} aria-labelledby={headId}>
        {/* "von dir geändert" only once something besides the reference is filled (a fresh "Planzeile anlegen" row isn't an edit yet). */}
        <BlockItem id={row.id} editedByUser={row.editedByUser && missing.length < FIELDS.length + 1} removeLabel={removeLabel} onRemove={() => remove(row)} onLeave={leave(row.id)}>
          {/* One head line: the toggle and "Bezug ändern" (design check step 20: closed records stay short). */}
          <div className="bprow__headline" data-group-header={row.id}>
            <h4 className="bprow__head">
              <button type="button" id={headId} className="bprow__toggle" aria-expanded={open} aria-controls={bodyId} data-row-toggle={row.id} onClick={() => setClosed(row.id, open)}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
                {name}
                <span className="visually-hidden">: {refsName}</span>
              </button>
            </h4>
            <span data-field="refs">
              <Button
                variant="text"
                className="bgoal__pick"
                aria-expanded={choosing}
                aria-label={refs.length ? `Bezug ändern: ${name}` : `Bezug wählen: ${name}`}
                data-picker-toggle={row.id}
                onClick={() => (choosing ? closePicker(row.id) : setPicking(row.id))}
              >
                {refs.length ? 'Bezug ändern' : 'Bezug wählen'}
              </Button>
            </span>
          </div>
          <div className="bquestion__refs bprow__refs">
            {refs.length > 0 ? (
              <ul className="bquestion__chips">
                {refs.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>{chip(r, !open)}</li>
                ))}
              </ul>
            ) : (
              <p className="bsection__cue bprow__norefs">Noch kein Bezug – zu welchem Indikator oder welcher Pflichtangabe gehört die Zeile?</p>
            )}
          </div>
          {choosing && <PlanPicker row={row} rows={rows} project={project} onChange={(fields) => edit(row.id, fields)} onClose={() => closePicker(row.id)} onOpenStep={onOpenStep} />}
          {open ? (
            <div id={bodyId} className="bprow__body">
              <div className="bindicator__fields">
                {FIELDS.map((f) =>
                  formField(
                    row,
                    f.field,
                    f.label,
                    f.placeholder,
                    name,
                    f.field === 'dataSource' && !(row.dataSource as string)?.trim() && existing.length ? (
                      <p className="bsection__cue bprow__hint">Aus Schritt 0 vorhanden: {existing.join(', ')}</p>
                    ) : f.field === 'firstCollection' && baselines.length ? (
                      <ul className="bprow__hint bprow__baselines">
                        {baselines.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    ) : undefined,
                  ),
                )}
              </div>
              <WhyField
                value={row.why ?? ''}
                blocked={blocked.has(fieldKey('planRows', row.id, 'why'))}
                context={name}
                placeholder="Warum diese Erhebung so? (nötig zum Bestätigen)"
                onSave={(why) => edit(row.id, { why })}
              />
            </div>
          ) : (
            <div id={bodyId} className="bprow__summary">
              {missing.length === FIELDS.length + 1 ? (
                <p>Noch leer – öffne die Zeile oder lass dir einen Vorschlag machen.</p>
              ) : (
                <>
                  {facts.length > 0 && <p>{facts.join(' · ')}</p>}
                  {missing.length > 0 && <p>Noch leer: {missing.join(', ')}</p>}
                </>
              )}
            </div>
          )}
        </BlockItem>
      </article>
    )
  }

  function closePicker(id: string) {
    setPicking(null)
    focusNext.current = `[data-picker-toggle="${id}"]`
  }

  function rowsSection(): ReactNode {
    const lines = removals.filter((r) => !rows.some((i) => i.id === r.item.id))
    const out: ReactNode[] = []
    for (let i = 0; i <= rows.length; i++) {
      for (const r of lines.filter((l) => Math.min(l.slot ?? rows.length, rows.length) === i))
        out.push(
          <li key={`undo-${r.key}`} data-undo-key={r.key}>
            <UndoLine label={r.label} quoted={r.quoted} onUndo={() => undo(r)} focus={!r.undoAction} />
          </li>,
        )
      if (i < rows.length) out.push(<li key={rows[i].id}>{planRow(rows[i], i)}</li>)
    }
    const openRows = rows.filter((r) => !collapsed.includes(r.id)).length
    const closeAll = openRows > rows.length / 2
    const toggleAll =
      rows.length >= 2 ? (
        <Button
          variant="text"
          className="bdecide__btn"
          onClick={() => {
            const update = (keys: string[]) => [...keys.filter((k) => !rows.some((r) => r.id === k)), ...(closeAll ? rows.map((r) => r.id) : [])]
            latest.current = update(latest.current)
            onCollapsedChange(update)
          }}
        >
          {closeAll ? 'Alle schließen' : 'Alle öffnen'}
        </Button>
      ) : undefined
    return (
      <BlockSection title="Planzeilen" addText="Planzeile" addLabel="Planzeile hinzufügen" addKey="planRows" actions={toggleAll} onAdd={() => add({}, '[data-field="refs"] button')}>
        {out.length ? (
          <ol className="blist bquestions">{out}</ol>
        ) : (
          <p className="bsection__empty">Noch keine Planzeile – woher kommen die Antworten, wer erhebt sie, wann? Die Wirkungshelferin schlägt einen Plan vor.</p>
        )}
      </BlockSection>
    )
  }

  const note = !settled(project.steps[5]) ? 'Schritt 5 ist noch nicht bestätigt – Indikatoren und Pflichtangaben können sich noch ändern.' : ''
  return (
    <div className="bpanel bplan" ref={panel}>
      {note && <p className="bgroups__note">{note}</p>}
      {coverageSection()}
      {rowsSection()}
    </div>
  )
}

type PickerProps = {
  row: Item
  rows: Item[]
  project: Project
  onChange: (fields: { indicatorIds?: string[]; mandatoryFigureIds?: string[] }) => void
  onClose: () => void
  onOpenStep: (step: StepId) => void
}

/** "Zu welchen Indikatoren oder Pflichtangaben gehört diese Zeile?" — the step 19 picker: each tick saves at once. */
function PlanPicker({ row, rows, project, onChange, onClose, onOpenStep }: PickerProps) {
  const box = useRef<HTMLFieldSetElement>(null)
  const indicatorIds = row.indicatorIds as string[]
  const figureIds = row.mandatoryFigureIds as string[]
  const all = needs(project)
  const broken = planRefsOf(all, row).filter((r) => !r.need)
  const questions = [...new Map(all.flatMap((n) => (n.kind === 'indicator' ? [[n.question.id, n] as const] : []))).values()]
  const figures = all.filter((n) => n.kind === 'figure')

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }
  const toggle = (kind: Need['kind'], id: string, on: boolean) => {
    if (kind === 'indicator') onChange({ indicatorIds: on ? [...indicatorIds, id] : indicatorIds.filter((x) => x !== id) })
    else onChange({ mandatoryFigureIds: on ? [...figureIds, id] : figureIds.filter((x) => x !== id) })
  }
  /** " · in Zeile 3" when another row covers it already (still tickable: rows can share). */
  const elsewhere = (kind: Need['kind'], id: string) => {
    const nums = rowsCovering(rows, kind, id).filter((n) => rows[n - 1].id !== row.id)
    return nums.length ? <span className="bpicker__meta"> · in {rowList(nums)}</span> : null
  }
  const option = (need: Need) => {
    const checked = (need.kind === 'indicator' ? indicatorIds : figureIds).includes(need.item.id)
    const text = needText(need).trim() || (need.kind === 'indicator' ? 'Indikator noch leer' : 'Pflichtangabe noch leer')
    return (
      <li key={need.item.id}>
        <label className="bpicker__option">
          <input type="checkbox" checked={checked} onChange={(e) => toggle(need.kind, need.item.id, e.target.checked)} />
          <span>
            {text}
            {elsewhere(need.kind, need.item.id)}
          </span>
        </label>
      </li>
    )
  }

  return (
    <fieldset className="bpicker" ref={box} data-picker={row.id} onKeyDown={onKeyDown}>
      <legend>Zu welchen Indikatoren oder Pflichtangaben gehört diese Zeile?</legend>
      {!all.length && (
        <p className="bpicker__none">
          In Schritt 5 gibt es noch keine Indikatoren oder Pflichtangaben.{' '}
          <Button variant="text" onClick={() => onOpenStep(5)}>
            Zu Schritt 5
          </Button>
        </p>
      )}
      {questions.length > 0 && (
        <div className="bpicker__level" role="group" aria-labelledby={`${row.id}-pick-ind`}>
          <p className="bpicker__groupname" id={`${row.id}-pick-ind`}>
            Indikatoren
          </p>
          {questions.map((q) => {
            if (q.kind !== 'indicator') return null
            const text = (q.question.text as string)?.trim()
            return (
              <fieldset key={q.question.id} className="bpicker__question">
                <legend className="bpicker__levelname">
                  Frage {q.questionNo}: {text ? cut(text, 50) : 'ohne Text'}
                </legend>
                <ul>{all.filter((n) => n.kind === 'indicator' && n.question.id === q.question.id).map(option)}</ul>
              </fieldset>
            )
          })}
        </div>
      )}
      {figures.length > 0 && (
        <div className="bpicker__level" role="group" aria-labelledby={`${row.id}-pick-fig`}>
          <p className="bpicker__groupname" id={`${row.id}-pick-fig`}>
            Pflichtangaben
          </p>
          <ul>{figures.map(option)}</ul>
        </div>
      )}
      {broken.length > 0 && (
        <ul className="bpicker__broken">
          {broken.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <label className="bpicker__option">
                <input type="checkbox" checked onChange={() => toggle(r.kind, r.id, false)} />
                <span>
                  <StatusIcon status="warn" size={14} tooltip={false} /> Verweis fehlt (gelöscht)
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
