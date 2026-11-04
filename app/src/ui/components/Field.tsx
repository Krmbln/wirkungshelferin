import { useId, type ReactNode } from 'react'
import { StatusIcon } from './StatusIcon'
import './Field.css'

export type ControlProps = {
  id: string
  className: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

type Props = {
  label: string
  hint?: ReactNode
  /** Shown at the field (design §7.3), linked to the control. */
  error?: string | null
  /** The control itself, with the ids and class it needs. */
  children: (control: ControlProps) => ReactNode
}

// Label above, control, then hint or error below. Inputs: 1 px --line-strong, white (design §3).
export function Field({ label, hint, error, children }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        className: 'field__control',
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** ⛔ + text under a control. role=alert, so an error after Enter is announced too. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="field__error" id={id} role="alert">
      {/* The icon's own label ("blockiert das Bestätigen") would be wrong here. */}
      <span className="field__error-icon" aria-hidden="true">
        <StatusIcon status="block" tooltip={false} size={16} />
      </span>
      {children}
    </p>
  )
}
