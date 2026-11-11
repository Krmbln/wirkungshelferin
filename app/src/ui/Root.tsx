import { idbStore, type Store } from '../storage/store'
import { ChromeGate } from './gate/ChromeGate'
import { FrameGate } from './gate/FrameGate'
import { isGoogleChrome, type NavigatorWithUAData } from './gate/isGoogleChrome'
import { Session } from './Session'

type Props = {
  nav: NavigatorWithUAData
  appUrl: string
  /** Tests pass an in-memory store; the app uses IndexedDB. */
  store?: Store
  /** True when another page embeds the app in a frame. */
  framed?: boolean
}

let defaultStore: Store | undefined

// The gates decide before Session mounts, so no data is loaded outside Chrome or inside a frame.
export function Root({ nav, appUrl, store, framed = window.top !== window.self }: Props) {
  if (!isGoogleChrome(nav)) return <ChromeGate appUrl={appUrl} />
  if (framed) return <FrameGate appUrl={appUrl} />
  return <Session store={store ?? (defaultStore ??= idbStore())} />
}
