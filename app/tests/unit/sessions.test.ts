import { describe, expect, it } from 'vitest'
import { SESSION_GAP_MS, sessionBreak, sessionLabel } from '../../src/ui/chat/sessions'

// "Letzte Sitzung" divider (implementation plan step 10).

const t = (iso: string) => new Date(iso).toISOString()
const now = new Date('2026-11-06T15:00:00')

describe('sessionBreak', () => {
  it('none without messages or without a 2-hour pause', () => {
    expect(sessionBreak([], now)).toBeUndefined()
    expect(sessionBreak([t('2026-11-06T13:30:00'), t('2026-11-06T14:50:00')], now)).toBeUndefined()
  })

  it('at the end when Lukas is back and hasn’t written yet', () => {
    const times = [t('2026-10-26T09:00:00'), t('2026-10-26T09:10:00')]
    expect(sessionBreak(times, now)).toEqual({ index: 2, last: times[1] })
  })

  it('before the first message after the newest pause only', () => {
    const times = [t('2026-10-20T09:00:00'), t('2026-10-26T09:00:00'), t('2026-10-26T09:10:00'), t('2026-11-06T14:30:00'), t('2026-11-06T14:40:00')]
    expect(sessionBreak(times, now)).toEqual({ index: 3, last: times[2] })
  })

  it('exactly 2 hours counts', () => {
    const first = new Date('2026-11-06T12:00:00')
    expect(sessionBreak([first.toISOString(), new Date(first.getTime() + SESSION_GAP_MS).toISOString()], now)?.index).toBe(1)
  })
})

describe('sessionLabel', () => {
  it('heute, gestern, date, date with year', () => {
    expect(sessionLabel(t('2026-11-06T09:00:00'), now)).toBe('Letzte Sitzung: heute')
    expect(sessionLabel(t('2026-11-05T22:00:00'), now)).toBe('Letzte Sitzung: gestern')
    expect(sessionLabel(t('2026-10-26T09:00:00'), now)).toBe('Letzte Sitzung: 26.10.')
    expect(sessionLabel(t('2026-11-01T09:00:00'), now)).toBe('Letzte Sitzung: 01.11.')
    expect(sessionLabel(t('2025-12-24T09:00:00'), now)).toBe('Letzte Sitzung: 24.12.2025')
  })
})
