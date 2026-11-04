import { useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../components/Icon'
import { StatusIcon, statusLabel } from '../components/StatusIcon'
import { stepsByPart, type Step, type StepStatus, type StepStatuses, type View } from '../steps'
import './Sidebar.css'

type Props = {
  view: View
  statuses: StepStatuses
  onNavigate: (view: View) => void
}

// Left sidebar (design §5.2): Übersicht, steps grouped by part, backup slot, Einstellungen.
export function Sidebar({ view, statuses, onNavigate }: Props) {
  const current = (match: boolean) => (match ? ('page' as const) : undefined)

  return (
    <nav className="sidebar" aria-label="Navigation">
      <p className="sidebar__name">Wirkungshelferin</p>

      <button
        type="button"
        className="sidebar__row"
        aria-current={current(view.kind === 'home')}
        onClick={() => onNavigate({ kind: 'home' })}
      >
        Übersicht
      </button>

      {stepsByPart.map(({ part, steps }) => (
        <div key={part} className="sidebar__group">
          <p className="sidebar__part" id={`sidebar-part-${part}`}>
            {part}
          </p>
          <ul aria-labelledby={`sidebar-part-${part}`}>
            {steps.map((step) => (
              <li key={step.id}>
                <StepRow
                  step={step}
                  status={statuses[step.id]}
                  current={view.kind === 'step' && view.step === step.id}
                  onOpen={() => onNavigate({ kind: 'step', step: step.id })}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="sidebar__foot">
        {/* Backup status slot, filled in step 6. */}
        <p className="sidebar__backup" data-slot="backup-status">
          <Icon name="backup" size={16} />
          Noch kein Backup
        </p>
        <button
          type="button"
          className="sidebar__row"
          aria-current={current(view.kind === 'settings')}
          onClick={() => onNavigate({ kind: 'settings' })}
        >
          Einstellungen
        </button>
      </div>
    </nav>
  )
}

// The row shows its status tooltip on hover and keyboard focus, beside the row (design §7.1).
// A click also focuses the row, so focus that follows a pointer press doesn't open it.
type RowProps = { step: Step; status: StepStatus; current: boolean; onOpen: () => void }

function StepRow({ step, status, current, onOpen }: RowProps) {
  const [tip, setTip] = useState(false)
  const pointer = useRef(false)

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') setTip(false)
  }

  return (
    <button
      type="button"
      className="sidebar__row sidebar__step"
      aria-current={current ? 'page' : undefined}
      // Starts with the visible text (WCAG 2.5.3), then the status the icon shows.
      aria-label={`${step.id} ${step.short}, ${statusLabel(status)}`}
      data-tooltip-anchor
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
      onPointerDown={() => (pointer.current = true)}
      onFocus={() => {
        if (!pointer.current) setTip(true)
        pointer.current = false
      }}
      onBlur={() => setTip(false)}
      onKeyDown={onKeyDown}
      onClick={onOpen}
    >
      <StatusIcon status={status} tooltipOpen={tip} tooltipSide="right" />
      <span className="sidebar__num tabular">{step.id}</span>
      <span>{step.short}</span>
    </button>
  )
}
