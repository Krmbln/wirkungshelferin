import type { Project } from './schemas/project'

// Backup reminder (PRD F7, tech design §8): due when the last backup is more than 7 days
// old. Counted in calendar days, so the sidebar's "vor 8 Tagen" and the reminder agree.

export const BACKUP_REMINDER_DAYS = 7

export type BackupState = {
  /** Calendar days since the last backup; undefined = never saved one. */
  days?: number
  due: boolean
}

/** Whole calendar days from `iso` to `now`, in local time. Never negative. */
export function calendarDaysSince(iso: string, now: Date): number {
  const then = new Date(iso)
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/** Without any backup, the week counts from the project's start. */
export function backupState(project: Pick<Project, 'lastBackupAt' | 'createdAt'>, now: Date): BackupState {
  if (project.lastBackupAt) {
    const days = calendarDaysSince(project.lastBackupAt, now)
    return { days, due: days > BACKUP_REMINDER_DAYS }
  }
  return { due: calendarDaysSince(project.createdAt, now) > BACKUP_REMINDER_DAYS }
}

/** "heute" / "gestern" / "vor 3 Tagen". */
export function daysAgo(days: number): string {
  if (days === 0) return 'heute'
  if (days === 1) return 'gestern'
  return `vor ${days} Tagen`
}

/** The project as saved in a backup made at `at`: the file carries its own backup time. */
export function withBackupTime(project: Project, at: Date): Project {
  return { ...project, lastBackupAt: at.toISOString() }
}
