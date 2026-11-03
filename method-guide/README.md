# Method Guide – Wirkungshelferin

The assistant's methodological knowledge, one file per step. **Methodological layer only, independent of any project or context.** Project knowledge comes from the user's documents, not from here.

## What the guide is for
1. **Chat instructions** per step: questions, where to challenge, what to propose, which mistakes to catch.
2. **Rubric** per step: the in-app quality check (✓/⚠/⛔) and the criteria for Karim's dry run (PRD F9, ≥ 80 %).
3. **Intro panel texts** for the user.
4. **What a good entry looks like** for each building block. Field names and types are fixed in Phase 3 (tech design), not here.

## Files
| File | Content | Status |
|---|---|---|
| `00-shared.md` | Shared model (Wirkungstreppe + ToC elements), language, attitude, pace, cross-cutting rules | ✅ Batch A |
| `step-0-context.md` | Project context & measurement frame | ✅ Batch A |
| `step-1-target-groups.md` | Challenge, target groups & stakeholders | ✅ Batch A |
| `step-2-problem.md` | Problem & root causes | ✅ Batch A |
| `step-3-goals.md` | Impact goals | ✅ Batch B |
| `step-4-impact-logic.md` | Impact logic | ✅ Batch B |
| `step-5-focus-indicators.md` | Measurement focus & indicators | ✅ Batch C |
| `step-6-data-plan.md` | Data collection plan | ✅ Batch C |
| `glossary.md` | Terms in plain German | ✅ final (Batch C) |
| `_log/` | Critique + verification per file (self-correction loop) | – |

## Conventions
- **Language:** German. All user-facing text uses the informal "Du" and plain language.
- **Sources:** IDs S1–S18 refer to `docs/method-catalog.md`. Page numbers are the **printed** page numbers of the sources (the Kursbuch PDF index is printed page + 2).
- **No verbatim quotes** from the sources (the repo is public). Everything is paraphrased.
- **Own decisions** that no source covers are labelled "eigene Festlegung" or "PO-Entscheidung".
- **No example project** (removed 2026-10-10): examples always come from the user's own project (see `00-shared.md`, section 10).
- **No time or effort aspects** (PO decision 2026-10-07).

## How each file was produced
Each file went through a fixed self-correction loop:
1. Draft
2. Critique (at least 3 weak points, from the impact-expert and layperson perspectives)
3. Verification (yes/no questions checked against the source files, with locations)
4. Final version

Critique and verification are in `_log/<file>.md`.
