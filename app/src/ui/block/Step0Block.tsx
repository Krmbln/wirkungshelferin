import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { FORM_LABELS, MAY_BE_EMPTY, OFFEN, formEmpty, formFields, isBlank, isOffen, leerFields, type FormName } from '../../domain/profile'
import type { Action } from '../../domain/reducer'
import type { Item, ItemOf } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import { PdfButton, type PdfControls } from '../chat/PdfImport'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import '../components/Chip.css'
import { PURPOSE } from '../proposals/describe'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, UndoLine } from './parts'
import { useRemovals, type Removal } from './useRemovals'

// Step 0: project profile, measurement frame, sources (PRD F3, design §6.2 "Step 14 design").
// The two forms use the form pattern: one field per row, label above, three states
// (filled / leer / "offen"). No "Warum?" in step 0.

type Source = ItemOf<0, 'sources'>

/** Texts that are lists (one entry per line); the others are single texts. */
const LISTS = new Set(['activities', 'statedGoals', 'otherOffers', 'openQuestions', 'requiredFigures', 'existingData'])
/** Long texts wrap onto several lines; short ones are one line. */
const MULTILINE = new Set(['projectBoundary', 'participants', 'team', 'requiredFormat'])

const PLACEHOLDERS: Record<FormName, Record<string, string>> = {
  profile: {
    name: 'Wie heißt das Projekt?',
    organisation: 'Welche Organisation steht dahinter?',
    projectBoundary: 'Welches Angebot betrachten wir – und welches nicht?',
    location: 'Art des Ortes, Stadtteil',
    activities: 'Was passiert, mit wem, wie oft? Eine pro Zeile',
    participants: 'Wer nimmt teil, wie kommen sie dazu, wie regelmäßig? Keine Namen',
    team: 'Wer trägt das Projekt – haupt-, ehrenamtlich, auf Honorar?',
    duration: 'Seit wann, bis wann?',
    funder: 'Wer finanziert es?',
    budgetRange: 'optional',
    statedGoals: 'In den Worten des Dokuments, eins pro Zeile',
    otherOffers: 'Was gibt es in der Nähe, was macht ihr anders?',
    openQuestions: 'Was ist noch unklar – und wer kann es klären?',
  },
  frame: {
    audience: 'Wer liest die Ergebnisse?',
    requiredFormat: 'Gibt es eine Vorgabe, wie der Nachweis aussehen muss?',
    requiredFigures: 'Welche Zahlen verlangt die Geldgeberin auf jeden Fall? Eine pro Zeile',
    existingData: 'Was schreibt ihr schon auf – und was zählt es genau? Eine pro Zeile',
  },
}

const sourceLabel = (s: Source) => s.label || 'Quelle ohne Namen'

/** "eingefügt am 08.11. · 12.300 Zeichen" */
export function sourceMeta(source: Source): string {
  const date = new Date(source.at)
  const day = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
  return `${source.origin === 'pdf' ? 'aus PDF' : 'eingefügt'} am ${day} · ${source.text.length.toLocaleString('de-DE')} Zeichen`
}

type Props = {
  project: Project
  onAction: (action: Action) => void
  /** "+ Text einfügen": opens the paste form in the chat column. */
  onPaste?: () => void
  /** "+ PDF hochladen" (step 15). */
  pdf?: PdfControls
}

export function Step0Block({ project, onAction, onPaste, pdf }: Props) {
  const block = project.steps[0].block
  const panel = useRef<HTMLDivElement>(null)
  const focusNext = useRef<string | null>(null)
  const [announce, setAnnounce] = useState('')

  const { removals, push, drop } = useRemovals((removal) => {
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (line?.contains(document.activeElement)) focusNext.current = '[data-add="sources"]'
  })

  // One try after the render the move was meant for (a target that never came must not steal focus later).
  useEffect(() => {
    if (!focusNext.current) return
    panel.current?.querySelector<HTMLElement>(focusNext.current)?.focus()
    focusNext.current = null
  })

  const edit = (collection: string, id: string, fields: Record<string, unknown>) =>
    onAction({ type: 'item/edit', step: 0, collection, id, fields })

  /** "als offen markieren": sets the value, says so, and moves on to the next field still leer. */
  function markOffen(form: FormName, field: string) {
    edit(form, form, { [field]: LISTS.has(field) ? [OFFEN] : OFFEN })
    setAnnounce(`${FORM_LABELS[form][field]}: offen`)
    const order = leerFields(block as never)
    const next = order[order.findIndex((f) => f.form === form && f.field === field) + 1]
    // The next field's button, or its text area while its section still hides the buttons;
    // after the last one, the next stop in the panel (the field itself would open for editing).
    const at = (f: { form: string; field: string }) => `[data-item-id="${f.form}"] [data-field="${f.field}"]`
    focusNext.current = next ? `${at(next)} .bform__mark, ${at(next)} textarea` : '[data-add="sources"]'
  }

  function removeSource(source: Source, index: number) {
    onAction({ type: 'item/remove', step: 0, collection: 'sources', id: source.id })
    push({ collection: 'sources', item: source as Item, index, label: sourceLabel(source) })
  }

  function undo(removal: Removal) {
    onAction({ type: 'item/restore', step: 0, collection: 'sources', item: removal.item, index: removal.index })
    drop(removal.key)
    focusNext.current = `[data-item-id="${removal.item.id}"] textarea`
  }

  const profileEmpty = formEmpty(block.profile as Item, 'profile')
  const sources = block.sources
  const lines = removals.filter((r) => !sources.some((s) => s.id === r.item.id))
  const rows = []
  for (let i = 0; i <= sources.length; i++) {
    for (const r of lines.filter((l) => Math.min(l.index, sources.length) === i))
      rows.push(
        <li key={`undo-${r.key}`} data-undo-key={r.key}>
          <UndoLine label={r.label} note="Der Chat kennt den Text weiter." onUndo={() => undo(r)} />
        </li>,
      )
    if (i < sources.length) {
      const s = sources[i]
      rows.push(
        <li key={s.id}>
          <SourceRow source={s} onLabel={(label) => edit('sources', s.id, { label })} onRemove={() => removeSource(s, i)} />
        </li>,
      )
    }
  }

  return (
    <div className="bpanel" ref={panel}>
      <p className="visually-hidden" role="status">
        {announce}
      </p>
      <Form form="profile" item={block.profile as Item} onEdit={(f) => edit('profile', 'profile', f)} onMarkOffen={(f) => markOffen('profile', f)}>
        {profileEmpty && (
          <p className="bform__lead">
            {pdf ? 'Lade links ein PDF hoch, füge einen Text ein' : 'Füge links einen Text ein'} oder lass dich interviewen – die Wirkungshelferin schlägt dann ein
            Profil vor. Du kannst auch selbst schreiben.
          </p>
        )}
      </Form>
      <Form form="frame" item={block.frame as Item} onEdit={(f) => edit('frame', 'frame', f)} onMarkOffen={(f) => markOffen('frame', f)} />
      <BlockSection
        title="Quellen"
        addText="Text einfügen"
        addLabel="Text einfügen"
        addKey="sources"
        onAdd={onPaste}
        empty={!rows.length}
        emptyHint={pdf ? 'Noch keine Quelle – lade deinen Antrag als PDF hoch oder füge einen Text ein.' : 'Noch keine Quelle – füge deinen Antrag oder ein Konzept als Text ein.'}
        actions={
          pdf && (
            <PdfButton pdf={pdf} variant="text" icon={<Icon name="plus" size={16} />}>
              PDF hochladen
            </PdfButton>
          )
        }
      >
        <ul className="blist">{rows}</ul>
      </BlockSection>
    </div>
  )
}

type FormProps = {
  form: FormName
  item: Item
  onEdit: (fields: Record<string, unknown>) => void
  onMarkOffen: (field: string) => void
  children?: ReactNode
}

/** One form singleton as a section: its fields in order, "von dir geändert" beside the heading. */
function Form({ form, item, onEdit, onMarkOffen, children }: FormProps) {
  // The buttons wait until the section has any content: before a draft they would invite marking everything.
  const empty = formEmpty(item, form)
  return (
    <BlockSection
      title={form === 'profile' ? 'Projektprofil' : 'Messrahmen'}
      meta={item.editedByUser && !empty ? <span className="bitem__edited bsection__meta">von dir geändert</span> : undefined}
    >
      {children}
      <div className="bitem bform" data-item-id={form}>
        {formFields(form).map((field) =>
          field === 'purpose' ? (
            <PurposeField key={field} value={item.purpose as string} onSave={(purpose) => onEdit({ purpose })} />
          ) : (
            <FormField
              key={field}
              form={form}
              field={field}
              value={item[field] as string | string[] | undefined}
              canMarkOffen={!empty && !MAY_BE_EMPTY[form].includes(field)}
              onSave={(value) => onEdit({ [field]: value })}
              onMarkOffen={() => onMarkOffen(field)}
            />
          ),
        )}
      </div>
    </BlockSection>
  )
}

type FieldProps = {
  form: FormName
  field: string
  value: string | string[] | undefined
  canMarkOffen: boolean
  onSave: (value: string | string[] | undefined) => void
  onMarkOffen: () => void
}

/**
 * One field in its three states (design §6.2, step 14): filled = the text; leer = the resting
 * look + "als offen markieren"; offen = the chip, which opens an empty text area on focus.
 * Leaving it empty keeps "offen"; Enter, blur and Esc save what was typed, as everywhere.
 */
function FormField({ form, field, value, canMarkOffen, onSave, onMarkOffen }: FieldProps) {
  const id = useId()
  const hint = useId()
  const box = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const list = LISTS.has(field)
  const label = FORM_LABELS[form][field]
  const offen = isOffen(value)
  const text = Array.isArray(value) ? value.join('\n') : (value ?? '')

  useEffect(() => {
    if (editing) box.current?.querySelector('textarea')?.focus()
  }, [editing])

  function save(next: string) {
    if (list) {
      const entries = next.split('\n').map((l) => l.trim()).filter(Boolean)
      if (entries.join('\n') !== text) onSave(entries)
    } else if (field === 'budgetRange') onSave(next || undefined)
    else onSave(next)
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false)
  }

  return (
    <div className="bform__field" data-field={field} ref={box} onBlur={onBlur}>
      <div className="bform__labels">
        <label className="bfield__label" htmlFor={id}>
          {label}
        </label>
        {canMarkOffen && isBlank(value) && (
          <Button variant="text" className="bform__mark" aria-label={`${label} als offen markieren`} onClick={onMarkOffen}>
            als offen markieren
          </Button>
        )}
      </div>
      {offen && !editing ? (
        // Tabbing or clicking in opens the text area at once (no separate edit mode to learn).
        <button type="button" id={id} className="bform__offen" onFocus={() => setEditing(true)} onClick={() => setEditing(true)}>
          <span className="offen-chip">offen</span>
          <span className="bform__unknown">noch unbekannt</span>
        </button>
      ) : (
        <InlineText
          id={id}
          multiline={list || MULTILINE.has(field)}
          value={offen ? '' : text}
          placeholder={PLACEHOLDERS[form][field]}
          describedBy={offen ? hint : undefined}
          onSave={save}
        />
      )}
      {offen && (
        <span id={hint} hidden>
          derzeit als offen markiert
        </span>
      )}
    </div>
  )
}

/** "Wofür?": a native radio group; its fourth option is "offen" (none chosen = leer). */
function PurposeField({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const name = useId()
  return (
    <fieldset className="bform__field bform__radios" data-field="purpose">
      <legend className="bfield__label">{FORM_LABELS.frame.purpose}</legend>
      <div className="bcontrols">
        {Object.entries(PURPOSE).map(([key, text]) => (
          <label key={key} className="bcontrol">
            <input type="radio" name={name} checked={value === key} onChange={() => onSave(key)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** A source: its label (editable), where it came from, and its text read-only behind a toggle. */
function SourceRow({ source, onLabel, onRemove }: { source: Source; onLabel: (label: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <BlockItem id={source.id} editedByUser={false} removeLabel={`Quelle „${sourceLabel(source)}“ entfernen`} onRemove={onRemove}>
      <InlineText strong value={source.label} label="Bezeichnung der Quelle" placeholder="Bezeichnung" onSave={(label) => label && onLabel(label)} />
      <p className="bsource__meta">{sourceMeta(source)}</p>
      <Button variant="text" className="bsource__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Text ansehen
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
      </Button>
      <div id={id} className="bsource__text" hidden={!open} tabIndex={0} aria-label={`Text von „${sourceLabel(source)}“`}>
        {source.text}
      </div>
    </BlockItem>
  )
}
