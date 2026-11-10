import type { ReactNode } from 'react'
import { StatusIcon } from './StatusIcon'
import './Banner.css'

export type BannerTone = 'warn' | 'block' | 'neutral'

type Props = {
  tone: BannerTone
  children: ReactNode
  /** Buttons on the right, e.g. [Backup speichern]. */
  actions?: ReactNode
  /** false: a standing notice, not announced on every visit (no live role). */
  live?: boolean
}

// Status tint + 1 px border; text stays --text, the colour sits on icon and border (design §3).
export function Banner({ tone, children, actions, live = true }: Props) {
  return (
    <div className={`banner banner--${tone}`} role={live ? (tone === 'block' ? 'alert' : 'status') : undefined}>
      {tone !== 'neutral' && <StatusIcon status={tone} tooltip={false} size={20} />}
      <div className="banner__text">{children}</div>
      {actions && <div className="banner__actions">{actions}</div>}
    </div>
  )
}
