import { useRef, useState } from 'react'
import type { BackupState } from '../../domain/backup'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { StatusIcon } from '../components/StatusIcon'
import { ThinkingIndicator } from '../components/ThinkingIndicator'
import { confirmedLine, homeCard, rowStatus, type CardBody } from '../home'
import { recommendedStep, statusesOf, steps, stepsByPart } from '../steps'
import './Home.css'

type Props = {
  project: Project
  now: Date
  /** The step whose summary is being written (card state D). */
  writing?: StepId
  backup: BackupState
  onOpenStep: (step: StepId) => void
  onSaveBackup: () => void
}

const eyebrow = { resume: 'Wo du aufgehört hast', fresh: 'Hier fängst du an', next: 'Als Nächstes' }

function Body({ body, step }: { body: CardBody; step: StepId }) {
  switch (body.kind) {
    case 'summary':
      return (
        <>
          <p>{body.summary}</p>
          <p className="home__next">
            <strong>Zum Weitermachen:</strong> {body.nextAction}
          </p>
        </>
      )
    case 'question':
      return (
        <>
          <p className="home__muted">Zuletzt hat die Wirkungshelferin gefragt:</p>
          <p>{body.question}</p>
        </>
      )
    case 'unanswered':
      // Not muted: the one state where something went wrong (design check).
      return <p>Deine letzte Nachricht hat noch keine Antwort.</p>
    case 'outdated':
      return <p>Ein früherer Schritt hat sich geändert. Prüf, ob hier noch alles passt.</p>
    default:
      return <p className="home__muted">{steps[step].lead}</p>
  }
}

// Home (design §6.1). "Weiter" is the page's only primary button; the card says where Lukas
// left off ("Step 22"), or what comes next.
export function Home({ project, now, writing, backup, onOpenStep, onSaveBackup }: Props) {
  const statuses = statusesOf(project)
  const next = recommendedStep(statuses)
  const card = homeCard(project)
  const [backupSaved, setBackupSaved] = useState(false)
  const savedNote = useRef<HTMLParagraphElement>(null)

  return (
    <div className="home">
      <section className="home__resume" aria-labelledby="resume-heading">
        {card.kind === 'done' ? (
          // No eyebrow: "Als Nächstes" over "all confirmed" would contradict it (design check).
          <h2 id="resume-heading">Alle Schritte sind bestätigt.</h2>
        ) : (
          <>
            <p className="home__eyebrow" id="resume-heading">
              {card.kind === 'resume' ? eyebrow.resume : card.fresh ? eyebrow.fresh : eyebrow.next}
            </p>
            <h2 id="resume-step">
              Schritt {card.step} · {steps[card.step].title}
            </h2>
            {/* B, C, D: a fixed minimum, so the summary landing doesn't move Weiter (UI/UX H2). */}
            <div className={card.kind === 'resume' ? 'home__body home__body--swap' : 'home__body'}>
              <Body body={card.body} step={card.step} />
              {card.kind === 'resume' && writing === card.step && card.body.kind !== 'summary' && (
                <p className="home__writing">
                  <ThinkingIndicator announce={false} label="fasst zusammen, wo du stehst …" />
                </p>
              )}
              {card.kind === 'next' && card.confirmed && <p className="home__confirmed">{confirmedLine(card.confirmed.step, card.confirmed.at, now)}</p>}
            </div>
            <Button variant="primary" aria-describedby="resume-step" onClick={() => onOpenStep(card.step)}>
              Weiter
            </Button>
          </>
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
                    <span className="home__row-status">{rowStatus(project, step.id, now)}</span>
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
