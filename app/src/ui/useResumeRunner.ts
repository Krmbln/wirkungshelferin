import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiClient } from '../ai/client'
import { resumeCall, resumeFrom } from '../ai/resume'
import { activityAt, resumeDue, withResume } from '../domain/resume'
import type { Project } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import type { Settings } from '../storage/settings'
import { CARD_LIMITS } from './home'

export type ResumeControls = {
  /** The step whose home summary is being written (card state D). */
  writing?: StepId
  /** Writes the step's home summary if it is due; App calls it once Lukas has left the step. */
  write: (step: StepId) => void
}

type Options = {
  ai: AiClient
  settings: Settings
  project: () => Project | null
  change: (fn: (project: Project) => Project, options?: { now?: boolean }) => void
}

// The home summary (design §6.1 "Step 22"): one at a time, in the background, never an error on
// screen — the card's fallback is good enough. Each piece of work gets one try: a failure waits
// for new activity instead of trying again on every render.
export function useResumeRunner({ ai, settings, project, change }: Options): ResumeControls {
  const [writing, setWriting] = useState<StepId>()
  const tried = useRef(new Set<string>())
  const controller = useRef<AbortController>(undefined)
  const latest = useRef({ ai, settings, project, change })
  latest.current = { ai, settings, project, change }

  useEffect(() => () => controller.current?.abort(), [])

  const write = useCallback((step: StepId) => {
    const { ai, settings, project } = latest.current
    const current = project()
    if (!current || controller.current || resumeDue(current) !== step || !settings.apiKey) return
    // The stamp: the newest activity this summary covers, so later work makes it due again.
    const at = activityAt(current, step)!
    const key = `${step}@${at}`
    if (tried.current.has(key)) return
    tried.current.add(key)
    let call: ReturnType<typeof resumeCall>
    try {
      call = resumeCall(current, step)
    } catch (error) {
      console.error('Resume request not built', error instanceof Error ? error.name : typeof error)
      return
    }
    const own = new AbortController()
    controller.current = own
    setWriting(step)
    void ai.send(settings, call, { signal: own.signal }).then((result) => {
      controller.current = undefined
      setWriting(undefined)
      const text = result.status === 'done' ? resumeFrom(result.message) : undefined
      if (!text) return
      // The card cuts longer text; logged so the prompt can be tuned (design "Step 22").
      if (text.summary.length > CARD_LIMITS.summary || text.nextAction.length > CARD_LIMITS.nextAction)
        console.info('Resume text cut on the card', text.summary.length, text.nextAction.length)
      latest.current.change((p) => withResume(p, step, { ...text, at }), { now: true })
    })
  }, [])

  return { writing, write }
}
