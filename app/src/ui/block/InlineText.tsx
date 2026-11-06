import { useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../components/Icon'

type Props = {
  value: string
  /** Called on Enter, blur or Esc when the text changed (design §6.2: all three save). */
  onSave: (value: string) => void
  /** Accessible name, unless a visible <label htmlFor={id}> names the field. */
  label?: string
  id?: string
  placeholder?: string
  /** Shift+Enter makes a new line; otherwise line breaks become spaces. */
  multiline?: boolean
  /** The row's main text (name, role): 600 weight. */
  strong?: boolean
  small?: boolean
  invalid?: boolean
  /** Gallery: show the hover look without a pointer. */
  forceState?: 'hover'
}

// An always-editable text area styled as plain text (design §6.2, step 11): no edit mode, so a
// click or Tab is all it takes. The draft is local while focused; the block's value is shown
// otherwise, so an applied proposal appears at once.
export function InlineText({ value, onSave, label, id, placeholder, multiline = false, strong, small, invalid, forceState }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  function save() {
    if (draft === null) return
    const text = multiline ? draft.replace(/\s+$/, '').replace(/^\s*\n/, '') : draft.replace(/\s*\n\s*/g, ' ').trim()
    setDraft(null)
    if (text !== value) onSave(text)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape' || (event.key === 'Enter' && !(multiline && event.shiftKey))) {
      event.preventDefault()
      ref.current?.blur()
    }
  }

  const classes = ['inline', strong && 'inline--strong', small && 'inline--small'].filter(Boolean).join(' ')
  return (
    <span className={classes} data-force-state={forceState}>
      <textarea
        ref={ref}
        id={id}
        className="inline__input"
        rows={1}
        value={draft ?? value}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        spellCheck
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
      />
      <span className="inline__pencil" aria-hidden="true">
        <Icon name="pencil" size={16} />
      </span>
    </span>
  )
}
