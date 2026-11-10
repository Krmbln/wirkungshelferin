// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { commitAnswer, prepareAct, reviewed, reviewPending } from '../../../src/ai/chat'
import { lukasText } from '../../../src/ai/prompt'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import { defaultSettings } from '../../../src/storage/settings'
import { dummyKey } from '../../dummyKey'
import { fixtureState, replayClient } from '../../replay'
import type { StepId } from '../../../src/domain/types'
import { AT, LATER, editCause, outdatedProject, reconfirm } from '../../outdated'

// "Änderung prüfen lassen" (implementation plan step 21, tech design §9): the turn brings each
// changed earlier step as confirmed then and as confirmed now.

const TURN = '2026-11-10T13:00:00.000Z'
const ANSWER = '2026-11-10T13:00:05.000Z'
const meta = { at: TURN, newId: (() => { let n = 0; return () => `m${++n}` })() }

/** Step 2 re-confirmed with a changed cause: steps 3–6 outdated. */
const marked = () => reconfirm(outdatedProject(), 2, [editCause('Kein Werkzeug und kein Raum')])

function answered(p: Project, step: StepId, extra: Record<string, unknown> = {}): Project {
  const next = structuredClone(p)
  next.steps[step].segments.at(-1)!.messages.push({ id: 'a1', at: ANSWER, role: 'assistant', content: [{ type: 'text', text: 'Schritt 2 hat jetzt …' }], ...extra })
  return next
}

const lastUserText = (p: Project, step: StepId) =>
  (p.steps[step].segments.at(-1)!.messages.at(-1)!.content as { type: string; text?: string }[]).map((b) => b.text ?? '').join('\n---\n')

describe('the review turn', () => {
  it('brings step 2 as confirmed then and now, before the app line; stored as an app turn', () => {
    const prepared = prepareAct(marked(), 4, { kind: 'review' }, meta)!
    const stored = prepared.project.steps[4].segments.at(-1)!.messages.at(-1)!
    expect(stored.act).toEqual({ kind: 'review', label: 'Schritt 2' })
    const text = lastUserText(prepared.project, 4)
    const then = text.indexOf('[Schritt 2, wie bestätigt am 2026-11-03 – darauf baut dieser Schritt auf]')
    const now = text.indexOf('[Schritt 2 jetzt, bestätigt am 2026-11-10]')
    const line = text.indexOf('[App] Die Person hat „Änderung prüfen lassen“ gedrückt')
    expect([then, now, line].every((i) => i >= 0)).toBe(true)
    expect(then < now && now < line).toBe(true)
    expect(text.slice(then, now)).toContain('"text":"Kein Werkzeug"')
    expect(text.slice(now, line)).toContain('"text":"Kein Werkzeug und kein Raum"')
    // The summary of a later segment reads the short app line, not both blocks.
    expect(lukasText(stored)).toMatch(/^\[App\] Die Person hat „Änderung prüfen lassen“/)
    // The request carries the stored turn.
    expect(JSON.stringify(prepared.call.messages.at(-1))).toContain('Kein Werkzeug und kein Raum')
  })

  it('names every changed step, in step order', () => {
    const both = reconfirm(reconfirm(outdatedProject(), 0, [{ type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields: { location: 'Südstadt' } }]), 2, [editCause('Neu')], LATER)
    const prepared = prepareAct(both, 5, { kind: 'review' }, meta)!
    expect(prepared.project.steps[5].segments.at(-1)!.messages.at(-1)!.act?.label).toBe('Schritt 0 und 2')
  })

  it('is refused on a step that is not outdated', () => {
    const p = marked()
    expect(prepareAct(p, 2, { kind: 'review' }, meta)).toBeUndefined()
    expect(prepareAct(outdatedProject(), 4, { kind: 'review' }, meta)).toBeUndefined()
  })
})

describe('reviewed (the banner\'s "after the check")', () => {
  it('only a complete answer after the turn counts', () => {
    const p = marked()
    expect(reviewed(p, 4)).toBe(false)
    const asked = prepareAct(p, 4, { kind: 'review' }, meta)!.project
    expect(reviewPending(asked, 4)).toBe(true)
    // No answer yet, or it failed: the turn stays unanswered.
    expect(reviewed(asked, 4)).toBe(false)
    expect(reviewed(answered(asked, 4, { aborted: true }), 4)).toBe(false)
    const done = answered(asked, 4)
    expect(reviewed(done, 4)).toBe(true)
    expect(reviewPending(done, 4)).toBe(false)
  })

  it('a stopped answer stays unchecked, even when a later answer to another question is complete', () => {
    const asked = prepareAct(marked(), 4, { kind: 'review' }, meta)!.project
    const stopped = answered(asked, 4, { aborted: true })
    stopped.steps[4].segments.at(-1)!.messages.push(
      { id: 'u2', at: ANSWER, role: 'user', content: [{ type: 'text', text: 'Was heißt das?' }, { type: 'text', text: '[Baustein unverändert]' }] },
      { id: 'a2', at: ANSWER, role: 'assistant', content: [{ type: 'text', text: 'Das heißt …' }] },
    )
    expect(reviewed(stopped, 4)).toBe(false)
  })

  it('a newer change after the check makes it unchecked again', () => {
    const done = answered(prepareAct(marked(), 4, { kind: 'review' }, meta)!.project, 4)
    const again = reconfirm(done, 2, [editCause('Noch einmal anders')], '2026-11-10T14:00:00.000Z')
    expect(again.steps[4].status).toBe('maybe_outdated')
    expect(reviewed(again, 4)).toBe(false)
  })

  it('an older review turn from before the newest change does not count', () => {
    const p = marked()
    expect(p.steps[2].confirmed?.at).toBe(AT)
    const early = answered(prepareAct(p, 4, { kind: 'review' }, { ...meta, at: '2026-11-10T09:00:00.000Z' })!.project, 4)
    expect(reviewed(early, 4)).toBe(false)
  })
})

describe('the recorded review answer (contract "11 · change", replayed offline)', () => {
  it('lands as a complete answer: the banner turns to "geprüft", the card is valid', async () => {
    const asked = projectSchema.parse(fixtureState('review-step5')!.project)
    expect(reviewPending(asked, 5)).toBe(true)
    const result = await replayClient('review-step5').send({ ...defaultSettings, apiKey: dummyKey }, { system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 })
    if (result.status !== 'done') throw new Error(result.status)
    const done = commitAnswer(asked, 5, result, asked.steps[5].block as never, { at: '2026-11-06T10:00:10.000Z' })
    expect(done.steps[5].segments.at(-1)!.messages.at(-1)!.toolErrors).toBeUndefined()
    expect(reviewed(done, 5)).toBe(true)
    expect(done.steps[5].proposals).toHaveLength(1)
  })
})
