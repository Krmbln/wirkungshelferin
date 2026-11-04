import { useState } from 'react'
import type { Project } from '../../domain/schemas/project'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import type { LoadProblem } from '../../storage/load'
import { backupFileName, downloadJson } from '../../storage/backup'
import { useBackupFile } from '../backupFile'
import { Screen } from './Screen'

type Props = {
  problem: LoadProblem
  /** The stored document, untouched. */
  raw?: unknown
  /** Replaces the unreadable document with a backup (after the confirm dialog). */
  onUseBackup?: (project: Project) => Promise<void>
  reload?: () => void
}

const text: Record<LoadProblem, { title: string; lead: string }> = {
  invalid: {
    title: 'Deine Daten lassen sich nicht öffnen',
    lead: 'Sie sind noch in Chrome gespeichert, und die Wirkungshelferin verändert sie nicht. Sichere sie als Datei und gib sie der Person, die dir die Wirkungshelferin eingerichtet hat – oder mach danach mit einem Backup weiter.',
  },
  newer: {
    title: 'Deine Daten stammen von einer neueren Version',
    lead: 'Diese Seite ist noch die ältere Version der Wirkungshelferin. Lade sie neu, dann passt es wieder. Wenn das nicht hilft, beende Chrome und öffne es wieder. Deine Daten bleiben unverändert.',
  },
  storage: {
    title: 'Chrome lässt die Wirkungshelferin gerade nicht an ihre Daten',
    lead: 'Lade die Seite neu. Wenn das nicht hilft, beende Chrome und öffne es wieder.',
  },
}

// Load pipeline failed (tech design §8): a plain message, the stored data stays as it is.
export function LoadError({ problem, raw, onUseBackup, reload = () => window.location.reload() }: Props) {
  const { title, lead } = text[problem]

  return (
    <Screen>
      <h1>{title}</h1>
      <p className="screen__lead">{lead}</p>
      {problem === 'invalid' ? (
        <SaveAndReplace raw={raw} onUseBackup={onUseBackup} />
      ) : (
        <div className="screen__actions">
          <Button variant="secondary" onClick={reload}>
            Seite neu laden
          </Button>
        </div>
      )}
    </Screen>
  )
}

// Unreadable data: first save it as a file, then optionally go on with a backup instead.
// The stored data is replaced only after the confirm dialog (design §7.6).
function SaveAndReplace({ raw, onUseBackup }: Pick<Props, 'raw' | 'onUseBackup'>) {
  const [saved, setSaved] = useState(false)
  const backup = useBackupFile()

  return (
    <>
      <div className="screen__actions">
        <Button
          variant="secondary"
          onClick={() => {
            downloadJson(raw, backupFileName(new Date(), 'wirkungshelferin-daten'))
            setSaved(true)
          }}
        >
          Daten als Datei sichern
        </Button>
        {saved && (
          <p className="screen__hint" role="status">
            Gesichert in deinen Downloads.
          </p>
        )}
        {saved && onUseBackup && (
          <>
            <Button variant="text" onClick={backup.pick}>
              Mit einem Backup weitermachen
            </Button>
            {backup.input}
          </>
        )}
      </div>
      {backup.error && (
        <div className="screen__message">
          <Banner tone="warn">{backup.error}</Banner>
        </div>
      )}
      <Dialog
        open={backup.chosen !== null}
        title="Mit dem Backup weitermachen?"
        onClose={backup.cancel}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={backup.cancel}>
              Abbrechen
            </Button>
            <Button variant="primary" onClick={() => (backup.chosen ? onUseBackup?.(backup.chosen) : undefined)}>
              Backup laden
            </Button>
          </>
        }
      >
        <p>
          Das Backup ersetzt die Daten, die sich nicht öffnen ließen. Du hast sie gerade als Datei gesichert, dort bleiben sie
          erhalten.
        </p>
      </Dialog>
    </>
  )
}
