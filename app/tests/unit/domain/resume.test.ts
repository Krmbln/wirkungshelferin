// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makeProject } from '../../../src/domain/fixtures'
import { reducer } from '../../../src/domain/reducer'
import { activityAt, activityChanged, markActive, resumeCurrent, resumeDue, withResume } from '../../../src/domain/resume'
import { projectSchema } from '../../../src/domain/schemas/project'
import { withChat } from '../../resume'

// "Wo du aufgehört hast" (implementation plan step 22, design §6.1 "Step 22").

const T1 = '2026-11-10T10:00:00.000Z'
const T2 = '2026-11-10T10:05:00.000Z'
const T3 = '2026-11-10T10:10:00.000Z'

const chatted = (status: 'in_progress' | 'confirmed' | 'not_started' = 'in_progress') =>
  withChat(makeProject({ steps: { 2: { status } } }), 2, [
    { role: 'user', text: 'Die Räder sind oft kaputt.', at: T1 },
    { role: 'assistant', text: 'Woran liegt das?', at: T1 },
  ])

describe('activity in the step on screen', () => {
  it('an edit in the step counts', () => {
    const p = makeProject()
    const next = reducer(p, { type: 'item/add', step: 2, collection: 'causes', fields: { text: 'Kein Werkzeug' } } as never)
    expect(activityChanged(p, next, 2)).toBe(true)
  })

  it('a clone of the whole project (an answer for another step) is no work in this one', () => {
    const p = chatted()
    expect(activityChanged(p, structuredClone(p), 2)).toBe(false)
    expect(activityChanged(p, withChat(p, 1, [{ role: 'assistant', text: 'Entwurf', at: T2 }]), 2)).toBe(false)
  })

  it('writing the step’s own home summary is no work', () => {
    const p = chatted()
    expect(activityChanged(p, withResume(p, 2, { summary: 's', nextAction: 'n', at: T1 }), 2)).toBe(false)
  })

  it('markActive stores the step and the time, and the project stays valid', () => {
    const p = markActive(makeProject(), 3, T2)
    expect(p.lastActive).toEqual({ stepId: 3, at: T2 })
    expect(projectSchema.safeParse(p).success).toBe(true)
  })
})

describe('when the home summary is due', () => {
  it('not without a last active step', () => {
    expect(resumeDue(chatted())).toBeUndefined()
  })

  it('due for the last active step with an answer and no summary', () => {
    expect(resumeDue(markActive(chatted(), 2, T2))).toBe(2)
  })

  it('not for a confirmed step (the card moves on)', () => {
    expect(resumeDue(markActive(chatted('confirmed'), 2, T2))).toBeUndefined()
  })

  it('due for a step still "noch nicht begonnen" that has a chat (status changes with block edits only)', () => {
    expect(resumeDue(markActive(chatted('not_started'), 2, T2))).toBe(2)
  })

  it('not without any complete answer (nothing to sum up; a stopped answer doesn’t count)', () => {
    const p = withChat(makeProject({ steps: { 2: { status: 'in_progress' } } }), 2, [
      { role: 'user', text: 'Hallo', at: T1 },
      { role: 'assistant', text: 'Wor', at: T1, aborted: true },
    ])
    expect(resumeDue(markActive(p, 2, T2))).toBeUndefined()
  })

  it('a summary stamped with the newest activity covers it; later work makes it due again', () => {
    const active = markActive(chatted(), 2, T2)
    const summed = withResume(active, 2, { summary: 's', nextAction: 'n', at: activityAt(active, 2)! })
    expect(resumeDue(summed)).toBeUndefined()
    expect(resumeCurrent(summed, 2)).toBeDefined()
    expect(resumeDue(markActive(summed, 2, T3))).toBe(2)
  })

  it('an answer that landed after Lukas left is newer than his last work: the stamp includes it', () => {
    const p = markActive(chatted(), 2, T1)
    const late = withChat(p, 2, [
      { role: 'user', text: 'Die Räder sind oft kaputt.', at: T1 },
      { role: 'assistant', text: 'Woran liegt das?', at: T3 },
    ])
    expect(activityAt(late, 2)).toBe(T3)
    const summed = withResume(late, 2, { summary: 's', nextAction: 'n', at: activityAt(late, 2)! })
    expect(resumeDue(summed)).toBeUndefined()
    // Stamped with his last work only, it would never be current: the loop the stamp prevents.
    expect(resumeDue(withResume(late, 2, { summary: 's', nextAction: 'n', at: T1 }))).toBe(2)
  })

  it('another step’s summary is current only when no newer message came', () => {
    const p = withResume(chatted(), 2, { summary: 's', nextAction: 'n', at: T1 })
    expect(resumeCurrent(p, 2)).toBeDefined()
    expect(resumeCurrent(withChat(p, 2, [{ role: 'assistant', text: 'Und?', at: T2 }]), 2)).toBeUndefined()
  })
})
