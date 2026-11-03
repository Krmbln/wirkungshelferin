import type { ReactNode } from 'react'

// The whole icon set (design §8): line style, 1.5 px stroke, no package.
// Status symbols are always these SVGs, never Unicode (macOS renders those as emoji).
const filled = { fill: 'currentColor', stroke: 'none' } as const

const shapes = {
  statusTodo: <circle cx="10" cy="10" r="7" />,
  statusProgress: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 0 0 14z" {...filled} />
    </>
  ),
  statusOk: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M6.6 10.2l2.3 2.3 4.5-4.8" />
    </>
  ),
  statusWarn: (
    <>
      <path d="M10 3.2l7.3 12.8H2.7z" />
      <path d="M10 8v3.4" />
      <circle cx="10" cy="13.6" r="0.9" {...filled} />
    </>
  ),
  statusBlock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M6.5 10h7" />
    </>
  ),
  send: <path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5" />,
  stop: <rect x="6" y="6" width="8" height="8" rx="1.5" {...filled} />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  copy: (
    <>
      <rect x="7" y="7" width="9" height="9" rx="1.5" />
      <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6.5h2.2M9.8 6.5H16M4 13.5h6.2M13.8 13.5H16" />
      <circle cx="8" cy="6.5" r="1.8" />
      <circle cx="12" cy="13.5" r="1.8" />
    </>
  ),
  backup: <path d="M10 3.5V12M6.5 8.5L10 12l3.5-3.5M4 12.5v2A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-2" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
  chevronDown: <path d="M5 8l5 5 5-5" />,
  pencil: <path d="M12.8 4.7l2.5 2.5L7.5 15l-3.2.7.7-3.2zM11.2 6.3l2.5 2.5" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof shapes
export const iconNames = Object.keys(shapes) as IconName[]

type Props = {
  name: IconName
  size?: number
  /** Accessible name. Without it the icon is decorative and hidden from screen readers. */
  label?: string
  className?: string
}

export function Icon({ name, size = 20, label, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {shapes[name]}
    </svg>
  )
}
