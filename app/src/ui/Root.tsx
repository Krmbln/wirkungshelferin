import { idbStore, type Store } from '../storage/store'
import { ChromeGate } from './gate/ChromeGate'
import { isGoogleChrome, type NavigatorWithUAData } from './gate/isGoogleChrome'
import { Session } from './Session'

type Props = {
  nav: NavigatorWithUAData
  appUrl: string
  /** Tests pass an in-memory store; the app uses IndexedDB. */
  store?: Store
}

let defaultStore: Store | undefined

// The gate decides before Session mounts, so no data is loaded outside Chrome.
export function Root({ nav, appUrl, store }: Props) {
  if (!isGoogleChrome(nav)) return <ChromeGate appUrl={appUrl} />
  return <Session store={store ?? (defaultStore ??= idbStore())} />
}
