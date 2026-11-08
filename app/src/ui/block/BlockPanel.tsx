import { useEffect, useRef } from 'react'
import type { Action } from '../../domain/reducer'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { openProposals, targetItemId } from '../proposals/describe'
import { highlight, scrollIntoView } from '../proposals/highlight'
import type { TargetHint } from '../proposals/ProposalCard'
import { prefersReducedMotion } from '../motion'
import { Step1Block } from './Step1Block'
import { issueKey } from '../../domain/check'
import { stillOpen } from '../check/gate'

/** Changes just applied from a card; `n` makes a repeat count as new. */
export type Applied = { proposalId: string; changeIds: string[]; n: number }

type Props = {
  project: Project
  step: StepId
  onAction: (action: Action) => void
  /** Item outlined while a proposal row is hovered or focused (keyboard focus also scrolls to it). */
  outlined?: TargetHint
  applied?: Applied
  /** "offene Änderungen im Chat ▸": jump to this proposal's card. */
  onShowProposals?: (proposalId: string) => void
  /** A check runs or failed: every ⛔ field shows its marker now (gate.ts stillOpen). */
  liveIssues?: boolean
}

/** About how long a smooth scroll into view takes. */
const SCROLL_MS = 300

const itemEl = (panel: HTMLElement | null, id: string) => panel?.querySelector(`[data-item-id="${CSS.escape(id)}"]`) ?? null

// The step's block, editable (design §6.2). Steps 0 and 2–6 follow in steps 14–20.
// Outline and highlight are set on the item's element by id, so every block gets them.
export function BlockPanel({ project, step, onAction, outlined, applied, onShowProposals, liveIssues = false }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const open = openProposals(project, step)

  useEffect(() => {
    if (!outlined) return
    const el = itemEl(panel.current, outlined.id)
    el?.setAttribute('data-outlined', '')
    return () => el?.removeAttribute('data-outlined')
  }, [outlined, project])

  useEffect(() => {
    const el = outlined?.scroll ? itemEl(panel.current, outlined.id) : null
    if (el) scrollIntoView(el)
  }, [outlined])

  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[step].proposals.find((p) => p.id === applied.proposalId)
    const els = applied.changeIds
      .map((id) => proposal?.changes.find((c) => c.id === id))
      .flatMap((change) => (proposal && change?.state === 'applied' ? [targetItemId(proposal, change)] : []))
      .map((id) => (id ? itemEl(panel.current, id) : null))
      .filter((el): el is Element => el !== null)
    if (els[0]) scrollIntoView(els[0])
    // A smooth scroll takes a moment; the 1.5 s fade starts once the item is there.
    const timer = setTimeout(() => els.forEach(highlight), prefersReducedMotion() ? 0 : SCROLL_MS)
    return () => clearTimeout(timer)
    // Only a new apply lights up; later edits of the project don't.
  }, [applied?.n])

  return (
    <div className="bpanel-wrap" ref={panel}>
      {open.count > 0 && onShowProposals && (
        <Button variant="text" className="bopen" onClick={() => onShowProposals(open.first!)}>
          {open.count === 1 ? '1 offene Änderung im Chat' : `${open.count} offene Änderungen im Chat`}
          <Icon name="chevronRight" size={16} />
        </Button>
      )}
      {step === 1 ? <Step1Block project={project} onAction={onAction} applied={applied} blocked={new Set(stillOpen(project, 1, liveIssues).map(issueKey))} /> : <p className="placeholder">Noch leer – hier entsteht der Baustein für diesen Schritt.</p>}
    </div>
  )
}
