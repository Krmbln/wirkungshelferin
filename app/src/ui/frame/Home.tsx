import { Button } from '../components/Button'
import { StatusIcon } from '../components/StatusIcon'
import { homeStatusLine, recommendedStep, steps, stepsByPart, type StepId, type StepStatuses } from '../steps'
import './Home.css'

type Props = {
  statuses: StepStatuses
  onOpenStep: (step: StepId) => void
}

// Home (design §6.1). "Weiter" is the page's only primary button.
// The card shows the recommended step until step 22 adds "Wo du aufgehört hast".
export function Home({ statuses, onOpenStep }: Props) {
  const next = recommendedStep(statuses)
  const nextStep = next === null ? null : steps[next]
  // Honest label until step 22 knows where Lukas really left off.
  const fresh = steps.every((s) => statuses[s.id] === 'todo')

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
