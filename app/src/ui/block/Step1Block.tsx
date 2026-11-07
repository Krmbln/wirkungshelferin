import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { isEmptyItem } from '../../domain/block'
import { groupContent } from '../../domain/groups'
import type { Action } from '../../domain/reducer'
import type { Item, ItemOf } from '../../domain/schemas/blocks'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { InlineText } from './InlineText'
import { BlockItem, BlockSection, UndoLine, WhyField } from './parts'
import type { Applied } from './BlockPanel'
import { useRemovals, type Removal } from './useRemovals'
import { scrollIntoView } from '../proposals/highlight'

// Step 1: challenge, target groups, stakeholders (PRD F5, design §6.2 "Step 11 build").

type TargetGroup = ItemOf<1, 'targetGroups'>
type Stakeholder = ItemOf<1, 'stakeholders'>
type ListName = 'targetGroups' | 'stakeholders'

const PREFIX: Record<ListName, string> = { targetGroups: 'tg', stakeholders: 'sh' }

const groupLabel = (g: TargetGroup) => g.name || 'Zielgruppe ohne Namen'
const stakeholderLabel = (s: Stakeholder) => s.role || 'Beteiligte ohne Rolle'

type Props = {
  project: Project
  onAction: (action: Action) => void
  /** Changes just applied from a proposal: a removal gets the undo line at its place. */
  applied?: Applied
}

export function Step1Block({ project, onAction, applied }: Props) {
  const block = project.steps[1].block
  const panel = useRef<HTMLDivElement>(null)
  // Where focus goes after the next render (a new row, a restored row, the add button).
  const focusNext = useRef<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  // The dialog stays mounted after closing, so the native close (and focus return) runs.
  const [confirming, setConfirming] = useState<TargetGroup | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const ask = (group: TargetGroup) => {
    setConfirming(group)
    setDialogOpen(true)
  }
  const closeDialog = () => setDialogOpen(false)

  const { removals, push, drop } = useRemovals((removal) => {
    // The undo line goes; focus that sat on it moves to the section instead of <body>.
    const line = panel.current?.querySelector(`[data-undo-key="${removal.key}"]`)
    if (line?.contains(document.activeElement)) focusNext.current = `[data-add="${removal.collection}"]`
  })

  // An applied ENTFERNEN shows its cause in the block too (design §7.2): the undo line at the
  // removed row's place, without taking focus from the card.
  const scrollNext = useRef<number | null>(null)
  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[1].proposals.find((p) => p.id === applied.proposalId)
    for (const id of applied.changeIds) {
      const change = proposal?.changes.find((c) => c.id === id)
      if (!proposal || change?.op !== 'remove' || change.state !== 'applied' || !change.undo?.before) continue
      const item = change.undo.before as Item
      const label = change.collection === 'targetGroups' ? groupLabel(item as TargetGroup) : stakeholderLabel(item as Stakeholder)
      const key = push({
        collection: change.collection,
        item,
        index: change.undo.index,
        label,
        undoAction: { type: 'change/undo', step: 1, proposalId: proposal.id, changeId: change.id },
      })
      scrollNext.current = key
    }
    // Only a new apply adds lines; later edits of the project don't.
  }, [applied?.n])

  useEffect(() => {
    if (scrollNext.current === null) return
    const line = panel.current?.querySelector(`[data-undo-key="${scrollNext.current}"]`)
    if (line) {
      scrollIntoView(line)
      scrollNext.current = null
    }
  })

  useEffect(() => {
    if (!focusNext.current) return
    const target = panel.current?.querySelector<HTMLElement>(focusNext.current)
    if (target) {
      target.focus()
      focusNext.current = null
    }
  })

  const edit = (collection: string, id: string, fields: Record<string, unknown>) =>
    onAction({ type: 'item/edit', step: 1, collection, id, fields })

  function add(collection: ListName) {
    const id = `${PREFIX[collection]}${(project.idCounters[PREFIX[collection]] ?? 0) + 1}`
    onAction({ type: 'item/add', step: 1, collection })
    setFresh(id)
    focusNext.current = `[data-item-id="${id}"] textarea`
  }

  function remove(collection: ListName, item: Item, index: number, label: string) {
    onAction({ type: 'item/remove', step: 1, collection, id: item.id })
    push({ collection, item, index, label })
  }

  function undo(removal: Removal) {
    onAction(removal.undoAction ?? { type: 'item/restore', step: 1, collection: removal.collection, item: removal.item, index: removal.index })
    drop(removal.key)
    focusNext.current = `[data-item-id="${removal.item.id}"] textarea`
  }

  const leave = (collection: ListName, id: string) =>
    fresh === id
      ? () => {
          onAction({ type: 'item/discard', step: 1, collection, id })
          setFresh(null)
        }
      : undefined

  /** The list's rows with the undo lines at the places their rows had. */
  function rows<T extends Item>(collection: ListName, items: T[], render: (item: T, index: number) => ReactNode) {
    // A line whose row is back (undone from the card) goes.
    const lines = removals.filter((r) => r.collection === collection && !items.some((i) => i.id === r.item.id))
    const out: ReactNode[] = []
    for (let i = 0; i <= items.length; i++) {
      for (const r of lines.filter((l) => Math.min(l.index, items.length) === i))
        out.push(
          <li key={`undo-${r.key}`} data-undo-key={r.key}>
            <UndoLine label={r.label} onUndo={() => undo(r)} focus={!r.undoAction} />
          </li>,
        )
      if (i < items.length) out.push(<li key={items[i].id}>{render(items[i], i)}</li>)
    }
    return { list: <ul className="blist">{out}</ul>, empty: !out.length }
  }

  const challenge = block.challenge
  const groups = rows('targetGroups', block.targetGroups, (g, index) => (
    <BlockItem
      id={g.id}
      editedByUser={g.editedByUser && !isEmptyItem(1, 'targetGroups', g)}
      removeLabel={`Zielgruppe „${groupLabel(g)}“ entfernen`}
      onRemove={() => {
        if (Object.keys(groupContent(project, g.id)).length) ask(g)
        else remove('targetGroups', g, index, groupLabel(g))
      }}
      onLeave={leave('targetGroups', g.id)}
    >
      <InlineText strong value={g.name} label="Name der Zielgruppe" placeholder="Name der Gruppe" onSave={(name) => edit('targetGroups', g.id, { name })} />
      <InlineText
        multiline
        value={g.description}
        label="Beschreibung der Zielgruppe"
        placeholder="Wer gehört dazu? Alter, Lebenslage, Zugang zum Projekt"
        onSave={(description) => edit('targetGroups', g.id, { description })}
      />
      <div className="bcontrols">
        <fieldset className="bcontrols__group">
          <legend className="visually-hidden">Wie erreicht ihr die Gruppe?</legend>
          {(['direct', 'indirect'] as const).map((reach) => (
            <label key={reach} className="bcontrol">
              <input type="radio" name={`reach-${g.id}`} checked={g.reach === reach} onChange={() => edit('targetGroups', g.id, { reach })} />
              {reach === 'direct' ? 'direkt' : 'indirekt'}
            </label>
          ))}
        </fieldset>
        <label className="bcontrol">
          <input type="checkbox" checked={g.isFocus} onChange={(e) => edit('targetGroups', g.id, { isFocus: e.target.checked })} />
          Fokusgruppe
        </label>
        <SizeField value={g.sizeEstimate ?? ''} onSave={(size) => edit('targetGroups', g.id, { sizeEstimate: size || undefined })} />
      </div>
      <WhyField value={g.why ?? ''} onSave={(why) => edit('targetGroups', g.id, { why })} />
    </BlockItem>
  ))
  const stakeholders = rows('stakeholders', block.stakeholders, (s, index) => (
    <BlockItem
      id={s.id}
      editedByUser={s.editedByUser && !isEmptyItem(1, 'stakeholders', s)}
      removeLabel={`Beteiligte „${stakeholderLabel(s)}“ entfernen`}
      onRemove={() => remove('stakeholders', s, index, stakeholderLabel(s))}
      onLeave={leave('stakeholders', s.id)}
    >
      <InlineText strong value={s.role} label="Rolle" placeholder="Wer? Zum Beispiel Schule, Eltern, Geldgeberin" onSave={(role) => edit('stakeholders', s.id, { role })} />
      <ListField
        label="Erwartungen"
        values={s.expectations}
        placeholder="Was erwarten sie? Eine pro Zeile, neue Zeile mit Shift+Enter"
        onSave={(expectations) => edit('stakeholders', s.id, { expectations })}
      />
    </BlockItem>
  ))

  return (
    <div className="bpanel" ref={panel}>
      <BlockSection title="Herausforderung">
        <BlockItem id={challenge.id} editedByUser={challenge.editedByUser}>
          <InlineText
            value={challenge.text}
            label="Herausforderung"
            placeholder="In einem Satz: Welche Herausforderung geht ihr an?"
            onSave={(text) => edit('challenge', challenge.id, { text })}
          />
          <WhyField value={challenge.why ?? ''} onSave={(why) => edit('challenge', challenge.id, { why })} />
        </BlockItem>
      </BlockSection>

      <BlockSection
        title="Zielgruppen"
        onAdd={() => add('targetGroups')}
        addLabel="Zielgruppe hinzufügen"
        addKey="targetGroups"
        empty={groups.empty}
        emptyHint="Noch leer – erzähl der Wirkungshelferin, für wen euer Angebot da ist."
      >
        {groups.list}
      </BlockSection>

      <BlockSection
        title="Beteiligte"
        onAdd={() => add('stakeholders')}
        addLabel="Beteiligte hinzufügen"
        addKey="stakeholders"
        empty={stakeholders.empty}
        emptyHint="Noch leer – wer hat mit eurem Angebot zu tun oder redet mit?"
      >
        {stakeholders.list}
      </BlockSection>

      {confirming && (
        <RemoveGroupDialog
          open={dialogOpen}
          group={confirming}
          content={groupContent(project, confirming.id)}
          onCancel={closeDialog}
          onUnmark={() => {
            edit('targetGroups', confirming.id, { isFocus: false })
            closeDialog()
          }}
          onDelete={() => {
            onAction({ type: 'targetGroup/delete', id: confirming.id })
            closeDialog()
            focusNext.current = '[data-add="targetGroups"]'
          }}
        />
      )}
    </div>
  )
}

/** Optional size: placeholder while empty, a visible "Größe:" once it has a value. */
function SizeField({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const id = useId()
  return (
    <span className="bsize">
      {value && (
        <label className="bsize__label" htmlFor={id}>
          Größe:
        </label>
      )}
      <InlineText small id={id} value={value} label="Größe der Zielgruppe" placeholder="Größe (optional)" onSave={onSave} />
    </span>
  )
}

/** A list of short texts edited as one field, one entry per line (design §6.2, step 11). */
function ListField({ label, values, placeholder, onSave }: { label: string; values: string[]; placeholder: string; onSave: (values: string[]) => void }) {
  const id = useId()
  return (
    <div className="bfield">
      <label className="bfield__label" htmlFor={id}>
        {label}
      </label>
      <InlineText
        id={id}
        multiline
        value={values.join('\n')}
        placeholder={placeholder}
        onSave={(text) => {
          const next = text.split('\n').map((line) => line.trim()).filter(Boolean)
          if (next.join('\n') !== values.join('\n')) onSave(next)
        }}
      />
    </div>
  )
}

/** "In Schritt 2 und 3 gibt es schon 5 Einträge zu dieser Gruppe." */
export function contentText(content: Partial<Record<StepId, number>>): string {
  const steps = Object.keys(content)
  if (!steps.length) return ''
  const total = Object.values(content).reduce((sum, n) => sum + (n ?? 0), 0)
  const where = steps.length === 1 ? steps[0] : `${steps.slice(0, -1).join(', ')} und ${steps.at(-1)}`
  return `In Schritt ${where} gibt es schon ${total === 1 ? 'einen Eintrag' : `${total} Einträge`} zu dieser Gruppe.`
}

type DialogProps = {
  open: boolean
  group: TargetGroup
  content: Partial<Record<StepId, number>>
  onCancel: () => void
  onUnmark: () => void
  onDelete: () => void
}

// PRD F5: the default is to un-mark the focus group and keep its content; a hard delete
// removes its step 2–4 items. No 10-second undo after it: this dialog is the safety net.
function RemoveGroupDialog({ open, group, content, onCancel, onUnmark, onDelete }: DialogProps) {
  return (
    <Dialog
      open={open}
      stacked={group.isFocus}
      title={`Zielgruppe „${groupLabel(group)}“ entfernen?`}
      onClose={onCancel}
      actions={
        <>
          <Button variant="secondary" data-autofocus onClick={onCancel}>
            Abbrechen
          </Button>
          {group.isFocus && (
            <Button variant="primary" onClick={onUnmark}>
              Nur als Fokusgruppe abwählen
            </Button>
          )}
          <Button variant={group.isFocus ? 'secondary' : 'primary'} onClick={onDelete}>
            Endgültig löschen
          </Button>
        </>
      }
    >
      <p>
        {contentText(content)}{' '}
        {group.isFocus && 'Wenn du sie nur als Fokusgruppe abwählst, bleiben diese Einträge erhalten. '}
        „Endgültig löschen“ entfernt sie mit, das lässt sich nicht rückgängig machen.
      </p>
    </Dialog>
  )
}
