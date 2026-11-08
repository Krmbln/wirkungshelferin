import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MAX_PASTE } from '../../ai/chat'
import { problemText, type AiProblem } from '../../ai/errors'
import { pdfLabel, readPdfFile, type FileProblem, type PdfResult } from '../../ai/pdf'
import { Banner } from '../components/Banner'
import { Button, type ButtonProps } from '../components/Button'
import { Icon } from '../components/Icon'
import { ThinkingIndicator } from '../components/ThinkingIndicator'

// Step 0's PDF upload (design §6.2, step 15): checks the file, reads its text through Claude
// (ai/pdf.ts) and hands it on — the whole text to the chat as a PDF source, a part to the
// paste form. Lives in App, so a step switch doesn't lose it; nothing is stored until it's done.

/** Session's extractPdf with the key and model filled in. */
export type ReadPdf = (base64: string, options: { signal: AbortSignal; onProgress: (chars: number) => void }) => Promise<PdfResult>

export type PdfProblem = FileProblem | AiProblem | 'noText'

export type PdfState =
  | { kind: 'reading'; name: string; label: string; chars: number }
  /** `file`: kept for "Erneut versuchen" after an API problem. */
  | { kind: 'failed'; name: string; label: string; problem: PdfProblem; size: number; file?: Blob }

export type PdfControls = {
  state?: PdfState
  /** Why no PDF can be picked now; undefined when one can. */
  blocked?: string
  pick: (file: File) => void
  retry: () => void
  stop: () => void
  dismiss: () => void
}

type Handlers = {
  /** The whole text: it goes to the chat as a PDF source. */
  onText: (label: string, text: string) => void
  /** Only part of it, or too long to send: it opens in the paste form with a note. */
  onPartial: (label: string, text: string, note: string) => void
}

export const PDF_WAIT = 'Warte, bis das PDF gelesen ist.'
export const CHAT_WAIT = 'Warte, bis die Antwort im Chat fertig ist.'

const INCOMPLETE_NOTE = 'Das PDF war zu lang, um es ganz zu lesen. Unten steht der Text bis dahin – ergänze den Rest oder sende ihn so.'
const longNote = (chars: number) =>
  `Der Text aus dem PDF hat ${chars.toLocaleString('de-DE')} Zeichen – kürze ihn auf das Wichtigste (höchstens ${MAX_PASTE.toLocaleString('de-DE')}).`

export function usePdfImport(read: ReadPdf | undefined, handlers: Handlers, chatBusy: boolean): PdfControls | undefined {
  const [state, setState] = useState<PdfState>()
  // The reading in flight; a stopped or replaced one finds itself gone and drops its result.
  const current = useRef<AbortController | undefined>(undefined)
  const latest = useRef({ read, handlers })
  latest.current = { read, handlers }

  useEffect(() => () => current.current?.abort(), [])

  const start = useCallback(async (file: Blob, name: string) => {
    const label = pdfLabel(name) || 'PDF'
    const opened = await readPdfFile(file)
    if (!opened.ok) {
      setState({ kind: 'failed', name, label, problem: opened.problem, size: file.size })
      return
    }
    const controller = new AbortController()
    current.current = controller
    setState({ kind: 'reading', name, label, chars: 0 })
    const result = await latest.current.read!(opened.base64, {
      signal: controller.signal,
      onProgress: (chars) => setState((s) => (s?.kind === 'reading' && current.current === controller ? { ...s, chars } : s)),
    })
    if (current.current !== controller) return
    current.current = undefined
    const failed = (problem: PdfProblem) => setState({ kind: 'failed', name, label, problem, size: file.size, file })
    if (result.status === 'aborted') return setState(undefined)
    if (result.status === 'failed') return failed(result.problem)
    if (result.status === 'refused') return failed('refusal')
    const text = result.text.trim()
    if (!text) return failed(result.status === 'done' ? 'noText' : 'other')
    setState(undefined)
    if (text.length > MAX_PASTE) latest.current.handlers.onPartial(label, text, longNote(text.length))
    else if (result.status === 'incomplete') latest.current.handlers.onPartial(label, text, INCOMPLETE_NOTE)
    else latest.current.handlers.onText(label, text)
  }, [])

  const reading = state?.kind === 'reading'
  if (!read) return undefined
  return {
    state,
    blocked: reading ? PDF_WAIT : chatBusy ? CHAT_WAIT : undefined,
    pick: (file) => {
      if (!reading && !chatBusy) void start(file, file.name)
    },
    retry: () => {
      if (state?.kind === 'failed' && state.file && !chatBusy) void start(state.file, state.name)
    },
    stop: () => {
      current.current?.abort()
      current.current = undefined
      setState(undefined)
    },
    dismiss: () => setState(undefined),
  }
}

const FILE_PROBLEMS: PdfProblem[] = ['empty', 'type', 'size', 'unreadable', 'noText', 'refusal']

export function pdfProblemText(state: Extract<PdfState, { kind: 'failed' }>, model: string): string {
  const name = `„${state.name}“`
  switch (state.problem) {
    case 'empty':
      return `${name} ist leer. Wähle eine andere Datei oder füge den Text ein.`
    case 'type':
      // A name ending in .pdf would make "ist kein PDF" read like a bug.
      if (/\.pdf$/i.test(state.name)) return `${name} ist keine echte PDF-Datei – sie heißt nur so. Wähl eine andere Datei oder füge den Text ein.`
      return `${name} ist kein PDF. Wähl eine PDF-Datei oder füge den Text ein.`
    case 'size':
      return `${name} ist zu groß (${(state.size / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB). Es geht bis 24 MB – füge sonst den Text ein.`
    case 'unreadable':
      return `${name} ließ sich nicht öffnen. Wähle die Datei noch einmal oder füge den Text ein.`
    case 'noText':
      return `Im PDF ${name} war kein Text zu finden. Füge den Text stattdessen ein.`
    case 'refusal':
      return 'Claude hat das Auslesen dieses PDFs abgelehnt. Füge den Text stattdessen ein.'
    case 'other':
      return 'Das PDF ließ sich nicht lesen – vielleicht ist es geschützt oder hat mehr als 600 Seiten. Füge den Text stattdessen ein.'
    default:
      return problemText(state.problem, model, 'chat')
  }
}

type PdfButtonProps = Omit<ButtonProps, 'onClick' | 'disabledReason'> & { pdf: PdfControls; children: ReactNode }

/** A button that opens Chrome's file picker for one PDF. */
export function PdfButton({ pdf, children, ...rest }: PdfButtonProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button {...rest} disabledReason={pdf.blocked} onClick={() => input.current?.click()}>
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        data-pdf-input
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Empty again, so picking the same file once more still fires a change.
          e.target.value = ''
          if (file) pdf.pick(file)
        }}
      />
    </>
  )
}

type PanelProps = { pdf: PdfControls; model: string; onPaste: () => void; onOpenSettings: () => void; onStopped: () => void }

/** At the end of the chat log: the reading in progress, or why it failed. */
export function PdfPanel({ pdf, model, onPaste, onOpenSettings, onStopped }: PanelProps) {
  const state = pdf.state
  if (!state) return null
  if (state.kind === 'reading') {
    return (
      <div className="pdfread" aria-busy>
        <div className="pdfread__text">
          <p className="pdfread__title">
            <Icon name="document" size={16} />
            <ThinkingIndicator label={`„${state.label}“ wird gelesen …`} />
          </p>
          <p className="pdfread__note">Bei langen Dokumenten dauert das ein, zwei Minuten.</p>
          {state.chars > 0 && <p className="pdfread__count">{state.chars.toLocaleString('de-DE')} Zeichen gelesen</p>}
        </div>
        <Button
          variant="secondary"
          icon={<Icon name="stop" />}
          onClick={() => {
            pdf.stop()
            onStopped()
          }}
        >
          Stopp
        </Button>
      </div>
    )
  }
  const paste = () => {
    pdf.dismiss()
    onPaste()
  }
  const toSettings = state.problem === 'key' || state.problem === 'model'
  const fileProblem = FILE_PROBLEMS.includes(state.problem)
  // Unreadable: the same file again rarely helps, so pasting leads (UI/UX review, step 15).
  const pasteFirst = state.problem === 'other'
  return (
    <div className="chat__error">
      <Banner
        tone="block"
        actions={
          <>
            {fileProblem ? (
              <PdfButton pdf={pdf} variant="secondary">
                Anderes PDF wählen
              </PdfButton>
            ) : toSettings ? (
              <Button variant="secondary" onClick={onOpenSettings}>
                Zu den Einstellungen
              </Button>
            ) : pasteFirst ? (
              <Button variant="secondary" onClick={paste}>
                Text einfügen
              </Button>
            ) : (
              <Button variant="secondary" disabledReason={pdf.blocked} onClick={pdf.retry}>
                Erneut versuchen
              </Button>
            )}
            {pasteFirst ? (
              <Button variant="text" disabledReason={pdf.blocked} onClick={pdf.retry}>
                Erneut versuchen
              </Button>
            ) : (
              <Button variant="text" onClick={paste}>
                Text einfügen
              </Button>
            )}
          </>
        }
      >
        {pdfProblemText(state, model)}
      </Banner>
    </div>
  )
}
