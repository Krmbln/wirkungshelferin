# Live API contract — last run

Run: 2026-11-09 20:46 UTC · model claude-opus-5-5 · effort medium

| | Check | Note |
|---|---|---|
| ✓ | Strict schemas step 0 | stop: end_turn |
| ✓ | Strict schemas step 1 | stop: end_turn |
| ✓ | Strict schemas step 2 | stop: end_turn |
| ✓ | Strict schemas step 3 | stop: end_turn |
| ✓ | Strict schemas step 4 | stop: end_turn |
| ✓ | Strict schemas step 5 | stop: end_turn |
| ✓ | Strict schemas step 6 | stop: end_turn |
| ✓ | Step 1 opening: tool call valid, temp ids → real ids | 8 changes (7 adds), 7 applied, 1 rejected; text 1454 chars; question: Von den rund 15 Jugendlichen pro Nachmittag: Wie viele sind fast jedes Mal da, und wie vie |
| ✓ | Message order | single-user |
| ✓ | Step 1 update by short id + baseRev | tg1 (baseRev 2) applied; no text; question: Sind auch die Gelegenheitsbesucher vor allem 12 bis 14 – oder kommen die wenigen Älteren e |
| ✓ | Stopped during thinking (turn with an app event) | first block: thinking |
| ✓ | Stopped during tool_use | stopped at tool_use start |
| ✓ | History after stopped turns accepted (strict history check) | 7 messages sent, 2 stopped turns left out, 1 new proposal(s); text 171 chars; question: Was hat die Hausverwaltung mit der Werkstatt zu tun, und was erwartet sie vom Projekt? |
| ✓ | Reload with open proposal | 1 tool_result(s), with open changes; stop: end_turn |
| ✓ | Cache hits | first turn 0, then 23481, 26072, 26129 |
| ✓ | PDF extraction with continuation | 3 rounds, 3064 characters, all 40 rows |
| ✓ | Step 0 paste: profile proposal valid, unknown = "offen", no deadline | 2 change(s); offen: team, budgetRange, otherOffers; frame purpose "geldgeberin"; text 1025 chars, 3 "?"; question: Praxis-Frage 1 von 3: Wie läuft die Teilnahme? Kommen die Jugendlichen mit Anmeldung als f |
| ✓ | Step 0 follow-up proposal: question field filled | 1 change(s); no text, 2 "?"; question: Praxis-Frage 1 von 3: Kommen die Jugendlichen als feste Gruppe mit Anmeldung, oder kommen  |
| ✓ | Step 1 opening after the hand-off: text + question first, then the card | text 1306 chars; question: Von den etwa 15 Jugendlichen pro Nachmittag: Wie viele kommen ungefähr regelmäßig, und wie |
| ✓ | Step 0 interview: first question | **Frage 1 von 8:** Wie heißt dein Projekt? |
| ✓ | Step 0 PDF: read → PDF source → profile proposal valid | 3065 chars in 239 updates; offen: organisation, team, duration, funder, budgetRange, statedGoals, otherOffers; text 1011 chars, 2 "?"; question: Wie läuft die Teilnahme bei euch: Kommen und gehen die Jugendlichen, wie sie wollen, oder  |
| ✓ | Step 2: problem tree proposal valid (groupId, parentId, ≤ 3 levels), text + question first | 6 changes; 5 causes (2 nested), 0 consequences; evidence eigene_erfahrung/unsicher; text 1510 chars; question: Trifft das Kernproblem den Kern, und woher weißt du, dass die Reparaturen für die Familien |
| ✓ | Step 2 follow-up: second group + consequences, text first, no challenge as a consequence | 12 changes; 5 consequences; no text; question: Stimmt die Kette bei den Mädchen so, oder fehlt dort ein wichtiger Grund? |
| ✓ | Step 3: goals proposal valid (causeIds of the group, levels), text + question first | 5 changes; goals 6:ca1 5:ca1+ca4 5:ca1 4:ca4 4:ca4; time frames 5/5; text 1797 chars; question: Was heißt bei euch „regelmäßig kommen“, zum Beispiel mindestens zweimal im Monat oder alle |
| ✓ | Step 3 follow-up proposal (Stufe 7): question field filled | 1 change(s); no text; question: Trifft „andere Stadtteile erreichen“ das, was ihr gesellschaftlich wollt, oder geht es euc |
| ✓ | Step 3: gap in step 2 → "[Zu Schritt 2](#schritt-2)" in the text | link: Anders wäre es, wenn das Gefühl von Sicherheit etwas ist, das den Jugendlichen auch **außerhalb** der Werkstatt fehlt. E; proposal: no |
| ✓ | Step 4: chain proposal valid (own group, upwards, ends at goals), text + question first, no ids | 17 changes; 5 outputs; links ac1→ou1 ac3→ou2 ou1→ou3 ou2→ou3 ou3→ou4 ou3→ou5 ou4→go1 go1→go2! ou5→go2 go2→go3!; text 1724 chars; question: Im Projektprofil stehen auch „kleine Touren in die Umgebung“: Finden die noch statt? Sie k |
| ✓ | Step 4: factors (groupId "" or tg1) and side effects with direction, text first | 3 factors (alle, alle, tg1; bus named: true); 3 side effects (negative, negative, positive); no text; question: Wer könnte nicht profitieren oder sogar Nachteile haben, zum Beispiel weil er nachmittags  |
| ✓ | Step 5 opening: li1 decided, figures with targets, no figure as an indicator, no ids | 3 changes; li1 deferred ("Ob die Ehrenamtlichen bleiben, merkt das Team sofort ohne Me"); 0 questions, 0 indicators; figures Teilnehmende nach Geschlecht (Pflichtangabe Geldgeberin)=im Schnitt 15 pro Nachmittag (Schätzung aus der Projektskizze); Anzahl offener Werkstatttage (Pflichtangabe Geldgeberin)=rund 40 pro Halbjahr (2 pro Woche, ohne Schulferien; Schätzung); text 1275 chars; question: Zählen die 15 pro Nachmittag Besuche oder verschiedene Jugendliche, und weißt du schon, we |
| ✓ | Step 5 follow-up: 1–2 indicators per question, baseline + target, question field filled | 2 indicators (2 per question; levels 4,5); no text; question: Was würdet ihr anders machen, wenn sich zeigt, dass kaum jemand das Rad zu Hause selbst re |

- Shape A `system-between` ([user: tool_results] → [system: events] → [user: text]): refused ({"type":"error","error":{"type":"invalid_request_error","message":"messages.3: role 'system' must precede an 'assistant' message or end the array; the directive-only form (content: [] with output_conf)
- Shape B `system-after` ([user: tool_results + text] → [system: events]): accepted
- Shape B after a stopped answer ([user] → [system] → [user]): refused ({"type":"error","error":{"type":"invalid_request_error","message":"messages.1: role 'system' must precede an 'assistant' message or end the array; the directive-only form (content: [] with output_conf)
- Shape C `single-user` ([user: tool_results + "[App] …" + text]): accepted
- **Decided message order: `single-user`** (MESSAGE_ORDER in src/ai/prompt.ts)
- Cache reads per turn: 0 → 23481 → 26072 → 26129 tokens

Usage: 31 calls · input 3525 · output 45131 · cache read 339571 · cache write 1 h 166586 / 5 min 5469 · **≈ $2.34**

Added 2026-11-10 (step 19, run alone with `-t "9 · step 5"`): the two step 5 rows above · 2 calls · **≈ $0.19** (a first run, ≈ $0.27, failed on a fixture whose step 0 snapshot didn't carry the figures).
