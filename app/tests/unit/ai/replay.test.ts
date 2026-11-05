// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import { toProposal } from '../../../src/ai/proposal'
import { PROPOSE } from '../../../src/ai/tools'
import { stepOf } from '../../../src/domain/block'
import { changeView } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema } from '../../../src/domain/schemas/project'
import type { StepId } from '../../../src/domain/types'
import { defaultSettings } from '../../../src/storage/settings'
import { dummyKey } from '../../dummyKey'
import { fixtureBody, fixtureNames, fixtureState, replayClient, sseEvents } from '../../replay'

// The streams recorded by `npm run contract`, replayed offline (implementation plan step 8).

const settings = { ...defaultSettings, apiKey: dummyKey }
const call = { system: 's', messages: [{ role: 'user' as const, content: 'x' }], maxTokens: 100 }

const complete = ['step1-opening', 'step1-update', 'step1-after-stop', 'step1-reload', 'pdf-round1', 'pdf-round2']
const stopped = ['step1-stopped-thinking', 'step1-stopped-tool']

describe('recorded fixtures', () => {
  it('exist for every contract scenario', () => {
    expect(fixtureNames()).toEqual(expect.arrayContaining([...complete, ...stopped]))
  })

  it('contain no credentials and no real names', () => {
    // Split so this file doesn't trip the repo scan itself.
    const patterns = [['sk', '-ant-'].join(''), ['x-api', '-key'].join(''), ['author', 'ization'].join('')]
    const names = realNames()
    for (const name of fixtureNames()) {
      const text = fixtureBody(name) + JSON.stringify(fixtureState(name) ?? '')
      for (const p of patterns) expect(text.toLowerCase(), `${name} contains ${p}`).not.toContain(p)
      for (const real of names) expect(text.toLowerCase(), `${name} contains a real name`).not.toContain(real)
    }
  })

  it.each(complete)('%s replays to a finished message', async (name) => {
    const result = await replayClient(name).send(settings, call)
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(['end_turn', 'tool_use', 'max_tokens']).toContain(result.message.stop_reason)
    // Thinking blocks come back with a signature, to be stored and sent back unchanged.
    for (const block of result.message.content.filter((b) => b.type === 'thinking')) expect(block.signature).toBeTruthy()
  })

  it.each(complete.filter((n) => n.startsWith('step1')))('%s: every propose_changes call converts and applies', async (name) => {
    const state = fixtureState(name)!
    const step = state.step as StepId
    let project = projectSchema.parse(state.project)
    const result = await replayClient(name).send(settings, call)
    if (result.status !== 'done') throw new Error(result.status)
    const uses = result.message.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use' && b.name === PROPOSE)
    uses.forEach((use, i) => {
      const converted = toProposal(step, use.input, { seen: stepOf(project, step).block, toolUseId: use.id, proposalId: `r${i + 1}`, at: '2026-11-05T10:00:00.000Z' })
      if (!converted.ok) throw new Error(converted.errors.join('; '))
      project = reducer(project, { type: 'proposal/add', step, proposal: converted.proposal })
      for (const change of converted.proposal.changes) expect(changeView(project, step, `r${i + 1}`, change.id).kind).not.toBe('stale')
      project = reducer(project, { type: 'change/applyAll', step, proposalId: `r${i + 1}` })
      expect(project.steps[step].proposals.at(-1)!.changes.every((c) => c.state === 'applied')).toBe(true)
    })
    projectSchema.parse(project)
  })

  it.each(stopped)('%s is a cut-off stream: starts, never finishes', (name) => {
    const types = sseEvents(fixtureBody(name)).map((e) => e.type)
    expect(types[0]).toBe('message_start')
    expect(types).toContain('content_block_start')
    expect(types).not.toContain('message_stop')
  })

  it('the stop during tool_use was cut at the tool_use block', () => {
    const starts = sseEvents(fixtureBody('step1-stopped-tool')).filter((e) => e.type === 'content_block_start')
    expect((starts.at(-1)!.content_block as { type: string }).type).toBe('tool_use')
  })
})

/** Lower-case real names from the scan's list (CI secret or the git-ignored local file). */
function realNames(): string[] {
  const file = fileURLToPath(new URL('../../../../.real-names.txt', import.meta.url))
  const raw = process.env.REAL_NAMES ?? (existsSync(file) ? readFileSync(file, 'utf8') : '')
  return raw
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'))
}
