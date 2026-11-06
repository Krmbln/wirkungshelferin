import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { problemText } from '../../ai/errors'
import { lukasText } from '../../ai/prompt'
import { PROPOSE } from '../../ai/tools'
import type { ChatSegment, Proposal, StoredMessage } from '../../domain/schemas/project'
import type { StepIntro } from '../../guide/intro'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { ThinkingIndicator } from '../components/ThinkingIndicator'
import { IntroPanel } from './IntroPanel'
import { Markdown } from './Markdown'
import { sessionBreak, sessionLabel } from './sessions'
import { isThinking, messageTexts, streamTexts, type ChatRun } from './stream'
import './Chat.css'

export type ChatProps = {
  /** The step's chat segments, oldest first; all stay visible. */
  segments: ChatSegment[]
  /** The step's intro panel; open while the chat is empty. */
  intro?: StepIntro
  /** For the "Letzte Sitzung" divider. */
  now: Date
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
export function Chat({ segments, intro, now, proposals, run, unanswered, draft, onDraftChange, onSend, onStop, onRetry, onOpenSettings, model }: ChatProps) {
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  // Lukas scrolled up to read while an answer comes in: "Zur neuesten Nachricht" shows.
  const [away, setAway] = useState(false)
  const messages = segments.flatMap((s) => s.messages)
  // Open on a first visit, collapsed once the step has a chat; it never closes under Lukas's hands.
  const [introOpen, setIntroOpen] = useState(() => !messages.length)
  const running = run?.kind === 'running' || run?.kind === 'summarising'
  const announcement = useAnnouncement(messages)
  const visible = messages.filter((m) => m.role !== 'system')
  const sessionStart = sessionBreak(visible.map((m) => m.at), now)

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

  const toNewest = () => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
    following.current = true
    setAway(false)
    input.current?.focus()
  }

  function send() {
    const text = draft.trim()
    if (!text || running) return
    onDraftChange('')
    following.current = true
    setAway(false)
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

  // Session divider before the first message after the newest break (or at the end), segment
  // dividers where a new segment starts. Both at one spot merge into one line.
  const session = sessionStart && sessionLabel(sessionStart.last, now)
  const items: ReactNode[] = []
  let index = 0
  segments.forEach((segment, si) => {
    segment.messages.forEach((message, mi) => {
      const here = message.role !== 'system' && sessionStart?.index === index++
      if (si > 0 && mi === 0) items.push(<SegmentDivider key={`seg-${segment.id}`} summary={segment.summaryOfPrevious} session={here ? session : undefined} />)
      else if (here) items.push(<SessionDivider key="session" label={session!} />)
      items.push(<ChatMessage key={message.id} message={message} proposals={proposals} />)
    })
  })
  // At the end: Lukas is back and hasn't written yet. A summary run shows the new segment's line already.
  const atEnd = sessionStart?.index === visible.length ? session : undefined
  if (run?.kind === 'summarising') items.push(<SegmentDivider key="seg-pending" pending session={atEnd} />)
  else if (atEnd) items.push(<SessionDivider key="session" label={atEnd} />)

  return (
    <>
      {intro && <IntroPanel intro={intro} open={introOpen} onToggle={() => setIntroOpen((o) => !o)} />}
      <div
        className="workspace__scroll chat__log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK
          setAway(!following.current)
        }}
      >
        {!messages.length && !run && (
          <p className="placeholder">Hier sprichst du mit der Wirkungshelferin über diesen Schritt. Schreib einfach los.</p>
        )}
        <ol className="chat__messages">
          {items}
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
      {running && away && (
        <div className="chat__jump">
          <Button variant="secondary" icon={<Icon name="chevronDown" />} onClick={toNewest}>
            Zur neuesten Nachricht
          </Button>
        </div>
      )}
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

function SessionDivider({ label }: { label: string }) {
  return (
    <li className="chat__divider">
      <span className="chat__divider-label">{label}</span>
    </li>
  )
}

/**
 * Where a new segment starts: the assistant knows what's above only from the summary.
 * `pending` = the summary is still being written. `session` = a break ended here too.
 */
function SegmentDivider({ summary, session, pending = false }: { summary?: string; session?: string; pending?: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <li className="chat__divider chat__divider--segment">
      <span className="chat__divider-label">{session ? `${session} · Neuer Gesprächsabschnitt` : 'Neuer Gesprächsabschnitt'}</span>
      {pending ? null : summary ? (
        <>
          <button type="button" className="chat__summary-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            Zusammenfassung
            <Icon name={open ? 'chevronDown' : 'chevronRight'} />
          </button>
          <div id={id} className="chat__summary" hidden={!open}>
            <p className="chat__summary-lead">Das Gespräch darüber kennt die Wirkungshelferin nur noch so:</p>
            <Markdown>{summary}</Markdown>
          </div>
        </>
      ) : (
        <span className="chat__divider-note">Das Gespräch darüber kennt die Wirkungshelferin nicht mehr. Dein Baustein ist davon nicht betroffen.</span>
      )}
    </li>
  )
}

function RunMessage({ run }: { run: ChatRun }) {
  if (run.kind === 'summarising') {
    // Lukas's turn waits for the summary; it is stored with the new segment's first message.
    return (
      <>
        <li className="msg msg--user">
          <p className="msg__plain">{run.text}</p>
        </li>
        <li className="msg msg--assistant" aria-busy>
          <span className="msg__label">Wirkungshelferin</span>
          <p className="msg__thinking">
            <ThinkingIndicator label="fasst das bisherige Gespräch zusammen …" />
          </p>
        </li>
      </>
    )
  }
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
