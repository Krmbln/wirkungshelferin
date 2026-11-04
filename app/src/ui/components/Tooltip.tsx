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
  /** Opens the bubble from outside, e.g. while a focusable parent row has focus. */
  forceOpen?: boolean
  /**
   * 'right' places the bubble beside the closest [data-tooltip-anchor] ancestor (e.g. a
   * sidebar row), so it doesn't cover the next row. Fixed position, so a scrolling parent
   * doesn't clip it.
   */
  side?: 'below' | 'right'
  className?: string
}

// Opens on hover and on Enter, closes on Esc, blur and mouse leave (design §10).
// The bubble is inside the wrapper, so moving the pointer onto it keeps it open (WCAG 1.4.13).
export function Tooltip({
  content,
  children,
  focusable = true,
  forceOpen = false,
  side = 'below',
  className,
}: Props) {
  const id = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const [beside, setBeside] = useState<{ top: number; left: number } | null>(null)
  const shown = open || forceOpen

  // Esc must close a hover-opened tooltip too, wherever focus is (WCAG 1.4.13).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function measure() {
    const el = wrapper.current
    if (!el) return
    if (side === 'right') {
      const rect = (el.closest('[data-tooltip-anchor]') ?? el).getBoundingClientRect()
      setBeside({ top: rect.top + rect.height / 2, left: rect.right + 8 })
      return
    }
    // Triggers in the right half open leftwards, so the bubble isn't clipped at the edge.
    setAlignEnd(el.getBoundingClientRect().left > window.innerWidth / 2)
  }

  useEffect(() => {
    if (forceOpen) measure()
    // Re-measure whenever the bubble is opened from outside.
  }, [forceOpen])

  function show() {
    measure()
    setOpen(true)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open) setOpen(false)
      else show()
    }
  }

  const classes = ['tooltip', side === 'right' ? 'tooltip--right' : alignEnd && 'tooltip--end', className].filter(Boolean).join(' ')
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
        hidden={!shown}
        style={side === 'right' && beside ? beside : undefined}
        aria-hidden={focusable ? undefined : true}
      >
        {content}
      </span>
    </span>
  )
}
