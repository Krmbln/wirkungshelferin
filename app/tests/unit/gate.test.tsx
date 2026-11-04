import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isGoogleChrome, type NavigatorWithUAData } from '../../src/ui/gate/isGoogleChrome'
import { Root } from '../../src/ui/Root'

const brands = (...names: string[]) => names.map((brand) => ({ brand, version: '142' }))

const browsers: Record<string, NavigatorWithUAData> = {
  safari: {},
  firefox: { userAgentData: undefined },
  edge: { userAgentData: { brands: brands('Not_A Brand', 'Chromium', 'Microsoft Edge') } },
  brave: { userAgentData: { brands: brands('Brave', 'Chromium', 'Not_A Brand') } },
  chromium: { userAgentData: { brands: brands('Chromium', 'Not_A Brand') } },
  noBrands: { userAgentData: {} },
  chrome: { userAgentData: { brands: brands('Google Chrome', 'Chromium', 'Not_A Brand') } },
}

const APP_URL = 'https://krmbln.github.io/wirkungshelferin/'

describe('isGoogleChrome', () => {
  it.each(['safari', 'firefox', 'edge', 'brave', 'chromium', 'noBrands'])('blocks %s', (name) => {
    expect(isGoogleChrome(browsers[name])).toBe(false)
  })

  it('allows Google Chrome', () => {
    expect(isGoogleChrome(browsers.chrome)).toBe(true)
  })
})

describe('Root', () => {
  it('shows the gate with the app link outside Chrome', () => {
    render(<Root nav={browsers.safari} appUrl={APP_URL} />)
    expect(screen.getByRole('heading', { name: 'Bitte öffne die Wirkungshelferin in Chrome' })).toBeTruthy()
    expect(screen.getByText(APP_URL)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('shows the app in Chrome', () => {
    render(<Root nav={browsers.chrome} appUrl={APP_URL} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    expect(screen.queryByText(/Bitte öffne/)).toBeNull()
  })
})
