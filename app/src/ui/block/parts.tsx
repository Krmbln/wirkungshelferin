import { useEffect, useId, useRef, type FocusEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusIcon } from '../components/StatusIcon'
import { InlineText } from './InlineText'
import './Block.css'

// The reusable pieces of every block panel (design §6.2, step 11). Steps 2–6 use them too.

type SectionProps = {
  title: ReactNode
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
  /** 4 inside a group of steps 2–4 (the group header is the h3). */
  level?: 3 | 4
  /** Under the heading, before the rows (step 2: the challenge line above Folgen). */
  lead?: ReactNode
  /** The add button can't be used now, and why (step 3: a level marked "trifft nicht zu"). */
  addDisabled?: string
  children: ReactNode
}

export function BlockSection({ title, addText = 'hinzufügen', meta, onAdd, addLabel, addKey, emptyHint, empty = false, actions, level = 3, lead, addDisabled, children }: SectionProps) {
  const headingId = useId()
  const Heading = level === 4 ? 'h4' : 'h3'
  return (
    <section className="bsection" aria-labelledby={headingId}>
      <div className="bsection__head">
        <Heading id={headingId}>{title}</Heading>
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
      {lead}
      {empty && emptyHint ? <p className="bsection__empty">{emptyHint}</p> : children}
    </section>
  )

  function add() {
    if (!onAdd) return null
    return (
      <Button variant="text" className="bsection__add" icon={<Icon name="plus" size={16} />} aria-label={addLabel} data-add={addKey} disabledReason={addDisabled} onClick={onAdd}>
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
  /** Says what belongs here (step 2: per collection); always ends with "(nötig zum Bestätigen)". */
  placeholder?: string
  onSave: (value: string) => void
  /** ⛔ marker: set once a check found the Why missing (step 13). */
  blocked?: boolean
  /** Names the item in the field's accessible name when many rows repeat it ("Warum: Ziel „…“", step 17). */
  context?: string
  forceState?: 'hover'
  /** Another reason field in the same look (step 4: "weil …", "Annahme"): visible label, `data-field`, accessible name prefix. */
  label?: ReactNode
  field?: string
  name?: string
}

/** "Warum?" directly under a Why-carrying item (design §6.2). */
export function WhyField({
  value,
  onSave,
  blocked = false,
  context,
  forceState,
  placeholder = 'Warum ist das wichtig? (nötig zum Bestätigen)',
  label = 'Warum?',
  field = 'why',
  name = 'Warum',
}: WhyProps) {
  const id = useId()
  return (
    <div className="why" data-field={field}>
      <label className="why__label" htmlFor={id}>
        {label}
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
        label={context && `${name}: ${context}`}
        multiline
        invalid={blocked}
        placeholder={placeholder}
        forceState={forceState}
      />
    </div>
  )
}

/** A cross-step reference shows the referenced item's text; a broken one says so (PRD F5). `full`: wraps, no max width (step 16). */
export function ReferenceChip({ text, full = false }: { text?: string; full?: boolean }) {
  if (text === undefined)
    return (
      <span className="refchip refchip--missing">
        <StatusIcon status="warn" size={14} tooltip={false} />
        Verweis fehlt
      </span>
    )
  return (
    <span className={`refchip${full ? ' refchip--full' : ''}`} title={full ? undefined : text}>
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
