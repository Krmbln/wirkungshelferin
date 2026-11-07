import { useEffect, useId, useRef, useState, type FocusEvent } from 'react'
import type { Action } from '../../domain/reducer'
import type { Project, Proposal } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { Chip, chipLabels } from '../components/Chip'
import { Icon } from '../components/Icon'
import { blockedText, openCount, proposalRows, staleText, targetItemId, type FieldLine, type Row } from './describe'
import { highlight, scrollIntoView } from './highlight'
import './ProposalCard.css'

/** Hover = outline only; keyboard focus also scrolls the item into view. */
export type TargetHint = { id: string; scroll: boolean }

type Props = {
  project: Project
  step: StepId
  proposal: Proposal
  onAction: (action: Action) => void
  /** Hovering or focusing a row outlines its item in the block; undefined clears it. */
  onTarget: (target: TargetHint | undefined) => void
  /** Changes just applied: the block scrolls to their items and highlights them. */
  onApplied: (proposalId: string, changeIds: string[]) => void
  /** Set when the "offene Änderungen" line asks for this card: scroll here and highlight. */
  jump?: number
  /** The jump was carried out (so a remounted card doesn't jump again). */
  onJumped?: () => void
}

/** Values this short read as "~~alt~~ → neu" on one line (design §6.2 sketch). */
const SHORT = 20
/** Long item names are cut in button labels, so a screen reader doesn't read a paragraph three times. */
const LABEL_MAX = 60

const shorten = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text)

// The proposal card inside an assistant message (design §6.2). Nothing changes in the block
// without Lukas's click; every decision can be taken back while nothing builds on it.
export function ProposalCard({ project, step, proposal, onAction, onTarget, onApplied, jump, onJumped }: Props) {
  const card = useRef<HTMLElement>(null)
  const titleId = useId()
  const summaryId = useId()
  // Focus after the next render: the row's next control, or the row when it has none left.
  const focusNext = useRef<{ selector: string; fallback: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rows = proposalRows(project, step, proposal)
  const open = openCount(project, step, proposal)

  useEffect(() => {
    const next = focusNext.current
    if (!next || !card.current) return
    focusNext.current = null
    const el = card.current.querySelector<HTMLElement>(next.selector) ?? card.current.querySelector<HTMLElement>(next.fallback)
    el?.focus()
  })

  useEffect(() => {
    if (jump === undefined || !card.current) return
    const first = card.current.querySelector('.prow--open, .prow--blocked')
    // The card's top, unless that would leave its first open row out of view; then that row.
    const room = card.current.closest('.chat__log')?.clientHeight ?? Infinity
    const reach = first ? first.getBoundingClientRect().bottom - card.current.getBoundingClientRect().top : 0
    scrollIntoView(first && reach > room ? first : card.current, 'start')
    card.current.focus({ preventScroll: true })
    highlight(card.current)
    onJumped?.()
  }, [jump, onJumped])

  /** Focus goes there after the re-render; if the action changed nothing, it must not wait for a later one. */
  function focusAfter(selector: string, fallback: string) {
    focusNext.current = { selector, fallback }
    setTimeout(() => {
      if (focusNext.current?.selector === selector) focusNext.current = null
    }, 0)
  }

  const ref = { step, proposalId: proposal.id }
  const rowSel = (changeId: string) => `[data-change-id="${CSS.escape(changeId)}"]`

  function apply(row: Row) {
    focusAfter(`${rowSel(row.change.id)} .prow__undo`, rowSel(row.change.id))
    onAction({ type: 'change/apply', ...ref, changeId: row.change.id })
    onApplied(proposal.id, [row.change.id])
    setAnnouncement(`Übernommen: ${row.text.noun} „${shorten(row.text.main)}“`)
  }
  function reject(row: Row) {
    focusAfter(`${rowSel(row.change.id)} .prow__undo`, rowSel(row.change.id))
    onAction({ type: 'change/reject', ...ref, changeId: row.change.id })
    setAnnouncement(`Abgelehnt: ${row.text.noun} „${shorten(row.text.main)}“`)
  }
  function undo(row: Row) {
    focusAfter(`${rowSel(row.change.id)} .prow__apply`, rowSel(row.change.id))
    onAction({ type: 'change/undo', ...ref, changeId: row.change.id })
    onTarget(undefined)
    setAnnouncement(`Rückgängig gemacht: ${row.text.noun} „${shorten(row.text.main)}“`)
  }
  function applyAll() {
    const changeIds = rows.filter((r) => r.view.kind === 'open' || r.view.kind === 'blocked').map((r) => r.change.id)
    focusAfter(`${rowSel(changeIds[0])} .prow__undo`, '.pcard__title')
    onAction({ type: 'change/applyAll', ...ref })
    onApplied(proposal.id, changeIds)
    setAnnouncement(`${changeIds.length} Änderungen übernommen`)
  }

  return (
    // An article, not a region: a long chat would otherwise list "Vorschlag" landmarks over and over.
    <article
      className="pcard"
      ref={card}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={proposal.summary ? summaryId : undefined}
      data-proposal-id={proposal.id}
    >
      <h3 className="pcard__title" id={titleId} tabIndex={-1}>
        Vorschlag
      </h3>
      {proposal.summary && (
        <p className="pcard__summary" id={summaryId}>
          {proposal.summary}
        </p>
      )}
      <ul className="prows">
        {rows.map((row) => (
          <ProposalRow
            key={row.change.id}
            project={project}
            step={step}
            proposal={proposal}
            row={row}
            onApply={() => apply(row)}
            onReject={() => reject(row)}
            onUndo={() => undo(row)}
            onTarget={onTarget}
          />
        ))}
      </ul>
      {open >= 2 && (
        <div className="pcard__all">
          <Button variant="secondary" onClick={applyAll}>
            Alle übernehmen
          </Button>
        </div>
      )}
      <div className="visually-hidden" role="status">
        {announcement}
      </div>
    </article>
  )
}

type RowProps = {
  project: Project
  step: StepId
  proposal: Proposal
  row: Row
  onApply: () => void
  onReject: () => void
  onUndo: () => void
  onTarget: (target: TargetHint | undefined) => void
}

function ProposalRow({ project, step, proposal, row, onApply, onReject, onUndo, onTarget }: RowProps) {
  const { change, view, text, undoable } = row
  const [details, setDetails] = useState(false)
  const detailsId = useId()
  const stale = view.kind === 'stale'
  // What the buttons act on, for screen readers: "Neu – Zielgruppe „Stammgäste …“".
  const what = text.main ? `${chipLabels[text.kind]} – ${text.noun} „${shorten(text.main)}“` : `${chipLabels[text.kind]} – ${text.noun}`
  const hint = (scroll: boolean) => {
    const id = targetItemId(proposal, change)
    onTarget(id ? { id, scroll } : undefined)
  }
  const hasDetails = !stale && change.op === 'add' && text.fields.length > 0

  function onBlur(event: FocusEvent<HTMLLIElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onTarget(undefined)
  }

  return (
    <li
      className={`prow prow--${view.kind}`}
      data-change-id={change.id}
      tabIndex={-1}
      onMouseEnter={() => hint(false)}
      onMouseLeave={() => onTarget(undefined)}
      // Keyboard focus also brings the item into view; a click doesn't scroll the block.
      onFocus={(e) => hint(e.target.matches(':focus-visible'))}
      onBlur={onBlur}
    >
      <div className="prow__text">
        <span className="prow__head">
          <Chip kind={text.kind} />
          <span className="prow__noun">{text.noun}</span>
        </span>
        {text.main && <span className="prow__main">{text.main}</span>}
        {(text.meta.length > 0 || hasDetails) && (
          // "Details" ends the meta line and opens right under it, above the buttons.
          <span className="prow__meta">
            {text.meta.join(' · ')}
            {text.meta.length > 0 && hasDetails && ' · '}
            {hasDetails && (
              <button type="button" className="prow__toggle" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((d) => !d)}>
                Details
                <Icon name={details ? 'chevronDown' : 'chevronRight'} size={16} />
              </button>
            )}
          </span>
        )}
      </div>

      {!stale && change.op === 'update' && text.fields.length > 0 && (
        <dl className="prow__fields">
          {text.fields.map((f) => (
            <ChangedField key={f.label} field={f} hideLabel={f.label === text.noun} />
          ))}
        </dl>
      )}

      {hasDetails && (
        <dl id={detailsId} className="prow__fields" hidden={!details}>
          {text.fields.map((f) => (
            <div key={f.label} className="prow__field">
              <dt>{f.label}</dt>
              <dd>{f.after}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="prow__foot">
        {(view.kind === 'open' || view.kind === 'blocked') && (
          <>
            <Button
              variant="secondary"
              className="prow__apply"
              aria-label={`Übernehmen: ${what}`}
              disabledReason={view.kind === 'blocked' ? blockedText(project, step, proposal, view.needs) : undefined}
              onClick={onApply}
            >
              Übernehmen
            </Button>
            <Button variant="text" className="prow__reject" aria-label={`Ablehnen: ${what}`} onClick={onReject}>
              Ablehnen
            </Button>
          </>
        )}
        {(view.kind === 'applied' || view.kind === 'rejected') && (
          <>
            <span className="prow__state">
              {view.kind === 'applied' ? (
                <>
                  <Icon name="statusOk" size={16} /> übernommen
                </>
              ) : (
                'abgelehnt'
              )}
            </span>
            {undoable && (
              <Button variant="text" className="prow__undo" aria-label={`Rückgängig: ${what}`} onClick={onUndo}>
                Rückgängig
              </Button>
            )}
          </>
        )}
        {view.kind === 'stale' && <span className="prow__state">{staleText(project, step, proposal, change, view.reason)}</span>}
      </div>
    </li>
  )
}

/** ÄNDERN: the old value struck through, the new one after it; short values on one line. */
function ChangedField({ field, hideLabel }: { field: FieldLine; hideLabel: boolean }) {
  const short = (field.before ?? '').length <= SHORT && field.after.length <= SHORT
  return (
    <div className="prow__field">
      <dt className={hideLabel ? 'visually-hidden' : undefined}>{field.label}</dt>
      <dd className={short ? 'prow__change prow__change--inline' : 'prow__change'}>
        {field.before ? (
          <del className="prow__before">
            <span className="visually-hidden">bisher: </span>
            {field.before}
          </del>
        ) : (
          <span className="prow__before prow__before--empty">bisher leer</span>
        )}
        {short && <span aria-hidden="true">→</span>}
        <ins className="prow__after">
          <span className="visually-hidden">neu: </span>
          {field.after}
        </ins>
      </dd>
    </div>
  )
}
