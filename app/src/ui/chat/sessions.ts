import { calendarDaysSince } from '../../domain/backup'

// "Letzte Sitzung" divider (design §6.2): after a break, a muted line marks where this session
// starts. Only the newest break gets one.

/** A pause at least this long counts as a new session. */
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000

/**
 * Where the current session starts in a list of message times (oldest first): the index of the
 * first message after the newest break, or `times.length` when the break is now (Lukas is back
 * and hasn't written yet, so new messages appear below the line). `last` = when the previous
 * session ended.
 */
export function sessionBreak(times: string[], now: Date): { index: number; last: string } | undefined {
  if (!times.length) return undefined
  const ms = times.map((t) => Date.parse(t))
  if (now.getTime() - ms[ms.length - 1] >= SESSION_GAP_MS) return { index: times.length, last: times[times.length - 1] }
  for (let i = ms.length - 1; i > 0; i--) {
    if (ms[i] - ms[i - 1] >= SESSION_GAP_MS) return { index: i, last: times[i - 1] }
  }
  return undefined
}

/** "heute" / "gestern" / "05.11." (with the year when it isn't this year's). */
export function dayText(at: string, now: Date): string {
  const days = calendarDaysSince(at, now)
  const then = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  if (days === 0) return 'heute'
  if (days === 1) return 'gestern'
  return `${two(then.getDate())}.${two(then.getMonth() + 1)}.${then.getFullYear() === now.getFullYear() ? '' : then.getFullYear()}`
}

/** "Letzte Sitzung: heute" / "gestern" / "05.11.". */
export const sessionLabel = (last: string, now: Date) => `Letzte Sitzung: ${dayText(last, now)}`
