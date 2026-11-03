import { App } from './App'
import { ChromeGate } from './gate/ChromeGate'
import { isGoogleChrome, type NavigatorWithUAData } from './gate/isGoogleChrome'

// The gate decides before App mounts, so no data is loaded outside Chrome.
export function Root({ nav, appUrl }: { nav: NavigatorWithUAData; appUrl: string }) {
  return isGoogleChrome(nav) ? <App /> : <ChromeGate appUrl={appUrl} />
}
