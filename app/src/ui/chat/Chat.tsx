import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { problemText } from '../../ai/errors'
import { lukasText } from '../../ai/prompt'
import { PROPOSE } from '../../ai/tools'
import type { Proposal, StoredMessage } from '../../domain/schemas/project'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { ThinkingIndicator } from '../components/ThinkingIndicator'
import { Markdown } from './Markdown'
import { isThinking, messageTexts, streamTexts, type ChatRun } from './stream'
import './Chat.css'

export type ChatProps = {
  /** Every stored message of the step, oldest first. */
  messages: StoredMessage[]
  proposals: Proposal[]
  run?: ChatRun
  /** The newest turn is Lukas's and has no answer (e.g. after a reload during a failed turn). */
  unanswered: boolean
  draft: string
  onDraftChange: (text: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onRetry: () => void
  onOpenSettings: () => void
  model: string
}

/** How close to the bottom still counts as "following" the chat, in px. */
const FOLLOW_SLACK = 80

// The chat column (design §6.2). Lukas's turns right, Claude's left; the stream shows
// "denkt nach …" until text arrives. Errors stay in the chat, the input is never lost.
export function Chat({ messages, proposals, run, unanswered, draft, onDraftChange, onSend, onStop, onRetry, onOpenSettings, model }: ChatProps) {
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  const running = run?.kind === 'running'
  const announcement = useAnnouncement(messages)

  // Send ↔ Stopp and the error banner come and go; focus that went with them returns to the
  // input, so Lukas can keep typing without clicking back (design §10).
  const lastRun = useRef(run?.kind)
  useEffect(() => {
    if (lastRun.current === run?.kind) return
    lastRun.current = run?.kind
    if (!document.activeElement || document.activeElement === document.body) input.current?.focus()
  }, [run?.kind])

  // Opens at the newest message and follows the stream, unless Lukas scrolled up to read.
  const streamed = run?.kind === 'running' ? streamTexts(run.blocks).join('').length : 0
  useLayoutEffect(() => {
    const el = log.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [messages.length, streamed, run?.kind])

  function send() {
    const text = draft.trim()
    if (!text || running) return
    onDraftChange('')
    following.current = true
    onSend(text)
    input.current?.focus()
  }

  const retry = () => {
    onRetry()
    input.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    // Shift+Enter makes a new line; Enter and Cmd+Enter send.
    if (event.shiftKey && !event.metaKey) return
    event.preventDefault()
    send()
  }

  return (
    <>
      <div
        className="workspace__scroll chat__log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK
        }}
      >
        {!messages.length && !run && (
          <p className="placeholder">Hier sprichst du mit der Wirkungshelferin über diesen Schritt. Schreib einfach los.</p>
        )}
        <ol className="chat__messages">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} proposals={proposals} />
          ))}
          {run && <RunMessage run={run} />}
        </ol>
        {run?.kind === 'failed' && <RunError run={run} model={model} onRetry={retry} onOpenSettings={onOpenSettings} />}
        {!run && unanswered && (
          <p className="chat__no-answer">
            Darauf kam keine Antwort.{' '}
            <Button variant="text" onClick={retry}>
              Erneut versuchen
            </Button>
          </p>
        )}
      </div>
      <div className="visually-hidden" aria-live="polite" data-testid="chat-live">
        {announcement}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label className="visually-hidden" htmlFor="chat-input">
          Deine Nachricht
        </label>
        <textarea
          id="chat-input"
          ref={input}
          className="composer__input"
          placeholder="Schreib deine Antwort …"
          rows={2}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <Button
            variant="secondary"
            className="composer__stop"
            icon={<Icon name="stop" />}
            onClick={() => {
              onStop()
              input.current?.focus()
            }}
          >
            Stopp
          </Button>
        ) : (
          <Button type="submit" variant="text" className="btn--icon composer__send" aria-label="Senden" icon={<Icon name="send" />} />
        )}
      </form>
    </>
  )
}

function ChatMessage({ message, proposals }: { message: StoredMessage; proposals: Proposal[] }) {
  if (message.role === 'system') return null
  if (message.role === 'user') {
    const text = lukasText(message)
    if (!text) return null
    return (
      <li className="msg msg--user">
        <p className="msg__plain">{text}</p>
      </li>
    )
  }
  const uses = message.aborted ? [] : message.content.filter((b) => b.type === 'tool_use' && b.name === PROPOSE)
  const shown = uses.flatMap((use) => proposals.filter((p) => p.toolUseId === use.id))
  return (
    <li className="msg msg--assistant">
      <span className="msg__label">Wirkungshelferin</span>
      {messageTexts(message).map((text, i) => (
        <Markdown key={i}>{text}</Markdown>
      ))}
      {/* Placeholder until the proposal card (step 12). A stopped message shows none. */}
      {shown.map((p) => (
        <p key={p.id} className="msg__proposal">
          Vorschlag: {p.summary}
        </p>
      ))}
      {message.aborted && <span className="msg__aborted">abgebrochen</span>}
    </li>
  )
}

function RunMessage({ run }: { run: ChatRun }) {
  const texts = run.kind === 'running' ? streamTexts(run.blocks) : run.partial ? [run.partial] : []
  if (run.kind === 'failed' && !texts.length) return null
  const thinking = run.kind === 'running' && isThinking(run.blocks)
  return (
    <li className="msg msg--assistant" aria-busy={run.kind === 'running' || undefined}>
      <span className="msg__label">Wirkungshelferin</span>
      {texts.map((text, i) => (
        <Markdown key={i}>{text}</Markdown>
      ))}
      {thinking && (
        <p className="msg__thinking">
          <ThinkingIndicator announce={!texts.length} />
        </p>
      )}
      {/* Not stored: gone after the next try, so it says it is cut off. */}
      {run.kind === 'failed' && <span className="msg__aborted">unvollständig</span>}
    </li>
  )
}

function RunError({ run, model, onRetry, onOpenSettings }: { run: Extract<ChatRun, { kind: 'failed' }>; model: string; onRetry: () => void; onOpenSettings: () => void }) {
  const toSettings = run.problem === 'key' || run.problem === 'model'
  return (
    <div className="chat__error">
      <Banner
        tone="block"
        actions={
          <>
            {toSettings && (
              <Button variant="secondary" onClick={onOpenSettings}>
                Zu den Einstellungen
              </Button>
            )}
            <Button variant={toSettings ? 'text' : 'secondary'} onClick={onRetry}>
              Erneut versuchen
            </Button>
          </>
        }
      >
        {problemText(run.problem, model, 'chat')}
      </Banner>
    </div>
  )
}

/** One polite announcement per finished message, never per streamed token (design §10). */
function useAnnouncement(messages: StoredMessage[]): string {
  const last = messages.at(-1)
  const seen = useRef(last?.id)
  const [text, setText] = useState('')
  useEffect(() => {
    if (!last || last.id === seen.current) return
    seen.current = last.id
    if (last.role !== 'assistant') return
    setText(last.aborted ? 'Antwort abgebrochen.' : `Wirkungshelferin: ${messageTexts(last).join('\n\n')}`)
  }, [last])
  return text
}
