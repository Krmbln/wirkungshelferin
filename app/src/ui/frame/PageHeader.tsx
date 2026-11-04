import type { Ref } from 'react'
import './PageHeader.css'

type Props = {
  title: string
  /** Orientation line above the title, e.g. "Schritt 3 · Strategie" (design §5.2). */
  meta?: string
  headingRef?: Ref<HTMLHeadingElement>
}

// The page's one h1, plus the "Gespeichert" slot (design §7.4, filled in step 5).
export function PageHeader({ title, meta, headingRef }: Props) {
  return (
    <header className="page-header">
      <div className="page-header__titles">
        {meta && <p className="page-header__meta">{meta}</p>}
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
      </div>
      <p className="page-header__saved" aria-live="polite" data-slot="saved" />
    </header>
  )
}
