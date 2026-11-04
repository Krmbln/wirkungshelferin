import { describe, expect, it } from 'vitest'
import { holdTabLock, TAB_LOCK } from '../../../src/storage/tabLock'

/** Two tabs share one browser: `browser` holds the locks, each tab gets its own manager. */
function fakeBrowser() {
  const holders = new Map<string, object>()
  let requests = 0
  const tab = () => {
    const self = {}
    const locks = {
      request: async (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
        requests++
        expect(options.ifAvailable).toBe(true)
        if (holders.has(name)) return callback(null)
        holders.set(name, self)
        return callback({ name, mode: 'exclusive' } as Lock)
      },
      query: async () => ({}),
    } as unknown as LockManager
    return { locks, close: () => holders.get(TAB_LOCK) === self && holders.delete(TAB_LOCK) }
  }
  return { tab, requests: () => requests }
}

describe('Tab lock', () => {
  it('the first tab gets it, a second tab is refused', async () => {
    const browser = fakeBrowser()
    expect(await holdTabLock(browser.tab().locks)).toBe(true)
    expect(await holdTabLock(browser.tab().locks)).toBe(false)
  })

  it('after the first tab closes, a reloaded tab gets it', async () => {
    const browser = fakeBrowser()
    const first = browser.tab()
    expect(await holdTabLock(first.locks)).toBe(true)
    expect(await holdTabLock(browser.tab().locks)).toBe(false)
    first.close()
    expect(await holdTabLock(browser.tab().locks)).toBe(true)
  })

  it('a refused tab can ask again; it gets the lock once the other tab is gone', async () => {
    const browser = fakeBrowser()
    const first = browser.tab()
    const second = browser.tab()
    expect(await holdTabLock(first.locks)).toBe(true)
    expect(await holdTabLock(second.locks)).toBe(false)
    expect(await holdTabLock(second.locks)).toBe(false)
    first.close()
    expect(await holdTabLock(second.locks)).toBe(true)
  })

  it('asks once per page, so StrictMode running effects twice does not lock itself out', async () => {
    const browser = fakeBrowser()
    const { locks } = browser.tab()
    expect(await holdTabLock(locks)).toBe(true)
    expect(await holdTabLock(locks)).toBe(true)
    expect(browser.requests()).toBe(1)
  })

  it('without Web Locks the app still starts', async () => {
    expect(await holdTabLock(undefined)).toBe(true)
  })
})
