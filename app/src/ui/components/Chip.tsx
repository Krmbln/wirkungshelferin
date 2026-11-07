import './Chip.css'

// Change-type chip in proposal rows (design §6.2): fixed width, caps, border carries the type.
export type ChipKind = 'new' | 'change' | 'remove' | 'stale'

export const chipLabels: Record<ChipKind, string> = {
  new: 'Neu',
  change: 'Ändern',
  remove: 'Entfernen',
  stale: 'Veraltet',
}

export function Chip({ kind }: { kind: ChipKind }) {
  return <span className={`chip chip--${kind}`}>{chipLabels[kind]}</span>
}
