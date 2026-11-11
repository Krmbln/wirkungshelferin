import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isGoogleChrome, type NavigatorWithUAData } from '../../src/ui/gate/isGoogleChrome'
import { Root } from '../../src/ui/Root'
import { makeProject } from '../../src/domain/fixtures'
import { keys } from '../../src/storage/store'
import { readyStore } from '../stores'

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
  it('shows the gate with the app link outside Chrome, without reading storage', () => {
    const store = readyStore()
    const get = vi.spyOn(store, 'get')
    render(<Root nav={browsers.safari} appUrl={APP_URL} store={store} />)
    expect(get).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Bitte öffne die Wirkungshelferin in Chrome' })).toBeTruthy()
    expect(screen.getByText(APP_URL)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('shows the app in Chrome', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    render(<Root nav={browsers.chrome} appUrl={APP_URL} store={store} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    expect(screen.queryByText(/Bitte öffne/)).toBeNull()
  })

  it('refuses to load inside a frame, without reading storage', () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const get = vi.spyOn(store, 'get')
    render(<Root nav={browsers.chrome} appUrl={APP_URL} store={store} framed />)
    expect(get).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Bitte öffne die Wirkungshelferin direkt' })).toBeTruthy()
    const link = screen.getByRole('link', { name: 'In einem eigenen Tab öffnen' })
    expect(link.getAttribute('href')).toBe(APP_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
