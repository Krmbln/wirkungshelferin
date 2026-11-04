import { useRef, useState, type FormEvent } from 'react'
import { daysAgo, type BackupState } from '../../domain/backup'
import type { Project } from '../../domain/schemas/project'
import { DEFAULT_MODEL, efforts, keyProblem, maskKey, type Effort, type Settings as SettingsValue } from '../../storage/settings'
import { useBackupFile } from '../backupFile'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { Field, FieldError } from '../components/Field'
import { StatusIcon } from '../components/StatusIcon'
import './Settings.css'

export type SettingsProps = {
  settings: SettingsValue
  /** Saves at once; rejects when storage refuses, so the page can say so at the field. */
  onSettingsChange: (settings: SettingsValue) => Promise<void>
  backup: BackupState
  onSaveBackup: () => void
  /** Replaces the project with a loaded backup (after the confirm dialog). */
  onReplaceProject: (project: Project) => Promise<void>
  /** Version of the newest pre-migration copy; the restore section shows only then. */
  previousVersion?: number
  onRestorePrevious?: () => Promise<void>
}

const SAVE_FAILED = 'Speichern hat nicht geklappt. Versuch es noch einmal.'

export const effortLabel: Record<Effort, string> = {
  low: 'niedrig',
  medium: 'mittel (Standard)',
  high: 'hoch',
  xhigh: 'sehr hoch',
  max: 'maximal',
}

// Settings (design §6.3): a simple form page. Every change is saved at once; there is no
// "save all" button. The API key lives with the settings, never in the project or a backup.
export function Settings(props: SettingsProps) {
  return (
    <div className="page-body settings">
      <section className="settings__section" aria-labelledby="settings-claude">
        <h2 id="settings-claude">Verbindung zu Claude</h2>
        <ApiKey {...props} />
        <Model {...props} />
        <EffortSelect {...props} />
      </section>
      <BackupSection {...props} />
      {props.previousVersion !== undefined && props.onRestorePrevious && (
        <RestoreSection onRestorePrevious={props.onRestorePrevious} />
      )}
    </div>
  )
}

function ApiKey({ settings, onSettingsChange }: SettingsProps) {
  const stored = settings.apiKey
  const [editing, setEditing] = useState(!stored)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const shown = useRef<HTMLParagraphElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // Removed elsewhere (or from the dialog): go back to entering one.
  if (!stored && !editing) setEditing(true)

  async function save(e: FormEvent) {
    e.preventDefault()
    const key = draft.trim()
    const problem = keyProblem(key)
    if (problem) {
      setError(problem)
      input.current?.focus()
      return
    }
    try {
      await onSettingsChange({ ...settings, apiKey: key })
    } catch {
      setError(SAVE_FAILED)
      return
    }
    setDraft('')
    setError(null)
    setEditing(false)
    // The field goes away; focus lands on the saved key instead of <body>.
    requestAnimationFrame(() => shown.current?.focus())
  }

  async function remove() {
    const { apiKey: _, ...rest } = settings
    try {
      await onSettingsChange(rest)
    } catch {
      setError(SAVE_FAILED)
    }
    setConfirmRemove(false)
  }

  if (stored && !editing) {
    return (
      <div className="field">
        <p className="field__label">API-Schlüssel</p>
        <div className="settings__key">
          <p ref={shown} tabIndex={-1} className="settings__key-value tabular">
            <span aria-hidden="true">{maskKey(stored)}</span>
            <span className="visually-hidden">API-Schlüssel gespeichert, endet auf {stored.slice(-4)}</span>
          </p>
          <Button
            variant="text"
            onClick={() => {
              setEditing(true)
              requestAnimationFrame(() => input.current?.focus())
            }}
          >
            ändern
          </Button>
          <Button variant="text" onClick={() => setConfirmRemove(true)}>
            entfernen
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
        <p className="field__hint">Er bleibt nur in diesem Chrome und kommt nie in ein Backup.</p>
        <Dialog
          open={confirmRemove}
          title="API-Schlüssel entfernen?"
          onClose={() => setConfirmRemove(false)}
          actions={
            <>
              <Button variant="secondary" data-autofocus onClick={() => setConfirmRemove(false)}>
                Abbrechen
              </Button>
              <Button variant="primary" onClick={remove}>
                Entfernen
              </Button>
            </>
          }
        >
          <p>Ohne Schlüssel kann die Wirkungshelferin nicht mit Claude arbeiten. Danach musst du ihn neu eingeben.</p>
        </Dialog>
      </div>
    )
  }

  return (
    <form className="settings__key-form" onSubmit={save} noValidate>
      <Field
        label={stored ? 'Neuer API-Schlüssel' : 'API-Schlüssel'}
        error={error}
        hint="Er bleibt nur in diesem Chrome und kommt nie in ein Backup."
      >
        {(control) => (
          <div className="settings__row">
            <input
              {...control}
              ref={input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                // A new paste shouldn't look wrong before it is checked again.
                setError(null)
              }}
            />
            <Button type="submit" variant="secondary">
              Speichern
            </Button>
            {stored && (
              <Button
                variant="text"
                onClick={() => {
                  setDraft('')
                  setError(null)
                  setEditing(false)
                }}
              >
                Abbrechen
              </Button>
            )}
          </div>
        )}
      </Field>
    </form>
  )
}

// Saved on Enter and when the field is left, like block fields (design §6.2).
function Model({ settings, onSettingsChange }: SettingsProps) {
  const [draft, setDraft] = useState(settings.model)
  const [error, setError] = useState<string | null>(null)

  async function commit() {
    const model = draft.trim()
    if (model === '') {
      setError(`Gib ein Modell an. Standard ist ${DEFAULT_MODEL}.`)
      return
    }
    setDraft(model)
    if (model === settings.model) {
      setError(null)
      return
    }
    try {
      await onSettingsChange({ ...settings, model })
      setError(null)
    } catch {
      setError(SAVE_FAILED)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void commit()
      }}
      noValidate
    >
      <Field label="Modell" error={error} hint={`Standard: ${DEFAULT_MODEL}. Ändere das nur nach Absprache.`}>
        {(control) => (
          <input
            {...control}
            className={`${control.className} settings__narrow tabular`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
          />
        )}
      </Field>
    </form>
  )
}

function EffortSelect({ settings, onSettingsChange }: SettingsProps) {
  const [error, setError] = useState<string | null>(null)

  return (
    <Field
      label="Denktiefe"
      error={error}
      hint="Je höher, desto gründlicher denkt Claude nach – dafür dauert jede Antwort länger und kostet mehr."
    >
      {(control) => (
        <select
          {...control}
          className={`${control.className} settings__narrow`}
          value={settings.effort}
          onChange={async (e) => {
            try {
              await onSettingsChange({ ...settings, effort: e.target.value as Effort })
              setError(null)
            } catch {
              setError(SAVE_FAILED)
            }
          }}
        >
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effortLabel[effort]}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

function BackupSection({ backup, onSaveBackup, onReplaceProject }: SettingsProps) {
  const file = useBackupFile()
  const [note, setNote] = useState<string | null>(null)

  return (
    <section className="settings__section" aria-labelledby="settings-backup">
      <h2 id="settings-backup">Backup</h2>
      <p className="settings__status">
        {/* Overdue: the same ⚠ as in the sidebar and on home. */}
        {backup.due && (
          <span className="settings__status-icon" aria-hidden="true">
            <StatusIcon status="warn" tooltip={false} size={18} />
          </span>
        )}
        {backup.days === undefined ? 'Du hast noch kein Backup gespeichert.' : `Letztes Backup: ${daysAgo(backup.days)}`}
      </p>
      <p className="settings__muted">
        Ein Backup ist eine Datei mit deinem ganzen Projekt. Dein API-Schlüssel ist nicht darin.
      </p>
      <div className="settings__actions">
        <Button
          variant="secondary"
          onClick={() => {
            onSaveBackup()
            setNote('Backup ist in deinen Downloads.')
          }}
        >
          Backup speichern
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setNote(null)
            file.pick()
          }}
        >
          Backup laden
        </Button>
        {file.input}
        {/* In the row, so the live region exists before it has something to say. */}
        <p className="settings__muted" role="status">
          {note}
        </p>
      </div>
      {file.error && <Banner tone="warn">{file.error}</Banner>}
      <Dialog
        open={file.chosen !== null}
        title="Backup laden?"
        onClose={file.cancel}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={file.cancel}>
              Abbrechen
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!file.chosen) return
                await onReplaceProject(file.chosen)
                file.cancel()
                setNote('Backup geladen.')
              }}
            >
              Backup laden
            </Button>
          </>
        }
      >
        {file.chosen && (
          <p>
            Das Backup {backupDate(file.chosen)} ersetzt alles, was jetzt in der Wirkungshelferin steht. Wenn du den jetzigen
            Stand behalten willst, speichere vorher ein Backup.
          </p>
        )}
      </Dialog>
    </section>
  )
}

/** "vom 3. November 2026": when the file was saved, else when the project last changed. */
function backupDate(project: Project): string {
  const at = new Date(project.lastBackupAt ?? project.updatedAt)
  return `vom ${at.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

function RestoreSection({ onRestorePrevious }: { onRestorePrevious: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)

  return (
    <section className="settings__section" aria-labelledby="settings-previous">
      <h2 id="settings-previous">Vorherige Version</h2>
      <p className="settings__muted">
        Beim letzten Update der Wirkungshelferin wurden deine Daten umgewandelt. Wenn dabei etwas verloren gegangen ist,
        holst du hier den Stand von davor zurück.
      </p>
      <div className="settings__actions">
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Vorherige Version wiederherstellen
        </Button>
      </div>
      <Dialog
        open={confirm}
        title="Vorherige Version wiederherstellen?"
        onClose={() => setConfirm(false)}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirm(false)}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={onRestorePrevious}>
              Wiederherstellen
            </Button>
          </>
        }
      >
        <p>
          Deine Daten gehen zurück auf den Stand vor dem letzten Update. Was du seitdem geändert hast, geht verloren. Die Seite
          lädt danach neu.
        </p>
      </Dialog>
    </section>
  )
}
