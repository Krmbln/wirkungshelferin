import type { Project } from '../../domain/schemas/project'

// Which setup screens a Chrome needs (PO decision 2026-11-04): setup runs once per Chrome,
// and screens already done are skipped. After a backup was loaded only the key is missing.

export type SetupStep = 'welcome' | 'key' | 'privacy' | 'backup'

export function setupPlan(project: Project): SetupStep[] {
  const fresh = !project.privacyNoteSeen
  return [
    ...(fresh ? (['welcome'] as const) : []),
    'key' as const,
    ...(fresh ? (['privacy'] as const) : []),
    ...(project.lastBackupAt ? [] : (['backup'] as const)),
  ]
}

/** The checklist names, without the welcome screen (it introduces them). */
export const setupStepTitle: Record<Exclude<SetupStep, 'welcome'>, string> = {
  key: 'Verbindung zu Claude',
  privacy: 'Datenschutz',
  backup: 'Erstes Backup',
}
