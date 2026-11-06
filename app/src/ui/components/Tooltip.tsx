import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
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
  /**
   * Below the trigger in a fixed position, for triggers inside a scrolling box (e.g. the intro
   * panel) that would clip the bubble. Closes when anything scrolls, so it never floats off.
   */
  fixed?: boolean
  className?: string
}

// Opens on hover, click and Enter, closes on Esc, blur and mouse leave (design §6.2, §10).
// The bubble is inside the wrapper, so moving the pointer onto it keeps it open (WCAG 1.4.13).
export function Tooltip({
  content,
  children,
  focusable = true,
  forceOpen = false,
  side = 'below',
  fixed = false,
  className,
}: Props) {
  const id = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const [beside, setBeside] = useState<CSSProperties | null>(null)
  const shown = open || forceOpen

  // Esc must close a hover-opened tooltip too, wherever focus is (WCAG 1.4.13).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    if (fixed) document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, fixed])

  function measure() {
    const el = wrapper.current
    if (!el) return
    if (side === 'right') {
      const rect = (el.closest('[data-tooltip-anchor]') ?? el).getBoundingClientRect()
      setBeside({ top: rect.top + rect.height / 2, left: rect.right + 8 })
      return
    }
    // Triggers in the right half open leftwards, so the bubble isn't clipped at the edge.
    const rect = el.getBoundingClientRect()
    const end = rect.left > window.innerWidth / 2
    setAlignEnd(end)
    if (fixed) setBeside(end ? { top: rect.bottom + 8, right: window.innerWidth - rect.right } : { top: rect.bottom + 8, left: rect.left })
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

  const classes = ['tooltip', side === 'right' ? 'tooltip--right' : alignEnd && 'tooltip--end', fixed && side === 'below' && 'tooltip--fixed', className]
    .filter(Boolean)
    .join(' ')
  return (
    <span ref={wrapper} className={classes} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      <span
        className="tooltip__trigger"
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={focusable ? id : undefined}
        onKeyDown={focusable ? onKeyDown : undefined}
        onClick={focusable ? show : undefined}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      <span
        role="tooltip"
        id={id}
        className="tooltip__bubble"
        hidden={!shown}
        style={(side === 'right' || fixed) && beside ? beside : undefined}
        aria-hidden={focusable ? undefined : true}
      >
        {content}
      </span>
    </span>
  )
}
