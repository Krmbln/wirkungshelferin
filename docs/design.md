# Design Direction — Wirkungshelferin (v1)

> ✅ **Approved by PO 2026-11-02.**

> Phase 4 output. Draft 2026-11-02. The design bible: every UI decision during building references this file. Updated during Phase 6 whenever the visual direction changes.
> Inputs: PO words (2026-11-02), PRD §8 (look & feel), PRD F1–F8 (screens and states), tech design §11–12 (Chrome only, self-hosted fonts, no extra UI packages).
> UI/UX Designer review 2026-11-02: score 7/10, 1 Critical (confirm gate contradicted itself), 6 High, 10 Medium → all incorporated. Re-review: Critical resolved, **8.5/10**; 5 Medium polish points incorporated.

---

## 1. Visual References
No screenshots provided. The direction rests on the PO's words and the PRD. `docs/design-references/` stays empty until the PO adds something during Phase 6.

## 2. Vibe in Words
**Clean · simple · few colours · minimalist · easy to use.** (PO, 2026-11-02)
From the PRD: **calm, clear, professional — a workspace, not a chatbot toy.** Plain German, informal "Du".

What this means in practice:
- One accent colour. Everything else is greys and white.
- Lines and whitespace separate things; no shadows, gradients, illustrations or emojis.
- Every screen has **one obvious next action**.
- Text is short. Explanations exist, but sit one click away (intro panel, term tooltips).

---

## 3. Colour Palette
Light mode only in v1 (Lukas works on a Mac in daylight; tokens make dark mode possible later).

| Role | Token | Hex | Usage |
|---|---|---|---|
| Background | `--bg` | `#FAFAF9` | App background |
| Surface | `--surface` | `#FFFFFF` | Panels, cards, inputs |
| Subtle surface | `--surface-subtle` | `#F2F2F0` | Assistant chat bubbles, hover, intro panel |
| Line | `--line` | `#E3E3E0` | Dividers between areas (1 px), not for controls |
| Line strong | `--line-strong` | `#858B87` | Borders of inputs and outlined buttons (≥ 3:1, WCAG 1.4.11) |
| Text | `--text` | `#1F2321` | Body text, headings |
| Text muted | `--text-muted` | `#5F6662` | Labels, hints, timestamps (AA on white and `--bg`) |
| **Accent (primary)** | `--accent` | `#1F6B66` | Primary buttons, links, focus ring, current step, progress |
| Accent soft | `--accent-soft` | `#E4F0EE` | Selected step background, "neu" change highlight |
| Success | `--ok` | `#276B43` | ✓ in quality check, "bestätigt" status |
| Warning | `--warn` | `#8A5700` | ⚠ open points, "vielleicht veraltet", backup reminder |
| Blocking | `--block` | `#B3261E` | ⛔ blocking points, errors, "Entfernen" in proposals |

**Rules**
- The accent is the **only** decorative colour. Success, warning and blocking colours appear **only** where they carry a status, always together with an icon and a word (never colour alone).
- Status colours are used as text/icon colour and as a 1 px border or a very light tint (8–10 % of the colour), never as large fills. **Text on a tint is always `--text`**; the status colour goes on the icon and the border.
- Contrast (checked): `--text-muted` 5.9:1, `--accent` 6.3:1, `--block` 6.5:1 on white; `--ok`/`--warn` darkened to stay ≥ 4.5:1 on white and `--bg`; white on `--accent` 6.3:1. Avoid `--warn` on `--surface-subtle`.
- **Buttons and their states:**

| Type | Rest | Hover | Pressed | Disabled |
|---|---|---|---|---|
| Primary | `--accent` fill, white text | 8 % darker | 14 % darker | `--surface-subtle` fill, 1 px `--line-strong` border, `--text-muted` text, `not-allowed` cursor, **reason written next to it** |
| Busy (any button) | label changes (e.g. "prüft …"), button disabled so a double click can't start a second run | | | |
| Secondary | white, 1 px `--line-strong`, `--text` | `--surface-subtle` fill | `--line` fill | `--text-muted` text and border |
| Text | `--accent` text | underline | — | `--text-muted` |

---

## 4. Typography
- **One family: Source Sans 3**, self-hosted (CSP, tech design §12), weights 400 and 600 only. Fallback: `system-ui, -apple-system, "Segoe UI", sans-serif`.
- Why: very legible at small sizes, full German character set, calm and neutral without looking generic-corporate.

| Use | Size / line height | Weight |
|---|---|---|
| Page title (step name) | 24 / 32 | 600 |
| Section heading (block section, home groups) | 18 / 26 | 600 |
| Body, chat, inputs | 16 / 24 | 400 |
| Labels, buttons | 15 / 20 | 600 |
| Small (hints, timestamps, status labels) | 13 / 18 | 400 |

- Line length in chat and intro: max ~70 characters.
- No all-caps except the change-type chips in proposals (13 px, letter-spacing 0.04em). Sidebar group labels use sentence case (13 / 600, muted).
- Numbers that line up (indicator targets, counts): tabular figures.

---

## 5. Layout Principles

### 5.1 Grid & spacing
- 4 px base unit. Spacing tokens: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Radius: 6 px (inputs, buttons, cards), 10 px (panels). No pill shapes except status chips.
- Separation by whitespace first, 1 px lines second. No shadows (one exception: dialogs, a soft single shadow).
- Target screen: MacBook, 1280–1728 px wide. Two columns hold down to ~960 px. Below that a one-line hint appears at the top: "Zieh das Fenster etwas breiter, dann siehst du Chat und Baustein nebeneinander." No stacked layout.

### 5.2 App frame
```
┌──────────────┬──────────────────────────────────────────────────────┐
│ Wirkungs-    │  Step title · "Schritt 3 · Strategie"  Gespeichert   │
│ helferin     ├───────────────────────────┬──────────────────────────┤
│              │                           │                          │
│ Übersicht    │   CHAT                    │   BAUSTEIN               │
│              │   (intro panel on top,    │   (the step's block,     │
│ Kontext      │    collapsible)           │    editable)             │
│ ✓ 0 Projekt  │                           │  2 offene Vorschläge ▸   │
│ Strategie    │                           │                          │
│ ✓ 1 Gruppen  │                           │                          │
│ ◐ 2 Problem  │                           │                          │
│ ○ 3 Ziele    │                           │                          │
│ ○ 4 Logik    │                           │   ──────────────────     │
│ Analyse      │                           │   Qualitätscheck         │
│ ○ 5 Messen   │  ┌─────────────────────┐  │ [Prüfen und bestätigen]  │
│ ○ 6 Plan     │  │ Nachricht …     [→] │  │                          │
│              │  └─────────────────────┘  │                          │
│ Backup · ⚙   │                           │                          │
└──────────────┴───────────────────────────┴──────────────────────────┘
```
- **Left sidebar (fixed, ~220 px):** app name, "Übersicht" (home), steps grouped as Kontext / Strategie / Analyse with status icon + number + short name. Bottom: backup status ("Letztes Backup: vor 3 Tagen") and "Einstellungen". Steps keep the method's numbering 0–6 everywhere (guide, copy output).
- **Status icons (fixed mapping, each with `aria-label` and tooltip):** ○ noch nicht begonnen · ◐ in Arbeit · ✓ bestätigt · ⚠ vielleicht veraltet. The current step is shown by the highlight, not by an icon.
- **Step workspace:** chat left (~45 %), block right (~55 %), both scroll independently. The divider is a 1 px line.
- **Always visible orientation** (PRD §8): the current step is highlighted in the sidebar (accent-soft background + accent text) and the header says "Schritt N · [Teil]" (no "von 6": steps start at 0, which would read like a bug).
- **No icon-only header menu.** Everything that isn't step work lives in the sidebar (Übersicht, backup, Einstellungen) or in the block panel (copy buttons).
- No hamburger menus, no tabs inside tabs, no modals for normal work. Dialogs only for destructive or irreversible actions (load backup over data, hard-delete a target group).

### 5.3 Density
Spacious, not sparse. Lists in the block panel are compact rows (16 px text, 12 px vertical padding); the chat has generous spacing between turns (24 px).

---

## 6. Screens

### 6.1 Home ("Übersicht")
1. **"Wo du aufgehört hast"** card at the top: step name, 1–2 sentence summary, next action, primary button **"Weiter"**. This is the only primary button on the page.
2. Backup reminder (only if > 7 days): one line with ⚠ icon + "Backup speichern".
3. Steps 0–6 grouped by part, each row: status icon, name, one-line status ("bestätigt am 12.11." / "in Arbeit" / "noch nicht begonnen" / "vielleicht veraltet – prüfen"). Click opens the step. Recommended next step marked with "Empfohlen als Nächstes".
4. Empty state (no project): two equal buttons side by side, **"Neu starten"** and **"Backup laden"**, with one sentence each explaining when to use which.

### 6.2 Step workspace
**Intro panel** (top of the chat, open on first visit, collapsed afterwards to one line "Worum geht es? ▸"): "Worum geht es?", "Warum?", example, key terms (underlined with dotted line; hover/click shows the glossary definition).

**Chat**
- Assistant messages: left, on `--surface-subtle`, no avatar, small label "Wirkungshelferin".
- Lukas's messages: right, white with 1 px line.
- While the assistant thinks: a single line "denkt nach …" with a subtle pulsing dot (static if reduced motion). Then text streams in.
- Input: multi-line field at the bottom, placeholder "Schreib deine Antwort …". Enter sends, Shift+Enter makes a new line. Send button with arrow icon. While streaming: "Stopp" button instead.
- Every assistant turn ends with a question or next action (guide rule); the UI doesn't add anything.

**Proposal card** (inside the chat, part of an assistant message)
```
┌ Vorschlag ─────────────────────────────────────────────┐
│ Zwei Zielgruppen ergänzen, weil … (one sentence)       │
│                                                        │
│ NEU      Kinder 10–13 aus dem Kiez    [Übernehmen] Ablehnen │
│ ÄNDERN   Eltern: „indirekt" → „direkt"[Übernehmen] Ablehnen │
│ ENTFERNEN  Schulen                    [Übernehmen] Ablehnen │
│ VERALTET  Trainer (von dir geändert)  – nicht mehr anwendbar │
│                                                        │
│                                     [Alle übernehmen]  │
└────────────────────────────────────────────────────────┘
```
- Change type as a **fixed-width chip** (1 px border, 13 px caps): NEU with accent border, ÄNDERN with `--line-strong`, ENTFERNEN with `--block` border; chip text always `--text`. For ÄNDERN the old value is struck through, the new value follows.
- **Row layout:** chip + text on the first line, the buttons on a second line below (the chat column can be ~330 px wide).
- **Button hierarchy:** "Übernehmen" per row and "Alle übernehmen" are **secondary** buttons; "Ablehnen" is a text button. The only primary button in the workspace stays the confirm button.
- Rejected rows show "abgelehnt" (muted) with a "Rückgängig" text link.
- Hovering a row outlines the target item in the block panel.
- After applying: the row shows "✓ übernommen" (muted); the block panel scrolls the item into view and highlights it briefly (accent-soft, fades over 1.5 s; no animation with reduced motion). An applied ENTFERNEN gets the 10-second "Rückgängig" (§7), no extra dialog.
- A proposal card appears only once its message is complete; a message stopped mid-stream shows no card.
- Stale rows: greyed, label "VERALTET", short reason ("du hast das inzwischen geändert"), no button.
- Dependent rows (need another change first): button disabled with hint "zuerst ‚Neu: …' übernehmen".
- "Alle übernehmen" appears only when ≥ 2 open changes exist.

**Block panel ("Baustein")**
- **Open proposals line** at the top of the panel when the chat holds unapplied changes: "2 offene Vorschläge im Chat ▸". Click scrolls the chat to the card and highlights it. Hidden when none are open.
- **Empty block** (first visit): instead of bare headings one muted sentence per section, e.g. "Noch leer – erzähl der Wirkungshelferin, für wen euer Angebot da ist."
- Sections per collection (e.g. "Zielgruppen", "Beteiligte"), each with a heading and a "+ hinzufügen" text button.
- Item = a row with the main text; click to edit inline (no separate edit mode). Hover: `--surface-subtle` background + text cursor + a small pencil icon at the right. Editing: 1 px `--line-strong` border + focus ring. **Enter, blur and Esc all save and leave the field** (nothing typed is lost); mistakes are fixed via "Rückgängig". Secondary fields (direct/indirect, evidence label, critical) as small inline controls.
- **Why:** directly under each Why-carrying item, labelled "Warum?". An empty Why shows a muted placeholder "Warum ist das wichtig? (nötig zum Bestätigen)". The ⛔ field marker appears after a check has found it (see the check states below).
- Items Lukas edited himself carry a tiny muted label "von dir geändert".
- References (e.g. goal → cause) show the referenced text as a small chip; a broken reference shows ⚠ "Verweis fehlt".
- Step 4 shows its chain per focus group as an ordered list (activity → output → goal), not a graph (graph = v1.1).

**Quality check & confirm** (bottom of the block panel, sticky, at most ~40 % of the panel height; the result list scrolls inside it)

One primary button that changes with the state:

| State | Primary button | What Lukas sees |
|---|---|---|
| **A · Not checked yet** (or block changed since the last check) | **"Prüfen und bestätigen"** (enabled) | Nothing yet, or the old result greyed with "Geändert seit der Prüfung – erneut prüfen" |
| **B · Checked, ⛔ present** | "Bestätigen" **disabled**, reason next to it: "Noch 2 Punkte blockieren das Bestätigen" | ⛔ rows on top, each with "Zum Feld" (scrolls to and focuses the field; the field marker shows); ⚠ rows; ✓ collapsed to "7 Punkte erfüllt ▸" |
| **C · Checked, only ⚠ or ✓** | "Bestätigen" (enabled) | ⚠ rows; clicking shows one inline line: "2 offene Punkte werden mit gespeichert. Trotzdem bestätigen?" [Bestätigen] [Abbrechen] — no modal |

- Clicking "Prüfen und bestätigen" runs the check (code ⛔ rules instantly, then the assistant's ✓/⚠ judgement, shown with "prüft …"). The result decides B or C; with no ⚠ at all, C confirms directly.
- Any edit or applied change after a check moves the panel back to A.
- A secondary text button "Nur prüfen" runs the check without confirming.
- After confirm: status ✓ in the sidebar, then the backup prompt as an inline banner: "Schritt bestätigt. Jetzt Backup speichern?" [Backup speichern] [Später].

**"Vielleicht veraltet" step:** a ⚠ banner at the top of the workspace: "Ein früherer Schritt hat sich geändert. Lass die Wirkungshelferin prüfen, was das für diesen Schritt bedeutet." [Prüfen lassen].

**Edge states**
- **App loading from storage:** the frame with grey skeleton rows (no spinner), usually invisible because it's fast.
- **Return after a break:** the chat opens at the latest message, with a muted divider "Letzte Sitzung: 26.10." above the new activity.
- **Stopped mid-stream:** partial text stays, marked "abgebrochen" (muted); no proposal card.
- **API key invalid mid-session:** inline error in the chat: "Dein API-Schlüssel funktioniert nicht mehr." + link "Zu den Einstellungen". Typed text stays.

### 6.3 Setup & settings
- **Setup (first start):** a single centred column (max 560 px), steps 1–4 as a short checklist: Willkommen → API-Schlüssel eingeben + "Verbindung testen" → Datenschutz-Hinweis → Erstes Backup. Each step one screen, "Weiter" as the only primary button.
- **Settings:** simple form page: API key (masked, "ändern" / "entfernen"), model ID, effort, "Vorherige Version wiederherstellen" (only if a pre-migration copy exists), backup save/load.

### 6.4 Blocking screens
- **Not Chrome:** centred, one heading "Bitte öffne die Wirkungshelferin in Chrome", three numbered steps, the link to copy. No app chrome around it.
- **Second tab:** same layout: "Die Wirkungshelferin ist schon in einem anderen Tab offen." + "Diesen Tab schließen".

---

## 7. Interaction & Feedback Rules
1. **One primary action per view.** Primary = accent button. Secondary = outlined. Tertiary = text link.
2. **Nothing changes in the block without a visible cause:** either Lukas typed it, or he clicked "Übernehmen". Changes get a brief highlight.
3. **Errors appear where they happened** (in the chat for API errors, at the field for input errors), in plain German with what to do and a retry button. No error codes in the UI (codes go to the console).
4. **Autosave is silent when it works, loud when it fails.** A muted "Gespeichert" appears in the header for 2 s after a save; no save button. If a save fails (storage full, browser error): a persistent ⛔ banner at the top, "Speichern hat nicht geklappt – speichere jetzt ein Backup" [Backup speichern]. It never hides by itself; it disappears only after a successful save.
5. **Never lose typed text:** the chat input keeps its content through errors, reloads and step switches (stored per step).
6. **Removing a block item** (by hand or via an applied ENTFERNEN) happens immediately with a 10-second inline "Rückgängig" link; no dialog. **Loading a backup over existing data and hard-deleting a target group** need one confirmation dialog.
7. **Copy buttons** (per block and "Alles kopieren") confirm with "Kopiert" for 2 s.
8. **Motion:** only fades and highlights, 150–250 ms; all disabled under `prefers-reduced-motion`.

---

## 8. Iconography
- Few icons, simple line style (1.5 px stroke), drawn as a small set of inline SVGs (no icon package — tech design §3.1). Needed: status (○ ◐ ✓ ⚠ ⛔), send, stop, plus, close, copy, settings, backup, chevron.
- Icons always come with text, except send/close/chevron/pencil, which get an `aria-label`.
- Status symbols (✓ ⚠ ⛔ ○ ◐) are **always the SVGs**, never the Unicode characters (Chrome on macOS renders those as colour emoji). The assistant's prompt asks it not to write these characters in chat text either.

## 9. Copy Tone (UI texts)
- Du, short sentences, active verbs. Buttons say what happens: "Übernehmen", "Bestätigen", "Backup speichern", "Prüfen".
- No method jargon in UI labels where a plain word exists; method terms (Wirkungslogik, Indikator) are allowed as step names and always explained via the term tooltip.
- No exclamation marks, no emojis, no "Super!".

## 10. Accessibility
- Contrast WCAG AA for all text (palette above is checked against `--surface` and `--bg`).
- Visible focus ring everywhere: 2 px accent outline with 2 px offset.
- Full keyboard use: Tab order follows reading order; Enter sends; Esc closes dialogs and inline edits.
- Status never by colour alone (icon + word).
- Click targets ≥ 32 × 32 px.
- Term tooltips are keyboard-accessible: focusable, open on Enter, close on Esc.
- Chat region announces new assistant messages politely (`aria-live="polite"`), not every streamed token.

## 11. Platform Conventions
- Desktop web app in Chrome on macOS. Follows web conventions, with Mac-friendly details: system-like scrollbars, Cmd+Enter also sends, native text selection and copy work everywhere.
- Not optimised for mobile or tablets (PRD §9).

## 12. Specific Likes
- Clean, simple, minimalist, few colours, easy to use (PO 2026-11-02).

## 13. Specific Dislikes (derived)
- Chatbot-toy look: avatars, bubbles with tails, emojis, confetti.
- Colour used as decoration; more than one accent.
- Dense dashboards, nested menus, hidden actions behind icons without labels.
