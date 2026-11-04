import { Icon, type IconName } from './Icon'
import { Tooltip } from './Tooltip'
import './StatusIcon.css'

// Step status (design §5.2) and quality-check results (design §6.2), fixed mapping.
export type Status = 'todo' | 'progress' | 'done' | 'stale' | 'ok' | 'warn' | 'block'

const mapping: Record<Status, { icon: IconName; label: string; tone: string }> = {
  todo: { icon: 'statusTodo', label: 'noch nicht begonnen', tone: 'muted' },
  progress: { icon: 'statusProgress', label: 'in Arbeit', tone: 'muted' },
  done: { icon: 'statusOk', label: 'bestätigt', tone: 'ok' },
  stale: { icon: 'statusWarn', label: 'vielleicht veraltet', tone: 'warn' },
  ok: { icon: 'statusOk', label: 'erfüllt', tone: 'ok' },
  warn: { icon: 'statusWarn', label: 'offener Punkt', tone: 'warn' },
  block: { icon: 'statusBlock', label: 'blockiert das Bestätigen', tone: 'block' },
}

export const statusLabel = (status: Status) => mapping[status].label

type Props = {
  status: Status
  size?: number
  /** Show the label as a hover tooltip. Off where the word already sits next to the icon. */
  tooltip?: boolean
  /** Shows the tooltip without hover, e.g. while the parent row has keyboard focus. */
  tooltipOpen?: boolean
  tooltipSide?: 'below' | 'right'
}

export function StatusIcon({ status, size = 18, tooltip = true, tooltipOpen = false, tooltipSide }: Props) {
  const { icon, label, tone } = mapping[status]
  const svg = <Icon name={icon} size={size} label={label} className={`status-icon status-icon--${tone}`} />
  return tooltip ? (
    <Tooltip content={label} focusable={false} forceOpen={tooltipOpen} side={tooltipSide}>
      {svg}
    </Tooltip>
  ) : (
    svg
  )
}
