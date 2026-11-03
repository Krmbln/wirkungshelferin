import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import './Tooltip.css'

type Props = {
  content: ReactNode
  children: ReactNode
  /**
   * false when the trigger already carries the same text as its accessible name (e.g. a
   * StatusIcon's aria-label): no extra tab stop, and the bubble is hidden from screen
   * readers so the label isn't read twice.
   */
  focusable?: boolean
  className?: string
}

// Opens on hover and on Enter, closes on Esc, blur and mouse leave (design §10).
// The bubble is inside the wrapper, so moving the pointer onto it keeps it open (WCAG 1.4.13).
export function Tooltip({ content, children, focusable = true, className }: Props) {
  const id = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)

  // Esc must close a hover-opened tooltip too, wherever focus is (WCAG 1.4.13).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function show() {
    // Triggers in the right half open leftwards, so the bubble isn't clipped at the edge.
    const rect = wrapper.current?.getBoundingClientRect()
    setAlignEnd(!!rect && rect.left > window.innerWidth / 2)
    setOpen(true)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open) setOpen(false)
      else show()
    }
  }

  const classes = ['tooltip', alignEnd && 'tooltip--end', className].filter(Boolean).join(' ')
  return (
    <span ref={wrapper} className={classes} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <span
        className="tooltip__trigger"
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={focusable ? id : undefined}
        onKeyDown={focusable ? onKeyDown : undefined}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className="tooltip__bubble"
        hidden={!open}
        aria-hidden={focusable ? undefined : true}
      >
        {content}
      </span>
    </span>
  )
}
