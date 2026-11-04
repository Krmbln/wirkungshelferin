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
- **Buttons and their states** (height 32 px; disabled and busy use `aria-disabled`, so they stay focusable and the reason is linked via `aria-describedby`):

| Type | Rest | Hover | Pressed | Disabled |
|---|---|---|---|---|
| Primary | `--accent` fill, white text | 8 % darker | 14 % darker | `--surface-subtle` fill, 1 px `--line-strong` border, `--text-muted` text, `not-allowed` cursor, **reason written next to it** |
| Busy (any button) | label changes (e.g. "prüft …"), button disabled so a double click can't start a second run | | | |
| Secondary | white, 1 px `--line-strong`, `--text` | `--surface-subtle` fill | `--line` fill | `--text-muted` text, 1 px `--line` border (lighter than at rest, so it reads as "off"; step 2) |
| Text | `--accent` text | underline | keeps the underline | `--text-muted` |
| Icon-only (send, close) | 32 × 32 px, `aria-label` required; as text button: `--text-muted` icon | `--surface-subtle` fill, `--text` icon | `--line` fill | `--text-muted` |

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
- **Left sidebar (fixed, ~220 px):** app name, "Übersicht" (home), steps grouped as Kontext / Strategie / Analyse with status icon + number + short name. Bottom: backup status ("Letztes Backup: vor 3 Tagen") and "Einstellungen" (text only, like "Übersicht"). *Step 6:* the backup line is status only (no button): "Noch kein Backup" / "Backup: heute | gestern | vor N Tagen" (short, so it fits one line at 220 px; Settings keeps "Letztes Backup: …"; PO left the choice to Claude), muted with the backup icon; once overdue the icon becomes ⚠ in `--warn` and the text turns `--text`. The page title area keeps the same height with and without the "Schritt N · Teil" line, so switching views doesn't jump (step 3). Steps keep the method's numbering 0–6 everywhere (guide, copy output).
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
   - *Until step 22* (step 3 build, UI/UX review): the card shows the recommended step with an honest label, "Hier fängst du an" when nothing is started, otherwise "Als Nächstes". "Wo du aufgehört hast" comes with real session data.
2. Backup reminder (only if > 7 days): one line with ⚠ icon + "Backup speichern".
   - *Step 6 build:* a ⚠ banner between the card and the step list, "Dein letztes Backup ist N Tage alt. Speichere ein neues, damit nichts verloren geht." (never one: "Du hast noch kein Backup gespeichert. …") + secondary [Backup speichern]. Due when the last backup is more than 7 **calendar** days old (never one: counted from the project start), so it agrees with the sidebar's "vor 8 Tagen". After the download the banner goes and a muted line "Backup ist in deinen Downloads." takes its place and gets focus. Every download (settings, reminder, save-failure banner) records `lastBackupAt`, and the file carries that time.
3. Steps 0–6 grouped by part, each row: status icon, name, one-line status ("bestätigt am 12.11." / "in Arbeit" / "noch nicht begonnen" / "vielleicht veraltet – prüfen"). Click opens the step. Recommended next step marked with "Empfohlen als Nächstes" as a small label chip (1 px accent border, `--text` text, 13 px, `--radius`), so it doesn't read as a link (step 3).
4. Empty state (no project): two equal buttons side by side, **"Neu starten"** and **"Backup laden"**, with one sentence each explaining when to use which.
   - *Step 5 build:* the empty state has **no app frame** (no sidebar): without a project there is nothing to navigate, and it is the doorway to setup (§6.3). It uses the centred single-column layout of the blocking screens, widened to 680 px: h1 "Willkommen bei der Wirkungshelferin", one muted lead line ("Hier kommst du in sieben Schritten …"), then two equal panels side by side (1 px line, `--radius-panel`, no shadow). Each panel: one sentence on when to use it, a **secondary** button at the bottom. Both are secondary because neither is the "right" choice. An unusable backup file shows a ⚠ banner under the panels ("…kein Backup der Wirkungshelferin… Es hat sich nichts verändert. Wähl eine andere Datei – Backups heißen „wirkungshelferin-backup-…json“."); nothing changes, and the banner clears as soon as another file is chosen.

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
- **App loading from storage:** the frame with grey skeleton rows (no spinner), usually invisible because it's fast. *Step 5:* static `--line`-coloured bars (3 px radius, not pills) in the shape of sidebar, header, home card and rows; no shimmer; a visually hidden "Wird geladen …" status for screen readers.
- **Return after a break:** the chat opens at the latest message, with a muted divider "Letzte Sitzung: 26.10." above the new activity.
- **Stopped mid-stream:** partial text stays, marked "abgebrochen" (muted); no proposal card.
- **API key invalid mid-session:** inline error in the chat: "Dein API-Schlüssel funktioniert nicht mehr." + link "Zu den Einstellungen". Typed text stays.

### 6.3 Setup & settings
- **Setup (first start):** a single centred column (max 560 px), steps 1–4 as a short checklist: Willkommen → API-Schlüssel eingeben + "Verbindung testen" → Datenschutz-Hinweis → Erstes Backup. Each step one screen, "Weiter" as the only primary button.
- **Settings:** simple form page: API key (masked, "ändern" / "entfernen"), model ID, effort, "Vorherige Version wiederherstellen" (only if a pre-migration copy exists), backup save/load.
  - *Step 6 build:* one column (max 600 px), sections with an 18 px heading, separated by a 1 px line: **Verbindung zu Claude** (API-Schlüssel, Modell, Denktiefe), **Backup**, and **Vorherige Version** (only if a pre-migration copy exists). Every change saves at once (no "save all"); a settings save also shows "Gespeichert" in the header. Fields: label above (15 / 600), 32 px control with 1 px `--line-strong`, hint below (13, muted); an error replaces nothing, it sits under the control with a ⛔ icon and turns the border `--block` (design §7.3).
  - API key: password field + [Speichern]; stored → "••••••••ab12" (last four only) + text buttons "ändern" / "entfernen"; "entfernen" asks in a dialog (Lukas can't get the key back himself). Hint: "Er bleibt nur in diesem Chrome und kommt nie in ein Backup." A cut-off or broken paste is refused at the field; the real check is "Verbindung testen" (step 7). The UI never shows a key prefix.
  - Modell: text field, saved on Enter and when leaving it; empty → error at the field. Hint "Standard: claude-opus-5-5. Ändere das nur nach Absprache."
  - Denktiefe (effort): select niedrig / mittel (Standard) / hoch / sehr hoch / maximal, saved on change.
  - Backup: status line, one muted line ("Ein Backup ist eine Datei mit deinem ganzen Projekt. Dein API-Schlüssel ist nicht darin."), [Backup speichern] [Backup laden] (both secondary), muted status after the action. Loading → confirm dialog "Backup laden?" naming the backup's date, "…ersetzt alles, was jetzt in der Wirkungshelferin steht. Wenn du den jetzigen Stand behalten willst, speichere vorher ein Backup." An unusable file → ⚠ banner under the buttons, nothing changes.
  - Vorherige Version: dialog "…Was du seitdem geändert hast, geht verloren. Die Seite lädt danach neu." The restored copy goes through the load pipeline again on reload.

### 6.4 Blocking screens
- **Not Chrome:** centred, one heading "Bitte öffne die Wirkungshelferin in Chrome", a one-line lead ("Die Wirkungshelferin funktioniert nur in Google Chrome. So geht’s:"), three numbered steps, the link to copy. No app chrome around it. If copying fails, the link gets selected and a muted line says "Kopieren ging nicht – der Link ist markiert, drück Cmd+C."
- **Second tab:** same layout: "Die Wirkungshelferin ist schon in einem anderen Tab offen" (blocking-screen headings have no full stop) + "Diesen Tab schließen". Lead: "Arbeite dort weiter. So können sich zwei Tabs nicht gegenseitig überschreiben. Wenn du den anderen Tab schließt, geht es hier weiter." The tab asks for the lock again whenever Lukas comes back to it (tab shown, window focused or a click into the page, retried for ~3 s) and then opens the app by itself; it never queues in the background, because a queued tab would take over whenever the working tab reloads. Chrome only lets a script close tabs it opened, so if closing fails a muted line says "Chrome lässt diesen Tab nicht von hier aus schließen – drück Cmd+W." (same fallback pattern as the gate's copy button).
- **Data can't be loaded** (step 5, tech design §8): same layout, one secondary action. Three cases: unreadable document → "Deine Daten lassen sich nicht öffnen" + [Daten als Datei sichern]; the lead ends "– oder mach danach mit einem Backup weiter."; after the download a muted "Gesichert in deinen Downloads." (role status) and a text button "Mit einem Backup weitermachen" (file picker → confirm dialog "Mit dem Backup weitermachen?" → replace). The stored data stays untouched until that dialog is confirmed; document from a newer version → "Deine Daten stammen von einer neueren Version" + [Seite neu laden], lead ends with the fallback "Wenn das nicht hilft, beende Chrome und öffne es wieder."; browser storage unavailable → "Chrome lässt die Wirkungshelferin gerade nicht an ihre Daten" + [Seite neu laden].

---

## 7. Interaction & Feedback Rules
1. **One primary action per view.** Primary = accent button. Secondary = outlined. Tertiary = text link.
2. **Nothing changes in the block without a visible cause:** either Lukas typed it, or he clicked "Übernehmen". Changes get a brief highlight.
3. **Errors appear where they happened** (in the chat for API errors, at the field for input errors), in plain German with what to do and a retry button. No error codes in the UI (codes go to the console).
4. **Autosave is silent when it works, loud when it fails.** A muted "Gespeichert" appears in the header for 2 s after a save; no save button. If a save fails (storage full, browser error): a persistent ⛔ banner at the top, "Speichern hat nicht geklappt – speichere jetzt ein Backup" [Backup speichern]. It never hides by itself; it disappears only after a successful save. *Step 5:* the banner sits above the page header, full width of the main area, so it stays visible on every view including the step workspace; [Backup speichern] downloads the backup file; afterwards one small line inside the banner says "Backup ist in deinen Downloads. Diese Meldung bleibt, bis Chrome wieder speichern kann." "Gespeichert" is visual only (aria-hidden): saving is silent for screen readers too, failures are announced by the alert banner.
5. **Never lose typed text:** the chat input keeps its content through errors, reloads and step switches (stored per step).
6. **Removing a block item** (by hand or via an applied ENTFERNEN) happens immediately with a 10-second inline "Rückgängig" link; no dialog. **Loading a backup over existing data and hard-deleting a target group** need one confirmation dialog.
7. **Copy buttons** (per block and "Alles kopieren") confirm with "Kopiert" for 2 s.
8. **Motion:** only fades and highlights, 150–250 ms; all disabled under `prefers-reduced-motion`.

---

### 7.1 Tooltip and dialog specs (added in step 2)
- **Tooltip:** dark bubble (`--text` background, white 13 px text, 6 px radius, max 280 px wide), 8 px below the trigger. Opens on hover and Enter, closes on Esc, blur and mouse leave; the pointer can move onto the bubble without closing it. Triggers in the right half of the window open leftwards. When the trigger already has the same text as its accessible name (status icons), the bubble is hidden from screen readers and adds no tab stop; the focusable parent row (sidebar, check row) shows it on focus. **Sidebar rows** show the status bubble on hover and keyboard focus (not after a click), placed **beside the row**, vertically centred, so it never covers the next row (step 3).
- **Dialog:** native modal `<dialog>`, max 480 px, 10 px radius, the one shadow, dimmed backdrop. Title + ✕ on top, actions bottom right with the safe choice ("Abbrechen") first and focused.
- **Change-type chips:** 6 px radius (`--radius`), min width 92 px.

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
