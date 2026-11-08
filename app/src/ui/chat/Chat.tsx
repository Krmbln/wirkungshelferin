import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
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
import { AppLine, PasteForm, StartPanel, type PasteControls } from './StartPanel'
import { Markdown } from './Markdown'
import { PDF_WAIT, PdfButton, PdfPanel, type PdfControls } from './PdfImport'
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
  /** The card for a proposal of a complete message (App: ProposalCard). */
  renderProposal: (proposal: Proposal) => ReactNode
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
  /** Step 0: the start panel, the paste form and "+ Text einfügen" (design §6.2, step 14). */
  paste?: PasteControls
  onInterview?: () => void
  /** Step 0's PDF upload (step 15); undefined where it isn't offered. */
  pdf?: PdfControls
}

/**
 * Lukas has acted in the step: written, pasted, started the interview, or decided on a
 * change. The intro stays open until then (design §6.2, step 14); the step 1 opening the app
 * sent and Claude's messages don't count.
 */
export function lukasActed(messages: StoredMessage[], proposals: Proposal[]): boolean {
  return messages.some((m) => m.role === 'user' && m.act?.kind !== 'opening') || proposals.some((p) => p.changes.some((c) => c.state !== 'open'))
}

/** How close to the bottom still counts as "following" the chat, in px. */
const FOLLOW_SLACK = 80

// The chat column (design §6.2). Lukas's turns right, Claude's left; the stream shows
// "denkt nach …" until text arrives. Errors stay in the chat, the input is never lost.
export function Chat({ segments, intro, now, proposals, renderProposal, run, unanswered, draft, onDraftChange, onSend, onStop, onRetry, onOpenSettings, model, paste, onInterview, pdf }: ChatProps) {
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const following = useRef(true)
  // Lukas scrolled up to read while an answer comes in: "Zur neuesten Nachricht" shows.
  const [away, setAway] = useState(false)
  const messages = segments.flatMap((s) => s.messages)
  // Open until Lukas has acted in the step; then it closes once and never under his hands.
  const acted = lukasActed(messages, proposals)
  const [introOpen, setIntroOpen] = useState(() => !acted)
  const wasActed = useRef(acted)
  if (acted && !wasActed.current) {
    wasActed.current = true
    setIntroOpen(false)
  }
  // The paste form and a PDF's panel need the room: the intro folds while they show and comes back as it was.
  const pasting = !!paste?.open
  const roomNeeded = pasting || !!pdf?.state
  const running = run?.kind === 'running' || run?.kind === 'summarising'
  const reading = pdf?.state?.kind === 'reading'
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
    // An empty chat shows the start panel or the hint from the top (step 0's one next action).
    if (el && following.current && (messages.length || run || pdf?.state)) el.scrollTop = el.scrollHeight
  }, [messages.length, streamed, run?.kind, pdf?.state?.kind])

  // Marks a log cut off at the bottom, e.g. the start panel's last option under the composer
  // (macOS hides scrollbars; the gate's list does the same, step 13).
  useEffect(() => {
    const box = log.current
    if (!box) return
    const mark = () => box.toggleAttribute('data-cut', box.scrollTop + box.clientHeight < box.scrollHeight - 1)
    mark()
    box.addEventListener('scroll', mark)
    window.addEventListener('resize', mark)
    return () => {
      box.removeEventListener('scroll', mark)
      window.removeEventListener('resize', mark)
    }
  })

  const toNewest = () => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
    following.current = true
    setAway(false)
    input.current?.focus()
  }

  function send() {
    const text = draft.trim()
    // The text stays in the input while a PDF is read; the panel above says why (step 15).
    if (!text || running || reading) return
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
      items.push(<ChatMessage key={message.id} message={message} proposals={proposals} renderProposal={renderProposal} />)
    })
  })
  // At the end: Lukas is back and hasn't written yet. A summary run shows the new segment's line already.
  const atEnd = sessionStart?.index === visible.length ? session : undefined
  if (run?.kind === 'summarising') items.push(<SegmentDivider key="seg-pending" pending session={atEnd} />)
  else if (atEnd) items.push(<SessionDivider key="session" label={atEnd} />)

  return (
    <>
      {intro && <IntroPanel intro={intro} open={introOpen && !roomNeeded} onToggle={() => setIntroOpen((o) => !o)} />}
      <div
        className="workspace__scroll chat__log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK
          setAway(!following.current)
        }}
      >
        {!messages.length && !run && paste && onInterview
          ? !roomNeeded && <StartPanel onPaste={paste.onOpen} onInterview={onInterview} pdf={pdf} />
          : !messages.length && !run && <p className="placeholder">Hier sprichst du mit der Wirkungshelferin über diesen Schritt. Schreib einfach los.</p>}
        <ol className="chat__messages">
          {items}
          {run && <RunMessage run={run} />}
        </ol>
        {pdf && paste && (
          <PdfPanel pdf={pdf} model={model} onPaste={paste.onOpen} onOpenSettings={onOpenSettings} onStopped={() => setTimeout(() => input.current?.focus())} />
        )}
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
      {pasting && paste ? (
        <PasteForm
          draft={paste.draft}
          busy={running}
          note={paste.note}
          wait={paste.wait}
          onChange={paste.onChange}
          onCancel={cancelPaste}
          onSubmit={submitPaste}
        />
      ) : (
        <>
          {reading ? (
            <p className="chat__paste-line chat__wait" id="chat-wait">
              {PDF_WAIT}
            </p>
          ) : paste && messages.length > 0 && (
            <div className="chat__paste-line">
              {pdf && (
                <PdfButton pdf={pdf} variant="text" icon={<Icon name="plus" size={16} />}>
                  PDF hochladen
                </PdfButton>
              )}
              <Button variant="text" icon={<Icon name="plus" size={16} />} onClick={paste.onOpen}>
                Text einfügen
              </Button>
            </div>
          )}
          {composer()}
        </>
      )}
    </>
  )

  function cancelPaste() {
    paste?.onCancel()
    // Back to the composer, with what was typed there (the draft lives outside the form).
    setTimeout(() => input.current?.focus())
  }

  function submitPaste() {
    following.current = true
    setAway(false)
    paste?.onSubmit()
    setTimeout(() => input.current?.focus())
  }

  // Called, not rendered as <Composer />: a component defined in here would be a new type on
  // every render and remount the input while Lukas types.
  function composer() {
    return (
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
          aria-describedby={reading ? 'chat-wait' : undefined}
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
    )
  }
}

function ChatMessage({ message, proposals, renderProposal }: { message: StoredMessage; proposals: Proposal[]; renderProposal: ChatProps['renderProposal'] }) {
  if (message.role === 'system') return null
  if (message.act) return <AppLine act={message.act} />
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
      {/* Only complete messages carry proposals; a stopped one shows no card (design §6.2). */}
      {shown.map((p) => (
        <Fragment key={p.id}>{renderProposal(p)}</Fragment>
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
        {run.act ? (
          <AppLine act={run.act.kind === 'paste' || run.act.kind === 'pdf' ? { kind: run.act.kind, label: run.act.label, chars: run.act.text.trim().length } : { kind: run.act.kind }} />
        ) : (
          <li className="msg msg--user">
            <p className="msg__plain">{run.text}</p>
          </li>
        )}
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
