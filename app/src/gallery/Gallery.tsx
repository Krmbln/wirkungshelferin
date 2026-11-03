import { useState, type ReactNode } from 'react'
import { Banner } from '../ui/components/Banner'
import { Button, type ButtonVariant } from '../ui/components/Button'
import { Chip, type ChipKind } from '../ui/components/Chip'
import { Dialog } from '../ui/components/Dialog'
import { Icon, iconNames } from '../ui/components/Icon'
import { StatusIcon, statusLabel, type Status } from '../ui/components/StatusIcon'
import { ThinkingIndicator } from '../ui/components/ThinkingIndicator'
import { Tooltip } from '../ui/components/Tooltip'
import { ChromeGate } from '../ui/gate/ChromeGate'
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

export function Gallery({ appUrl }: { appUrl: string }) {
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
