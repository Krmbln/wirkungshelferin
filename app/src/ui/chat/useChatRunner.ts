import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiClient } from '../../ai/client'
import { commitAnswer, prepareRetry, prepareTurn, type Prepared } from '../../ai/chat'
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

type Options = {
  ai: AiClient
  settings: Settings
  /** Applies a change to the newest project; `now` saves it at once. Does nothing without a project. */
  change: (fn: (project: Project) => Project, options?: { now?: boolean }) => void
}

const now = () => new Date().toISOString()

// Runs chat turns, at most one per step. A run outlives the step view, so switching steps
// doesn't lose an answer; Session owns it. Stopping keeps what arrived (design §6.2).
export function useChatRunner({ ai, settings, change }: Options): ChatControls {
  const [runs, setRuns] = useState<ChatControls['runs']>({})
  const controllers = useRef(new Map<StepId, AbortController>())
  const latest = useRef({ ai, settings, change })
  latest.current = { ai, settings, change }

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
    async (step: StepId, prepare: (project: Project) => Prepared | undefined) => {
      if (controllers.current.has(step)) return
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
      if (!prepared) return
      const { call, shown } = prepared
      const controller = new AbortController()
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

  return {
    runs,
    send: useCallback((step, text) => void run(step, (p) => prepareTurn(p, step, text, { at: now() })), [run]),
    retry: useCallback((step) => void run(step, (p) => prepareRetry(p, step)), [run]),
    stop: useCallback((step) => controllers.current.get(step)?.abort(), []),
  }
}
