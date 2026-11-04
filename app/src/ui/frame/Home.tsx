import { useRef, useState } from 'react'
import type { BackupState } from '../../domain/backup'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { StatusIcon } from '../components/StatusIcon'
import { homeStatusLine, recommendedStep, steps, stepsByPart, type StepId, type StepStatuses } from '../steps'
import './Home.css'

type Props = {
  statuses: StepStatuses
  backup: BackupState
  onOpenStep: (step: StepId) => void
  onSaveBackup: () => void
}

// Home (design §6.1). "Weiter" is the page's only primary button.
// The card shows the recommended step until step 22 adds "Wo du aufgehört hast".
export function Home({ statuses, backup, onOpenStep, onSaveBackup }: Props) {
  const next = recommendedStep(statuses)
  const nextStep = next === null ? null : steps[next]
  // Honest label until step 22 knows where Lukas really left off.
  const fresh = steps.every((s) => statuses[s.id] === 'todo')
  const [backupSaved, setBackupSaved] = useState(false)
  const savedNote = useRef<HTMLParagraphElement>(null)

  return (
    <div className="home">
      <section className="home__resume" aria-labelledby="resume-heading">
        <p className="home__eyebrow" id="resume-heading">
          {fresh ? 'Hier fängst du an' : 'Als Nächstes'}
        </p>
        {nextStep ? (
          <>
            <h2>
              Schritt {nextStep.id} · {nextStep.title}
            </h2>
            <p className="home__lead">{nextStep.lead}</p>
            <Button variant="primary" onClick={() => onOpenStep(nextStep.id)}>
              Weiter
            </Button>
          </>
        ) : (
          <h2>Alle Schritte sind bestätigt.</h2>
        )}
      </section>

      {/* Backup reminder (design §6.1, item 2): only when the last backup is > 7 days old. */}
      {backup.due && (
        <Banner
          tone="warn"
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                onSaveBackup()
                setBackupSaved(true)
                // The banner goes with the button; focus moves to the line that replaces it.
                requestAnimationFrame(() => savedNote.current?.focus())
              }}
            >
              Backup speichern
            </Button>
          }
        >
          {backup.days === undefined
            ? 'Du hast noch kein Backup gespeichert. Speichere jetzt eins, damit nichts verloren geht.'
            : `Dein letztes Backup ist ${backup.days} Tage alt. Speichere ein neues, damit nichts verloren geht.`}
        </Banner>
      )}
      {backupSaved && !backup.due && (
        <p ref={savedNote} tabIndex={-1} className="home__saved" role="status">
          Backup ist in deinen Downloads.
        </p>
      )}

      {stepsByPart.map(({ part, steps: partSteps }) => (
        <section key={part} className="home__part" aria-labelledby={`home-part-${part}`}>
          <h2 id={`home-part-${part}`}>{part}</h2>
          <ul>
            {partSteps.map((step) => (
              <li key={step.id}>
                <button type="button" className="home__row" onClick={() => onOpenStep(step.id)}>
                  {/* The status is written out in the row, so the icon isn't read as well. */}
                  <span className="home__row-icon" aria-hidden="true">
                    <StatusIcon status={statuses[step.id]} tooltip={false} />
                  </span>
                  <span className="home__row-text">
                    <span className="home__row-title">
                      {step.id} · {step.title}
                    </span>
                    <span className="home__row-status">{homeStatusLine[statuses[step.id]]}</span>
                  </span>
                  {step.id === next && <span className="home__recommended">Empfohlen als Nächstes</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
