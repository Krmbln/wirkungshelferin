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
**Intro panel** (top of the chat, open on first visit, collapsed afterwards to one line "Worum geht es? ▸"): "Worum geht es?", "Warum?", key terms (underlined with dotted line; hover/click shows the glossary definition). No example (step 10, see below).

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

*Step 12 build (PO approved 2026-11-07: undo while possible, jump to the oldest open card):*
- **Card:** white `--surface` panel, 1 px `--line`, `--radius-panel`, 12 px padding, inside the assistant message; a message with a card uses the full chat-column width. Title "Vorschlag" (15/600), the summary sentence under it. It is an `article` labelled "Vorschlag" and described by the summary (not a landmark, so a long chat doesn't list "Vorschlag" again and again).
- **Row:** line 1 = chip + the collection noun (13 px muted, "Zielgruppe"); line 2 = the item's name 16/600 at full width (at ~330 px a chip beside the name squeezed it); NEU: a muted meta line with short facts ("direkt · Fokusgruppe") and the long fields behind "Details ▸" (accent text button at the right end of the button line, opens above the buttons). ÄNDERN: each changed field always visible: 13/600 muted label, old value struck through and muted (max 2 lines), new value; values ≤ 20 characters on one line "~~indirekt~~ → direkt"; an empty old value reads muted "bisher leer". An empty singleton is named by its noun only, an unnamed item "Zielgruppe ohne Namen" — never an internal id. Buttons: [Übernehmen] Ablehnen, labels name the change ("Übernehmen: Neu – Zielgruppe „…“", names cut at 60 characters).
- **States:** applied → "✓ übernommen" (13 px muted) + "Rückgängig" (13/600) **as long as undo is possible** (gone once Lukas edited the item or another applied change builds on it); rejected → "abgelehnt" + "Rückgängig", text muted; stale → VERALTET chip, text muted, reason in words ("du hast das inzwischen geändert", "hat sich inzwischen geändert", "gibt es nicht mehr", "Eintrag nicht gefunden", "hängt an einer abgelehnten oder veralteten Änderung", "passt nicht zum Baustein"), no buttons; dependent → Übernehmen disabled, reason "zuerst ‚Neu: …‘ übernehmen" on its own line under both buttons.
- **Focus and announcements:** after Übernehmen / Ablehnen focus moves to the row's "Rückgängig", after Rückgängig back to "Übernehmen", after "Alle übernehmen" to the first row's "Rückgängig". A visually hidden status line per card says what happened ("Übernommen: Zielgruppe „…“", "2 Änderungen übernommen").
- **Link to the block:** hovering a row outlines its item (2 px `--accent` inset ring on a layer 12 px wider than the item); keyboard focus on a row also scrolls the item into view, hover doesn't. After Übernehmen the item scrolls into view (only the block column moves, never the window) and gets the accent-soft highlight fading over 1.5 s, starting once the scroll is there (static and immediate under reduced motion). An applied ENTFERNEN leaves the block's undo line "„…“ entfernt. Rückgängig" at the row's place for 10 s (focus stays in the card); it undoes the proposal change, so card and block agree.
- **Open changes line:** "N offene Änderungen im Chat ▸" / "1 offene Änderung im Chat ▸" (counts rows, so the noun names rows; text button at the top of the panel). Click → the oldest card with open changes: its first open row at the top of the chat when the card is taller than the chat, else the card's top; card focused and highlighted.

**Block panel ("Baustein")**
- **Open proposals line** at the top of the panel when the chat holds unapplied changes: "2 offene Änderungen im Chat ▸" (step 12 wording). Click scrolls the chat to the card and highlights it. Hidden when none are open.
- **Empty block** (first visit): instead of bare headings one muted sentence per section, e.g. "Noch leer – erzähl der Wirkungshelferin, für wen euer Angebot da ist."
- Sections per collection (e.g. "Zielgruppen", "Beteiligte"), each with a heading and a "+ hinzufügen" text button.
- Item = a row with the main text; click to edit inline (no separate edit mode). Hover: `--surface-subtle` background + text cursor + a small pencil icon at the right. Editing: 1 px `--line-strong` border + focus ring. **Enter, blur and Esc all save and leave the field** (nothing typed is lost); mistakes are fixed via "Rückgängig". Secondary fields (direct/indirect, evidence label, critical) as small inline controls.
- **Why:** directly under each Why-carrying item, labelled "Warum?". An empty Why shows a muted placeholder "Warum ist das wichtig? (nötig zum Bestätigen)". The ⛔ field marker appears after a check has found it (see the check states below).
- Items Lukas edited himself carry a tiny muted label "von dir geändert".
- References (e.g. goal → cause) show the referenced text as a small chip; a broken reference shows ⚠ "Verweis fehlt".
- Step 4 shows its chain per focus group as an ordered list (activity → output → goal), not a graph (graph = v1.1).

*Step 11 build (block components, step 1 block; PO approved the five decisions 2026-11-06):*
- **Sections:** heading 15/600 (`h3`) with "+ hinzufügen" (text button, plus icon) on the same line at the right; 24 px between sections. Items are rows separated by 1 px `--line`, 12 px vertical padding. An empty list shows its muted sentence instead of rows ("Noch leer – erzähl der Wirkungshelferin, für wen euer Angebot da ist." / "Noch leer – wer hat mit eurem Angebot zu tun oder redet mit?").
- **Inline fields are always editable text areas** styled as plain text (1 px transparent border, so nothing jumps): hover = `--surface-subtle` + pencil at the right, focus = 1 px `--line-strong` border + focus ring. The main text (target group name, stakeholder role) is 16/600, other text 16/400. Empty fields show a muted placeholder. **Enter, blur and Esc save; Shift+Enter makes a new line** (same as the chat). Every field has an accessible name.
- **Secondary fields** as small native controls in one line under the text (`accent-color`, 15 px labels, ≥ 32 px targets): target group "direkt / indirekt" (radio pair), "Fokusgruppe" (checkbox), "Größe" (inline text, optional, placeholder "Größe (optional)").
- **Remove (decision 1):** a muted ✕ icon button at the top right of every list row, always visible (no hover-only actions), `aria-label` "Zielgruppe „…“ entfernen". Singletons (Herausforderung) have none.
- **Undo line:** the removed row is replaced at its place by one muted 13 px line "„…“ entfernt." + text button "Rückgängig" for 10 seconds; focus moves to "Rückgängig". Undo lives only on screen (gone after a reload).
- **Target group with content in steps 2–4 (decision 2):** ✕ opens a dialog "Zielgruppe „…“ entfernen?" naming what exists ("In Schritt 2 und 3 gibt es schon 5 Einträge zu dieser Gruppe."). Focus group: [Abbrechen] (focused) · [Nur als Fokusgruppe abwählen] (primary, keeps the content) · [Endgültig löschen] (secondary, removes the group and its step 2–4 items; references from steps 5–6 then show "Verweis fehlt"). Non-focus group: [Abbrechen] · [Endgültig löschen] (primary). No 10-second undo after a hard delete: the dialog is the safety net. A group without content in steps 2–4 goes at once, with the undo line.
- **Stakeholders (decisions 3, 4):** role + "Erwartungen" as a muted label over a list; edited as one field with one expectation per line (Shift+Enter for the next line); empty lines are dropped on save. No "Warum?" for stakeholders (the assistant's tool carries none).
- **"+ hinzufügen" (decision 5):** adds a row and puts the cursor in its main field. When focus leaves a row that is still completely empty, the row disappears again (no undo line, nothing to undo).
- **"von dir geändert":** 13 px muted, after the row's text, on every item Lukas created or edited.
- **ReferenceChip:** 13 px, 1 px `--line`, `--radius`, the referenced item's text (one line, ellipsis, max 240 px); broken → ⚠ icon + "Verweis fehlt" in `--text`. First used in step 16; shown in the gallery now.
- **Herausforderung:** a single field with placeholder "In einem Satz: Welche Herausforderung geht ihr an?", its "Warum?" under it.
- *UI/UX review (8/10, 0 Critical / 1 High / 6 Medium / 4 Low), fixed:* **an empty field has a resting look**, `--surface-subtle` fill + the pencil, so it never looks like the muted hint sentences (High; filled text stays plain, hover shows the pencil); the target-group dialog stacks its three buttons full width, safe choice on top (they don't fit side by side in 480 px; `Dialog stacked`); a filled size shows a muted "Größe:" before it; a blocked "Warum?" says "fehlt" next to the ⛔; "von dir geändert" only once a row has content; "Warum?" label in `--text` (it is needed to confirm); "Rückgängig" 13/600; sections 24 px apart as specified. "von dir geändert" + ✕ sit beside the row's first field only, so the lines below use the full width. Accepted as is: filled text shows it is editable only on hover (desktop convention, the pencil and background appear).

**Quality check & confirm** (bottom of the block panel, sticky, at most **50 %** of the panel height — was ~40 %, raised after the step 13 PO test: at a ~880 px high window 40 % showed 1½ result rows; the result list scrolls inside it, a 1 px line marks it when cut off)

One primary button that changes with the state:

| State | Primary button | What Lukas sees |
|---|---|---|
| **A · Not checked yet** (or block changed since the last check) | **"Prüfen und bestätigen"** (enabled) | Nothing yet, or the old result greyed with "Geändert seit der Prüfung – erneut prüfen" |
| **D · Confirmed, unchanged** (step 13) | none | "✓ Bestätigt heute", "Wenn du etwas änderst, prüfst du neu.", ⚠ rows "trotzdem bestätigt" |
| **B · Checked, ⛔ present** | "Bestätigen" **disabled**, reason next to it: "Noch 2 Punkte blockieren das Bestätigen" | ⛔ rows on top, each with "Zum Feld" (scrolls to and focuses the field; the field marker shows); ⚠ rows; ✓ collapsed to "7 Punkte erfüllt ▸" |
| **C · Checked, only ⚠ or ✓** | "Bestätigen" (enabled) | ⚠ rows; clicking shows one inline line: "2 offene Punkte werden mit gespeichert. Trotzdem bestätigen?" [Bestätigen] [Abbrechen] — no modal |

- Clicking "Prüfen und bestätigen" runs the check (code ⛔ rules instantly, then the assistant's ✓/⚠ judgement, shown with "prüft …"). The result decides B or C; with no ⚠ at all, C confirms directly.
- Any edit or applied change after a check moves the panel back to A.
- A secondary text button "Nur prüfen" runs the check without confirming.
- After confirm: status ✓ in the sidebar, then the backup prompt as an inline banner: "Schritt bestätigt. Jetzt Backup speichern?" [Backup speichern] [Später].

*Step 13 build (PO decisions 2026-11-08: check as its own request, question opens at once, check waits for the chat; UI/UX review 8/10):*
- **D · Confirmed, unchanged since** (fourth state): "✓ Bestätigt heute / gestern / am 05.11." (15/600, ✓ in `--ok`), under it muted 13 px "Wenn du etwas änderst, prüfst du neu."; the last result stays (⚠ rows marked "· trotzdem bestätigt", ✓ collapsed); no buttons. Any edit or applied change → A.
- **⛔ instantly:** while "prüft …" runs and after a failed check, the ⛔ rows (with "Zum Feld") and the field markers come straight from the block; ✓/⚠ follow with Claude's answer. After a result, ⛔ rows show what the check found; in A after an edit only those still open stay, live (not greyed), with "Zum Feld"; old ⚠/✓ rows at 70 % opacity. Lead in A without a result: muted "Bevor du bestätigst, prüft die Wirkungshelferin den Baustein." (stays during the check, so nothing jumps).
- **Rows:** 18 px status icon on the first line; ⛔ = the issue in words ("Warum fehlt: Zielgruppe „…“", "Noch keine Fokusgruppe gewählt (1 oder 2)", "3 Fokusgruppen gewählt – höchstens 2") + text button "Zum Feld" (32 px target, accessible name "Zum Feld: …"); ⚠/✓ = rubric criterion name 15/600 + Claude's sentence 13 px muted. Only the result list scrolls; the "N Punkte erfüllt ▸" toggle sits below it (never scrolls away; opening brings the first ✓ row into view), the buttons below that.
- **Buttons:** A = [Prüfen und bestätigen] + text "Nur prüfen" (only in A); B = "Bestätigen" disabled with "Noch N Punkte blockieren das Bestätigen" beside it; C = [Bestätigen]. While a chat answer runs: the primary is disabled with "Warte, bis die Antwort im Chat fertig ist.", "Nur prüfen" hidden. Busy label "prüft …"; a second click does nothing.
- **Question:** after "Prüfen und bestätigen" with ⚠ points it opens at once (PO decision; from C via "Bestätigen"): "N offene Punkte werden mit gespeichert. Trotzdem bestätigen?" [Bestätigen] (focused) Abbrechen (focus back to "Bestätigen"). Without ⚠ it confirms directly.
- **Focus:** after a check with ⛔ → the first "Zum Feld" (visible ring); after "Nur prüfen" without ⛔ → "Bestätigen"; after confirming → "Backup speichern"; after saving → the muted line "Backup ist in deinen Downloads." (as on home); after "Später" → the "Bestätigt …" line. A visually hidden status line announces "Der Baustein wird geprüft …" and the result ("Geprüft. Noch 1 Punkt blockiert das Bestätigen.").
- **Failure:** ⛔ banner with the plain problem text above the buttons (no own retry: the primary button tries again); key/model problems get [Zu den Einstellungen]; no usable result → "Die Prüfung hat kein Ergebnis gebracht. Versuch es noch einmal."
- *Not done (Low):* the check has no Stopp; no divider line above the ✓ toggle when the list is cut off.

**"Vielleicht veraltet" step:** a ⚠ banner at the top of the workspace: "Ein früherer Schritt hat sich geändert. Lass die Wirkungshelferin prüfen, was das für diesen Schritt bedeutet." [Prüfen lassen].

**Edge states**
- **App loading from storage:** the frame with grey skeleton rows (no spinner), usually invisible because it's fast. *Step 5:* static `--line`-coloured bars (3 px radius, not pills) in the shape of sidebar, header, home card and rows; no shimmer; a visually hidden "Wird geladen …" status for screen readers.
- **Return after a break:** the chat opens at the latest message, with a muted divider "Letzte Sitzung: 26.10." above the new activity.
- **Stopped mid-stream:** partial text stays, marked "abgebrochen" (muted); no proposal card.
- **API key invalid mid-session:** inline error in the chat: "Dein API-Schlüssel funktioniert nicht mehr." + link "Zu den Einstellungen". Typed text stays.

*Step 9 build (chat, UI/UX review 8/10):*
- Turns 24 px apart; bubbles max 88 % wide, 12/16 px padding, `--radius-panel`. Claude's label "Wirkungshelferin" 13 px muted. Lukas's text plain with its line breaks; Claude's Markdown at body sizes (headings 15/600 like labels, lists indented, links accent, open in a new tab). Raw HTML shows as text, images as "[Bild: …]".
- Composer: one box with a 1 px `--line-strong` border and the focus ring on the whole box; the textarea grows with the text up to a third of the window. Send = arrow icon (muted while empty); while a turn runs it becomes a secondary [Stopp] with a filled square (accepted exception to the line-icon rule, §8: universal stop symbol). After sending, Stopp or a retry, focus goes back to the input. Enter does nothing while a turn runs; the text stays.
- "denkt nach …" shows until text arrives and again while Claude thinks or writes a tool call later in the same message (announced only the first time).
- **Retry treatments (rule for later steps):** an error happening *now* → ⛔ banner in the chat, text beside the icon, buttons on a line below it (fits ~330 px); key or model problem → [Zu den Einstellungen] secondary + "Erneut versuchen" text button, key text "Dein API-Schlüssel funktioniert nicht mehr. Trag in den Einstellungen einen neuen ein."; any other problem → [Erneut versuchen] secondary. A problem from the *past* (after a reload the last turn has no answer) → one muted line "Darauf kam keine Antwort." + "Erneut versuchen" text button.
- Text from a broken stream stays visible with a muted "unvollständig" (it isn't stored); a stopped message keeps "abgebrochen" (stored).
- Empty chat: muted "Hier sprichst du mit der Wirkungshelferin über diesen Schritt. Schreib einfach los." (step 10 adds the intro panel).

*Step 10 build (intro, terms, dividers, segments):*
- **Intro panel:** pinned at the top of the chat column, above the scrolling messages (so it is always one click away). Collapsed = one 44 px row "Worum geht es? ▸" (15/600, chevron muted, 1 px `--line` under it). Open = `--surface-subtle` panel: the guide's "Worum geht es?" text, "Warum?" (label) + text, "Begriffe:" + the terms separated by " · ", max 45 % of the column; only the body scrolls, the toggle row stays visible. Open while the step's chat is empty, collapsed once it has messages; it never closes by itself while Lukas is on the step. **No example:** the guide has none (it only tells the assistant to make one from the project), so examples stay in the chat. Text comes from each step file's "Intro-Panel" section.
- **Term tooltips:** dotted underline (`.term`); hover, click or Enter opens the glossary text, Esc / blur / leave closes. "Fachwort: …" follows the plain text; a combined term ("direkte/indirekte Zielgruppe") shows both entries, each with its bold name. The bubble is fixed-positioned so the intro's scroll box can't clip it, and it closes when anything scrolls.
- **"Letzte Sitzung" divider:** a pause of ≥ 2 hours starts a new session. One muted line (13 px, 1 px `--line` rules either side) "Letzte Sitzung: heute | gestern | 26.10." before the first message after the newest pause; when Lukas is back and hasn't written yet, it sits under the last message, so new messages appear below it. Only the newest pause gets one.
- **New segment divider:** same line style, "Neuer Gesprächsabschnitt", with a small accent text toggle "Zusammenfassung ▸" under it. Open: a 1 px `--line` panel (`--radius-panel`) with the muted lead "Das Gespräch darüber kennt die Wirkungshelferin nur noch so:" and the summary (Markdown). Without a summary (it failed after a model change): muted "Das Gespräch darüber kennt die Wirkungshelferin nicht mehr. Dein Baustein ist davon nicht betroffen." Old segments stay visible above. **When a session break and a new segment fall at the same spot, they merge into one line:** "Letzte Sitzung: 26.10. · Neuer Gesprächsabschnitt".
- **Summary before a turn:** the "Neuer Gesprächsabschnitt" line (without toggle) shows already, then Lukas's message as his bubble, then an assistant bubble with the pulsing dot and "fasst das bisherige Gespräch zusammen …"; Stopp works as usual and puts his text back into the input.
- **"Zur neuesten Nachricht":** secondary button with a down chevron, centred, floating 12 px above the composer over the messages; only while an answer runs and Lukas has scrolled up. Click → bottom, follows the stream again, focus back to the input.
- *UI/UX review (8.5/10, 0 Critical / 0 High):* fixed — merged dividers, toggle stays visible, reassurance on the no-summary note, pending segment line during the summary, disc bullets in Markdown lists (Chrome's nested-list circles), room for the focus ring between terms. Not done — click closing an open term (it opens on hover, so a click would close what Lukas is about to read); dividers counted as list items by screen readers (Low). PO 2026-11-06: "Letzte Sitzung: 26.10." stays as it is; the reassurance sentence on the no-summary note stays.

### 6.3 Setup & settings
- **Setup (first start):** a single centred column (max 560 px), steps 1–4 as a short checklist: Willkommen → API-Schlüssel eingeben + "Verbindung testen" → Datenschutz-Hinweis → Erstes Backup. Each step one screen, "Weiter" as the only primary button.
  - *Step 7 build:* shown once per Chrome (after "Neu starten" or a backup loaded into a new Chrome); screens already done are skipped (after "Backup laden" only the key screen, whose lead starts "Dein Projekt ist geladen. In diesem Chrome fehlt nur noch der API-Schlüssel."). Welcome = "Bevor es losgeht" + numbered list of the steps with one line each. Screens 2–4 show a small horizontal checklist above the h1 (13 px muted, ✓ done / ◐ current in 600 `--text` / ○ todo, SVG icons), only when there are 2+ steps. The last screen's button says "Fertig". "Weiter"/"Fertig" stays the only primary and is aria-disabled with its reason beside it ("Teste zuerst die Verbindung." / "Speichere zuerst das Backup."). Focus moves to the new h1.
  - Key screen: dot-masked **text** input (`KeyInput`, `-webkit-text-security`), so Chrome's password manager doesn't offer to save it; [Verbindung testen] secondary beside it, busy "Teste …" without changing width (Button reserves the wider label). Success: ✓ line "Verbindung erfolgreich. Der Schlüssel ist gespeichert." (live region). **Only key problems mark the field** (red border + ⛔ under it); offline, busy, credit, model, unreachable, other go in a ⛔ line under the form and leave the field alone. Setup texts never point to the settings page (no route out of setup).
  - Datenschutz: four concrete rules (no names of participants, no other personal data, describe groups, check documents before upload).
  - Erstes Backup: when Chrome refused persistent storage, a ⚠ banner sits *above* the action ("Chrome kann deine Daten löschen, wenn der Speicher knapp wird. Setz ein Lesezeichen … (Cmd+D) …"); [Backup speichern] is primary until saved, then secondary and "Fertig" takes over; granted storage → ✓ line "Chrome hebt deine Daten dauerhaft auf."
  - Settings gained [Verbindung testen] at the end of "Verbindung zu Claude" (tests the saved key, model, effort); success and ⛔ failure both appear under the button; disabled with reason when no key is saved.
  - Banner (shared): multi-line text without actions aligns its icon to the first line.
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
