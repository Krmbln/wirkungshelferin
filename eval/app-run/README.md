# App run (step 25a: blocker pass)

Drives the live app in real Chrome (Playwright) with a simulated first-time user: Haiku plays the
persona of an eval case (`eval/cases/<case>/facts.md`) and knows nothing about the app. Each turn it
sees only the page's aria snapshot and a numbered list of its controls, and returns one action
(click · type + Enter · paste the application text · wait · "weiß nicht weiter"). The app runs
with Lukas's settings (Opus 5.5, effort medium); the script does the setup itself, so the key
never reaches the user model or the logs.

```bash
source ~/.nvm/nvm.sh && nvm use 24
node --test eval/app-run/lib.test.ts                    # pure helpers
node eval/app-run/run.ts --fake --steps 0-1             # free smoke run: API faked, scripted user
caffeinate -i node eval/app-run/run.ts                  # paid run, key from app/.env.local
node eval/app-run/run.ts --run <id>                     # resume an aborted run
```

Options: `--case dev-1`, `--cap 8` (USD, Opus + Haiku, priced from each answer's usage),
`--max-actions 18` (per step), `--steps 0-6`, `--url`, `--headed`.

Guardrails per step: the action cap; the screen unchanged after 3 actions in a row → stuck; two
"weiß nicht weiter" → stuck; 3 actions away from the step → the script opens it (logged). After
a give-up the script opens the next step itself. Three answers that can't be priced stop the run.

Output in `eval/runs/app-run/<id>/` (git-ignored): `report.md` (results, findings, chat per step,
blocks), `log.jsonl`, `shots/`, `project.json`, `state.json`. The Chrome profile (it holds the
key) is deleted when a run finishes and kept for `--run` when it aborts.
