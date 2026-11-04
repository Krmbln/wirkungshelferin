import { useRef, useState, type ChangeEvent } from 'react'
import type { Project } from '../domain/schemas/project'
import { backupProblemText, readBackupFile } from '../storage/backup'

// Choosing a backup file to replace existing data: the file runs through the load pipeline,
// then waits in `chosen` until the confirm dialog says yes (design §7.6). Nothing changes
// before that.
export function useBackupFile() {
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Project | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset, so choosing the same file again fires another change.
    e.target.value = ''
    if (!file) return
    setError(null)
    const parsed = await readBackupFile(file)
    if (parsed.ok) setChosen(parsed.project)
    else setError(backupProblemText[parsed.problem])
  }

  const input = (
    <input
      ref={ref}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={onChange}
    />
  )

  return {
    input,
    pick: () => ref.current?.click(),
    error,
    chosen,
    cancel: () => setChosen(null),
  }
}
