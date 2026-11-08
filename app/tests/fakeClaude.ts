// Made-up API responses in the wire format (SSE), for unit tests and Playwright routes.

const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`

/** A complete streamed answer "OK" with the given stop reason. */
export function sseAnswer(stopReason: 'end_turn' | 'max_tokens' | 'refusal' = 'end_turn'): string {
  return [
    event('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1 },
      },
    }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 2 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('')
}

/** An error event in the middle of a stream (HTTP 200 already sent). */
export function sseError(type: string): string {
  return sseAnswer().split('event: content_block_delta')[0] + event('error', { type: 'error', error: { type, message: 'test' } })
}

/** The JSON body of an HTTP error response. */
export function errorBody(type: string, message = 'test'): string {
  return JSON.stringify({ type: 'error', error: { type, message } })
}

/** A complete streamed answer that is one tool call, e.g. report_quality_check. */
export function sseToolUse(name: string, input: unknown, id = 'toolu_test'): string {
  return [
    event('message_start', {
      type: 'message_start',
      message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } },
    }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('')
}
