import { useCallback, useEffect, useRef, useState } from 'react'
import { checkCall } from '../../ai/chat'
import { checkFromAnswer } from '../../ai/check'
import type { AiClient } from '../../ai/client'
import type { AiProblem } from '../../ai/errors'
import { withAppJudged } from '../../domain/check'
import { reducer } from '../../domain/reducer'
import type { Project, QualityCheck } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import type { Settings } from '../../storage/settings'

/** `no_result`: Claude answered without a usable report_quality_check. */
export type CheckProblem = AiProblem | 'no_result'
export type CheckRun = { kind: 'running' } | { kind: 'failed'; problem: CheckProblem }

export type CheckControls = {
  runs: Partial<Record<StepId, CheckRun>>
  /** Runs the gate's check; the stored check, or undefined when it failed or one already runs. */
  check: (step: StepId) => Promise<QualityCheck | undefined>
}

type Options = {
  ai: AiClient
  settings: Settings
  project: () => Project | null
  change: (fn: (project: Project) => Project, options?: { now?: boolean }) => void
}

const now = () => new Date().toISOString()

// The gate's "Prüfen" (design §6.2), at most one per step. Like a chat run it lives in Session,
// so switching steps doesn't lose the result.
export function useCheckRunner({ ai, settings, project, change }: Options): CheckControls {
  const [runs, setRuns] = useState<CheckControls['runs']>({})
  const controllers = useRef(new Map<StepId, AbortController>())
  const latest = useRef({ ai, settings, project, change })
  latest.current = { ai, settings, project, change }

  const setRun = useCallback((step: StepId, run: CheckRun | undefined) => {
    setRuns((runs) => {
      const copy = { ...runs }
      if (run) copy[step] = run
      else delete copy[step]
      return copy
    })
  }, [])

  useEffect(() => {
    const all = controllers.current
    return () => all.forEach((c) => c.abort())
  }, [])

  const check = useCallback(
    async (step: StepId) => {
      const { ai, settings, project } = latest.current
      const current = project()
      if (!current || controllers.current.has(step)) return undefined
      let prepared: ReturnType<typeof checkCall>
      try {
        prepared = checkCall(current, step, now())
      } catch (error) {
        console.error('Check request not built', error instanceof Error ? error.name : typeof error)
        setRun(step, { kind: 'failed', problem: 'other' })
        return undefined
      }
      const { call, shown } = prepared
      const controller = new AbortController()
      controllers.current.set(step, controller)
      setRun(step, { kind: 'running' })
      const result = await ai.send(settings, call, { signal: controller.signal })
      controllers.current.delete(step)
      if (result.status === 'aborted') {
        setRun(step, undefined)
        return undefined
      }
      if (result.status === 'failed' || result.message.stop_reason === 'refusal') {
        setRun(step, { kind: 'failed', problem: result.status === 'failed' ? result.problem : 'refusal' })
        return undefined
      }
      const results = checkFromAnswer(step, result.message)
      if (!results) {
        setRun(step, { kind: 'failed', problem: 'no_result' })
        return undefined
      }
      // Stamped when it lands: a chat turn sent meanwhile then still hears about it, and an
      // older result never replaces a newer one (reducer).
      // With the app's own judgement in place already: the gate decides from this result
      // whether to ask "Trotzdem bestätigen?" (step 0 completeness).
      const stored: QualityCheck = { at: now(), source: 'app', block: shown, results: withAppJudged(step, shown, results, latest.current.project() ?? undefined) }
      latest.current.change((p) => reducer(p, { type: 'check/store', step, check: stored }), { now: true })
      setRun(step, undefined)
      return stored
    },
    [setRun],
  )

  return { runs, check }
}
