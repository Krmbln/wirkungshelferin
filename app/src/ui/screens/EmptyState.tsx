import { useRef, useState, type ChangeEvent } from 'react'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Screen } from './Screen'
import './EmptyState.css'

type Props = {
  onNew: () => Promise<void> | void
  /** Returns a message when the file can't be used; nothing has changed then. */
  onLoadBackup: (file: File) => Promise<string | null>
  /** Gallery only: show a message from the start. */
  initialError?: string
}

// Empty state (design §6.1.4): no project yet, so there is nothing to navigate. Two equal
// options; both secondary, because neither is the "right" one.
export function EmptyState({ onNew, onLoadBackup, initialError }: Props) {
  const [error, setError] = useState<string | null>(initialError ?? null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset, so choosing the same file again fires another change.
    e.target.value = ''
    if (!file) return
    // The old message goes as soon as a new file is chosen.
    setError(null)
    setError(await onLoadBackup(file))
  }

  return (
    <Screen wide>
      <h1>Willkommen bei der Wirkungshelferin</h1>
      <p className="screen__lead">
        Hier kommst du in sieben Schritten von eurem Projekt zu einem Plan, wie ihr eure Wirkung messt.
      </p>
      <div className="empty__options">
        <section className="empty__option" aria-labelledby="empty-new">
          <p id="empty-new">Du fängst zum ersten Mal an.</p>
          <Button variant="secondary" onClick={onNew}>
            Neu starten
          </Button>
        </section>
        <section className="empty__option" aria-labelledby="empty-backup">
          <p id="empty-backup">Du hast schon gearbeitet und dein Backup als Datei gespeichert.</p>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            Backup laden
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onFile}
          />
        </section>
      </div>
      {error && (
        <div className="screen__message">
          <Banner tone="warn">{error}</Banner>
        </div>
      )}
    </Screen>
  )
}
