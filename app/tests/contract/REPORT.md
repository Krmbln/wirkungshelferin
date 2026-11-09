# Live API contract — last run

Run: 2026-11-05 22:55 UTC · model claude-opus-5-5 · effort medium

| | Check | Note |
|---|---|---|
| ✓ | Strict schemas step 0 | stop: end_turn |
| ✓ | Strict schemas step 1 | stop: end_turn |
| ✓ | Strict schemas step 2 | stop: end_turn |
| ✓ | Strict schemas step 3 | stop: end_turn |
| ✓ | Strict schemas step 4 | stop: end_turn |
| ✓ | Strict schemas step 5 | stop: end_turn |
| ✓ | Strict schemas step 6 | stop: end_turn |
| ✓ | Step 1 opening: tool call valid, temp ids → real ids | 7 changes (6 adds), 6 applied, 1 rejected |
| ✓ | Message order | single-user |
| ✓ | Step 1 update by short id + baseRev | tg1 (baseRev 2) applied |
| ✓ | Stopped during thinking (turn with an app event) | first block: thinking |
| ✓ | Stopped during tool_use | stopped at tool_use start |
| ✓ | History after stopped turns accepted (strict history check) | 7 messages sent, 2 stopped turns left out, 1 new proposal(s) |
| ✓ | Reload with open proposal | 1 tool_result(s), with open changes; stop: end_turn |
| ✓ | Cache hits | first turn 0, then 22555, 25085, 25142 |
| ✓ | PDF extraction with continuation | 3 rounds, 3065 characters, all 40 rows |

- Shape A `system-between` ([user: tool_results] → [system: events] → [user: text]): refused ({"type":"error","error":{"type":"invalid_request_error","message":"messages.3: role 'system' must precede an 'assistant' message or end the array; the directive-only form (content: [] with output_conf)
- Shape B `system-after` ([user: tool_results + text] → [system: events]): accepted
- Shape B after a stopped answer ([user] → [system] → [user]): refused ({"type":"error","error":{"type":"invalid_request_error","message":"messages.1: role 'system' must precede an 'assistant' message or end the array; the directive-only form (content: [] with output_conf)
- Shape C `single-user` ([user: tool_results + "[App] …" + text]): accepted
- **Decided message order: `single-user`** (MESSAGE_ORDER in src/ai/prompt.ts)
- Cache reads per turn: 0 → 22555 → 25085 → 25142 tokens

Usage: 18 calls · input 3471 · output 8075 · cache read 180131 · cache write 1 h 30488 / 5 min 5253 · **≈ $0.48**

## Step 0 cases (step 14, run alone 2026-11-08)

| | Check | Note |
|---|---|---|
| ✓ | Step 1 opening after the hand-off: text + question first, then the card | Eine Frage zu der Zahl „im Schnitt 15 pro Nachmittag“: Das sind Besuche, nicht unbedingt verschiedene Jugendliche. **Kommen meistens dieselb |
| ✓ | Step 0 paste: profile proposal valid, unknown = "offen", no deadline | text first (1340 chars), 2 change(s); offen: team, budgetRange, otherOffers; frame purpose "offen" |
| ✓ | Step 0 interview: first question | **Frage 1 von 8:** Wie heißt dein Projekt? |

- The first paste run (18:16 UTC, $0.20) passed but Claude sent the card with no text: a tool call ends the turn. The rules now say text and the one question come first; the paste and opening cases assert it (≈ $0.21 + $0.20).

## Step 15 add-on (run alone: `npx vitest run --project contract -t "5 · step 0"`, 2026-11-08)

| | Check | Note |
|---|---|---|
| ✓ | Step 0 PDF: read → PDF source → profile proposal valid | 3145 chars in 244 updates; text first; offen: organisation, team, duration, funder, statedGoals, otherOffers |

Usage: 2 calls · output 5483 · cache write 1 h 19854 / 5 min 5253 · **≈ $0.29**

## Step 16 add-on (run alone: `npx vitest run --project contract -t "6 · step 2"`, 2026-11-09)

| | Check | Note |
|---|---|---|
| ✓ | Step 2: problem tree proposal valid (groupId, parentId, ≤ 3 levels), text + question first | 5 changes; 4 causes (2 nested), 0 consequences; evidence eigene_erfahrung/unsicher; question: „Trifft das Kernproblem den Kern – oder ist das Problem der Jugendlichen eigentlich ein anderes?“ |

Usage: 1 call · output 2932 · cache write 1 h 18695 · **≈ $0.21**

## Step 16 PO-run fix (run alone: `-t "6 · step 2"`, 2026-11-09)

The PO run's second proposal (13 changes) came as thinking → tool call with no text, and added the challenge as a consequence. Reproduced once in the contract (follow-up ✗, ≈ $0.35). Fix: the text-first rule in the propose_changes description, step 2 rules for the challenge and every proposal. Re-run:

| | Check | Note |
|---|---|---|
| ✓ | Step 2: problem tree proposal valid (groupId, parentId, ≤ 3 levels), text + question first | 6 changes; 5 causes (2 nested), 0 consequences; evidence eigene_erfahrung/unsicher; question: Trifft das den Kern – oder ist das Problem der Jugendlichen eigentlich ein anderes? |
| ✓ | Step 2 follow-up: second group + consequences, text first, no challenge as a consequence | 13 changes; 6 consequences; text first (2047 chars): Meine Frage: Trifft das Kernproblem der Mädchen den Kern – oder ist ihr eigentliches Probl |

Usage: 2 calls · output 8394 · cache write 1 h 23597 · **≈ $0.36**
