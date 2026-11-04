import { useState, type ReactNode } from 'react'
import { Banner } from '../ui/components/Banner'
import { Button, type ButtonVariant } from '../ui/components/Button'
import { Chip, type ChipKind } from '../ui/components/Chip'
import { Dialog } from '../ui/components/Dialog'
import { Icon, iconNames } from '../ui/components/Icon'
import { StatusIcon, statusLabel, type Status } from '../ui/components/StatusIcon'
import { ThinkingIndicator } from '../ui/components/ThinkingIndicator'
import { Tooltip } from '../ui/components/Tooltip'
import { App } from '../ui/App'
import { Sidebar } from '../ui/frame/Sidebar'
import { ChromeGate } from '../ui/gate/ChromeGate'
import { makeProject, makeProjectWithStatuses } from '../domain/fixtures'
import { backupProblemText } from '../storage/backup'
import { EmptyState } from '../ui/screens/EmptyState'
import { LoadError } from '../ui/screens/LoadError'
import { SecondTab } from '../ui/screens/SecondTab'
import { Skeleton } from '../ui/screens/Skeleton'
import { statusesOf } from '../ui/steps'
import './Gallery.css'

// Dev-only state gallery (implementation plan, standing rule 2). Every [data-state]
// figure is screenshotted by tests/gallery and reviewed against docs/design.md.

function State({ name, caption, children }: { name: string; caption: string; children: ReactNode }) {
  return (
    <figure className="gstate" data-state={name}>
      <div className="gstate__body">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gsection">
      <h2>{title}</h2>
      <div className="gsection__states">{children}</div>
    </section>
  )
}

const colours = [
  'bg',
  'surface',
  'surface-subtle',
  'line',
  'line-strong',
  'text',
  'text-muted',
  'accent',
  'accent-soft',
  'ok',
  'warn',
  'block',
]

const variants: { variant: ButtonVariant; label: string; name: string }[] = [
  { variant: 'primary', label: 'Prüfen und bestätigen', name: 'Primär' },
  { variant: 'secondary', label: 'Übernehmen', name: 'Sekundär' },
  { variant: 'text', label: 'Ablehnen', name: 'Text' },
]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Every status once, as after re-confirming step 1 (made-up state, no data).
const fresh = makeProject()
const mixed = makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'maybe_outdated', 3: 'in_progress' })

const noop = () => {}
const resolved = async () => {}

// The gallery's clock is pinned, so backup ages (sidebar, reminder) stay the same in every shot.
const galleryNow = new Date('2026-11-04T12:00:00')
const daysBefore = (days: number) => new Date(galleryNow.getTime() - days * 86_400_000).toISOString()
const backupDue = { ...mixed, lastBackupAt: daysBefore(9) }
const neverBackedUp = makeProject({ at: daysBefore(10) })
const backedUp = { ...mixed, lastBackupAt: daysBefore(3) }
const filledSettings = { apiKey: 'gallery-dummy-key-not-real-7f3a', model: 'claude-opus-5-5', effort: 'high' as const }
// The app's own text, so reviewed screenshots can't drift from it.
const backupError = backupProblemText.invalid

// Full-window screens at ?gallery&screen=<name>, screenshotted at the real viewport size.
export const screens: Record<string, { caption: string; render: () => ReactNode }> = {
  home: { caption: 'Übersicht, noch nichts begonnen', render: () => <App now={galleryNow} project={fresh} /> },
  'home-mixed': { caption: 'Übersicht, alle Status', render: () => <App now={galleryNow} project={mixed} /> },
  step: { caption: 'Arbeitsbereich Schritt 0', render: () => <App now={galleryNow} project={fresh} initialView={{ kind: 'step', step: 0 }} /> },
  'step-mixed': {
    caption: 'Arbeitsbereich Schritt 3, alle Status',
    render: () => <App now={galleryNow} project={mixed} initialView={{ kind: 'step', step: 3 }} />,
  },
  'home-backup-recent': { caption: 'Übersicht, Backup vor 3 Tagen', render: () => <App now={galleryNow} project={backedUp} /> },
  'home-backup-due': { caption: 'Übersicht, Backup 9 Tage alt (Erinnerung)', render: () => <BackupDue /> },
  'home-backup-never': {
    caption: 'Übersicht, nach 10 Tagen noch kein Backup',
    render: () => <App now={galleryNow} project={neverBackedUp} />,
  },
  settings: {
    caption: 'Einstellungen, noch kein Schlüssel',
    render: () => <App now={galleryNow} project={fresh} initialView={{ kind: 'settings' }} />,
  },
  'settings-filled': {
    caption: 'Einstellungen, Schlüssel gespeichert, vorherige Version vorhanden',
    render: () => (
      <App
        now={galleryNow}
        project={{ ...mixed, lastBackupAt: daysBefore(1) }}
        initialView={{ kind: 'settings' }}
        settings={filledSettings}
        onSettingsChange={resolved}
        previousVersion={0}
        onRestorePrevious={resolved}
      />
    ),
  },
  saved: { caption: '„Gespeichert“ im Kopf (2 s)', render: () => <App now={galleryNow} project={mixed} savedAt={Date.now()} /> },
  'save-failed': {
    caption: 'Speichern fehlgeschlagen',
    render: () => <App now={galleryNow} project={mixed} saveFailed onSaveBackup={noop} />,
  },
  'save-failed-step': {
    caption: 'Speichern fehlgeschlagen, im Arbeitsbereich',
    render: () => <App now={galleryNow} project={mixed} initialView={{ kind: 'step', step: 3 }} saveFailed onSaveBackup={noop} />,
  },
  skeleton: { caption: 'Laden (Skelett)', render: () => <Skeleton /> },
  empty: { caption: 'Noch kein Projekt', render: () => <EmptyState onNew={noop} onLoadBackup={async () => null} /> },
  'empty-error': {
    caption: 'Noch kein Projekt, Backup unbrauchbar',
    render: () => <EmptyState onNew={noop} onLoadBackup={async () => backupError} initialError={backupError} />,
  },
  'second-tab': { caption: 'Zweiter Tab', render: () => <SecondTab closeTab={async () => false} /> },
  'load-invalid': {
    caption: 'Daten lassen sich nicht öffnen',
    render: () => <LoadError problem="invalid" raw={{}} onUseBackup={async () => {}} />,
  },
  'load-newer': { caption: 'Daten von neuerer Version', render: () => <LoadError problem="newer" reload={noop} /> },
  'load-storage': { caption: 'Speicher nicht erreichbar', render: () => <LoadError problem="storage" reload={noop} /> },
}

// Like the Session: saving a backup records the time, so the reminder really goes.
function BackupDue() {
  const [project, setProject] = useState(backupDue)
  return <App now={galleryNow} project={project} onSaveBackup={() => setProject({ ...project, lastBackupAt: galleryNow.toISOString() })} />
}

export function Gallery({ appUrl }: { appUrl: string }) {
  const screen = new URLSearchParams(window.location.search).get('screen')
  if (screen && screens[screen]) return <>{screens[screen].render()}</>
  return <GalleryPage appUrl={appUrl} />
}

function GalleryPage({ appUrl }: { appUrl: string }) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="gallery">
      <header className="gallery__head">
        <h1>Zustandsgalerie</h1>
        <p>Nur in der Entwicklung sichtbar. Jede Komponente in jedem Zustand, geprüft gegen docs/design.md.</p>
      </header>

      <Section title="Farben">
        {colours.map((token) => (
          <State key={token} name={`colour-${token}`} caption={`--${token}`}>
            <span className={`gswatch gswatch--${token}`} />
          </State>
        ))}
      </Section>

      <Section title="Schrift">
        <State name="type-scale" caption="Source Sans 3 · 400 und 600">
          <div className="gtype">
            <p className="gtype__title">Schritt 2 · Problem und Ursachen</p>
            <p className="gtype__heading">Zielgruppen</p>
            <p>Kinder von 10 bis 13 Jahren aus dem Kiez, die nachmittags keinen festen Ort haben.</p>
            <p className="gtype__label">Übernehmen</p>
            <p className="gtype__small">Letzte Sitzung: 26.10.</p>
            <p className="tabular">Zielwert 120 · Basis 85 · 1.234</p>
          </div>
        </State>
      </Section>

      {variants.map(({ variant, label, name }) => (
        <Section key={variant} title={`Button · ${name}`}>
          <State name={`button-${variant}-rest`} caption="Ruhe">
            <Button variant={variant}>{label}</Button>
          </State>
          <State name={`button-${variant}-hover`} caption="Hover">
            <Button variant={variant} data-force-state="hover">
              {label}
            </Button>
          </State>
          <State name={`button-${variant}-pressed`} caption="Gedrückt">
            <Button variant={variant} data-force-state="pressed">
              {label}
            </Button>
          </State>
          <State name={`button-${variant}-busy`} caption="Beschäftigt">
            <Button variant={variant} busy busyLabel="prüft …">
              {label}
            </Button>
          </State>
          <State name={`button-${variant}-disabled`} caption="Deaktiviert, mit Grund">
            <Button variant={variant} disabledReason="Noch 2 Punkte blockieren das Bestätigen">
              {label}
            </Button>
          </State>
        </Section>
      ))}

      <Section title="Button · Varianten im Einsatz">
        <State name="button-with-icon" caption="Mit Icon">
          <Button variant="secondary" icon={<Icon name="backup" size={18} />}>
            Backup speichern
          </Button>
        </State>
        <State name="button-icon-only" caption="Senden (nur Icon, mit aria-label) · Stopp">
          <Button variant="primary" aria-label="Senden" className="btn--icon">
            <Icon name="send" />
          </Button>
          <Button variant="secondary" icon={<Icon name="stop" size={18} />}>
            Stopp
          </Button>
        </State>
        <State name="button-focus" caption="Fokus (Tastatur)">
          <Button variant="secondary" data-gallery-focus>
            Übernehmen
          </Button>
        </State>
        <State name="button-busy-live" caption="Zum Ausprobieren: zweimal klicken startet nur einen Lauf">
          <Button variant="primary" busyLabel="prüft …" onClick={() => wait(2000)}>
            Prüfen und bestätigen
          </Button>
        </State>
      </Section>

      <Section title="Icons">
        {iconNames.map((name) => (
          <State key={name} name={`icon-${name}`} caption={name}>
            <Icon name={name} />
          </State>
        ))}
      </Section>

      <Section title="Status">
        {(['todo', 'progress', 'done', 'stale', 'ok', 'warn', 'block'] as Status[]).map((status) => (
          <State key={status} name={`status-${status}`} caption={status}>
            <span className="gstatus">
              <StatusIcon status={status} />
              {statusLabel(status)}
            </span>
          </State>
        ))}
      </Section>

      <Section title="Chips">
        {(['new', 'change', 'remove', 'stale'] as ChipKind[]).map((kind) => (
          <State key={kind} name={`chip-${kind}`} caption={kind}>
            <Chip kind={kind} />
          </State>
        ))}
      </Section>

      <Section title="Banner">
        <div className="gwide">
          <State name="banner-block" caption="Blockierend · Speichern fehlgeschlagen">
            <Banner tone="block" actions={<Button variant="secondary">Backup speichern</Button>}>
              Speichern hat nicht geklappt – speichere jetzt ein Backup.
            </Banner>
          </State>
          <State name="banner-warn" caption="Warnung · vielleicht veraltet">
            <Banner tone="warn" actions={<Button variant="secondary">Prüfen lassen</Button>}>
              Ein früherer Schritt hat sich geändert. Lass die Wirkungshelferin prüfen, was das für diesen Schritt
              bedeutet.
            </Banner>
          </State>
          <State name="banner-neutral" caption="Neutral · nach dem Bestätigen">
            <Banner
              tone="neutral"
              actions={
                <>
                  <Button variant="secondary">Backup speichern</Button>
                  <Button variant="text">Später</Button>
                </>
              }
            >
              Schritt bestätigt. Jetzt Backup speichern?
            </Banner>
          </State>
        </div>
      </Section>

      <Section title="Tooltip">
        <State name="tooltip-term" caption="Begriff: Tab, Enter öffnet, Esc schließt">
          <p>
            Im nächsten Schritt baust du die{' '}
            <Tooltip content="Wie eure Aktivitäten Schritt für Schritt zu den Wirkungszielen führen sollen.">
              <span className="term">Wirkungslogik</span>
            </Tooltip>{' '}
            auf.
          </p>
        </State>
      </Section>

      <Section title="Dialog">
        <State name="dialog-trigger" caption="Nur für unumkehrbare Aktionen">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Dialog öffnen
          </Button>
          <Dialog
            open={dialogOpen}
            title="Backup laden?"
            onClose={() => setDialogOpen(false)}
            actions={
              <>
                <Button variant="secondary" data-autofocus onClick={() => setDialogOpen(false)}>
                  Abbrechen
                </Button>
                <Button variant="primary" onClick={() => setDialogOpen(false)}>
                  Backup laden
                </Button>
              </>
            }
          >
            <p>Das Backup vom 28.10. ersetzt deinen aktuellen Stand. Dein jetziger Stand geht dabei verloren.</p>
          </Dialog>
        </State>
      </Section>

      <Section title="Bewegung">
        <State name="thinking" caption="denkt nach … (statisch bei reduzierter Bewegung)">
          <ThinkingIndicator />
        </State>
      </Section>

      <Section title="App-Rahmen">
        <State name="sidebar-mixed" caption="Seitenleiste, Schritt 3 aktuell, alle Status">
          <div className="gframe gsidebar">
            <Sidebar
              view={{ kind: 'step', step: 3 }}
              statuses={statusesOf(mixed)}
              backup={{ days: 3, due: false }}
              onNavigate={() => {}}
            />
          </div>
        </State>
        <State name="sidebar-backup-due" caption="Seitenleiste, Backup 9 Tage alt">
          <div className="gframe gsidebar">
            <Sidebar view={{ kind: 'home' }} statuses={statusesOf(mixed)} backup={{ days: 9, due: true }} onNavigate={() => {}} />
          </div>
        </State>
        <State name="screen-links" caption="Ganze Bildschirme (volle Fenstergröße)">
          <ul className="gscreens">
            {Object.entries(screens).map(([name, { caption }]) => (
              <li key={name}>
                <a href={`?gallery&screen=${name}`}>{caption}</a>
              </li>
            ))}
          </ul>
        </State>
      </Section>

      <Section title="Sperrbildschirm">
        <div className="gwide">
          <State name="chrome-gate" caption="Nicht Chrome (design §6.4)">
            <div className="gframe">
              <ChromeGate appUrl={appUrl} />
            </div>
          </State>
        </div>
      </Section>
    </div>
  )
}
