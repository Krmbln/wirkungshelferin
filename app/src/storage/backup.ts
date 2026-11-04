import { parseDocument, type DocumentProblem, type Parsed } from '../domain/document'
import type { Project } from '../domain/schemas/project'

/** "wirkungshelferin-backup-2026-11-04.json", in local time (tech design §8). */
export function backupFileName(date: Date, name = 'wirkungshelferin-backup'): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${name}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

/** Hands a JSON file to the browser's download, via a generated link. */
export function downloadJson(value: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked after the click has been handled, so the download keeps its data.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The project document only. Settings (and the API key) live under another key. */
export function downloadBackup(project: Project, now = new Date()): void {
  downloadJson(project, backupFileName(now))
}

/** Reads a chosen file and runs it through the same migrate → validate pipeline as app start. */
export async function readBackupFile(file: Blob): Promise<Parsed> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    return { ok: false, problem: 'invalid' }
  }
  return parseDocument(raw)
}

/** What to tell Lukas when a chosen file can't be used. Nothing has changed then. */
export const backupProblemText: Record<DocumentProblem, string> = {
  invalid:
    'Diese Datei ist kein Backup der Wirkungshelferin, oder sie ist beschädigt. Es hat sich nichts verändert. Wähl eine andere Datei – Backups heißen „wirkungshelferin-backup-…json“.',
  newer:
    'Dieses Backup stammt von einer neueren Version der Wirkungshelferin. Lade die Seite neu und versuch es noch einmal. Es hat sich nichts verändert.',
}
