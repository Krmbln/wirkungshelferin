import type { PdfControls } from '../chat/PdfImport'
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Action } from '../../domain/reducer'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { openProposals, targetItemId } from '../proposals/describe'
import { highlight, scrollIntoView } from '../proposals/highlight'
import type { TargetHint } from '../proposals/ProposalCard'
import { prefersReducedMotion } from '../motion'
import { Step0Block } from './Step0Block'
import { Step1Block } from './Step1Block'
import { Step2Block } from './Step2Block'
import { Step3Block } from './Step3Block'
import { Step4Block } from './Step4Block'
import { Step5Block } from './Step5Block'
import { Step6Block } from './Step6Block'
import { BULK_OPEN_MAX } from '../../domain/plan'
import { panelGroupOf } from '../../domain/tree'
import { FORMS, formEmpty, type FormName } from '../../domain/profile'
import type { Item } from '../../domain/schemas/blocks'
import type { ProposalChange } from '../../domain/schemas/project'
import { issueKey } from '../../domain/check'
import { stillOpen } from '../check/gate'

/**
 * New collapsed keys, or an update of the current ones. Updates queue (React state updaters), so
 * the panel and a block changing keys in the same commit never overwrite each other (step 20:
 * Übernehmen opens a row while the block closes the coverage list).
 */
export type CollapsedChange = string[] | ((keys: string[]) => string[])

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
  /** Step 0 "+ Text einfügen": opens the paste form in the chat. */
  onPaste?: () => void
  /** "+ PDF hochladen" in step 0's Quellen (step 15). */
  pdf?: PdfControls
  /** Steps 2–4: collapsed group keys; step 6: closed rows and coverage list (App keeps them per step). */
  collapsed?: string[]
  onCollapsedChange?: (change: CollapsedChange) => void
  onOpenStep?: (step: StepId) => void
}

/** About how long a smooth scroll into view takes. */
const SCROLL_MS = 300

const itemEl = (panel: HTMLElement | null, id: string) => panel?.querySelector(`[data-item-id="${CSS.escape(id)}"]`) ?? null

/** The item, or the given fields of a form (step 14: a change to "Ort" lights up "Ort", not the whole profile). */
function targetEls(panel: HTMLElement | null, id: string, fields?: string[]): Element[] {
  const item = itemEl(panel, id)
  if (!item || !fields?.length) return item ? [item] : []
  const els = fields.map((f) => item.querySelector(`.bform__field[data-field="${CSS.escape(f)}"]`)).filter((el): el is Element => el !== null)
  return els.length ? els : [item]
}

/** Where to scroll for a target: a whole form scrolls to its section, so its heading stays in view. */
const scrollTarget = (el: Element) => (el.classList.contains('bform') ? (el.closest('section') ?? el) : el)

/** A change to a form that had content: its fields; a first draft or any other change: the whole item. */
function changedFormFields(step: StepId, change: ProposalChange): string[] | undefined {
  if (step !== 0 || !(FORMS as string[]).includes(change.collection) || change.op !== 'update') return undefined
  const before = change.undo?.before as Item | null | undefined
  return before && !formEmpty(before, change.collection as FormName) ? Object.keys(change.fields ?? {}) : undefined
}

// The step's block, editable (design §6.2).
// Outline and highlight are set on the item's element by id, so every block gets them.
export function BlockPanel({
  project,
  step,
  onAction,
  outlined,
  applied,
  onShowProposals,
  liveIssues = false,
  onPaste,
  pdf,
  collapsed = [],
  onCollapsedChange,
  onOpenStep,
}: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const open = openProposals(project, step)
  const latest = useRef(collapsed)
  latest.current = collapsed

  /** Opens the collapsed group an item sits in, at once, so the item is in the DOM right after. */
  function reveal(id: string) {
    const group = panelGroupOf(project, step, id)
    if (!group || !latest.current.includes(group) || !onCollapsedChange) return
    latest.current = latest.current.filter((k) => k !== group)
    flushSync(() => onCollapsedChange((keys) => keys.filter((k) => k !== group)))
  }

  useEffect(() => {
    if (!outlined) return
    // Hovering a row for an item in a collapsed group outlines the group's header and opens nothing.
    const group = panelGroupOf(project, step, outlined.id)
    const header = group && collapsed.includes(group) ? panel.current?.querySelector(`[data-group-header="${CSS.escape(group)}"]`) : null
    const els = header ? [header] : targetEls(panel.current, outlined.id, outlined.fields)
    els.forEach((el) => el.setAttribute('data-outlined', ''))
    return () => els.forEach((el) => el.removeAttribute('data-outlined'))
  }, [outlined, project, collapsed])

  useEffect(() => {
    // Step 6: keyboard focus on a card row only outlines a closed row's head and scrolls to it
    // (tabbing through a long card must not open every record, design "Step 20").
    if (outlined?.scroll && step !== 6) reveal(outlined.id)
    const el = outlined?.scroll ? targetEls(panel.current, outlined.id, outlined.fields)[0] : undefined
    if (el) scrollIntoView(scrollTarget(el))
  }, [outlined])

  useEffect(() => {
    if (!applied) return
    const proposal = project.steps[step].proposals.find((p) => p.id === applied.proposalId)
    const done = applied.changeIds.flatMap((id) => {
      const change = proposal?.changes.find((c) => c.id === id)
      const target = proposal && change?.state === 'applied' ? targetItemId(proposal, change) : undefined
      return target ? [{ change: change!, target }] : []
    })
    // Step 6: applying more than two rows at once opens none; new ones start closed (design "Step 20").
    if (step === 6 && done.length > BULK_OPEN_MAX) {
      const added = done.filter((d) => d.change.op === 'add').map((d) => d.target)
      const close = (keys: string[]) => [...keys.filter((k) => !added.includes(k)), ...added]
      latest.current = close(latest.current)
      if (onCollapsedChange) flushSync(() => onCollapsedChange(close))
    } else done.forEach((d) => reveal(d.target))
    const els = applied.changeIds
      .map((id) => proposal?.changes.find((c) => c.id === id))
      .flatMap((change) => {
        const id = proposal && change?.state === 'applied' ? targetItemId(proposal, change) : undefined
        return id ? targetEls(panel.current, id, changedFormFields(step, change!)) : []
      })
    if (els[0]) scrollIntoView(scrollTarget(els[0]))
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
      {step === 0 ? (
        <Step0Block project={project} onAction={onAction} onPaste={onPaste} pdf={pdf} />
      ) : step === 1 ? (
        <Step1Block project={project} onAction={onAction} applied={applied} blocked={new Set(stillOpen(project, 1, liveIssues).map(issueKey))} />
      ) : step === 2 ? (
        <Step2Block
          project={project}
          onAction={onAction}
          applied={applied}
          issues={stillOpen(project, 2, liveIssues)}
          collapsed={collapsed}
          onToggle={(key) => onCollapsedChange?.(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])}
          onOpenStep={(s) => onOpenStep?.(s)}
        />
      ) : step === 3 ? (
        <Step3Block
          project={project}
          onAction={onAction}
          applied={applied}
          issues={stillOpen(project, 3, liveIssues)}
          collapsed={collapsed}
          onToggle={(key) => onCollapsedChange?.(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])}
          onOpenStep={(s) => onOpenStep?.(s)}
        />
      ) : step === 4 ? (
        <Step4Block
          project={project}
          onAction={onAction}
          applied={applied}
          issues={stillOpen(project, 4, liveIssues)}
          collapsed={collapsed}
          onToggle={(key) => onCollapsedChange?.(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])}
          onOpenStep={(s) => onOpenStep?.(s)}
        />
      ) : step === 5 ? (
        <Step5Block project={project} onAction={onAction} applied={applied} issues={stillOpen(project, 5, liveIssues)} onOpenStep={(s) => onOpenStep?.(s)} />
      ) : (
        <Step6Block
          project={project}
          onAction={onAction}
          applied={applied}
          issues={stillOpen(project, 6, liveIssues)}
          collapsed={collapsed}
          onCollapsedChange={(change) => onCollapsedChange?.(change)}
          onOpenStep={(s) => onOpenStep?.(s)}
        />
      )}
    </div>
  )
}
