import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Project, StoredMessage } from '../src/domain/schemas/project'
import type { StepId } from '../src/domain/types'

// Home summary fixtures (step 22): chats written in short form. Made-up content.

export type Line = { role: 'user' | 'assistant'; text: string; at: string; aborted?: true; toolUseId?: string }

let n = 0
function stored({ role, text, at, aborted, toolUseId }: Line): StoredMessage {
  // A user turn ends with [his text, snapshot] (prompt.ts lukasText).
  const content =
    role === 'user'
      ? [{ type: 'text', text }, { type: 'text', text: '[Baustein unverändert]' }]
      : [{ type: 'thinking', thinking: 'hm', signature: 'sig' }, ...(text ? [{ type: 'text', text }] : []), ...(toolUseId ? [{ type: 'tool_use', id: toolUseId, name: 'propose_changes', input: {} }] : [])]
  return { id: `m${++n}`, at, role, content, ...(aborted && { aborted }) }
}

/** A copy with the step's chat set to these lines (one segment). */
export function withChat(project: Project, step: StepId, lines: Line[]): Project {
  const copy = structuredClone(project)
  copy.steps[step].segments = lines.length ? [{ id: `seg${step}`, startedAt: lines[0].at, model: 'claude-opus-5-5', messages: lines.map(stored) }] : []
  return copy
}

/** A complete structured-output answer. */
export const resumeAnswer = (json: unknown, stop: BetaMessage['stop_reason'] = 'end_turn') =>
  ({
    id: 'msg_r',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: 'kurz', signature: 'sig' }, { type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json), citations: null }],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as BetaMessage
