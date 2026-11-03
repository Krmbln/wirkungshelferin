// Chrome only (tech design §11). Safari and Firefox have no userAgentData;
// Edge and Brave report Chromium brands but not "Google Chrome".
// Arc reports like Chrome and is tolerated.
interface UserAgentBrand {
  brand: string
  version: string
}

export interface NavigatorWithUAData {
  userAgentData?: { brands?: readonly UserAgentBrand[] }
}

export function isGoogleChrome(nav: NavigatorWithUAData): boolean {
  return nav.userAgentData?.brands?.some((b) => b.brand === 'Google Chrome') ?? false
}
