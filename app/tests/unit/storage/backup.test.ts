import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeProject } from '../../../src/domain/fixtures'
import { backupFileName, downloadBackup, readBackupFile } from '../../../src/storage/backup'

const file = (text: string) => new Blob([text], { type: 'application/json' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Backup files', () => {
  it('names the file after the local date', () => {
    expect(backupFileName(new Date(2026, 10, 4, 23, 30))).toBe('wirkungshelferin-backup-2026-11-04.json')
    expect(backupFileName(new Date(2026, 0, 9), 'wirkungshelferin-daten')).toBe('wirkungshelferin-daten-2026-01-09.json')
  })

  it('downloads the project document as JSON under that name', async () => {
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:backup'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('wirkungshelferin-backup-2026-11-04.json')
      expect(this.href).toBe('blob:backup')
    })
    const p = makeProject()
    downloadBackup(p, new Date(2026, 10, 4))
    expect(click).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await blobs[0].text())).toEqual(p)
  })

  it('reads a valid backup', async () => {
    const p = makeProject()
    expect(await readBackupFile(file(JSON.stringify(p)))).toEqual({ ok: true, project: p, from: 1 })
  })

  it('refuses a file that is not JSON, not a project, or from a newer version', async () => {
    expect(await readBackupFile(file('kein json'))).toEqual({ ok: false, problem: 'invalid' })
    expect(await readBackupFile(file('{"a":1}'))).toEqual({ ok: false, problem: 'invalid' })
    expect(await readBackupFile(file(JSON.stringify({ ...makeProject(), schemaVersion: 9 })))).toEqual({
      ok: false,
      problem: 'newer',
    })
  })
})
