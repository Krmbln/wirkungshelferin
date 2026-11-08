import { useId, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'text'

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'onClick'> & {
  variant?: ButtonVariant
  /** Disables the button. Required as text: a disabled button always says why (design §3). */
  disabledReason?: string
  /** Externally controlled busy state, e.g. while a check runs. */
  busy?: boolean
  /** Label while busy, e.g. "prüft …". Defaults to the normal label. */
  busyLabel?: string
  icon?: ReactNode
  /** If this returns a promise, the button stays busy until it settles. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>
}

// Disabled and busy buttons use aria-disabled, not the disabled attribute,
// so keyboard users can still reach them and hear the reason.
export function Button({
  variant = 'secondary',
  disabledReason,
  busy = false,
  busyLabel,
  icon,
  onClick,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const reasonId = useId()
  const [pending, setPending] = useState(false)
  // The ref closes the gap between a click and the re-render that shows busy.
  const running = useRef(false)

  const isBusy = busy || pending
  const isDisabled = disabledReason !== undefined
  const inert = isBusy || isDisabled

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (inert || running.current) {
      event.preventDefault()
      return
    }
    const result = onClick?.(event)
    if (result instanceof Promise) {
      running.current = true
      setPending(true)
      result
        .catch(() => {
          // The caller handles and shows errors; the button only resets.
        })
        .finally(() => {
          running.current = false
          setPending(false)
        })
    }
  }

  const classes = ['btn', `btn--${variant}`, className].filter(Boolean).join(' ')
  const button = (
    <button
      {...rest}
      type={type}
      className={classes}
      aria-disabled={inert || undefined}
      aria-busy={isBusy || undefined}
      aria-describedby={isDisabled && !isBusy ? reasonId : rest['aria-describedby']}
      onClick={handleClick}
    >
      {icon && <span className="btn__icon">{icon}</span>}
      {busyLabel ? (
        // Both labels share one grid cell; the inactive one keeps its width (no jump while busy).
        <span className="btn__labels">
          <span className={isBusy ? 'btn__label--off' : undefined} aria-hidden={isBusy || undefined}>
            {children}
          </span>
          <span className={isBusy ? undefined : 'btn__label--off'} aria-hidden={!isBusy || undefined}>
            {busyLabel}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  )

  if (!isDisabled || isBusy) return button
  return (
    <span className="btn-with-reason">
      {button}
      <span id={reasonId} className="btn-reason">
        {disabledReason}
      </span>
    </span>
  )
}
