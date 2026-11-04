import type { ReactNode } from 'react'
import './Screen.css'

// Centred single column without app chrome (design §6.3, §6.4): Chrome gate, second tab,
// load error, empty state.
export function Screen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <main className={wide ? 'screen screen--wide' : 'screen'}>{children}</main>
}
