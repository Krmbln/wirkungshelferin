import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { MAX_PASTE } from '../../ai/chat'
import type { StoredMessage } from '../../domain/schemas/project'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { PdfButton, type PdfControls } from './PdfImport'
import '../components/Field.css'

// Step 0's ways in (design §6.2, step 14): the start panel while the chat is empty, the paste
// form in place of the composer, and the app lines for turns the app sends on Lukas's behalf.

/**
 * The paste form's content lives in App, so it survives a step switch (not a reload).
 * `fromPdf`: the text came from a PDF that was only partly read (step 15); it is sent as a PDF source.
 */
export type PasteDraft = { label: string; text: string; fromPdf?: boolean }

export type PasteControls = {
  open: boolean
  draft: PasteDraft
  /** Above the fields, e.g. why a PDF's text came only in part (step 15). */
  note?: string
  /** Why it can't send now besides the form's own reasons, e.g. a PDF being read. */
  wait?: string
  onOpen: () => void
  onChange: (draft: PasteDraft) => void
  onCancel: () => void
  onSubmit: () => void
}

export function StartPanel({ onPaste, onInterview, pdf }: { onPaste: () => void; onInterview: () => void; pdf?: PdfControls }) {
  return (
    <div className="start">
      <p className="start__lead">Wie willst du anfangen?</p>
      {pdf && (
        <div className="start__option">
          <p>Antrag oder Konzept als PDF? Lade es hoch – die Wirkungshelferin liest den Text heraus.</p>
          <PdfButton pdf={pdf} variant="secondary">
            PDF hochladen
          </PdfButton>
        </div>
      )}
      <div className="start__option">
        <p>{pdf ? 'Oder als Text? Kopier ihn hier hinein.' : 'Du hast einen Antrag, ein Konzept oder einen Bericht? Kopier den Text hier hinein.'}</p>
        <Button variant="secondary" onClick={onPaste}>
          Text einfügen
        </Button>
      </div>
      <div className="start__option">
        <p>Nichts Schriftliches? Die Wirkungshelferin stellt dir ungefähr acht kurze Fragen.</p>
        <Button variant="secondary" onClick={onInterview}>
          Interview starten
        </Button>
      </div>
    </div>
  )
}

/** Why "Einfügen und senden" can't act now, or undefined when it can. */
export function pasteBlocked(draft: PasteDraft, busy: boolean, wait?: string): string | undefined {
  if (busy) return 'Warte, bis die Antwort im Chat fertig ist.'
  if (wait) return wait
  if (!draft.text.trim()) return 'Füge zuerst einen Text ein.'
  if (draft.text.trim().length > MAX_PASTE) return `Der Text ist zu lang. Füge den wichtigsten Teil ein (höchstens ${MAX_PASTE.toLocaleString('de-DE')} Zeichen).`
  return undefined
}

type FormProps = {
  draft: PasteDraft
  busy: boolean
  note?: string
  wait?: string
  onChange: (draft: PasteDraft) => void
  onCancel: () => void
  onSubmit: () => void
}

/** In place of the composer. Enter makes a new line, Cmd+Enter sends; Esc does nothing (a big paste must not vanish). */
export function PasteForm({ draft, busy, note, wait, onChange, onCancel, onSubmit }: FormProps) {
  const titleId = useId()
  const labelId = useId()
  const textId = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const blocked = pasteBlocked(draft, busy, wait)
  const chars = draft.text.trim().length

  useEffect(() => {
    area.current?.focus()
  }, [])

  function send() {
    if (!blocked) onSubmit()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && event.metaKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <form
      className="pform"
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <h2 id={titleId} className="pform__title">
        Text einfügen
      </h2>
      {note && <p className="pform__note">{note}</p>}
      <div className="pform__field">
        <label className="field__label" htmlFor={labelId}>
          Bezeichnung
        </label>
        <input id={labelId} className="field__control" placeholder="z. B. Antrag 2026" value={draft.label} onChange={(e) => onChange({ ...draft, label: e.target.value })} />
      </div>
      <div className="pform__field">
        <label className="field__label" htmlFor={textId}>
          Text
        </label>
        <textarea
          id={textId}
          ref={area}
          className="field__control pform__text"
          rows={8}
          value={draft.text}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          onKeyDown={onKeyDown}
        />
        <span className="pform__count">{chars.toLocaleString('de-DE')} Zeichen</span>
      </div>
      <div className="pform__actions">
        <Button type="submit" variant="secondary" disabledReason={blocked}>
          Einfügen und senden
        </Button>
        <Button variant="text" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

const ACT_ICON: Record<NonNullable<StoredMessage['act']>['kind'], IconName> = { paste: 'document', pdf: 'document', interview: 'speech', opening: 'statusOk' }

/** "Text eingefügt: „Antrag 2026“ · 12.300 Zeichen", "PDF gelesen: „Projektantrag“ · 34.500 Zeichen" */
export function actText(act: NonNullable<StoredMessage['act']>): string {
  const what = `„${act.label ?? ''}“ · ${(act.chars ?? 0).toLocaleString('de-DE')} Zeichen`
  if (act.kind === 'paste') return `Text eingefügt: ${what}`
  if (act.kind === 'pdf') return `PDF gelesen: ${what}`
  return act.kind === 'interview' ? 'Interview gestartet' : 'Schritt 0 bestätigt'
}

/** A turn the app sent for a button: not Lukas's bubble, he didn't write those words. */
export function AppLine({ act }: { act: NonNullable<StoredMessage['act']> }) {
  return (
    <li className="chat__divider chat__act">
      <span className="chat__divider-label">
        <span className="chat__act-text">
          <Icon name={ACT_ICON[act.kind]} size={16} />
          <span title={actText(act)}>{actText(act)}</span>
        </span>
      </span>
    </li>
  )
}
