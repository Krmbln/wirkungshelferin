import { Fragment, useState, type ReactNode } from 'react'
import type { EarlierChange } from '../../domain/outdated'
import type { StepId } from '../../domain/types'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import './OutdatedBanner.css'

// "Vielleicht veraltet" (design §6.2 "Step 21"): a standing banner above the block of an outdated
// step, with "Änderung prüfen lassen". Gone once the step is confirmed again.

type Props = {
  changes: EarlierChange[]
  /** A "Prüfen lassen" turn got its complete answer. */
  reviewed: boolean
  /** That turn is running now. */
  running: boolean
  /** Another chat turn of this step is running. */
  chatBusy: boolean
  onReview: () => void
  onOpenStep: (step: StepId) => void
}

/** "Schritt 2", "Schritt 0 und Schritt 2", "Schritt 0 (Messrahmen) und Schritt 2", "Der Messrahmen in Schritt 0". */
export function changedSubject(changes: EarlierChange[], name: (step: StepId) => ReactNode, capital = true): ReactNode {
  if (changes.length === 1 && changes[0].frameOnly) return <>{capital ? 'Der' : 'der'} Messrahmen in {name(0)}</>
  return changes.map((c, i) => (
    <Fragment key={c.step}>
      {i > 0 && (i === changes.length - 1 ? ' und ' : ', ')}
      {name(c.step)}
      {c.frameOnly && ' (Messrahmen)'}
    </Fragment>
  ))
}

export function OutdatedBanner({ changes, reviewed, running, chatBusy, onReview, onOpenStep }: Props) {
  // Announced once when the answer lands while Lukas is here; the banner itself is no live region.
  const [announce, setAnnounce] = useState('')
  const [was, setWas] = useState(reviewed)
  if (was !== reviewed) {
    setWas(reviewed)
    setAnnounce(reviewed ? 'Geprüft – die Antwort steht im Chat.' : '')
  }

  const link = (step: StepId) => (
    <button type="button" className="outdated__link" aria-label={`Zu Schritt ${step}`} onClick={() => onOpenStep(step)}>
      Schritt {step}
    </button>
  )
  const several = changes.length > 1

  return (
    <div className="outdated">
      <Banner tone="warn" live={false}>
        {reviewed ? (
          'Die Antwort der Wirkungshelferin steht im Chat. Passt alles, bestätige unten erneut. '
        ) : (
          <>
            {changedSubject(changes, link)} {several ? 'haben' : 'hat'} sich geändert, seit du diesen Schritt bestätigt hast. Vielleicht passt hier etwas nicht
            mehr.
          </>
        )}
        {/* One element in both states, so focus stays on it when the answer lands. */}
        <Button
          variant={reviewed ? 'text' : 'secondary'}
          className={reviewed ? 'outdated__again' : 'outdated__review'}
          busy={running}
          busyLabel="prüft die Änderung …"
          disabledReason={chatBusy && !running ? 'Warte, bis die Antwort im Chat fertig ist.' : undefined}
          onClick={onReview}
        >
          {reviewed ? 'Nochmal prüfen lassen' : 'Änderung prüfen lassen'}
        </Button>
      </Banner>
      <p className="visually-hidden" role="status">
        {announce}
      </p>
    </div>
  )
}
