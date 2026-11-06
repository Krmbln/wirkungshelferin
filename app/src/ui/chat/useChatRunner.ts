import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiClient } from '../../ai/client'
import { commitAnswer, prepareRetry, prepareTurn, type Prepared } from '../../ai/chat'
import { rolloverNeeded, summaryCall, summaryFrom } from '../../ai/summarise'
import type { Project } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'
import type { Settings } from '../../storage/settings'
import { applyEvent, messageTexts, type ChatRun } from './stream'

export type ChatControls = {
  runs: Partial<Record<StepId, ChatRun>>
  send: (step: StepId, text: string) => void
  stop: (step: StepId) => void
  retry: (step: StepId) => void
}

/**
 * While the summary runs, Lukas's turn isn't stored yet: his text waits in the stored drafts
 * (not on screen), so a reload brings it back into the input.
 */
export type DraftKeeper = {
  /** Stores `text` as the step's draft without showing it. */
  hold: (step: StepId, text: string) => void
  /** Stores the drafts as they are on screen again (the turn is stored now). */
  release: () => void
  /** Puts `text` back into the input (Stopp during the summary). */
  restore: (step: StepId, text: string) => void
}

type Options = {
  ai: AiClient
  settings: Settings
  /** The newest project, or null. */
  project: () => Project | null
  /** Applies a change to the newest project; `now` saves it at once. Does nothing without a project. */
  change: (fn: (project: Project) => Project, options?: { now?: boolean }) => void
  drafts?: DraftKeeper
}

const now = () => new Date().toISOString()

// Runs chat turns, at most one per step. A run outlives the step view, so switching steps
// doesn't lose an answer; Session owns it. Stopping keeps what arrived (design §6.2).
export function useChatRunner({ ai, settings, project, change, drafts }: Options): ChatControls {
  const [runs, setRuns] = useState<ChatControls['runs']>({})
  const controllers = useRef(new Map<StepId, AbortController>())
  const latest = useRef({ ai, settings, project, change, drafts })
  latest.current = { ai, settings, project, change, drafts }

  const setRun = useCallback((step: StepId, run: ChatRun | ((run: ChatRun | undefined) => ChatRun | undefined) | undefined) => {
    setRuns((runs) => {
      const next = typeof run === 'function' ? run(runs[step]) : run
      const copy = { ...runs }
      if (next) copy[step] = next
      else delete copy[step]
      return copy
    })
  }, [])

  const run = useCallback(
    async (step: StepId, prepare: (project: Project) => Prepared | undefined, controller = new AbortController()) => {
      const { ai, settings, change } = latest.current
      let prepared: Prepared | undefined
      // Saved at once: Lukas's turn must survive a reload while Claude answers.
      change(
        (project) => {
          prepared = prepare(project)
          return prepared?.project ?? project
        },
        { now: true },
      )
      if (!prepared) {
        // Only the summary path registered this controller (and shows a run) before preparing.
        if (controllers.current.get(step) === controller) {
          controllers.current.delete(step)
          setRun(step, undefined)
        }
        return
      }
      const { call, shown } = prepared
      controllers.current.set(step, controller)
      setRun(step, { kind: 'running', blocks: [] })
      const result = await ai.send(settings, call, {
        signal: controller.signal,
        onEvent: (event) => setRun(step, (r) => (r?.kind === 'running' ? { kind: 'running', blocks: applyEvent(r.blocks, event) } : r)),
      })
      controllers.current.delete(step)
      // A refusal is not stored: the history stays clean and "Erneut versuchen" sends it again.
      if (result.status === 'failed' || (result.status === 'done' && result.message.stop_reason === 'refusal')) {
        const problem = result.status === 'failed' ? result.problem : 'refusal'
        const partial = messageTexts(result.status === 'failed' ? result.partial : result.message).join('\n\n')
        setRun(step, { kind: 'failed', problem, partial })
        return
      }
      latest.current.change((project) => commitAnswer(project, step, result, shown, { at: now() }), { now: true })
      setRun(step, undefined)
    },
    [setRun],
  )

  useEffect(() => {
    const all = controllers.current
    return () => all.forEach((c) => c.abort())
  }, [])

  /**
   * A long segment or a new model first gets a summary (tech design §6.5), then the turn goes
   * into a new segment that carries it. A failed summary never blocks Lukas: a long segment
   * simply goes on (and tries again next turn); after a model change the new segment starts
   * without one, since the old history belongs to the old model. Stopp brings his text back.
   */
  const send = useCallback(
    async (step: StepId, text: string) => {
      if (controllers.current.has(step)) return
      const { ai, settings, project, drafts } = latest.current
      const current = project()
      const rollover = current ? rolloverNeeded(current, step, settings.model) : undefined
      const turn = (newSegment?: { summary?: string }) => (p: Project) =>
        prepareTurn(p, step, text, { at: now(), model: settings.model, newSegment })
      if (!current || !rollover) return run(step, turn())

      const controller = new AbortController()
      controllers.current.set(step, controller)
      setRun(step, { kind: 'summarising', text })
      drafts?.hold(step, text)
      const result = await ai.send(settings, summaryCall(current, step), { signal: controller.signal })
      if (result.status === 'aborted') {
        controllers.current.delete(step)
        setRun(step, undefined)
        drafts?.restore(step, text)
        return
      }
      const summary = result.status === 'done' ? summaryFrom(result.message) : undefined
      const newSegment = summary || rollover === 'model' ? { summary } : undefined
      await run(step, (p) => {
        const prepared = turn(newSegment)(p)
        drafts?.release()
        return prepared
      }, controller)
    },
    [run, setRun],
  )

  return {
    runs,
    send: useCallback((step, text) => void send(step, text), [send]),
    retry: useCallback((step) => {
      if (!controllers.current.has(step)) void run(step, (p) => prepareRetry(p, step))
    }, [run]),
    stop: useCallback((step) => controllers.current.get(step)?.abort(), []),
  }
}
