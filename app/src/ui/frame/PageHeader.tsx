import { useEffect, useState, type Ref } from 'react'
import './PageHeader.css'

type Props = {
  title: string
  /** Orientation line above the title, e.g. "Schritt 3 · Strategie" (design §5.2). */
  meta?: string
  headingRef?: Ref<HTMLHeadingElement>
  /** Time of the last successful save. */
  savedAt?: number
}

export const SAVED_VISIBLE_MS = 2000

// The page's one h1, plus "Gespeichert": muted, for 2 s after each save (design §7.4).
export function PageHeader({ title, meta, headingRef, savedAt }: Props) {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (savedAt === undefined) return
    setSaved(true)
    const timer = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [savedAt])

  return (
    <header className="page-header">
      <div className="page-header__titles">
        {meta && <p className="page-header__meta">{meta}</p>}
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
      </div>
      {/* Visual only: silent when saving works; a failure is announced by the alert banner. */}
      <p className="page-header__saved" aria-hidden="true" data-slot="saved">
        {saved ? 'Gespeichert' : ''}
      </p>
    </header>
  )
}
