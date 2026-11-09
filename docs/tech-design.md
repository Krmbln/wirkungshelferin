# Technical Design — Wirkungshelferin (v1)

> ✅ **Approved by PO 2026-11-02**, incl. D1–D4 as recommended.

> Phase 3 output. Draft 2026-11-02, input: `docs/prd.md` (approved 2026-10-07, revised 2026-10-10), `docs/research.md` §9, method guide r2, eval harness (`eval/harness.py`).
> PO decisions taken for this draft (2026-11-02): default model **Claude Opus 5.5**; **Google Chrome only** (Edge blocked).
> Tech Architect review 2026-11-02: 1 Critical (model saw a stale block), 5 High, 7 Medium → all incorporated (§6.2–6.8, §8, §12–15). Re-review: Critical resolved; 2 new High (stable short IDs, message order) + 3 Medium → incorporated.

---

## 1. Summary

A static single-page app (React + TypeScript, built with Vite) hosted on GitHub Pages. No backend. All state lives in Lukas's Chrome (IndexedDB) with backup files as the safety net. The app calls the Claude API directly from the browser with Lukas's key. The method guide (Markdown in `method-guide/`) is bundled into the build and becomes the assistant's system prompt, exactly like the eval harness does today.

The two hard parts are:
1. **Proposals that Lukas applies item by item ("Übernehmen")**, without ever overwriting his own edits → structured tool calls + item revisions (§6.4).
2. **Long-lived state across months in one browser** → IndexedDB + persistent storage + schema-versioned backups (§8).

Everything else is ordinary UI work.

---

## 2. Constraints that shape the design

| Constraint | Source | Consequence |
|---|---|---|
| No backend, no server DB, ~€0 hosting | research §9, PRD §9 | Static hosting; browser storage; direct browser → Claude API calls |
| One user, one project, Chrome on a Mac | PRD §2, F1 | No auth, no sync, no multi-project model; desktop layout only |
| API key in the browser | PRD F1, §10 | Key stored separately from project data, never in backups or logs; spending cap on the key |
| Guide and prompts are public | PRD F9 | Guide is plain Markdown in the repo, bundled at build time |
| Assistant only proposes; Lukas applies | PRD F4 | Structured proposals with per-change apply and staleness detection |
| Hard blocks (⛔) are a fixed list | PRD F4 | ⛔ rules are deterministic code, not AI judgement |
| Claude builds and maintains the code; Karim deploys | CLAUDE.md | Mainstream, well-documented stack; one-command deploy via CI |

---

## 3. Stack

| Layer | Choice | Why | Alternative (when it would be better) |
|---|---|---|---|
| Language | **TypeScript** (strict) | Types catch most state/schema bugs before Lukas sees them; the official Claude SDK is first-class in TS | Plain JS: only if the app were a few hundred lines |
| UI | **React 19** | Most documented UI library; the app is state-heavy (chat, proposals, block panel, statuses) | Svelte: smaller bundle, but fewer examples and less tooling Claude can lean on |
| Build | **Vite** | Zero-config static build; imports the guide Markdown as raw strings (`?raw`) | — |
| State | `useReducer` + context, **pure reducer functions** | No extra library; reducers are trivially unit-testable (F6 rules, staleness) | Zustand: if state access across components gets awkward |
| Validation | **Zod 4** | One schema per block type → TS types, tool JSON schemas (`z.toJSONSchema`), backup validation and migration checks from a single source | Hand-written JSON Schema: more drift risk |
| Storage | **IndexedDB via `idb-keyval`** | Tiny wrapper; IndexedDB has no 5 MB limit (chats grow); survives as long as Chrome keeps site data | `localStorage`: simpler, but the 5 MB cap is reachable with long chats |
| AI | **`@anthropic-ai/sdk`** (official TS SDK) in browser mode | Streaming, tool use, typed errors, retries built in | Raw `fetch`: not allowed by our own rule (use the SDK) |
| Markdown in chat | **`react-markdown`** | Renders assistant Markdown without raw HTML (safe by default) | — |
| Styling | Plain CSS with custom properties (tokens from Phase 4) | No framework to learn; Phase 4 defines the tokens | Tailwind: faster prototyping, but noisier markup |
| Routing | None (app state decides the view: home / step N / settings) | Three views don't need a router; avoids GitHub Pages deep-link issues | — |
| Unit/component tests | **Vitest + Testing Library + jsdom + fake-indexeddb** | Fast, same config as Vite | — |
| E2E tests | **Playwright** (Chrome channel, ~6 smoke tests) | Only a real browser proves IndexedDB survives reload and the Chrome gate works | Skip E2E: cheaper, but persistence is the #1 risk (A4) |
| Hosting | **GitHub Pages** via a GitHub Actions workflow | Free, decided in research §9; push to `main` = deploy | Cloudflare Pages: free and allows a **private** repo (see D3) |

Railway (mentioned in CLAUDE.md) is not needed: there is no server.

### 3.1 Packages to install (PO approval required)

| Runtime | Dev only |
|---|---|
| `react`, `react-dom`, `@anthropic-ai/sdk`, `zod`, `idb-keyval`, `react-markdown` | `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `fake-indexeddb`, `@playwright/test` |

Six runtime dependencies. Nothing else gets installed without asking.

---

## 4. Architecture

```
┌────────────────────────── Lukas's Chrome ───────────────────────────┐
│                                                                      │
│  UI (React views)                                                    │
│   Home · StepWorkspace(intro | chat | block panel | quality check)   │
│   Settings · Setup · ChromeGate                                      │
│        │ dispatch(action)                ▲ state                     │
│        ▼                                 │                           │
│  Domain core (pure TS, no React, no I/O)                             │
│   reducer · block schemas · ⛔ validators · proposal apply/staleness │
│   change handling (F6) · copy formatter · migrations                 │
│        │ state changes                   ▲ load                      │
│        ▼                                 │                           │
│  Persistence ── autosave (debounced) ──► IndexedDB                   │
│   project doc (one key) · settings (separate key: API key, model)    │
│   backup export/import (JSON file, no API key)                       │
│                                                                      │
│  AI layer                                                            │
│   prompt builder (guide + context) · tool defs (from Zod)            │
│   streaming client · error mapper · summariser · PDF extractor       │
│        │ HTTPS, user's key                                           │
└────────┼─────────────────────────────────────────────────────────────┘
         ▼
   Claude Messages API (api.anthropic.com)
```

**Rule:** the domain core never calls the network or storage. The AI layer and persistence are adapters behind small interfaces (`AiClient`, `Store`), so tests swap in a scripted mock AI and fake-indexeddb.

---

## 5. Project structure

The web app lives in `app/` so the repo keeps docs, guide and eval side by side.

```
app/
  index.html
  vite.config.ts            # base path for Pages; allows importing ../method-guide
  src/
    main.tsx
    ui/                     # React views + components
      home/  step/  chat/  block/  settings/  setup/  gate/
    domain/
      types.ts              # Project, StepState, Item, Proposal …
      schemas/step0.ts … step6.ts   # Zod schemas per block
      reducer.ts
      validators/           # ⛔ rules per step (pure functions)
      proposals.ts          # apply / reject / staleness
      changeHandling.ts     # F6 status cascade
      copy.ts               # F8 HTML + plain text
      migrations.ts         # schema versions
    ai/
      client.ts             # AiClient interface + SDK implementation
      prompt.ts             # system prompt + context assembly
      tools.ts              # propose_changes / report_quality_check per step
      summarise.ts
      pdf.ts
      errors.ts             # API error → plain German message
    storage/
      store.ts              # IndexedDB adapter, persist() request
      backup.ts
    guide/index.ts          # imports method-guide/*.md?raw
  tests/
    unit/  component/  e2e/
.github/workflows/deploy.yml
```

---

## 6. AI integration

### 6.1 Model and settings
- Default model **`claude-opus-5-5`**, stored in settings, changeable by Karim without redeploy (PRD F1).
- **Effort:** `medium` (the model's default), set explicitly; changeable in settings. Thinking is always on with this model (it can't be disabled); the UI shows "denkt nach …" until text streams.
- **Refusal fallback:** requests send the server-side fallback option (`fallbacks: "default"` with its beta header) so a rare safety refusal falls back to another model instead of failing. The app still checks `stop_reason` and shows a plain message on `refusal`.
- Browser mode: SDK client created with `dangerouslyAllowBrowser: true` (sends the direct-browser-access header). Exact option names are verified against the SDK docs at build time.
- **`max_tokens` per call type** (thinking counts against it): chat turn 16k, quality check 8k, summary 4k, PDF extraction 32k (streamed, see 6.6).
- **Changing the model in settings starts a new segment** in every step, because thinking blocks and the cache belong to one model.

### 6.2 Prompt assembly (one request = one step)
Order matters for caching (tools → system → messages):

1. **Tools**: `propose_changes` and `report_quality_check` for the current step (§6.3). Stable per step.
2. **System prompt** (stable per step, cached): role + app operating rules (how proposals and the quality check work, replacing the harness's `<BAUSTEIN>` tags) + `00-shared.md` + `glossary.md` + current step file. ~25–30k tokens. Cache breakpoint at its end.
3. **Context message** (first user turn of a chat segment): project profile, measurement frame and the latest confirmed version of each other step (unconfirmed → current draft labelled "nicht bestätigt"), plus the current step's block. Not other steps' chats (PRD F4).
4. **Chat history** of the current segment, **append-only**.
5. **App events** (e.g. "Lukas hat Änderung 2 übernommen", "Feld X manuell geändert") go in as mid-conversation `system` messages, not as fake user text. They carry the narrative, not the data.
6. **Current block state** — the newest user turn ends with a compact snapshot of the current block: each item with its **short ID** (`tg1`, `c3`, `l2`, see §7), its current `rev`, its `editedByUser` flag and its field values, plus the step's open ⛔ issues. The system prompt tells the assistant that **only the latest snapshot counts**. A full snapshot is sent only when the block changed since the last one; otherwise the turn says "Block unverändert". Because it sits in the newest message, history stays append-only and the cached prefix is untouched. Snapshot tokens are counted separately from the segment threshold (6.5).

**Message order after an assistant turn with tool calls:** `[user: all pending tool_result blocks]` → `[system: app events]` → `[user: Lukas's text + block snapshot]`. If the API rejects this shape (consecutive user turns around a system message), the fallback is one user message: tool_results first, then the events as text, then Lukas's text and the snapshot. The live contract test (§13) settles the shape **before** any UI is built on it; prompt assembly has a unit test for the chosen order.

*As decided by the live contract (step 8, 2026-11-05):* the order is the **single user message** — `[user: tool_results, then the events as "[App] …" text, then Lukas's text, then the snapshot]`. The API refuses a `system` message between two user turns (it must end the array or come right before an assistant turn). Events as a `system` message *after* Lukas's turn pass a normal turn, but break after a stopped answer: the stopped answer is never sent, which leaves `[system] → [user]`. `MESSAGE_ORDER` in `src/ai/prompt.ts` holds the decision, and the contract fails if a later run disagrees. The context message and every snapshot are stored inside the user turn that carried them, so the history stays append-only. Stopped turns are stored with `aborted: true` and left out of every payload; a stopped turn's `tool_use` therefore never needs a `tool_result`. Both cache breakpoints use the 1-hour TTL.

*As built (step 9):* Lukas's turn is stored **before** the request goes out (`ai/chat.ts` `prepareTurn`), so nothing he typed is lost when the call fails or the tab reloads; the request is always exactly the stored history of the current segment. A failed call or a refusal stores nothing more: the chat shows the error and "Erneut versuchen", which sends the same history again (`prepareRetry`). After a reload, a turn without an answer shows "Darauf kam keine Antwort." with the same retry. If Lukas writes instead, two user turns follow each other, which the API accepts (the contract's after-stop case). A stopped answer is stored with whatever had arrived (or empty) as `aborted`. The block the newest user turn showed is kept as `sentBlock` on the step: it decides "[Baustein unverändert]" and is the `seen` for a retried answer's proposals. Invalid tool calls keep their errors on the assistant message (`toolErrors`, local metadata) and are answered as error results in the next turn, also after a reload.

**Caching:** two breakpoints, one after the system prompt and one on the last message, so the growing history is cached turn by turn. The system-prompt breakpoint uses the **1-hour TTL**, because Lukas often edits the block or thinks for more than 5 minutes between turns.

**Append-only rule:** the stored history is never edited, including the assistant's thinking blocks, which are stored and sent back unchanged. The current models reject edited history on newer accounts. When a chat gets long, the app doesn't rewrite it; it starts a **new segment** (see 6.5).

### 6.3 Tools
Both tools use `strict: true`, `tool_choice: auto` (forced tool choice isn't supported on this model), and are generated from the Zod schemas.

**`propose_changes`** — the only way the assistant changes a block.
```ts
{ summary: string,               // one sentence: what and why (guide §4)
  changes: Array<                // discriminated union per step, discriminator = collection + op
    | { op: "add",    collection: "targetGroups", tempId: "new:1", fields: TargetGroupFields }
    | { op: "update", collection: "targetGroups", targetId: "tg1", fields: Partial<TargetGroupFields> }
    | { op: "remove", collection: "targetGroups", targetId: "tg1" }
    | …one variant per collection of the step > }
```
- Every variant has `additionalProperties: false`; the union is generated from the step's Zod schemas.
- **Temporary IDs:** an `add` carries a `tempId` (`new:1`); other changes in the same proposal may reference it (e.g. a new link pointing to a new output). Applying resolves temp IDs to real IDs.
- A unit test sends every generated step schema through the strict-mode check of the live contract test (§13). If a step's union is too large for strict mode, that step falls back to `strict: false` with the same Zod validation.
*As built (step 8):* strict mode allows at most 16 union-typed and 24 optional parameters per request, so the schema is flat. Every field is required; optional texts are `""`; `why` only exists on Why-carrying collections. There is one variant per collection (`op` add | update; singletons: update only, under their own id) plus one shared `remove` variant, and this list is the only union. **An update carries the item's complete fields**; the app keeps only the fields that differ from the snapshot it sent and adds `baseRev` itself, so Claude never supplies revs. Both tools set `eager_input_streaming`; every input is validated with the same Zod schema before it becomes a card. All 7 steps passed strict mode live, so none needs the `strict: false` fallback.

**`report_quality_check`** — the assistant's rubric judgement (✓ / ⚠ per criterion + one sentence). Criteria IDs come from the step's rubric table in the guide.
*As built (step 13):* the gate's "Prüfen" is a request of its own (`ai/chat.ts` `checkCall`): the stored history of the current segment plus one more user turn (pending tool results, "[App] Die Person hat … auf „Prüfen“ geklickt …", snapshot), built with `prepareTurn` on a copy, so nothing is stored. Same tools and system prompt; the cache breakpoint stays on the last *stored* turn (the check turn is never sent again); 8k `max_tokens`, effort from the settings. Claude must name each criterion once; the criteria the hard rules own (`domain/check.ts` `HARD_CRITERIA`, step 1: 8 = Why, 5 = focus groups — a unit test checks they are exactly the rubric rows with ⛔) may be left out and count as ✓ "Von der App geprüft." No usable check or a `max_tokens` stop → "kein Ergebnis". A check Claude reports in a normal chat turn fills the gate too (for the block that turn showed); an invalid or cut-off one is answered with an `is_error` tool_result. A check is stamped when it lands and an older one never replaces a newer one (gate and chat can finish in either order). The next chat turn carries "[App]" lines for a gate check (⛔/⚠/✓ lines; "für einen älteren Stand" when the block changed since) and for a confirm (with `confirmedWarnings`) newer than Lukas's last turn — derived from timestamps, nothing queued. Every snapshot lists the open ⛔ issues ("⛔ offen:").

Because the tool input streams, the app validates each tool input against its Zod schema before showing it. Invalid input → an error `tool_result` back to the assistant, never a broken card.

**Tool results:** a `propose_changes` call is answered in the next request with a `tool_result` listing which changes Lukas applied, rejected or left open (order rule in 6.2).

### 6.4 Proposals and the ownership rule (PRD F4)
- Every item has a stable `id` and a `rev` counter. `rev` increases on every change (by Lukas or by an applied proposal).
- Each `update`/`remove` change gets as `baseRev` the rev the assistant **saw** — taken from the block snapshot sent with that request (6.2 item 6), not from the block when the answer arrives. An edit Lukas makes while the answer streams therefore makes the change stale.
- Applying a change checks `item.rev === baseRev`. If not → the change is shown as **"veraltet"** and can't be applied. This alone guarantees an old proposal never overwrites a manual edit.
- **Several changes to one item** in the same proposal are chained: applying the first sets the next one's expected rev, so "Alle übernehmen" doesn't mark its own changes stale.
- **Dependencies:** a change that references a `tempId` can only be applied after the change that creates it ("Zuerst Änderung N übernehmen"). Rejecting the creating change makes dependent changes stale.
- Fields Lukas edited carry `editedByUser: true`; the context message tells the assistant, which must propose instead of assuming.
- "Alle übernehmen" applies the non-stale changes in order; per-change apply is the same function.

### 6.5 Long chats and "Where you left off"
- **Segments:** when a step's history passes ~40 messages or ~30k tokens, the app asks the model (same model, effort `low`) for a summary of the segment, then starts a new segment whose context message includes that summary. The old segment stays stored and visible in the UI.
*As built (step 10, `ai/summarise.ts`):* a segment rolls over at **40 stored messages**, or when the prompt grew by **30k tokens** since the segment's first answer (each complete answer stores `usage` {prompt = input + cache write + cache read, output}), or when the settings name a **different model** than the segment's `model` (segments from before step 10 have none and never count). The check runs when Lukas sends. The summary request sends the old segment as **plain text** (Lukas's words, Claude's text, proposals as one line; no thinking, tool results, snapshots or stopped answers), with its own short German system prompt, effort `low`, 4k, no tools. So it works across a model change and never has open tool calls. The new segment's first user turn carries the context message plus "[Bisheriges Gespräch in diesem Schritt, zusammengefasst]"; answers to the old segment's open tool calls go in as "[App]" lines (the new segment has no tool_use to answer); the snapshot is full. The operating rules say to continue without a new greeting. A failed or refused summary never blocks Lukas: a size rollover stays in the old segment (and tries again next turn); a model rollover starts the segment without summary and says so. Lukas's text is not stored during the summary; it waits in the stored drafts (not on screen), so a reload brings it back, and Stopp puts it back into the input.
- **Home summary:** generated with effort `low` when Lukas navigates within the app (back to home or to another step) after new activity, and stored on the step. Not on tab close: an API call can't finish reliably there. If the summary is missing, home shows the step's last assistant question instead.

### 6.6 PDF import (step 0)
The PDF is sent once as a base64 `document` block with an extraction instruction (works for scanned PDFs, since the model reads pages visually). The extracted text is streamed and stored; if it hits `max_tokens`, the app asks the model to continue where it stopped. The file is discarded. Limits: files up to ~24 MB (the 32 MB request limit minus base64 overhead), 600 pages. Failure → plain message + paste fallback (PRD F3).

*As built (step 8):* `extractPdf` uses effort `low` (copying text needs no deep thinking, and thinking counts against `max_tokens`). On a `max_tokens` stop, the full assistant turn goes back unchanged, followed by a user turn quoting the end of the text so far ("mach genau dort weiter"); there is no assistant prefill on this model. At most 4 rounds; then `incomplete` with the text so far.

*As built (step 15, PDF upload + contact data, PO 2026-11-08 "as safe as possible, 80/20"):* `extractPdf` streams a live character count (`onProgress`); files are checked in the browser first (empty, not "%PDF-", > 24 MB) and read as base64 only then. Two layers keep contact data out of what is stored and sent again: (1) the reading instruction (`PDF_SYSTEM`) replaces people's names, phone numbers, e-mail and postal addresses, signatures, bank details and dates of birth with placeholders ([Name], [Telefon] …), keeping roles, organisations and project places; (2) `domain/contacts.ts` `scrubContacts` replaces e-mail addresses, phone numbers and IBANs in **every** source (paste and PDF) in `prepareAct`, before it is stored or sent (linear patterns with start anchors and length caps). The step 0 rules tell Claude the placeholders are deliberate (no asking, roles instead of names). Limit: the reading call itself sees the whole PDF. Checked on the real application: no name, phone, e-mail, street or signature left in the stored text; profile quality unchanged.

*As built (step 14, step 0 without PDF):* a paste is Lukas's own material: `sources` items (`userOnly`, never in the tools) {origin, label, text, at}. `ai/chat.ts` `prepareAct` sends a paste's full text **once**, in the turn that adds it (`[Quelle srcN: „…“]` before the "[App] …" line); every snapshot shows a source as label + `chars`, never the text. Step 1's context message appends step 0's sources in full (the opening drafts from them); a new step 0 segment carries them too; steps 2–6 see the profile only. Buttons that start a turn (paste, interview, step 1 opening) store the turn with `act` and show it as an app line. Confirming step 0 while step 1's chat is empty sends step 1's opening at once. Step 0 has no ⛔; rubric criterion 1 (completeness: every form field filled or "offen", except budgetRange / openQuestions) is judged by the app (`withAppJudged` in the reducer and the check runner). Operating rules: in a message with a proposal, text and the one question come **before** the tool call (a tool call ends the turn; found in the step 14 PO run).

### 6.7 Errors (PRD F1, §5)
The SDK's typed errors are mapped to plain German messages with what to do:

| Case | Detected by | Message direction |
|---|---|---|
| Invalid key | 401 `AuthenticationError` | "Schlüssel ungültig – in den Einstellungen prüfen" |
| No credit | 402 `billing_error` (fallback: 400 with "credit balance" text) | "Guthaben aufgebraucht – Karim Bescheid geben" |
| Rate limit / overloaded | 429 / 529 | "Kurz warten, dann erneut" (SDK retries twice first) |
| Offline | connection error / `navigator.onLine` | "Keine Internetverbindung" |
| Stream breaks | stream error event | Partial text kept, "Erneut versuchen" button; input preserved |
| Refusal | `stop_reason: "refusal"` | Plain note + retry |

*As built in step 7:*
- `src/ai/`: `AiClient` interface (`testConnection(settings)` for now; chat calls join in steps 8–9), `sdkAiClient()` on `@anthropic-ai/sdk` 1.1.0 (pinned; 1.x sends the key as a bearer token, not as `x-api-key`), `scriptedAiClient()` for tests and the gallery. A new SDK client per call, built from the current settings; SDK logging off, `maxRetries` 2.
- `requestParams(settings, …)` is the one place the shared options live: `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`, `output_config.effort`, system prompt with `cache_control` TTL `1h`, streamed. The connection test uses it with a tiny prompt and `max_tokens` 256 (a `max_tokens` stop still counts as success), 30 s timeout.
- Error mapper (`classifyError` → `key | credit | model | busy | offline | unreachable | refusal | other`): 401/403 → key, 402/`billing_error` → credit, 404 → model (the model ID is editable), 429/529 or `rate_limit_error`/`overloaded_error` without status (SSE error event) → busy, `APIConnectionError` → offline if `navigator.onLine` is false, else unreachable. Offline is detected before sending, so no retries run. The console gets status, type and request id only.
- Setup (once per Chrome, `settings.setupDone`): plan = welcome + privacy if `!privacyNoteSeen`, key always, backup if no `lastBackupAt`. Settings now load on every start path, including the load-error screen.

### 6.8 Cost estimate (Opus 5.5: $4 / $20 per MTok; cache reads $0.20; cache writes 1.25× (5 min) or 2× (1 h))
- **Warm turn** (cache hit): read system + history ~45k → ~$0.01; write new tokens ~2k → ~$0.01; output incl. thinking ~1.5k → ~$0.03. **≈ $0.05.**
- **Cold turn** (cache expired, e.g. first turn of a session): write ~45k at the 1-h rate → ~$0.36 + output → **≈ $0.40.**
- Lukas at ~1 hour per week (~15 turns, 1–2 cold starts): **≈ $5–12 per month**, depending on how often the cache goes cold. A full pass through steps 0–6 (~350 turns) ≈ $30–60. Spending cap on the key as the ceiling.
- Measured `usage.cache_read_input_tokens` is checked in the live contract test (§13) to confirm the cache actually hits.

---

## 7. Data model

All types are defined as Zod schemas; TS types are inferred. One JSON document per project.

```ts
Project {
  schemaVersion: number
  createdAt, updatedAt: string            // ISO
  lastBackupAt?: string
  lastActive?: { stepId: StepId, at: string }
  privacyNoteSeen: boolean
  steps: Record<StepId, StepState>        // StepId = 0..6
  idCounters: Record<string, number>      // per collection, for shortId
}

StepState {
  status: "not_started" | "in_progress" | "confirmed" | "maybe_outdated"
  block: Block<StepId>                    // current working block
  segments: ChatSegment[]                 // append-only chats
  proposals: Proposal[]
  qualityCheck?: QualityCheck             // last check: { at, source: app|chat, block it judged, results ✓/⚠ } — ⛔ derived from that block (step 13)
  confirmedWarnings: string[]             // criteria confirmed despite ⚠ (shown in copy)
  confirmed?: {                           // snapshot at last confirm (F6)
    at: string
    block: Block<StepId>
    basis: Partial<Record<StepId, string>> // confirmedAt of earlier steps used
  }
  resume?: { summary: string, nextAction: string, at: string }
}

Item { id: string, rev: number, editedByUser: boolean, why?: string }  // base for every list entry and singleton
// id IS the short ID (step 4 build: one field instead of id + shortId): assigned once per collection from a counter
// that is never reused (tg1, tg2 … even after tg1 is deleted); prefixes are unique across steps, so ids are unique
// project-wide. Singletons (profile, frame, challenge, level7) use their collection name as id.
// Persisted in the document and backups. Proposals and baseRev lookups always go by id, never by list position.

ChatSegment { id, startedAt, summaryOfPrevious?: string, messages: StoredMessage[] }
StoredMessage = the API message content blocks as returned (text, thinking, tool_use, tool_result) + local metadata (id, at)

Proposal { id, toolUseId, at, summary, changes: ProposalChange[] }
ProposalChange { id, op, collection, tempId?, targetId?, baseRev?, fields?,
                 state: "open" | "applied" | "rejected",
                 resultId?,                       // add: the real id its temp id resolved to
                 undo?: { before, index, afterRev } }  // while applied, for "Rückgängig"
// "veraltet" is derived from the current block on every read (step 4 build), never stored, so it can't drift.

Settings (separate IndexedDB key, never exported) { apiKey?, model, effort }
```

### 7.1 Blocks per step (fields from PRD F5; * = Why-carrying)

| Step | Collections / fields |
|---|---|
| 0 | `profile` (name, organisation, projectBoundary, location, activities[], participants, team, duration, funder, budgetRange?, statedGoals[], otherOffers[], openQuestions[]; unknown = `"offen"`), `frame` (purpose '' / geldgeberin / lernen / beides / offen, audience, requiredFormat, requiredFigures[], existingData[]), `sources[]` (origin paste/pdf, label, text, at; Lukas's only) — *as built in step 14* |
| 1 | `challenge`*; `targetGroups[]`* {name, description, direct/indirect, isFocus, sizeEstimate?}; `stakeholders[]` {role, expectations[], why?} |
| 2 | per focus group `problems[]` {groupId, coreProblem*} (one per group); `causes[]`* {groupId, parentId, text, evidence, notInfluenceable}; `consequences[]` {groupId, parentId, text}; `parentId` = cause of a cause / consequence of a consequence in the same list and group, `""` = direct, at most 3 levels (step 16); non-focus groups: coreProblem only (their other items are hidden while they aren't a focus group) |
| 3 | `goals[]`* {groupId, level 4/5/6, text, causeIds[], timeFrame}; `levelNotApplicable[]` {groupId, level, why}; `level7` {text, why} |
| 4 | `resources[]`; `activities[]`* {text, why}; `outputs[]` {groupId, level 1–3, text}; `links[]` {groupId, fromId, toId, because*, assumption, evidence, critical}; `externalFactors[]`; `sideEffects[]` {text, affectedGroup, positive/negative} |
| 5 | `focusQuestions[]`* {text, reason, audience, linkIds[], goalIds[]}; `deferredCandidates[]` {linkId, reason}; `indicators[]`* {text, level, focusQuestionId, baseline or baselinePlan, target, rubricNote}; `mandatoryFigures[]` {name, target, unit?, sourceNote?} |
| 6 | `planRows[]`* {indicatorIds[], mandatoryFigureIds[], dataSource, method, collector, frequency, consentNote, analysis, firstCollection} |

- **Evidence labels:** `eigene_erfahrung | eigene_daten | forschung | unsicher` (shown in German).
- **References are always IDs** (`causeIds`, `fromId`, `focusQuestionId` …). Display text is looked up at render time, so renaming updates everywhere. A missing target shows ⚠ "Verweis fehlt" (PRD F5).
- **Step 5 candidates** (critical assumptions with basis `unsicher`/`eigene_erfahrung`) are **derived** from step 4 at read time, never copied.
- **Definitions like "regelmäßig"** are free text inside the relevant item (e.g. an indicator). The app has no built-in definition and doesn't depend on one (PO 2026-11-02).
- **Outcome KPIs and mandatory figures** sit side by side in step 5: KPIs as `indicators` (count toward max 6), funder figures as `mandatoryFigures` with target values (don't count). Both can be served by plan rows in step 6.

### 7.2 Hard blocks (⛔) as code
One validator per step returns `{ blocking: Issue[], warnings: Issue[] }`. Exactly the PRD F4 list:
1. missing Why on a Why-carrying item;
2. number limits (1–2 focus groups; ≥1 goal per level 4–6 per focus group unless marked not applicable; max 6 indicators; 1–2 indicators per question; 1–3 focus questions);
3. mandatory links (goal → cause, link with because + assumption, level-7 statement, focus question → link/goal, indicator → focus question, plan row → indicator or mandatory figure).

Deterministic rules also cover what code can check reliably as ⚠ (e.g. "Verweis fehlt", more than 2 critical assumptions per focus group). Substance criteria (does the "because" explain a mechanism?) come from `report_quality_check`. The quality panel merges both: ⛔ from code, ✓/⚠ from the assistant.

---

## 8. Persistence

- **One project document** under one IndexedDB key; **settings** under another. Autosave debounced (~500 ms) after every state change, plus a flush on `visibilitychange`/`pagehide`.
- On first launch the app calls `navigator.storage.persist()` and shows the result in the setup checklist (PRD F1).
- **Backup file:** `wirkungshelferin-backup-YYYY-MM-DD.json` = the project document (schema version included), **never the API key**. Download via a generated link (works in Chrome).
- **Load pipeline (every app start and every backup load):** read → if `schemaVersion` is older than the app's, copy the raw document to key `project.pre-v{n}` → migrate (`migrations.ts`, one function per version step) → validate with Zod → only then replace. If migration or validation fails, the old document stays untouched and a plain message appears. A new app version therefore never reads an old document unmigrated.
- **Undo a migration:** Settings offers "Vorherige Version wiederherstellen", which restores `project.pre-v{n}` (a migration can pass validation and still lose content). *Step 6 build:* restore = save what is pending → stop autosave for good (so the unload flush can't write the current document back) → write the newest `project.pre-v{n}` to `project` → reload. The load pipeline then migrates the copy again with the app's current migrations, so the button helps once a broken migration is fixed; the copy itself stays.
- **Load backup** adds a confirm dialog if data exists. Unknown newer version or invalid file → plain message, nothing changed. *Step 6 build:* every backup download first writes `lastBackupAt` into the project (autosaved), and the file is that same document, so export → import is identical. Settings load after the project (missing or unusable → defaults; the stored value stays until a change) and save at once, never debounced. Effort values: `low | medium | high | xhigh | max` (Opus 5.5, default `medium`). The UI never contains an API-key prefix (scanner + dist check); the key shows as its last four characters.
- **One tab only:** the app takes a Web Lock (`navigator.locks`, `ifAvailable`). If another tab holds it, this tab shows "Die Wirkungshelferin ist schon in einem anderen Tab offen" and doesn't load data, so two tabs can't overwrite each other.
- **Reminders:** after each confirm ("Backup speichern?"); on home if `lastBackupAt` is older than 7 days (PRD F7).
- **Empty state:** "Neu starten" and "Backup laden" as equal options (PRD F2).
- **As built in step 5** (Code Reviewer + UI/UX review incorporated):
  - Storage: `idb-keyval` with its own database `wirkungshelferin` / store `data`; keys `project`, `settings`, `project.pre-v{n}`.
  - Autosave: 500 ms debounce, one write at a time (an older document never lands after a newer one). When the tab is hidden or closed it writes at once without waiting for a running write; IndexedDB keeps write transactions on one store in order. A failed save keeps the document and retries every 10 s, plus on the next change.
  - "Neu starten" and a loaded backup are saved at once, not after the debounce.
  - Load pipeline runs once per page (StrictMode in dev runs effects twice). If the migrated document can't be written, the result is a storage error and the old document stays; the pre-migration copy is written first.
  - Tab lock: a refused tab does **not** queue for the lock (a queued request would take the lock whenever the working tab reloads). It asks again when it becomes visible, focused or clicked — several times over ~3 s, because Chrome shows the neighbour tab before the closing tab has released the lock — then opens by itself. If `locks.request` itself rejects (only in non-secure or detached documents, never on the https Pages origin) the tab is let in rather than shown a wrong message.
  - Zod runs with `jitless: true` (set in `domain/schemas/zod.ts` before any schema exists): its fast path uses `new Function`, which the CSP blocks and Chrome reports as a violation.
  - The load-error screen for an unreadable document offers "Daten als Datei sichern", then "Mit einem Backup weitermachen" (file → confirm dialog → replace). The backup download from the save-failure banner was pulled forward from step 6.
- **Found in step 9:** Chrome drops IndexedDB writes that *start* while the page unloads, so the flush on `pagehide` saves nothing on a reload or tab close; it stays only as a best effort. A change less than 500 ms old is therefore at risk. Deliberate acts save at once instead: a chat turn (Lukas's message and the answer) goes through `change(fn, {now: true})` → `autosave.flush()`. Chat drafts live under their own key `drafts` (not in the project, so never in a backup and never "Gespeichert") and are written on every change, not debounced. **For step 11:** inline block edits save on Enter/blur/Esc, so they should save at once too, not only after the debounce.

---

## 9. Change handling (PRD F6)
Pure function `onConfirm(project, stepId)`:
- Sets the step to `confirmed`, stores the snapshot and basis.
- If the step had been confirmed before (a re-confirm), every **later confirmed** step becomes `maybe_outdated`. Unconfirmed steps stay as they are.
- **Step 0 exception:** diff `profile` vs `measurementFrame` against the last snapshot. Only the frame changed → only steps 5–6 are marked; the profile changed → steps 1–6.
- For an outdated step, the assistant gets the earlier block **as confirmed then** (from the step's `basis`) and **as now**, so it can say what changed.

---

## 10. Copy output (PRD F8)
`copy.ts` renders the PRD F8 order once as HTML (headings, lists) and once as plain text, written together via `ClipboardItem` (`text/html` + `text/plain`). References print the referenced item's text; broken references print ⚠ "Verweis fehlt". Points confirmed despite ⚠ are included.

---

## 11. Browser gate (PRD F1)
`navigator.userAgentData.brands` must include `"Google Chrome"`; otherwise (Safari, Firefox, Edge, Brave) a full-screen blocking page with "In Chrome öffnen" instructions. Arc identifies itself like Chrome and can't be reliably detected; it is tolerated. The gate runs before any data is loaded.

---

## 12. Security & privacy
- **API key:** IndexedDB settings key only; never in backups, never in logs, never in error reports; masked in the UI. Spending cap and a dedicated API workspace for this key (PRD §10).
- **Origin isolation:** on GitHub Pages, all repos of one account share the origin `<account>.github.io`, so JavaScript on any other page there could read the app's storage, including the key. **PO decision 2026-11-02: host on Karim's account** (`krmbln.github.io/wirkungshelferin/`). Checked 2026-11-02: the only other Pages site there (`Glueckskeks`) is plain HTML with one inline script and no external scripts, so the risk is low. **Rule:** no page with third-party scripts or untrusted code is published under `krmbln.github.io`. If that changes, the app moves to its own origin (free GitHub organisation or own domain); Lukas carries his data over with a backup file, since browser storage doesn't move with the address.
- **No participant data:** one-time privacy note (PRD F1). The app sends block content and documents to the Claude API only.
- **Rendering:** assistant Markdown rendered without raw HTML, so model output can't inject scripts.
- **Content Security Policy** via `<meta>`, production build only (the Vite dev server needs inline scripts): scripts from self only; `connect-src` limited to `https://api.anthropic.com`. Fonts chosen in Phase 4 are self-hosted, so `font-src`/`style-src` stay `self`.

---

## 13. Testing strategy (PRD §6)

| Level | Tool | What |
|---|---|---|
| Unit | Vitest | Reducer; ⛔ validators per step; proposal apply/staleness, temp-ID dependencies, chained changes to one item, an open change after its neighbour was deleted stays "veraltet" (short IDs never shift); F6 cascade incl. step-0 exception; migrations; copy formatter; error mapper; prompt assembly (stable prefix, no volatile content before the cache breakpoint) |
| Component | Testing Library + fake-indexeddb | Proposal card (apply all / one / stale); block panel manual edit survives a later assistant turn; confirm blocked while a Why is empty; empty state; settings |
| Mock AI | scripted `AiClient` | Replays recorded streams (text, thinking, tool_use, errors, refusal) so every flow runs without the network |
| E2E | Playwright, Chrome | Gate blocks non-Chrome UA; data survives reload; second tab is refused; an old-version document is migrated on start (pre-migration copy kept); backup export → clear → import restores everything except the key; one full "Übernehmen" flow with mocked API via request interception; offline message |
| Live contract | Node script, real API, **run manually only** | The real `ai/` layer runs 2–3 scripted step scenarios: tool schemas accepted in strict mode, tool calls valid, short IDs and temp IDs resolve, tool_result order accepted, cache hits measured. Its recorded streams become the mock-AI fixtures. Costs API credit (a few cents per run); not part of CI. It checks the **tool mechanics** only; method quality with tool calls is checked by the manual dry run in the app before handover. |
| Method quality | eval harness (`eval/`) | Unchanged: validates the guide, not the app. The app's operating rules (§6.2 item 2) replace the harness's simulation rules; a short manual dry run in the app before handover (PRD F9) |

Every build step ships with its tests (CLAUDE.md non-negotiable).

---

## 14. Hosting & deployment
1. Initialise git in the project folder (not a repo yet) and create the GitHub repo (see D2/D3).
2. Before the first push: check `.gitignore` again (`docs/method-sources/`, `docs/Projektdokumente/`, `eval/cases/lukas-1/` are excluded already) and review what the public repo reveals (see D3).
3. `.github/workflows/ci.yml`: on every push → `npm ci` → unit + component tests → `npx playwright install chrome` → E2E tests → `vite build`.
4. `.github/workflows/deploy.yml`: **manual release** (`workflow_dispatch` button in GitHub, or a `v*` tag) → same checks → deploy `app/dist` to Pages. A push alone never reaches Lukas; Karim tries the build locally (`npm run preview`) and then releases.
5. Karim's routine: `git add -A && git commit && git push` as today, plus one click on "Run workflow" when a version should go live. No server to run, nothing to restart.
6. Vite `base` set to the Pages path; no client routing, so no 404 handling needed.

---

## 15. Open decisions for the PO

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve the package list (§3.1) | ✅ Approved 2026-11-02 |
| D2 | ~~Dedicated GitHub organisation~~ | **Decided 2026-11-02: Karim's account** (`krmbln.github.io/wirkungshelferin/`), with the rule in §12 |
| D3 | The repo is public (Pages free tier). `docs/`, `memory-bank/` and `.claude/` mention Lukas, his organisation and the funder. Keep them public, exclude them, or switch to Cloudflare Pages with a private repo | Exclude `docs/` (except `tech-design.md`, `design.md`), `memory-bank/`, `.claude/` and `eval/runs/` from the public repo; keep app, guide, agents and CLAUDE.md public — ✅ Approved 2026-11-02 |
| D4 | Automatic backups into a folder Lukas picks once (Chrome's File System Access API) in addition to the download | Later (v1.1): reduces reliance on reminders, but Chrome asks Lukas to re-grant folder access each session, which adds friction at the start — ✅ Deferred to v1.1 (2026-11-02) |

## 16. Risks

| Risk | Mitigation |
|---|---|
| Chrome clears site data (user setting, profile reset) | `persist()`, backup reminders, equal "Backup laden" on empty state, setup checklist |
| Proposal tool output doesn't fit the schema | Strict tools + Zod validation + error `tool_result`; assistant retries |
| Prompt/guide changes break the cache or quality | Prompt assembly unit test (stable prefix); eval harness for guide changes |
| Model API changes (names, thinking rules) | Model ID and effort in settings; append-only history; SDK typed errors |
| App update reads old data wrongly | Migration on every load with a pre-migration copy; manual release instead of deploy-on-push |
| Two tabs overwrite each other | Web Lock, second tab refused |
| Lukas returns after weeks and is lost | "Wo du aufgehört hast" summary + one next action on home |
