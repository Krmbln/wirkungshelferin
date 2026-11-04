import { useEffect, useState } from 'react'

const HOUR = 3_600_000

/**
 * The current time, refreshed when Lukas comes back to the tab and once an hour, so
 * "Backup: heute" turns into "gestern" in a tab left open overnight.
 * `fixed` pins it (gallery, tests).
 */
export function useNow(fixed?: Date): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (fixed) return
    const tick = () => setNow(new Date())
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const timer = setInterval(tick, HOUR)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
    }
  }, [fixed])

  return fixed ?? now
}
