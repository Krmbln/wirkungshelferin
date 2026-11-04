// One tab only (tech design §8). The first tab holds a Web Lock for as long as it lives;
// Chrome releases it when the tab closes or reloads. Another tab doesn't get it and
// loads no data, so two tabs can't overwrite each other.
//
// A refused tab does not queue for the lock: a queued request would win the lock whenever
// the working tab reloads, and lock Lukas out of the tab he works in. It asks again when
// he comes back to it (Session).

export const TAB_LOCK = 'wirkungshelferin-tab'

// One request at a time per page: React's StrictMode runs effects twice in dev, and a
// second request from the same page would find the lock taken by itself.
const requests = new WeakMap<LockManager, Promise<boolean>>()

/**
 * true = this tab holds the lock now; false = another tab has it (ask again later).
 * Without Web Locks (not in Chrome) or if the request itself fails, the tab is let in:
 * Chrome on an https origin always has them, and refusing would show a wrong message.
 */
export function holdTabLock(locks: LockManager | undefined): Promise<boolean> {
  if (!locks) return Promise.resolve(true)
  const running = requests.get(locks)
  if (running) return running
  const result = new Promise<boolean>((resolve) => {
    locks
      .request(TAB_LOCK, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        // Never settles while the page lives, so the lock is held until the tab goes away.
        return lock ? new Promise<void>(() => {}) : undefined
      })
      .catch(() => resolve(true))
  })
  requests.set(locks, result)
  void result.then((held) => {
    if (!held) requests.delete(locks)
  })
  return result
}
