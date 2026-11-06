import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'
import './Dialog.css'

type Props = {
  open: boolean
  title: string
  children: ReactNode
  /** Buttons at the bottom. The safe choice ("Abbrechen") comes first and carries
   *  data-autofocus, so Enter never confirms a destructive action by accident. */
  actions: ReactNode
  onClose: () => void
  /** Three actions don't fit side by side in 480 px: full width, one per line. */
  stacked?: boolean
}

// Only for destructive or irreversible actions (design §5.2, §7.6). Native <dialog>:
// focus trap, Esc and the backdrop come from the browser.
export function Dialog({ open, title, children, actions, onClose, stacked = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc: let React state decide, so the dialog never closes behind its back.
        e.preventDefault()
        onClose()
      }}
    >
      <div className="dialog__head">
        <h2 id={titleId}>{title}</h2>
        <Button variant="text" className="btn--icon dialog__close" aria-label="Schließen" onClick={onClose}>
          <Icon name="close" />
        </Button>
      </div>
      <div className="dialog__body">{children}</div>
      <div className={stacked ? 'dialog__actions dialog__actions--stacked' : 'dialog__actions'}>{actions}</div>
    </dialog>
  )
}
