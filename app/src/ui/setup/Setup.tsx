import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ConnectionResult } from '../../ai/client'
import { problemText } from '../../ai/errors'
import type { Project } from '../../domain/schemas/project'
import { keyProblem, type Settings } from '../../storage/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Field, FieldError } from '../components/Field'
import { KeyInput } from '../components/KeyInput'
import { StatusIcon, type Status } from '../components/StatusIcon'
import { Screen } from '../screens/Screen'
import { setupPlan, setupStepTitle, type SetupStep } from './plan'
import './Setup.css'

export type SetupProps = {
  project: Project
  settings: Settings
  /** Result of navigator.storage.persist(); undefined = not known (yet). */
  persisted?: boolean
  /** Saves at once; rejects when storage refuses. */
  onSettingsChange: (settings: Settings) => Promise<void>
  /** Tests these settings (key, model, effort) against the API. */
  testConnection: (settings: Settings) => Promise<ConnectionResult>
  onPrivacySeen: () => void
  onSaveBackup: () => void
  /** Gallery only: open on this screen, with this test result. */
  initial?: { step?: SetupStep; keyResult?: ConnectionResult }
}

const SAVE_FAILED = 'Speichern hat nicht geklappt. Versuch es noch einmal.'
const KEY_HINT = 'Er bleibt nur in diesem Chrome und kommt nie in ein Backup.'
const count = ['', 'Eine Sache', 'Zwei Dinge', 'Drei Dinge']

// First start in a Chrome (design §6.3): one screen per step, "Weiter" as the only primary
// button. Ends by recording setupDone in the settings, so the app opens on home.
export function Setup(props: SetupProps) {
  const { project, settings, onSettingsChange, initial } = props
  // Fixed at the start: the checklist must not shrink while Lukas works through it.
  const [plan] = useState(() => setupPlan(project))
  const [index, setIndex] = useState(() => Math.max(0, plan.indexOf(initial?.step ?? plan[0])))
  const [keyOk, setKeyOk] = useState(initial?.keyResult?.ok ?? false)
  const [doneError, setDoneError] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  const step = plan[index]
  const last = index === plan.length - 1

  // A new screen replaces the old one, so focus would fall to <body>.
  useEffect(() => {
    if (moved.current) heading.current?.focus()
  }, [index])

  async function next() {
    if (step === 'privacy') props.onPrivacySeen()
    if (!last) {
      moved.current = true
      setIndex(index + 1)
      return
    }
    try {
      await onSettingsChange({ ...settings, setupDone: true })
    } catch {
      setDoneError(true)
    }
  }

  const blocked =
    step === 'key' && !keyOk
      ? 'Teste zuerst die Verbindung.'
      : step === 'backup' && !project.lastBackupAt
        ? 'Speichere zuerst das Backup.'
        : undefined

  const h1 = (text: string) => (
    <h1 ref={heading} tabIndex={-1}>
      {text}
    </h1>
  )

  let body: ReactNode
  if (step === 'welcome') body = <Welcome h1={h1} plan={plan} />
  else if (step === 'key') body = <KeyStep {...props} h1={h1} alone={plan.length === 1} onResult={setKeyOk} />
  else if (step === 'privacy') body = <Privacy h1={h1} />
  else body = <BackupStep {...props} h1={h1} />

  return (
    <Screen>
      {step !== 'welcome' && <Checklist plan={plan} current={step} />}
      {body}
      <div className="setup__next">
        <Button variant="primary" disabledReason={blocked} onClick={next}>
          {last ? 'Fertig' : 'Weiter'}
        </Button>
      </div>
      {doneError && <Banner tone="block">{SAVE_FAILED}</Banner>}
    </Screen>
  )
}

type H1 = { h1: (text: string) => ReactNode }

/** Steps after the welcome screen; a single step needs no checklist. */
function Checklist({ plan, current }: { plan: SetupStep[]; current: SetupStep }) {
  const steps = plan.filter((s) => s !== 'welcome')
  if (steps.length < 2) return null
  const at = steps.indexOf(current as Exclude<SetupStep, 'welcome'>)
  return (
    <ol className="setup__checklist" aria-label="Einrichtung">
      {steps.map((s, i) => {
        const status: Status = i < at ? 'done' : i === at ? 'progress' : 'todo'
        return (
          <li key={s} className={`setup__check setup__check--${status}`} aria-current={i === at ? 'step' : undefined}>
            <span className="setup__check-icon" aria-hidden="true">
              <StatusIcon status={status} tooltip={false} size={16} />
            </span>
            {setupStepTitle[s as Exclude<SetupStep, 'welcome'>]}
            {i < at && <span className="visually-hidden"> (erledigt)</span>}
          </li>
        )
      })}
    </ol>
  )
}

const intro: Record<Exclude<SetupStep, 'welcome'>, string> = {
  key: 'Du fügst den API-Schlüssel ein und testest, ob Claude antwortet.',
  privacy: 'Was du in die Wirkungshelferin schreiben darfst und was nicht.',
  backup: 'Du speicherst dein Projekt einmal als Datei.',
}

function Welcome({ h1, plan }: H1 & { plan: SetupStep[] }) {
  const steps = plan.filter((s): s is Exclude<SetupStep, 'welcome'> => s !== 'welcome')
  return (
    <>
      {h1('Bevor es losgeht')}
      <p className="screen__lead">{count[steps.length]} richtest du einmal ein, dann kann es losgehen.</p>
      <ol className="setup__intro">
        {steps.map((s) => (
          <li key={s}>
            <span className="setup__intro-title">{setupStepTitle[s]}</span>
            <span className="setup__intro-text">{intro[s]}</span>
          </li>
        ))}
      </ol>
    </>
  )
}

type Result = { ok: boolean; error?: string; field?: boolean }

/** Only a problem with the key itself marks the field; offline, busy etc. aren't the key's fault. */
function failure(result: ConnectionResult, model: string): Result {
  if (result.ok) return { ok: true }
  return { ok: false, error: problemText(result.problem, model, 'setup'), field: result.problem === 'key' }
}

function KeyStep({
  settings,
  onSettingsChange,
  testConnection,
  initial,
  h1,
  alone,
  onResult,
}: SetupProps & H1 & { alone: boolean; onResult: (ok: boolean) => void }) {
  const [draft, setDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<Result>(() => (initial?.keyResult ? failure(initial.keyResult, settings.model) : { ok: false }))
  const input = useRef<HTMLInputElement>(null)
  const { ok, error } = result

  function show(next: Result) {
    setResult(next)
    onResult(next.ok)
  }

  async function test(e: FormEvent) {
    e.preventDefault()
    if (testing) return
    const typed = draft.trim()
    // A key saved before (setup left half-way) can be tested without pasting it again.
    const key = typed || settings.apiKey || ''
    const problem = typed || !settings.apiKey ? keyProblem(typed) : null
    if (problem) {
      show({ ok: false, error: problem, field: true })
      input.current?.focus()
      return
    }
    const candidate = { ...settings, apiKey: key }
    setTesting(true)
    show({ ok: false })
    const tested = await testConnection(candidate)
    if (!tested.ok) {
      setTesting(false)
      show(failure(tested, settings.model))
      return
    }
    try {
      if (key !== settings.apiKey) await onSettingsChange(candidate)
    } catch {
      setTesting(false)
      show({ ok: false, error: SAVE_FAILED })
      return
    }
    setTesting(false)
    show({ ok: true })
  }

  const hint =
    settings.apiKey && !draft
      ? `Gespeichert ist ein Schlüssel, der auf ${settings.apiKey.slice(-4)} endet. Teste ihn oder füg einen neuen ein. ${KEY_HINT}`
      : KEY_HINT

  return (
    <>
      {h1('Verbindung zu Claude')}
      <p className="screen__lead">
        {/* After "Backup laden" in a new Chrome: say why the project isn't open yet. */}
        {alone && 'Dein Projekt ist geladen. In diesem Chrome fehlt nur noch der API-Schlüssel. '}
        Die Wirkungshelferin arbeitet mit Claude, einer KI von Anthropic. Füg den API-Schlüssel ein, den du von Karim bekommen
        hast, und teste die Verbindung.
      </p>
      <form className="setup__form" onSubmit={test} noValidate>
        <Field label="API-Schlüssel" error={result.field ? error : null} hint={hint}>
          {(control) => (
            <div className="setup__row">
              <KeyInput
                {...control}
                ref={input}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  // A new key is untested; an old message would be about the old one.
                  if (ok || error) show({ ok: false })
                }}
              />
              <Button type="submit" variant="secondary" busy={testing} busyLabel="Teste …">
                Verbindung testen
              </Button>
            </div>
          )}
        </Field>
      </form>
      {/* Mounted from the start, so the success is announced. */}
      <p className="setup__result" role="status">
        {ok && (
          <>
            <span className="setup__result-icon" aria-hidden="true">
              <StatusIcon status="ok" tooltip={false} size={18} />
            </span>
            Verbindung erfolgreich. Der Schlüssel ist gespeichert.
          </>
        )}
      </p>
      {error && !result.field && (
        <div className="setup__problem">
          <FieldError>{error}</FieldError>
        </div>
      )}
    </>
  )
}

function Privacy({ h1 }: H1) {
  return (
    <>
      {h1('Datenschutz')}
      <p className="screen__lead">
        Was du in die Wirkungshelferin schreibst oder hochlädst, geht an Claude, damit Claude dir antworten kann. Dein Projekt
        selbst liegt nur in diesem Chrome.
      </p>
      <ul className="setup__rules">
        <li>Schreib keine Namen von Teilnehmenden, auch nicht von Eltern oder Ehrenamtlichen.</li>
        <li>Lass andere persönliche Daten weg, zum Beispiel Adressen, Geburtstage oder Angaben zur Gesundheit.</li>
        <li>Beschreib Gruppen statt einzelner Menschen, zum Beispiel „Jugendliche zwischen 12 und 16“.</li>
        <li>Schau Dokumente vor dem Hochladen auf Namen durch.</li>
      </ul>
    </>
  )
}

function BackupStep({ project, persisted, onSaveBackup, h1 }: SetupProps & H1) {
  const saved = Boolean(project.lastBackupAt)
  return (
    <>
      {h1('Erstes Backup')}
      <p className="screen__lead">
        Ein Backup ist eine Datei mit deinem ganzen Projekt. Damit holst du alles zurück, falls Chrome deine Daten einmal
        löscht. Dein API-Schlüssel ist nicht darin.
      </p>
      {persisted === false && (
        <div className="setup__note">
          <Banner tone="warn">
            Chrome kann deine Daten löschen, wenn der Speicher knapp wird. Setz ein Lesezeichen für die Wirkungshelferin
            (Cmd+D), dann behält Chrome sie eher. Bis dahin schützt dich das Backup.
          </Banner>
        </div>
      )}
      <div className="setup__actions">
        {/* The only thing to do here, so primary until it's done; then "Fertig" takes over. */}
        <Button variant={saved ? 'secondary' : 'primary'} onClick={onSaveBackup}>
          Backup speichern
        </Button>
        <p className="setup__muted" role="status">
          {saved ? 'Backup ist in deinen Downloads.' : null}
        </p>
      </div>
      {persisted === true && (
        <p className="setup__result">
          <span className="setup__result-icon" aria-hidden="true">
            <StatusIcon status="ok" tooltip={false} size={18} />
          </span>
          Chrome hebt deine Daten dauerhaft auf.
        </p>
      )}
    </>
  )
}
