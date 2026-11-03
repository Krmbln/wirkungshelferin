#!/usr/bin/env python3
"""Eval harness for the Wirkungshelferin method guide.

Three isolated roles, each a separate `claude -p` session:
  - assistant: sees only the method guide (00-shared, glossary, current step) + earlier confirmed blocks
  - persona:   sees only the persona archetype + the case's facts.md (+ application.md); one session for all steps
  - judge:     sees only the case's traps.json + the final blocks

Usage:
  python3 -I eval/harness.py --round r0 --cases dev-1 dev-2 holdout-1
Holdout cases print only their score; details go to files the developer agent does not read.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUIDE = ROOT / "method-guide"
CASES = ROOT / "eval" / "cases"
RUNS = ROOT / "eval" / "runs"
SANDBOX = Path("/private/tmp/claude-502/sandbox")  # neutral cwd: no CLAUDE.md, no project files

STEP_FILES = {
    0: "step-0-context.md", 1: "step-1-target-groups.md", 2: "step-2-problem.md",
    3: "step-3-goals.md", 4: "step-4-impact-logic.md", 5: "step-5-focus-indicators.md",
    6: "step-6-data-plan.md",
}
STEP_NAMES = {
    0: "Projektkontext & Messrahmen", 1: "Herausforderung, Zielgruppen & Beteiligte",
    2: "Problem & Ursachen", 3: "Wirkungsziele", 4: "Wirkungslogik",
    5: "Messfokus & Indikatoren", 6: "Datenerhebungsplan",
}
MAX_PERSONA_TURNS = 15  # per step; then the app forces a close (r0: 25)
CONFIRM = "[BESTÄTIGT]"

ASSISTANT_MODEL = os.environ.get("EVAL_ASSISTANT_MODEL", "sonnet")
PERSONA_MODEL = os.environ.get("EVAL_PERSONA_MODEL", "haiku")  # r0: sonnet
JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "sonnet")  # r0: opus


# ---------------------------------------------------------------- claude -p

def claude(prompt, system, model, session=None, retries=8):
    """One turn. Returns (text, session_id, cost)."""
    cmd = ["claude", "-p", "--model", model, "--tools", "", "--setting-sources", "",
           "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
           "--system-prompt", system, "--output-format", "json", "--max-budget-usd", "3"]
    if session:
        cmd += ["--resume", session]
    cmd.append(prompt)
    last_err = None
    for attempt in range(retries + 1):
        try:
            out = subprocess.run(cmd, cwd=SANDBOX, capture_output=True, text=True, timeout=600)
            try:
                d = json.loads(out.stdout)
            except json.JSONDecodeError:
                raise RuntimeError(f"no JSON (rc={out.returncode}) stdout={out.stdout[:300]!r} stderr={out.stderr[:300]!r}")
            if d.get("is_error"):
                raise RuntimeError(d.get("result") or out.stderr[:500])
            return d["result"], d["session_id"], d.get("total_cost_usd", 0.0)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(min(30 * (attempt + 1), 180))
    raise RuntimeError(f"claude call failed: {last_err}")


# ---------------------------------------------------------------- prompts

def assistant_system(step):
    shared = (GUIDE / "00-shared.md").read_text()
    glossary = (GUIDE / "glossary.md").read_text()
    step_md = (GUIDE / STEP_FILES[step]).read_text()
    return f"""Du bist die „Wirkungshelferin“: eine deutschsprachige Assistentin, die eine Person ohne Methodenwissen Schritt für Schritt zu einem Wirkungsmodell für ihr Projekt führt. Du arbeitest gerade an Schritt {step} – {STEP_NAMES[step]}.

Folge dem Methodenleitfaden unten genau. Er ist dein einziges Methodenwissen.

## Bedienung (Simulation der App)
- Du sprichst im Chat mit der Person. Deine Vorschläge gelten als übernommen, wenn die Person zustimmt.
- Wenn der Baustein vollständig ist: Führe den Qualitätscheck gegen die Rubrik durch. Gib dann den **vollständigen** Baustein zwischen <BAUSTEIN> und </BAUSTEIN> aus (Markdown, alle Felder, inkl. aller Warum), danach den Check zwischen <CHECK> und </CHECK> (je Kriterium ✓/⚠/⛔ + ein Satz), und frage, ob die Person bestätigen will.
- Ändert sich danach noch etwas, gib den Baustein erneut vollständig aus.
- Bestätigen ist bei ⛔ nicht möglich.
- Nachrichten, die mit [APP] beginnen, kommen von der App, nicht von der Person.

==================== 00-shared.md ====================
{shared}

==================== glossary.md ====================
{glossary}

==================== {STEP_FILES[step]} ====================
{step_md}
"""


PERSONA_ARCHETYPE = """Du spielst in einem Test eine reale Person: eine Praktikerin bzw. einen Praktiker aus der sozialen Arbeit. Du nutzt zum ersten Mal ein KI-Werkzeug, das dir hilft, die Wirkung deines Projekts zu planen.

## So bist du
- Kein Wissen über Wirkungsmessung. Du kennst keine Fachbegriffe (Wirkungstreppe, Indikator, Theory of Change, Outcome …) und benutzt sie nie von dir aus.
- Wenig Zeit, ungeduldig bei langen Texten. Du antwortest kurz und umgangssprachlich, oft klein geschrieben, 1–3 Sätze.
- Du sprichst gern in Antragssprache und großen Zielen.
- Vorschläge nimmst du schnell an („passt“, „ok“, „joa“), wenn sie nicht falsch sind.
- Du widersprichst, wenn eine Tatsache über dein Projekt nicht stimmt.
- Nach Belegen gefragt sagst du oft „Erfahrung halt“, auch wenn es eher eine Vermutung ist.

## Spielregeln
- Bleib immer in der Rolle. Antworte nur als diese Person, auf Deutsch. Keine Erklärungen über den Test.
- Dein Wissen steht im Faktenblatt unten. **Versteckte Fakten** verrätst du nur, wenn die Assistentin danach fragt oder eine Frage stellt, die das Thema berührt. Von dir aus erzählst du sie nicht.
- Erfinde keine Fakten, die dem Faktenblatt widersprechen. Fehlt etwas im Faktenblatt, antworte plausibel und knapp oder sag „weiß ich nicht“.
- Deine **Vorstöße** (siehe Faktenblatt) bringst du an passender Stelle von dir aus ein. Du gibst nach, wenn die Assistentin mit einer guten Gegenfrage oder Begründung kommt – sonst bleibst du dabei.
- Wenn die Assistentin dich bittet, einen Baustein zu bestätigen, und du keinen Einwand hast, antworte mit einem kurzen Satz und schreib am Ende genau: [BESTÄTIGT]
- Wenn eine Nachricht mit [APP] beginnt, ist das eine Systemansage; antworte nur, wenn du gefragt wirst.
"""


def persona_system(case_dir):
    facts = (case_dir / "facts.md").read_text()
    app = (case_dir / "application.md").read_text()
    return f"""{PERSONA_ARCHETYPE}

==================== DEIN FAKTENBLATT (geheim) ====================
{facts}

==================== DEIN ANTRAG (kannst du in Schritt 0 einfügen, falls vorhanden) ====================
{app}
"""


JUDGE_SYSTEM = """You are an independent senior impact consultant grading the output of an AI assistant that helped a practitioner build an impact measurement system (PHINEO Wirkungstreppe + Theory of Change, steps 0–6).
You get: a list of traps (hidden facts a good consultant should have uncovered, and bad contents the practitioner pushed that should not survive unchallenged), and the final confirmed building blocks of steps 0–6 (in German).
Grade ONLY from the building blocks. The product deliberately does NOT capture report deadlines or due dates: ignore any trap criterion about deadlines, and never penalise their absence. For each trap decide: "pass", "partial" or "fail", using the trap's pass/partial criteria. Be strict but fair: credit any wording that clearly satisfies the criterion, wherever it appears in the blocks.
Also give an overall consultant score 1–10 for the whole model: "Could I defend this in front of the funder, and is it right-sized for a person with 1 hour per week?"
Answer with JSON only, no prose, in this shape:
{"traps":[{"id":"T1","verdict":"pass|partial|fail","reason":"<one sentence>"}],"overall":7,"overall_reason":"<two sentences>"}"""


# ---------------------------------------------------------------- run one case

def extract_block(text):
    m = re.findall(r"<BAUSTEIN>(.*?)</BAUSTEIN>", text, flags=re.S)
    return m[-1].strip() if m else None


def run_case(case, rnd, log, max_step=6, from_step=0, seed_round=None):
    case_dir = CASES / case
    out_dir = RUNS / rnd / case
    out_dir.mkdir(parents=True, exist_ok=True)
    state_file = out_dir / "state.json"
    transcript = []
    blocks = {}
    stats = {"case": case, "persona_turns": {}, "cost": 0.0, "forced_close": []}
    p_session = None
    if not state_file.exists() and seed_round and from_step > 0:
        # reuse confirmed blocks of steps < from_step from an earlier round (saves quota)
        seed = json.loads((RUNS / seed_round / case / "state.json").read_text())
        keep = [str(k) for k in range(from_step)]
        state_file.write_text(json.dumps({
            "transcript": [t for t in seed["transcript"] if t[1] < from_step],
            "blocks": {k: v for k, v in seed["blocks"].items() if k in keep},
            "stats": {"case": case, "persona_turns": {k: v for k, v in seed["stats"]["persona_turns"].items() if k in keep},
                      "cost": 0.0, "forced_close": [], "seeded_from": seed_round},
            "p_session": seed["p_session"]}, ensure_ascii=False))
    if state_file.exists():  # resume after an interruption
        st = json.loads(state_file.read_text())
        transcript = [tuple(x) for x in st["transcript"]]
        blocks = {int(k): v for k, v in st["blocks"].items()}
        stats, p_session = st["stats"], st["p_session"]
        log(f"{case}: resuming after step {max(blocks) if blocks else -1}")
    p_sys = persona_system(case_dir)
    has_doc = "KEIN ANTRAG" not in (case_dir / "application.md").read_text()

    for step in range(max_step + 1):
        if step in blocks:
            continue
        a_sys = assistant_system(step)
        a_session = None
        ctx = "\n\n".join(f"### Bestätigter Baustein Schritt {s} – {STEP_NAMES[s]}\n{b}" for s, b in blocks.items())
        if step == 0:
            opening = ("[APP] Schritt 0 beginnt. " +
                       ("Die Person fügt gleich ein Dokument ein." if has_doc else
                        "Die Person hat kein Dokument. Führe das Interview.") +
                       " Begrüße kurz und eröffne den Schritt gemäß Leitfaden.")
            if has_doc:
                opening += "\n\n[Eingefügter Text der Person]\n" + (case_dir / "application.md").read_text()
        else:
            opening = (f"[APP] Schritt {step} beginnt. Hier die bisher bestätigten Bausteine:\n\n{ctx}\n\n"
                       "Eröffne den Schritt gemäß Leitfaden.")
        a_msg, a_session, c = claude(opening, a_sys, ASSISTANT_MODEL, a_session)
        stats["cost"] += c
        transcript.append(("assistant", step, a_msg))
        last_block = extract_block(a_msg)
        turns = 0
        forced = False
        while True:
            p_prompt = (f"[Schritt {step} – {STEP_NAMES[step]}]\n\nDie Assistentin schreibt:\n\n{a_msg}"
                        if turns == 0 else f"Die Assistentin schreibt:\n\n{a_msg}")
            p_msg, p_session, c = claude(p_prompt, p_sys, PERSONA_MODEL, p_session)
            stats["cost"] += c
            turns += 1
            transcript.append(("persona", step, p_msg))
            if CONFIRM in p_msg and extract_block(a_msg):  # only a confirm right after a full block counts
                break
            if turns >= MAX_PERSONA_TURNS and not forced:
                forced = True
                p_msg += ("\n\n[APP] Die Sitzung ist sehr lang geworden. Schließe den Schritt jetzt ab: "
                          "Qualitätscheck, vollständiger Baustein, Bitte um Bestätigung.")
            elif turns >= MAX_PERSONA_TURNS + 5:
                break
            a_msg, a_session, c = claude(p_msg, a_sys, ASSISTANT_MODEL, a_session)
            stats["cost"] += c
            transcript.append(("assistant", step, a_msg))
            last_block = extract_block(a_msg) or last_block
        blocks[step] = last_block or "(kein Baustein ausgegeben)"
        stats["persona_turns"][step] = turns
        if forced:
            stats["forced_close"].append(step)
        state_file.write_text(json.dumps({"transcript": transcript, "blocks": blocks, "stats": stats,
                                          "p_session": p_session}, ensure_ascii=False))
        log(f"{case}: step {step} done, {turns} turns")

    # judge
    traps = (case_dir / "traps.json").read_text()
    all_blocks = "\n\n".join(f"## Step {s} – {STEP_NAMES[s]}\n{b}" for s, b in blocks.items())
    j_txt, _, c = claude(f"TRAPS:\n{traps}\n\nFINAL BUILDING BLOCKS:\n{all_blocks}", JUDGE_SYSTEM, JUDGE_MODEL)
    stats["cost"] += c
    m = re.search(r"\{.*\}", j_txt, flags=re.S)
    judge = json.loads(m.group(0)) if m else {"error": j_txt}
    pts = {"pass": 1.0, "partial": 0.5, "fail": 0.0}
    tr = judge.get("traps", [])
    stats["trap_score"] = round(sum(pts.get(t["verdict"], 0) for t in tr) / max(len(tr), 1), 3)
    stats["overall"] = judge.get("overall")
    stats["total_turns"] = sum(stats["persona_turns"].values())

    (out_dir / "blocks.md").write_text(all_blocks)
    (out_dir / "transcript.md").write_text("\n\n".join(
        f"---\n**{'🤖' if r == 'assistant' else '👤'} [S{s}]**\n\n{t}" for r, s, t in transcript))
    (out_dir / "judge.json").write_text(json.dumps(judge, ensure_ascii=False, indent=2))
    (out_dir / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2))
    return stats


# ---------------------------------------------------------------- main

def guide_words():
    return sum(len(p.read_text().split()) for p in GUIDE.glob("*.md"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    ap.add_argument("--cases", nargs="+", required=True)
    ap.add_argument("--max-step", type=int, default=6)
    ap.add_argument("--from-step", type=int, default=0, help="reuse steps < N from --seed-round")
    ap.add_argument("--seed-round", default=None)
    args = ap.parse_args()
    SANDBOX.mkdir(parents=True, exist_ok=True)
    rnd_dir = RUNS / args.round
    rnd_dir.mkdir(parents=True, exist_ok=True)
    # snapshot the guide used in this round
    snap = rnd_dir / "guide"
    snap.mkdir(exist_ok=True)
    for p in ([] if any(snap.iterdir()) else GUIDE.glob("*.md")):
        (snap / p.name).write_text(p.read_text())

    lock = threading.Lock()
    def log(msg):
        if "holdout" in msg:
            msg = msg.split(":")[0] + ": progress"
        with lock:
            print(time.strftime("%H:%M:%S"), msg, flush=True)

    results = {}
    def worker(case):
        try:
            results[case] = run_case(case, args.round, log, args.max_step, args.from_step, args.seed_round)
        except Exception as e:  # noqa: BLE001
            results[case] = {"case": case, "error": str(e)}
    threads = [threading.Thread(target=worker, args=(c,)) for c in args.cases]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    summary = {"round": args.round, "guide_words": guide_words(), "cases": {}}
    for c, s in results.items():
        keep = ["trap_score", "overall", "total_turns", "cost", "forced_close", "error"]
        if not c.startswith("holdout"):
            keep.append("persona_turns")
        summary["cases"][c] = {k: s.get(k) for k in keep if k in s}
    (rnd_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
