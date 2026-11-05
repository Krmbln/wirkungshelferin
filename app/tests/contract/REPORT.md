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
