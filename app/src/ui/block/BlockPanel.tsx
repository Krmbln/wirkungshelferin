import type { Action } from '../../domain/reducer'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Step1Block } from './Step1Block'

// The step's block, editable (design §6.2). Steps 0 and 2–6 follow in steps 14–20.
export function BlockPanel({ project, step, onAction }: { project: Project; step: StepId; onAction: (action: Action) => void }) {
  if (step === 1) return <Step1Block project={project} onAction={onAction} />
  return <p className="placeholder">Noch leer – hier entsteht der Baustein für diesen Schritt.</p>
}
