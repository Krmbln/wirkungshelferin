import { useEffect, useRef, useState } from 'react'
import { problemText } from '../../ai/errors'
import { calendarDaysSince } from '../../domain/backup'
import { hardIssues, issueContext, openWarnings, type FieldTarget } from '../../domain/check'
import type { LooseBlock } from '../../domain/block'
import type { Project, QualityCheck } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { dayText } from '../chat/sessions'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusIcon } from '../components/StatusIcon'
import { ThinkingIndicator } from '../components/ThinkingIndicator'
import { blockingText, gateView, okText, warnConfirmText, type JudgedRow } from './gate'
import type { CheckProblem, CheckRun } from './useCheckRunner'
import './QualityGate.css'

type Props = {
  project: Project
  step: StepId
  now: Date
  model: string
  run?: CheckRun
  /** An answer is running in the step's chat: a check now could be outdated at once. */
  chatBusy?: boolean
  onCheck: () => Promise<QualityCheck | undefined>
  onConfirm: () => void
  onGoToField: (target: FieldTarget) => void
  onSaveBackup: () => void
  onOpenSettings: () => void
  /** Step 0: confirming starts step 1's first draft; this banner replaces the backup question. */
  handoff?: Handoff
}

/** Step 1's first draft after step 0's confirm (design §6.2, step 14), live. */
export type Handoff = { status: 'writing' | 'done' | 'failed'; onContinue: () => void }

const HANDOFF_TEXT: Record<Handoff['status'], string> = {
  writing: 'Schritt 0 bestätigt. Die Wirkungshelferin schreibt den ersten Entwurf für Schritt 1 …',
  done: 'Schritt 0 bestätigt. Der erste Entwurf für Schritt 1 ist fertig.',
  failed: 'Schritt 0 bestätigt. Der Entwurf für Schritt 1 hat nicht geklappt – in Schritt 1 kannst du es erneut versuchen.',
}

const problemLine = (problem: CheckProblem, model: string) =>
  problem === 'no_result' ? 'Die Prüfung hat kein Ergebnis gebracht. Versuch es noch einmal.' : problemText(problem, model, 'chat')

/** "Bestätigt heute" / "gestern" / "am 05.11." */
const confirmedText = (at: string, now: Date) => `Bestätigt ${calendarDaysSince(at, now) <= 1 ? '' : 'am '}${dayText(at, now)}`

// The three-state gate at the bottom of the block panel (design §6.2): A "Prüfen und
// bestätigen", B blocked with the reason and "Zum Feld", C confirm (with the inline question
// when ⚠ points stay open). After confirming: the backup prompt.
export function QualityGate({ project, step, now, model, run, chatBusy = false, onCheck, onConfirm, onGoToField, onSaveBackup, onOpenSettings, handoff }: Props) {
  // While a check runs or after it failed, the ⛔ rows come from the block now (instantly, offline too).
  const view = gateView(project, step, !!run)
  const [asking, setAsking] = useState(false)
  const [prompt, setPrompt] = useState<'open' | 'saved' | 'handoff' | 'handoff-saved' | null>(null)
  const [okOpen, setOkOpen] = useState(false)
  const [announce, setAnnounce] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const focusNext = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // One try after the render the move was meant for; a target that never came (e.g. a confirm
  // refused because of an edit meanwhile) must not steal focus later.
  useEffect(() => {
    if (!focusNext.current) return
    const el = root.current?.querySelector<HTMLElement>(focusNext.current)
    focusNext.current = null
    // Visible ring also after a mouse click: the next Enter acts on it (Chrome supports focusVisible).
    el?.focus({ focusVisible: true } as FocusOptions)
  })

  // The ✓ rows open below the visible part of the list: bring the first one into view.
  useEffect(() => {
    const box = list.current
    const first = box?.querySelector<HTMLElement>('.gate__row--ok')
    if (!okOpen || !box || !first) return
    const below = first.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom
    if (below > 0) box.scrollTop += below
  }, [okOpen])

  // Marks a list cut off at the bottom (macOS hides scrollbars, so nothing else shows it).
  useEffect(() => {
    const box = list.current
    if (!box) return
    const mark = () => box.toggleAttribute('data-cut', box.scrollTop + box.clientHeight < box.scrollHeight - 1)
    mark()
    box.addEventListener('scroll', mark)
    window.addEventListener('resize', mark)
    return () => {
      box.removeEventListener('scroll', mark)
      window.removeEventListener('resize', mark)
    }
  })

  // An edit after the check (A) or a confirm (sidebar ✓) closes what belonged to the old state.
  if (asking && view.kind !== 'ready') setAsking(false)
  if (prompt && view.kind !== 'confirmed') setPrompt(null)

  const running = run?.kind === 'running'
  const warnings = view.check ? openWarnings(step, view.check, ...issueContext(project)) : []

  function confirm() {
    // Read before confirming: the hand-off is offered while step 1 is still empty.
    const handing = !!handoff
    onConfirm()
    setAsking(false)
    setPrompt(handing ? 'handoff' : 'open')
    focusNext.current = handing ? '[data-gate="next"]' : '[data-gate="backup"]'
  }

  function ask() {
    setAsking(true)
    focusNext.current = '[data-gate="confirm"]'
  }

  async function check(confirmAfter: boolean) {
    setAsking(false)
    setAnnounce('Der Baustein wird geprüft …')
    const result = await onCheck()
    if (!alive.current) return
    if (!result) return setAnnounce('')
    const blocking = hardIssues(step, result.block as LooseBlock, ...issueContext(project)).length
    const open = openWarnings(step, result, ...issueContext(project)).length
    setAnnounce(blocking ? `Geprüft. ${blockingText(blocking)}.` : open ? `Geprüft. ${open === 1 ? '1 offener Punkt' : `${open} offene Punkte`}.` : 'Geprüft. Alles erfüllt.')
    if (blocking) focusNext.current = '[data-gate="field"]'
    else if (!confirmAfter) focusNext.current = '[data-gate="primary"]'
    else if (open) ask()
    else confirm()
  }

  const checking = view.kind === 'unchecked' || view.kind === 'changed'
  const hasRows = view.blocking.length > 0 || view.warn.length > 0 || (okOpen && view.ok.length > 0)

  return (
    <div className="gate" ref={root}>
      <p className="visually-hidden" role="status">
        {announce}
      </p>

      {view.kind === 'unchecked' && <p className="gate__lead">Bevor du bestätigst, prüft die Wirkungshelferin den Baustein.</p>}
      {view.kind === 'changed' && <p className="gate__lead">Geändert seit der Prüfung – erneut prüfen</p>}
      {view.kind === 'confirmed' && (
        <div>
          <p className="gate__confirmed" data-gate="confirmed" tabIndex={-1}>
            <StatusIcon status="done" size={18} tooltip={false} />
            {confirmedText(view.confirmedAt!, now)}
          </p>
          <p className="gate__lead gate__hint">Wenn du etwas änderst, prüfst du neu.</p>
        </div>
      )}

      {hasRows && (
        <ul ref={list} className={`gate__rows${view.kind === 'changed' ? ' gate__rows--old' : ''}`} aria-label="Ergebnis der Prüfung">
          {view.blocking.map((row, i) => (
            <li key={row.key} className="gate__row gate__row--block">
              <StatusIcon status="block" size={18} />
              <span className="gate__text">{row.text}</span>
              {/* The fix lies in another step (step 2 without focus groups): go there instead. */}
              <Button
                variant="text"
                className="gate__field"
                data-gate={i === 0 ? 'field' : undefined}
                aria-label={row.target.step !== undefined && row.target.step !== step ? undefined : `Zum Feld: ${row.text}`}
                onClick={() => onGoToField(row.target)}
              >
                {row.target.step !== undefined && row.target.step !== step ? `Zu Schritt ${row.target.step}` : 'Zum Feld'}
              </Button>
            </li>
          ))}
          {view.warn.map((row) => (
            <Judged key={row.criterion} row={row} onGoToField={onGoToField} />
          ))}
          {okOpen && view.ok.map((row) => <Judged key={row.criterion} row={row} />)}
        </ul>
      )}
      {/* Outside the scrolling list, so it never scrolls out of sight. */}
      {view.ok.length > 0 && (
        <Button variant="text" className={`gate__toggle${view.kind === 'changed' ? ' gate__toggle--old' : ''}`} aria-expanded={okOpen} onClick={() => setOkOpen(!okOpen)}>
          {okText(view.ok.length)}
          <Icon name={okOpen ? 'chevronDown' : 'chevronRight'} size={16} />
        </Button>
      )}

      {/* The primary button below retries; only key and model problems need the way out. */}
      {run?.kind === 'failed' && (
        <Banner
          tone="block"
          actions={
            (run.problem === 'key' || run.problem === 'model') && (
              <Button variant="secondary" onClick={onOpenSettings}>
                Zu den Einstellungen
              </Button>
            )
          }
        >
          {problemLine(run.problem, model)}
        </Banner>
      )}

      {prompt === 'open' && (
        <Banner
          tone="neutral"
          actions={
            <>
              <Button
                variant="secondary"
                data-gate="backup"
                onClick={() => {
                  onSaveBackup()
                  setPrompt('saved')
                  focusNext.current = '[data-gate="saved"]'
                }}
              >
                Backup speichern
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  setPrompt(null)
                  focusNext.current = '[data-gate="confirmed"]'
                }}
              >
                Später
              </Button>
            </>
          }
        >
          Schritt bestätigt. Jetzt Backup speichern?
        </Banner>
      )}
      {(prompt === 'handoff' || prompt === 'handoff-saved') && handoff && (
        <div className="gate__handoff">
          <Banner
            tone="neutral"
            actions={
              <>
                <Button variant="primary" data-gate="next" onClick={handoff.onContinue}>
                  Weiter zu Schritt 1
                </Button>
                {prompt === 'handoff' && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onSaveBackup()
                      setPrompt('handoff-saved')
                      focusNext.current = '[data-gate="saved"]'
                    }}
                  >
                    Backup speichern
                  </Button>
                )}
              </>
            }
          >
            {handoff.status === 'writing' ? <ThinkingIndicator announce={false} label={HANDOFF_TEXT.writing} /> : HANDOFF_TEXT[handoff.status]}
            {prompt === 'handoff-saved' && (
              <span className="banner__note" data-gate="saved" tabIndex={-1}>
                Backup ist in deinen Downloads.
              </span>
            )}
          </Banner>
        </div>
      )}
      {prompt === 'saved' && (
        <p className="gate__lead" data-gate="saved" tabIndex={-1}>
          Backup ist in deinen Downloads.
        </p>
      )}

      {view.kind !== 'confirmed' &&
        (asking ? (
          <div className="gate__ask" role="group" aria-label="Trotzdem bestätigen?">
            <p>{warnConfirmText(warnings.length)}</p>
            <div className="gate__actions">
              <Button variant="primary" data-gate="confirm" onClick={confirm}>
                Bestätigen
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  setAsking(false)
                  focusNext.current = '[data-gate="primary"]'
                }}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        ) : (
          <div className="gate__actions">
            {checking ? (
              <Button
                variant="primary"
                data-gate="primary"
                busy={running}
                busyLabel="prüft …"
                disabledReason={chatBusy && !running ? 'Warte, bis die Antwort im Chat fertig ist.' : undefined}
                onClick={() => check(true)}
              >
                Prüfen und bestätigen
              </Button>
            ) : (
              <Button
                variant="primary"
                data-gate="primary"
                disabledReason={view.kind === 'blocked' ? blockingText(view.blocking.length) : undefined}
                onClick={() => (warnings.length ? ask() : confirm())}
              >
                Bestätigen
              </Button>
            )}
            {checking && !chatBusy && (
              <Button variant="text" busy={running} onClick={() => check(false)}>
                Nur prüfen
              </Button>
            )}
          </div>
        ))}
    </div>
  )
}

function Judged({ row, onGoToField }: { row: JudgedRow; onGoToField?: (target: FieldTarget) => void }) {
  const target = row.result === 'warn' ? row.target : undefined
  return (
    <li className={`gate__row gate__row--${row.result}`}>
      <StatusIcon status={row.result} size={18} />
      <span className="gate__text">
        <span className="gate__name">{row.name}</span>
        {row.confirmedAnyway && <span className="gate__anyway"> · trotzdem bestätigt</span>}
        <span className="gate__note">{row.note}</span>
      </span>
      {/* An app-judged ⚠ (step 0 completeness) leads to the first field still empty. */}
      {target && onGoToField && (
        <Button variant="text" className="gate__field" aria-label={`Zum Feld: ${row.note}`} onClick={() => onGoToField(target)}>
          Zum Feld
        </Button>
      )}
    </li>
  )
}
