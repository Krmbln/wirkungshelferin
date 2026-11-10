import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { isEmptyItem } from '../../domain/block'
import { chainItems, chainOf, endOf, type ChainItems } from '../../domain/chain'
import { cut, fieldKey, type HardIssue } from '../../domain/check'
import {
  INDICATOR_MAX,
  PER_QUESTION_MAX,
  QUESTION_MAX,
  candidates,
  decisionOf,
  defaultLevel,
  indicatorsOf,
  oldDeferrals,
  orphanIndicators,
  refsOf,
  uncoveredGroups,
  type Candidate,
  type OldCause,
} from '../../domain/focus'
import type { Action } from '../../domain/reducer'
import { FOCUS_REASONS, type Item } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import { targetGroups } from '../../domain/tree'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { StatusIcon } from '../components/StatusIcon'
import { Term } from '../chat/IntroPanel'
import { scrollIntoView } from '../proposals/highlight'
import { EVIDENCE, REASONS, STUFE } from '../proposals/describe'
import type { Applied } from './BlockPanel'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, UndoLine, WhyField } from './parts'
import { useRemovals, type Removal } from './useRemovals'

// Step 5 (design §6.2 "Step 19"): project-wide, three sections in the guide's working order —
// the candidates derived from step 4, the learning questions each with its indicators, the
// funder's mandatory figures. No group headers.

type Name = 'focusQuestions' | 'deferredCandidates' | 'indicators' | 'mandatoryFigures'

const groupLabel = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'
const textOf = (i: Item) => (i.text as string) || 'ohne Text'
const quoted = (text: string, n = 40) => `„${cut(text, n)}“`
const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

/** „A“ → „B“, each end cut at `n` characters; „?“ for a missing end. */
export function linkName(items: ChainItems, link: Item, n = 30): string {
  const end = (id: unknown) => {
    const found = endOf(items, link.groupId as string, id)
    return found ? quoted(textOf(found.item), n) : '„?“'
  }
  return `${end(link.fromId)} → ${end(link.toId)}`
}

const OLD_CAUSE: Record<Exclude<OldCause, 'evidence'>, string> = {
  removed: 'Verbindung gelöscht',
  hidden: 'Gruppe ist keine Fokusgruppe mehr',
  notCritical: 'nicht mehr kritisch',
  duplicate: 'doppelt',
}

type Props = {
  project: Project
  onAction: (action: Action) => void
  applied?: Applied
  /** ⛔ issues on screen (gate.ts stillOpen): field markers. */
  issues?: HardIssue[]
  onOpenStep: (step: StepId) => void
}

export function Step5Block({ project, onAction, applied, issues = [], onOpenStep }: Props) {
  const block = project.steps[5].block
  const lists = block as unknown as Record<Name, Item[]>
  const questions = lists.focusQuestions
  const indicators = lists.indicators
  const figures = lists.mandatoryFigures
  const items = chainItems(project)
  const groups = targetGroups(project)
  const focus = groups.filter((g) => g.isFocus)
  const loose = block as unknown as Record<string, Item[]>
  const blocked = new Set(issues.map((i) => fieldKey(i.target.collection, i.target.id, i.target.field)))
  const panel = useRef<HTMLDivElement>(null)
  const focusNext = useRef<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  /** The question whose "Prüft" picker is open (one at a time). */
  const [picking, setPicking] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')

  const { removals, push, drop } = useRemovals((removal) => {
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (!line?.contains(document.activeElement)) return
    focusNext.current =
      removal.collection === 'deferredCandidates'
        ? `[data-candidate="${removal.item.linkId as string}"] [data-decide="defer"]`
        : removal.collection === 'indicators'
          ? `[data-add="indicators-${removal.item.focusQuestionId as string}"]`
          : `[data-add="${removal.collection}"]`
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
    const proposal = project.steps[5].proposals.find((p) => p.id === applied.proposalId)
    for (const id of applied.changeIds) {
      const change = proposal?.changes.find((c) => c.id === id)
      if (!proposal || change?.state !== 'applied' || change.op !== 'remove' || !change.undo?.before) continue
      const item = change.undo.before as Item
      const name = change.collection as Name
      push({
        collection: name,
        item,
        index: change.undo.index,
        slot: slotOf(lists[name] ?? [], item, change.undo.index, name),
        ...removedText(name, item, change.undo.dependents?.length ?? 0),
        undoAction: { type: 'change/undo', step: 5, proposalId: proposal.id, changeId: change.id },
      })
      if (picking === item.id) setPicking(null)
    }
  }, [applied?.n])

  const edit = (collection: Name, id: string, fields: Record<string, unknown>) => onAction({ type: 'item/edit', step: 5, collection, id, fields })
  const nextOf = (prefix: string) => `${prefix}${(project.idCounters[prefix] ?? 0) + 1}`

  function add(collection: Name, prefix: string, fields: Record<string, unknown>, field = 'text', isFresh = true) {
    const id = nextOf(prefix)
    onAction({ type: 'item/add', step: 5, collection, fields })
    if (isFresh) setFresh(id)
    focusNext.current = `[data-item-id="${id}"] [data-field="${field}"] textarea`
    return id
  }

  function remove(collection: Name, item: Item) {
    const list = lists[collection]
    const index = list.findIndex((i) => i.id === item.id)
    // A question's indicators go with it (design "Step 19"), each at its place for the undo.
    const dependents =
      collection === 'focusQuestions' ? indicators.flatMap((i, n) => (i.focusQuestionId === item.id ? [{ collection: 'indicators', index: n, item: i }] : [])) : []
    onAction({ type: 'item/remove', step: 5, collection, id: item.id })
    if (picking === item.id) setPicking(null)
    push({ collection, item, index, slot: slotOf(list, item, index, collection), dependents, ...removedText(collection, item, dependents.length) })
  }

  function undo(removal: Removal) {
    onAction(
      removal.undoAction ?? { type: 'item/restore', step: 5, collection: removal.collection, item: removal.item, index: removal.index, dependents: removal.dependents },
    )
    drop(removal.key)
    focusNext.current =
      removal.collection === 'deferredCandidates'
        ? `[data-item-id="${removal.item.id}"] [data-field="reason"] textarea`
        : `[data-item-id="${removal.item.id}"] textarea, [data-item-id="${removal.item.id}"] button`
  }

  const leave = (collection: Name, id: string) =>
    fresh === id
      ? () => {
          onAction({ type: 'item/discard', step: 5, collection, id })
          setFresh(null)
        }
      : undefined

  const edited = (collection: Name, item: Item) => item.editedByUser && !isEmptyItem(5, collection, item)
  const undoLines = (collection: Name, keep: (i: Item) => boolean) =>
    removals.filter((r) => r.collection === collection && keep(r.item) && !lists[collection].some((i) => i.id === r.item.id))

  /** Rows with the undo lines of removed ones at their places. */
  function rows(collection: Name, shown: Item[], keep: (i: Item) => boolean, row: (item: Item, index: number) => ReactNode, tag: 'ul' | 'ol' = 'ul', className = 'blist'): ReactNode {
    const lines = undoLines(collection, keep)
    const out: ReactNode[] = []
    for (let i = 0; i <= shown.length; i++) {
      for (const r of lines.filter((l) => Math.min(l.slot ?? shown.length, shown.length) === i))
        out.push(
          <li key={`undo-${r.key}`} data-undo-key={r.key}>
            <UndoLine label={r.label} note={r.note} suffix={r.suffix} quoted={r.quoted} onUndo={() => undo(r)} focus={!r.undoAction} />
          </li>,
        )
      if (i < shown.length) out.push(<li key={shown[i].id}>{row(shown[i], i)}</li>)
    }
    if (!out.length) return null
    return tag === 'ol' ? <ol className={className}>{out}</ol> : <ul className={className}>{out}</ul>
  }

  function goToQuestion(id: string) {
    const el = panel.current?.querySelector<HTMLElement>(`[data-item-id="${id}"] [data-field="text"] textarea`)
    if (!el) return
    scrollIntoView(el)
    el.focus({ preventScroll: true })
  }

  // ——— Kandidaten aus Schritt 4 ———

  function candidateRow({ link, group }: Candidate): ReactNode {
    const assumption = link.assumption as string
    const decision = decisionOf(loose, link.id)
    const label = assumption ? quoted(assumption) : linkName(items, link)
    const line = undoLines('deferredCandidates', (i) => i.linkId === link.id)[0]
    let decide: ReactNode
    if (line) {
      decide = (
        <div className="bdecide" data-undo-key={line.key}>
          <UndoLine label={line.label} quoted={false} onUndo={() => undo(line)} focus={!line.undoAction} />
        </div>
      )
    } else if (decision.kind === 'open') {
      decide = (
        <div className="bdecide" data-field="decide">
          <span className="bdecide__open">
            <StatusIcon status="warn" size={16} tooltip={false} />
            noch offen
          </span>
          <Button
            variant="text"
            className="bdecide__btn"
            aria-label={`Als Lernfrage aufnehmen: Annahme ${label}`}
            // The reason stands once in the section's cue (design "Step 19"); here it is only read out.
            disabledReason={questions.length >= QUESTION_MAX ? `Schon ${QUESTION_MAX} Lernfragen.` : undefined}
            onClick={() => {
              add('focusQuestions', 'fq', { reasons: ['kritische_annahme'], linkIds: [link.id] }, 'text', false)
            }}
          >
            Als Lernfrage aufnehmen
          </Button>
          <Button
            variant="text"
            className="bdecide__btn"
            aria-label={`Zurückstellen: Annahme ${label}`}
            data-decide="defer"
            onClick={() => {
              add('deferredCandidates', 'dc', { linkId: link.id, reason: '' }, 'reason', false)
            }}
          >
            Zurückstellen
          </Button>
        </div>
      )
    } else if (decision.kind === 'included') {
      const nums = decision.questions
      const list = nums.length === 1 ? `Frage ${nums[0]}` : `Frage ${nums.slice(0, -1).join(', ')} und ${nums[nums.length - 1]}`
      decide = (
        <div className="bdecide" data-field="decide">
          <span>Aufgenommen in {list}</span>
          <Button variant="text" className="bdecide__btn" aria-label={`Zur Frage ${nums[0]}`} onClick={() => goToQuestion(questions[nums[0] - 1].id)}>
            Zur Frage
          </Button>
        </div>
      )
    } else {
      const d = decision.deferral
      const reason = (d.reason as string) ?? ''
      decide = (
        <div className="bitem bdecide bdecide--deferred" data-item-id={d.id}>
          <DeferralReason
            value={reason}
            label={label}
            onSave={(text) => edit('deferredCandidates', d.id, { reason: text })}
            onUndefer={() => {
              onAction({ type: 'item/remove', step: 5, collection: 'deferredCandidates', id: d.id })
              push({ collection: 'deferredCandidates', item: d, index: lists.deferredCandidates.findIndex((i) => i.id === d.id), label: 'Zurückstellung', quoted: false })
            }}
          />
        </div>
      )
    }
    return (
      <div className="bcand" data-candidate={link.id}>
        <p className={assumption ? 'bcand__text' : 'bcand__text bcand__text--empty'}>{assumption || 'Annahme noch leer'}</p>
        <p className="bcand__meta">
          {groupLabel(group)} · {linkName(items, link)} · {EVIDENCE[link.evidence as string]}
        </p>
        {decide}
      </div>
    )
  }

  function candidatesSection(): ReactNode {
    if (!focus.length) {
      return (
        <section className="bsection" aria-labelledby="candidates-title">
          <div className="bsection__head">
            <h3 id="candidates-title">Kandidaten aus Schritt 4</h3>
          </div>
          <div className="bgroups__none">
            <p>{groups.length ? 'Für diesen Schritt brauchst du 1–2 Fokusgruppen aus Schritt 1.' : 'Leg in Schritt 1 zuerst Zielgruppen an.'}</p>
            <Button variant="secondary" onClick={() => onOpenStep(1)}>
              Zu Schritt 1
            </Button>
          </div>
        </section>
      )
    }
    const list = candidates(project)
    const old = oldDeferrals(project, loose)
    const links = project.steps[4].block.links as Item[]
    const full = questions.length >= QUESTION_MAX && list.some(({ link }) => decisionOf(loose, link.id).kind === 'open')
    const oldText = (o: (typeof old)[number]) => {
      const link = links.find((l) => l.id === o.deferral.linkId)
      const name = link ? ((link.assumption as string) ? quoted(link.assumption as string) : linkName(items, link)) : quoted((o.deferral.reason as string) || 'ohne Grund')
      const cause = o.cause === 'evidence' ? `Evidenz jetzt: ${EVIDENCE[o.evidence!] ?? o.evidence}` : OLD_CAUSE[o.cause]
      return `Zurückgestellt, aber kein Kandidat mehr: ${name} (${cause})`
    }
    return (
      <BlockSection
        title="Kandidaten aus Schritt 4"
        lead={
          <>
            <p className="bsection__cue">Kritische Annahmen, die unsicher sind oder nur auf eigener Erfahrung beruhen. Nimm jede in eine Lernfrage auf oder stell sie mit Grund zurück.</p>
            {full && (
              <p className="bsection__cue">
                Schon {QUESTION_MAX} Lernfragen – ergänze eine Annahme bei einer Frage unter „Prüft“ oder stell sie zurück.
              </p>
            )}
          </>
        }
      >
        {list.length ? (
          <ul className="blist">
            {list.map((c) => (
              <li key={c.link.id}>{candidateRow(c)}</li>
            ))}
          </ul>
        ) : !links.length ? (
          <p className="bsection__empty">
            Noch keine – die Kandidaten kommen aus den kritischen Annahmen in Schritt 4.{' '}
            <Button variant="text" onClick={() => onOpenStep(4)}>
              Zu Schritt 4
            </Button>
          </p>
        ) : (
          <p className="bsection__empty">Keine Kandidaten – in Schritt 4 ist keine kritische Annahme unsicher oder nur durch eigene Erfahrung gestützt.</p>
        )}
        {old.length > 0 && (
          <ul className="blist bcand__old">
            {old.map((o) => (
              <li key={o.deferral.id}>
                <BlockItem id={o.deferral.id} editedByUser={false} removeLabel={`${oldText(o)} – entfernen`} onRemove={() => remove('deferredCandidates', o.deferral)}>
                  <p className="borphan bcand__oldtext">{oldText(o)}</p>
                </BlockItem>
              </li>
            ))}
          </ul>
        )}
        {rows('deferredCandidates', [], (i) => !list.some((c) => c.link.id === i.linkId), () => null)}
      </BlockSection>
    )
  }

  // ——— Lernfragen ———

  function questionRow(q: Item, n: number): ReactNode {
    const name = `Frage ${n + 1}`
    const own = indicatorsOf(loose, q.id)
    const refs = refsOf(project, q)
    const open = picking === q.id
    const headId = `${q.id}-head`
    const audience = (q.audience as string) ?? ''
    const stakeholders = (project.steps[1].block.stakeholders as Item[]).map((s) => s.role as string).filter(Boolean)
    const funder = project.steps[0].block.profile.funder
    const who = [stakeholders.length && `Aus Schritt 1: ${stakeholders.join(', ')}`, funder && funder !== 'offen' && `Geldgeberin laut Schritt 0: ${funder}`].filter(Boolean).join(' · ')
    const total = indicators.length
    const addReason = own.length >= PER_QUESTION_MAX ? `Höchstens ${PER_QUESTION_MAX} je Frage.` : total >= INDICATOR_MAX ? `Schon ${INDICATOR_MAX} Indikatoren – mehr gehen nicht.` : undefined
    const reasons = q.reasons as string[]
    const chip = (r: (typeof refs)[number]) => {
      if (!r.item) return <span className="refchip refchip--missing">
        <StatusIcon status="warn" size={14} tooltip={false} />
        Verweis fehlt
      </span>
      const prefix = r.kind === 'link' ? `Verbindung · ${groupLabel(r.group!)}` : `Ziel · Stufe ${r.item.level as number} · ${groupLabel(r.group!)}`
      const text = r.kind === 'link' ? linkName(items, r.item) : textOf(r.item)
      return (
        <span className="refchip refchip--level" title={text}>
          <span className="refchip__prefix">{prefix}</span> {text}
        </span>
      )
    }
    return (
      <article className="bquestion" aria-labelledby={headId}>
        <BlockItem id={q.id} editedByUser={edited('focusQuestions', q)} removeLabel={`Lernfrage ${quoted(textOf(q))} entfernen`} onRemove={() => remove('focusQuestions', q)} onLeave={leave('focusQuestions', q.id)}>
          <h4 className="bquestion__num" id={headId}>
            {name}
            <span className="visually-hidden">: {textOf(q)}</span>
          </h4>
          <div data-field="text">
            <InlineText multiline strong value={q.text as string} label={`Lernfrage ${n + 1}`} placeholder="Was willst du herausfinden? Als Frage" onSave={(text) => edit('focusQuestions', q.id, { text })} />
          </div>
          <fieldset className="why bquestion__reasons" data-field="reasons">
            <legend className="why__label">Grund</legend>
            <div className="bcontrols">
              {FOCUS_REASONS.map((r) => (
                <label key={r} className="bcontrol">
                  <input
                    type="checkbox"
                    aria-label={`${REASONS[r]}: ${name}`}
                    checked={reasons.includes(r)}
                    onChange={(e) => edit('focusQuestions', q.id, { reasons: FOCUS_REASONS.filter((x) => (x === r ? e.target.checked : reasons.includes(x))) })}
                  />
                  {r === 'kritische_annahme' && n === 0 ? <Term term="Kritische Annahme" label={REASONS[r]} /> : <span aria-hidden="true">{REASONS[r]}</span>}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="why" data-field="audience">
            <label className="why__label" htmlFor={`${q.id}-audience`}>
              Für wen?
            </label>
            <InlineText id={`${q.id}-audience`} value={audience} placeholder="Geldgeberin oder Beteiligte aus Schritt 1" onSave={(text) => edit('focusQuestions', q.id, { audience: text })} />
            {!audience && who && <p className="bsection__cue bquestion__who">{who}</p>}
          </div>
          <div className="bquestion__refs" data-field="refs">
            <div className="bquestion__refline">
              <span className="bgoal__lead">Prüft:</span>
              <Button
                variant="text"
                className="bgoal__pick"
                aria-expanded={open}
                aria-label={refs.length ? `Bezug ändern: ${name}` : `Bezug wählen: ${name}`}
                data-picker-toggle={q.id}
                onClick={() => (open ? closePicker(q.id) : setPicking(q.id))}
              >
                {refs.length ? 'Ändern' : 'Bezug wählen'}
              </Button>
            </div>
            {refs.length > 0 && (
              <ul className="bquestion__chips">
                {refs.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>{chip(r)}</li>
                ))}
              </ul>
            )}
          </div>
          {open && (
            <RefPicker
              question={q}
              project={project}
              items={items}
              block={loose}
              onChange={(fields, undefer) => {
                edit('focusQuestions', q.id, fields)
                if (undefer) {
                  onAction({ type: 'item/remove', step: 5, collection: 'deferredCandidates', id: undefer.id })
                  setAnnounce(`Zurückstellung von ${(undefer.linkName as string) ?? ''} aufgehoben`)
                }
              }}
              onClose={() => closePicker(q.id)}
              onOpenStep={onOpenStep}
            />
          )}
          <WhyField
            value={q.why ?? ''}
            blocked={blocked.has(fieldKey('focusQuestions', q.id, 'why'))}
            context={name}
            placeholder="Wofür brauchst du die Antwort – was würdet ihr anders machen? (nötig zum Bestätigen)"
            onSave={(why) => edit('focusQuestions', q.id, { why })}
          />
        </BlockItem>
        <div className="bquestion__indicators">
          <BlockSection
            level={5}
            title="Indikatoren"
            addText="Indikator"
            addLabel={`Indikator hinzufügen: ${name}`}
            addKey={`indicators-${q.id}`}
            addDisabled={addReason}
            onAdd={() => add('indicators', 'in', { focusQuestionId: q.id, level: defaultLevel(project, q) })}
          >
            {rows('indicators', own, (i) => i.focusQuestionId === q.id, (i) => indicatorRow(i)) ?? (
              <p className="bsection__empty">Noch kein Indikator – woran erkennst du die Antwort? 1 oder 2 je Frage.</p>
            )}
          </BlockSection>
        </div>
      </article>
    )
  }

  function closePicker(id: string) {
    setPicking(null)
    focusNext.current = `[data-picker-toggle="${id}"]`
  }

  function formField(item: Item, collection: Name, field: string, label: string, placeholder: string, context: string) {
    return (
      <div className="bform__field" data-field={field}>
        <label className="bfield__label" htmlFor={`${item.id}-${field}`}>
          {label}
        </label>
        <InlineText
          id={`${item.id}-${field}`}
          multiline
          label={`${label}: ${context}`}
          value={(item[field] as string) ?? ''}
          placeholder={placeholder}
          invalid={blocked.has(fieldKey(collection, item.id, field))}
          onSave={(text) => edit(collection, item.id, { [field]: text })}
        />
      </div>
    )
  }

  function indicatorRow(i: Item): ReactNode {
    const context = `Indikator ${quoted(textOf(i))}`
    const level = i.level as number
    return (
      <BlockItem id={i.id} editedByUser={edited('indicators', i)} removeLabel={`${context} entfernen`} onRemove={() => remove('indicators', i)} onLeave={leave('indicators', i.id)}>
        <div data-field="text">
          <InlineText
            multiline
            value={i.text as string}
            label="Indikator"
            placeholder="Woran erkennt ihr es? Anteil der …, die … – zum …"
            invalid={blocked.has(fieldKey('indicators', i.id, 'text'))}
            onSave={(text) => edit('indicators', i.id, { text })}
          />
        </div>
        <div className="bindicator__fields">
          <div className="bform__field" data-field="level">
            <label className="bfield__label" htmlFor={`${i.id}-level`}>
              Stufe
            </label>
            <span className="bindicator__level">
              <select id={`${i.id}-level`} className="bselect" value={level} onChange={(e) => edit('indicators', i.id, { level: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 7].map((l) => (
                  <option key={l} value={l}>
                    {STUFE[l]}
                  </option>
                ))}
              </select>
              {level === 7 && (
                <span className="blink__over">
                  <StatusIcon status="warn" size={14} tooltip={false} />
                  Stufe 7 sagt wenig aus – lieber 4–6
                </span>
              )}
            </span>
          </div>
          {formField(i, 'indicators', 'baseline', 'Ausgangswert', 'Wie ist es heute? Ein Wert – oder wie ihr ihn erhebt (z. B. nachträglich) – oder „ab jetzt“', context)}
          {formField(i, 'indicators', 'target', 'Zielwert oder Schwelle', 'Wie viel reicht euch? Bei einer Annahme: ab wann überdenkt ihr den Ansatz?', context)}
        </div>
        <WhyField
          value={i.why ?? ''}
          blocked={blocked.has(fieldKey('indicators', i.id, 'why'))}
          context={context}
          placeholder="Warum zeigt gerade das die Antwort? (nötig zum Bestätigen)"
          onSave={(why) => edit('indicators', i.id, { why })}
        />
      </BlockItem>
    )
  }

  function questionsSection(): ReactNode {
    const over = questions.length > QUESTION_MAX || indicators.length > INDICATOR_MAX
    const uncovered = uncoveredGroups(project, loose)
    const orphans = orphanIndicators(loose)
    const list = rows('focusQuestions', questions, () => true, questionRow, 'ol', 'blist bquestions')
    return (
      <BlockSection
        title="Lernfragen"
        addText="Lernfrage"
        addLabel="Lernfrage hinzufügen"
        addKey="focusQuestions"
        addDisabled={questions.length >= QUESTION_MAX ? `Höchstens ${QUESTION_MAX} Lernfragen.` : undefined}
        onAdd={() => add('focusQuestions', 'fq', {})}
        lead={
          <p className={over ? 'bsection__cue bcount bcount--over' : 'bsection__cue bcount'}>
            {over && <StatusIcon status="warn" size={14} tooltip={false} />}
            <span className="tabular">
              {questions.length} von höchstens {QUESTION_MAX} Fragen · {indicators.length} von höchstens {INDICATOR_MAX} Indikatoren
            </span>
          </p>
        }
      >
        {list ?? <p className="bsection__empty">Noch keine Lernfrage – was willst oder musst du wirklich wissen, und für wen?</p>}
        {uncovered.map((g) => (
          <p key={g.id} className="bsection__cue">
            Noch keine Lernfrage zu „{groupLabel(g)}“ – oder sag im Chat, warum die Gruppe diesmal nicht im Fokus steht.
          </p>
        ))}
        {orphans.length > 0 && (
          <div className="borphans">
            <BlockSection level={4} title="Indikatoren ohne Lernfrage">
              {rows('indicators', orphans, (i) => !questions.some((q) => q.id === i.focusQuestionId), (i) => indicatorRow(i))}
            </BlockSection>
          </div>
        )}
      </BlockSection>
    )
  }

  // ——— Pflichtangaben (Geldgeberin) ———

  function figureRow(f: Item): ReactNode {
    const context = `Pflichtangabe ${quoted((f.name as string) || 'ohne Namen')}`
    return (
      <BlockItem id={f.id} editedByUser={edited('mandatoryFigures', f)} removeLabel={`${context} entfernen`} onRemove={() => remove('mandatoryFigures', f)} onLeave={leave('mandatoryFigures', f.id)}>
        <div className="bfigure__name" data-field="name">
          <span className="offen-chip">Pflichtangabe</span>
          <InlineText multiline value={f.name as string} label="Pflichtangabe" placeholder="Welche Zahl oder Angabe? z. B. Teilnehmende nach Geschlecht" onSave={(name) => edit('mandatoryFigures', f.id, { name })} />
        </div>
        <div className="bindicator__fields">
          {formField(f, 'mandatoryFigures', 'target', 'Soll-Wert', 'Welcher Wert ist das Ziel? Nennt die Geldgeberin keinen, schlag einen vor', context)}
          {formField(f, 'mandatoryFigures', 'unit', 'Einheit', 'z. B. Personen, Termine', context)}
          {formField(f, 'mandatoryFigures', 'sourceNote', 'Festlegung', 'Wie zählt ihr genau? z. B. was „regelmäßig“ heißt', context)}
        </div>
      </BlockItem>
    )
  }

  function figuresSection(): ReactNode {
    const noted = project.steps[0].block.frame.requiredFigures.filter((t) => t.trim() && t !== 'offen')
    const list = rows('mandatoryFigures', figures, () => true, figureRow)
    return (
      <BlockSection
        title="Pflichtangaben (Geldgeberin)"
        addText="Pflichtangabe"
        addLabel="Pflichtangabe hinzufügen"
        addKey="mandatoryFigures"
        onAdd={() => add('mandatoryFigures', 'mf', {}, 'name')}
        lead={
          <>
            <p className="bsection__cue">Was die Geldgeberin ohnehin verlangt. Zählt nicht zu den 6 Indikatoren – in Schritt 6 bekommt trotzdem jede eine Planzeile.</p>
            {noted.length > 0 && (
              <div className="bnoted">
                <p>In Schritt 0 notiert:</p>
                <ul>
                  {noted.map((t, n) => (
                    <li key={n}>
                      {t}
                      {figures.some((f) => same((f.name as string) ?? '', t)) ? (
                        <span className="bnoted__done"> · angelegt</span>
                      ) : (
                        <>
                          {' '}
                          <Button variant="text" className="bnoted__add" aria-label={`Anlegen: ${t}`} onClick={() => {
                              add('mandatoryFigures', 'mf', { name: t }, 'target', false)
                            }}>
                            Anlegen
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        }
      >
        {list ?? <p className="bsection__empty">Noch leer – welche Zahlen verlangt die Geldgeberin auf jeden Fall?</p>}
      </BlockSection>
    )
  }

  // ——— Frame ———

  const unconfirmed = [3, 4].filter((s) => project.steps[s as StepId].status !== 'confirmed')
  const note =
    unconfirmed.length === 2
      ? 'Schritt 3 und 4 sind noch nicht bestätigt – Ziele, Kandidaten und Verbindungen können sich noch ändern.'
      : unconfirmed[0] === 4
        ? 'Schritt 4 ist noch nicht bestätigt – Kandidaten und Verbindungen können sich noch ändern.'
        : unconfirmed[0] === 3
          ? 'Schritt 3 ist noch nicht bestätigt – die Ziele können sich noch ändern.'
          : ''
  return (
    <div className="bpanel bfocus" ref={panel}>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
      {note && <p className="bgroups__note">{note}</p>}
      {candidatesSection()}
      {questionsSection()}
      {figuresSection()}
    </div>
  )
}

/** "Zurückgestellt, weil" + the reason and "Doch nicht zurückstellen" (a candidate's decision line). */
function DeferralReason({ value, label, onSave, onUndefer }: { value: string; label: string; onSave: (text: string) => void; onUndefer: () => void }) {
  const id = useId()
  return (
    <div className="why" data-field="reason">
      <div className="bdecide__head">
        <label className="why__label" htmlFor={id}>
          {!value.trim() && (
            <span aria-hidden="true">
              <StatusIcon status="warn" size={16} tooltip={false} />
            </span>
          )}
          Zurückgestellt, weil
        </label>
        <Button variant="text" className="bdecide__btn" aria-label={`Doch nicht zurückstellen: Annahme ${label}`} onClick={onUndefer}>
          Doch nicht zurückstellen
        </Button>
      </div>
      <InlineText id={id} multiline value={value} placeholder="Warum jetzt nicht? Ein Satz (sonst bleibt der Punkt offen)" onSave={onSave} />
    </div>
  )
}

type PickerProps = {
  question: Item
  project: Project
  items: ChainItems
  block: Record<string, Item[]>
  /** New references; `undefer`: the deferral a ticked link had (removed with the same tick). */
  onChange: (fields: { linkIds?: string[]; goalIds?: string[] }, undefer?: Item & { linkName?: string }) => void
  onClose: () => void
  onOpenStep: (step: StepId) => void
}

/** "Welche Verbindungen oder Ziele prüft diese Frage?" — the step 17 picker: each tick saves at once. */
function RefPicker({ question, project, items, block, onChange, onClose, onOpenStep }: PickerProps) {
  const box = useRef<HTMLFieldSetElement>(null)
  const linkIds = question.linkIds as string[]
  const goalIds = question.goalIds as string[]
  const focus = targetGroups(project).filter((g) => g.isFocus)
  const links = project.steps[4].block.links as Item[]
  const deferrals = block.deferredCandidates ?? []
  const broken = refsOf(project, question).filter((r) => !r.item)

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button')?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }
  const toggleLink = (link: Item, on: boolean) => {
    const deferral = on ? deferrals.find((d) => d.linkId === link.id) : undefined
    onChange({ linkIds: on ? [...linkIds, link.id] : linkIds.filter((l) => l !== link.id) }, deferral && { ...deferral, linkName: linkName(items, link) })
  }
  const toggleGoal = (id: string, on: boolean) => onChange({ goalIds: on ? [...goalIds, id] : goalIds.filter((g) => g !== id) })
  const toggleBroken = (kind: 'link' | 'goal', id: string) => (kind === 'link' ? onChange({ linkIds: linkIds.filter((l) => l !== id) }) : toggleGoal(id, false))
  const any = links.some((l) => focus.some((g) => g.id === l.groupId))

  return (
    <fieldset className="bpicker" ref={box} data-picker={question.id} onKeyDown={onKeyDown}>
      <legend>Welche Verbindungen oder Ziele prüft diese Frage?</legend>
      {!any && (
        <p className="bpicker__none">
          In Schritt 4 gibt es noch keine Verbindungen.{' '}
          <Button variant="text" onClick={() => onOpenStep(4)}>
            Zu Schritt 4
          </Button>
        </p>
      )}
      {focus.map((group) => {
        const chain = chainOf(items, links, group.id)
        const goals = (project.steps[3].block.goals as Item[]).filter((g) => g.groupId === group.id).sort((a, b) => (a.level as number) - (b.level as number))
        if (!chain.length && !goals.length) return null
        return (
          <div key={group.id} className="bpicker__level" role="group" aria-labelledby={`${question.id}-${group.id}`}>
            <p className="bpicker__groupname" id={`${question.id}-${group.id}`}>
              {groupLabel(group)}
            </p>
            {chain.length > 0 && (
              <div role="group" aria-labelledby={`${question.id}-${group.id}-links`}>
                <p className="bpicker__levelname" id={`${question.id}-${group.id}-links`}>
                  Verbindungen
                </p>
                <ul>
                  {chain.map((link) => {
                    const deferred = deferrals.some((d) => d.linkId === link.id)
                    return (
                      <li key={link.id}>
                        <label className="bpicker__option">
                          <input type="checkbox" checked={linkIds.includes(link.id)} onChange={(e) => toggleLink(link, e.target.checked)} />
                          <span>
                            {linkName(items, link, 40)}
                            {(link.critical as boolean) && <span className="bpicker__meta"> · kritisch</span>}
                            {deferred && !linkIds.includes(link.id) && <span className="bpicker__meta"> · zurückgestellt</span>}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {goals.length > 0 && (
              <div role="group" aria-labelledby={`${question.id}-${group.id}-goals`}>
                <p className="bpicker__levelname" id={`${question.id}-${group.id}-goals`}>
                  Ziele aus Schritt 3
                </p>
                <ul>
                  {goals.map((g) => (
                    <li key={g.id}>
                      <label className="bpicker__option">
                        <input type="checkbox" checked={goalIds.includes(g.id)} onChange={(e) => toggleGoal(g.id, e.target.checked)} />
                        <span>
                          Stufe {g.level as number}: {textOf(g)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
      {broken.length > 0 && (
        <ul className="bpicker__broken">
          {broken.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <label className="bpicker__option">
                <input type="checkbox" checked onChange={() => toggleBroken(r.kind, r.id)} />
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

/** The undo line's words: „…“ (+ "und 2 Indikatoren") entfernt. */
function removedText(collection: Name, item: Item, dependents: number): Pick<Removal, 'label' | 'suffix' | 'quoted'> {
  if (collection === 'deferredCandidates') return { label: 'Zurückstellung', quoted: false }
  const label = cut(((collection === 'mandatoryFigures' ? item.name : item.text) as string) || 'ohne Text', 60)
  return { label, suffix: dependents ? ` und ${dependents === 1 ? '1 Indikator' : `${dependents} Indikatoren`}` : '' }
}

/** Where an undo line goes among the removed row's siblings: indicators of the same question, else the whole list. */
function slotOf(list: Item[], item: Item, index: number, collection: Name): number {
  return collection === 'indicators' ? list.filter((i, n) => n < index && i.focusQuestionId === item.focusQuestionId).length : index
}
