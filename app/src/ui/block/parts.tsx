import { useEffect, useId, useRef, type FocusEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusIcon } from '../components/StatusIcon'
import { InlineText } from './InlineText'
import './Block.css'

// The reusable pieces of every block panel (design §6.2, step 11). Steps 2–6 use them too.

type SectionProps = {
  title: string
  /** The add button's visible text (default "hinzufügen"). */
  addText?: string
  /** Beside the heading, e.g. "von dir geändert" of a form (step 14). */
  meta?: ReactNode
  /** "+ hinzufügen"; lists only (a singleton has no add button). */
  onAdd?: () => void
  addLabel?: string
  /** Marks the add button, so focus can return to it (after an undo line expires). */
  addKey?: string
  /** Muted sentence instead of rows while the list is empty (design §6.2 "Empty block"). */
  emptyHint?: string
  empty?: boolean
  /** More buttons before the add button, e.g. "+ PDF hochladen" in Quellen (step 15). */
  actions?: ReactNode
  children: ReactNode
}

export function BlockSection({ title, addText = 'hinzufügen', meta, onAdd, addLabel, addKey, emptyHint, empty = false, actions, children }: SectionProps) {
  const headingId = useId()
  return (
    <section className="bsection" aria-labelledby={headingId}>
      <div className="bsection__head">
        <h3 id={headingId}>{title}</h3>
        {meta}
        {actions ? (
          <span className="bsection__adds">
            {actions}
            {add()}
          </span>
        ) : (
          add()
        )}
      </div>
      {empty && emptyHint ? <p className="bsection__empty">{emptyHint}</p> : children}
    </section>
  )

  function add() {
    if (!onAdd) return null
    return (
      <Button variant="text" className="bsection__add" icon={<Icon name="plus" size={16} />} aria-label={addLabel} data-add={addKey} onClick={onAdd}>
        {addText}
      </Button>
    )
  }
}

type ItemProps = {
  id: string
  editedByUser: boolean
  /** ✕ at the top right (lists only); its accessible name says what goes. */
  removeLabel?: string
  onRemove?: () => void
  /** Focus left the row (not just one of its fields), e.g. to drop a fresh row left empty. */
  onLeave?: () => void
  children: ReactNode
}

export function BlockItem({ id, editedByUser, removeLabel, onRemove, onLeave, children }: ItemProps) {
  function onBlur(event: FocusEvent<HTMLElement>) {
    const to = event.relatedTarget as Node | null
    if (!onLeave || event.currentTarget.contains(to)) return
    // Switching to another window blurs too (no new target, document without focus);
    // the row stays until Lukas really moves on.
    if (!to && !document.hasFocus()) return
    onLeave()
  }
  return (
    <div className="bitem" data-item-id={id} onBlur={onBlur}>
      <div className="bitem__body">{children}</div>
      <div className="bitem__side">
        {editedByUser && <span className="bitem__edited">von dir geändert</span>}
        {onRemove && (
          <Button variant="text" className="btn--icon bitem__remove" aria-label={removeLabel} onClick={onRemove}>
            <Icon name="close" size={16} />
          </Button>
        )}
      </div>
    </div>
  )
}

type WhyProps = {
  value: string
  onSave: (value: string) => void
  /** ⛔ marker: set once a check found the Why missing (step 13). */
  blocked?: boolean
  forceState?: 'hover'
}

/** "Warum?" directly under a Why-carrying item (design §6.2). */
export function WhyField({ value, onSave, blocked = false, forceState }: WhyProps) {
  const id = useId()
  return (
    <div className="why" data-field="why">
      <label className="why__label" htmlFor={id}>
        Warum?
        {blocked && (
          <>
            <span aria-hidden="true">
              <StatusIcon status="block" size={16} tooltip={false} />
            </span>
            <span className="why__missing"> fehlt</span>
          </>
        )}
      </label>
      <InlineText
        id={id}
        value={value}
        onSave={onSave}
        multiline
        invalid={blocked}
        placeholder="Warum ist das wichtig? (nötig zum Bestätigen)"
        forceState={forceState}
      />
    </div>
  )
}

/** A cross-step reference shows the referenced item's text; a broken one says so (PRD F5). */
export function ReferenceChip({ text }: { text?: string }) {
  if (text === undefined)
    return (
      <span className="refchip refchip--missing">
        <StatusIcon status="warn" size={14} tooltip={false} />
        Verweis fehlt
      </span>
    )
  return (
    <span className="refchip" title={text}>
      {text}
    </span>
  )
}

/** Takes the removed row's place for 10 seconds (design §7.6). */
export function UndoLine({ label, note, onUndo, focus = true }: { label: string; note?: string; onUndo: () => void; focus?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (focus) ref.current?.querySelector('button')?.focus()
  }, [focus])
  return (
    <p className="undo" role="status">
      <span>
        „{label}“ entfernt.{note && ` ${note}`}
      </span>
      <span ref={ref}>
        <Button variant="text" onClick={onUndo}>
          Rückgängig
        </Button>
      </span>
    </p>
  )
}
