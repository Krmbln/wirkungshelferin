import { prefersReducedMotion } from '../motion'

// The brief highlight after "Übernehmen" and after jumping to a card (design §6.2): accent-soft
// that fades over 1.5 s. Under reduced motion CSS animations are off, so it shows still and goes.

export const HIGHLIGHT_MS = 1500

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

export function highlight(el: Element) {
  clearTimeout(timers.get(el))
  // Restarts the animation when the same element lights up again.
  el.removeAttribute('data-highlight')
  void (el as HTMLElement).offsetWidth
  el.setAttribute('data-highlight', '')
  timers.set(
    el,
    setTimeout(() => el.removeAttribute('data-highlight'), HIGHLIGHT_MS),
  )
}

/** Room left above or below an element scrolled into view, in px. */
const SCROLL_MARGIN = 12

/**
 * Scrolls only the column the element sits in (chat or block), never the window: the native
 * scrollIntoView moves every scrollable ancestor. `start` (or an element taller than the
 * column) puts its top at the top; `nearest` scrolls as little as needed.
 */
export function scrollIntoView(el: Element, block: 'nearest' | 'start' = 'nearest') {
  const box = el.closest('.workspace__scroll')
  if (!box) return
  const rect = box.getBoundingClientRect()
  // Room a sticky header takes (steps 2–4): the column's scroll-padding-top.
  const pad = el.classList.contains('bgroup') ? 0 : parseFloat(getComputedStyle(box).scrollPaddingTop) || 0
  const outer = { top: rect.top + pad, bottom: rect.bottom, height: rect.height - pad }
  const inner = el.getBoundingClientRect()
  let by = 0
  if (block === 'start' || inner.height > outer.height || inner.top < outer.top) by = inner.top - outer.top - SCROLL_MARGIN
  else if (inner.bottom > outer.bottom) by = inner.bottom - outer.bottom + SCROLL_MARGIN
  if (by) box.scrollTo?.({ top: box.scrollTop + by, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}
