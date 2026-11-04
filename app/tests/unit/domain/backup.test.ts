import { describe, expect, it } from 'vitest'
import { backupState, calendarDaysSince, daysAgo, withBackupTime } from '../../../src/domain/backup'
import { makeProject } from '../../../src/domain/fixtures'

// Local times, like Lukas's clock.
const now = new Date(2026, 10, 20, 9, 0)
const daysBefore = (days: number, hour = 9) => new Date(2026, 10, 20 - days, hour, 0).toISOString()

describe('Backup reminder', () => {
  it('counts calendar days: late last night is "gestern", early this morning "heute"', () => {
    expect(calendarDaysSince(new Date(2026, 10, 19, 23, 50).toISOString(), now)).toBe(1)
    expect(calendarDaysSince(new Date(2026, 10, 20, 0, 5).toISOString(), now)).toBe(0)
    // A clock that lags behind the backup time never gives negative days.
    expect(calendarDaysSince(new Date(2026, 10, 21).toISOString(), now)).toBe(0)
  })

  it('is due only when the last backup is more than 7 days old', () => {
    const at = (days: number) => backupState({ createdAt: daysBefore(30), lastBackupAt: daysBefore(days) }, now)
    expect(at(6)).toEqual({ days: 6, due: false })
    expect(at(7)).toEqual({ days: 7, due: false })
    expect(at(8)).toEqual({ days: 8, due: true })
  })

  it('without any backup, the week counts from the project start', () => {
    expect(backupState({ createdAt: daysBefore(7) }, now)).toEqual({ due: false })
    expect(backupState({ createdAt: daysBefore(8) }, now)).toEqual({ due: true })
  })

  it('a backup today is not due, whatever the start date', () => {
    expect(backupState({ createdAt: daysBefore(60), lastBackupAt: daysBefore(0, 8) }, now)).toEqual({ days: 0, due: false })
  })

  it('says it in words', () => {
    expect([0, 1, 2, 9].map(daysAgo)).toEqual(['heute', 'gestern', 'vor 2 Tagen', 'vor 9 Tagen'])
  })

  it('the backup file carries its own time and nothing else changes', () => {
    const p = makeProject()
    const at = new Date('2026-11-04T10:30:00.000Z')
    expect(withBackupTime(p, at)).toEqual({ ...p, lastBackupAt: '2026-11-04T10:30:00.000Z' })
  })
})
