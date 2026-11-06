import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item } from '../../domain/schemas/blocks'

// The 10-second "Rückgängig" after a removal (design §7.6). Screen state only: a reload or
// a step switch ends it, the removal itself is already saved.

export const UNDO_MS = 10_000

export type Removal = { key: number; collection: string; item: Item; index: number; label: string }

export function useRemovals(onExpire?: (removal: Removal) => void) {
  const [removals, setRemovals] = useState<Removal[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const counter = useRef(0)
  const expire = useRef(onExpire)
  expire.current = onExpire

  const drop = useCallback((key: number) => {
    clearTimeout(timers.current.get(key))
    timers.current.delete(key)
    setRemovals((list) => list.filter((r) => r.key !== key))
  }, [])

  const push = useCallback(
    (removal: Omit<Removal, 'key'>) => {
      const key = ++counter.current
      const entry = { ...removal, key }
      setRemovals((list) => [...list, entry])
      timers.current.set(
        key,
        setTimeout(() => {
          expire.current?.(entry)
          drop(key)
        }, UNDO_MS),
      )
    },
    [drop],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  return { removals, push, drop }
}
