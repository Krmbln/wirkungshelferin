import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  defaultSettings,
  keyProblem,
  loadSettings,
  maskKey,
  saveSettings,
} from '../../../src/storage/settings'
import { keys, memoryStore } from '../../../src/storage/store'
import { dummyKey } from '../../dummyKey'

describe('Settings storage', () => {
  it('starts with the defaults: Opus 5.5, effort medium, no key', async () => {
    expect(await loadSettings(memoryStore())).toEqual({ model: DEFAULT_MODEL, effort: DEFAULT_EFFORT })
    expect(defaultSettings).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
  })

  it('saves under its own key, never under the project', async () => {
    const store = memoryStore()
    const settings = { apiKey: dummyKey, model: 'claude-opus-5-5', effort: 'high' as const }
    await saveSettings(store, settings)
    expect(store.data.get(keys.settings)).toEqual(settings)
    expect(store.data.has(keys.project)).toBe(false)
    expect(await loadSettings(store)).toEqual(settings)
  })

  it('unusable stored settings fall back to the defaults and stay untouched', async () => {
    const broken = { model: '', effort: 'turbo' }
    const store = memoryStore({ [keys.settings]: broken })
    expect(await loadSettings(store)).toEqual(defaultSettings)
    expect(store.data.get(keys.settings)).toEqual(broken)
  })

  it('a store that cannot be read gives the defaults', async () => {
    const store = memoryStore()
    store.get = () => Promise.reject(new Error('blocked'))
    expect(await loadSettings(store)).toEqual(defaultSettings)
  })

  it('refuses to save an invalid value', async () => {
    const store = memoryStore()
    await expect(saveSettings(store, { model: '  ', effort: 'medium' })).rejects.toThrow()
    expect(store.data.has(keys.settings)).toBe(false)
  })
})

describe('API key display and checks', () => {
  it('shows only the last four characters', () => {
    expect(maskKey(dummyKey)).toBe('••••••••c3AA')
    expect(maskKey(dummyKey)).not.toContain(dummyKey.slice(0, 10))
  })

  it('catches an empty, cut-off or broken paste', () => {
    expect(keyProblem('')).toMatch(/Füg hier/)
    expect(keyProblem(dummyKey.slice(0, 12))).toMatch(/nicht wie ein vollständiger/)
    expect(keyProblem(`${dummyKey.slice(0, 20)} ${dummyKey.slice(20)}`)).toMatch(/nicht wie ein vollständiger/)
    expect(keyProblem(dummyKey)).toBeNull()
  })
})
