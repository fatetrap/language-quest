"""Opus fix pass over every written lesson: a native-level editor finds the remaining mistakes and corrects them.

  .venv\\Scripts\\python.exe fix_course.py [--budget 75] [--workers 10] [--only u01l1]
Originals are kept in course/lessons_sonnet/. Each fixed lesson gets an "opus_fix" note, so a rerun skips it.
Then course.js is rebuilt (reload the app to see the corrected content).
"""

import argparse
import json
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from common import MODEL, USAGE
from make_course import COURSE_DIR, LESSONS_DIR, add_romanization, ask, build_course_js, log

BACKUP_DIR = COURSE_DIR / "lessons_sonnet"

FIX_PROMPT = """You are a native Mongolian (Khalkha) editor and a native English editor doing the final check of a
lesson from an English <> Mongolian course before learners use it. It was edited once already, but mistakes remain.
Find and fix every real mistake:
- Mongolian: spelling, ө/ү vs о/у, vowel harmony, case and verb endings, natural standard Khalkha word choice (replace
  rare, dialect or made-up words everywhere they appear), register (чи/та) consistent within a dialogue.
- English: grammar and natural wording.
- Translation pairs (and alt_* lists) that don't mean the same thing; remove wrong alternatives.
- Fill-in-the-blank: the answer must be the only correct option, and the answer and options must use the right forms.
- Grammar explanations and culture notes: must be accurate; the en and mn versions must say the same thing.
Ignore pure style preferences. Keep the lesson's structure.

Lesson {id} (level {level}): {title}
{lesson}

Each fix replaces one value. "section" is one of: intro, vocab, sentences, grammar, grammar.examples, fill_blank,
dialogue, culture_note. "index" is the item number from 0 for lists (null for intro, grammar, culture_note).
"field" is the key to replace (e.g. mn, en, alt_mn, example_mn, answer, options, text, translation, explain_en,
title_mn, intro_en). For alt_* and options give the full new list.

Answer with only JSON in a ```json block:
{{"rating_before": 1-10, "fixes": [{{"section": "...", "index": 0, "field": "...", "new": "...", "why": "short"}}],
  "notes": "one line"}}"""


def get_target(lesson, section, index):
    obj = lesson
    for part in section.split("."):
        obj = obj.get(part) if isinstance(obj, dict) else None
    if isinstance(obj, list):
        obj = obj[index] if isinstance(index, int) and 0 <= index < len(obj) else None
    return obj


def apply(lesson, fixes):
    applied = 0
    for fx in fixes or []:
        section, field = fx.get("section") or "", fx.get("field") or ""
        if section == "intro" or field in ("intro_en", "intro_mn"):
            if field in ("intro_en", "intro_mn"):
                lesson[field] = fx.get("new")
                applied += 1
            continue
        target = get_target(lesson, section, fx.get("index"))
        if isinstance(target, dict) and field:
            target[field] = fx.get("new")
            applied += 1
    return applied


def fix_lesson(unit, meta):
    path = LESSONS_DIR / f"{meta['id']}.json"
    lesson = json.loads(path.read_text(encoding="utf-8"))
    if "opus_fix" in lesson:
        return None
    backup = BACKUP_DIR / path.name
    if not backup.exists():
        shutil.copy2(path, backup)
    shown = json.loads(json.dumps(lesson))
    shown.pop("review", None)
    for section in ("vocab", "sentences", "dialogue"):
        for item in shown.get(section, []):
            item.pop("mn_latin", None)
    for ex in shown.get("grammar", {}).get("examples", []):
        ex.pop("mn_latin", None)
    r = ask(FIX_PROMPT.format(id=meta["id"], level=unit["level"], title=meta.get("title_en", ""),
                              lesson=json.dumps(shown, ensure_ascii=False)), MODEL, "opus_fix")
    applied = apply(lesson, r.get("fixes"))
    add_romanization(lesson)
    lesson["opus_fix"] = {"rating_before": r.get("rating_before"), "fixes": applied, "notes": r.get("notes", ""),
                          "changes": [{k: f.get(k) for k in ("section", "index", "field", "why")}
                                      for f in r.get("fixes") or []]}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(lesson, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)
    return applied, r.get("rating_before")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=75)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--only", nargs="*", help="lesson ids, e.g. u01l1")
    args = ap.parse_args()
    BACKUP_DIR.mkdir(exist_ok=True)
    outline = json.loads((COURSE_DIR / "outline.json").read_text(encoding="utf-8"))
    todo = [(u, l) for u in outline["units"] for l in u["lessons"]
            if (LESSONS_DIR / f"{l['id']}.json").exists() and (not args.only or l["id"] in args.only)]
    log(f"Opus fix pass: {len(todo)} lessons, {args.workers} at a time, budget ${args.budget:.0f}")
    started, done, total_fixes, skipped = time.time(), 0, 0, 0

    def guarded(pair):
        if USAGE.cost > args.budget:
            return "budget"
        return fix_lesson(*pair)

    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(guarded, p): p[1]["id"] for p in todo}
        for fut in as_completed(futures):
            lesson_id = futures[fut]
            try:
                res = fut.result()
            except Exception as e:
                log(f"{lesson_id} FAILED: {e}")
                continue
            if res == "budget":
                skipped += 1
                continue
            if res is None:
                continue
            done += 1
            total_fixes += res[0]
            if done % 10 == 0 or args.only:
                log(f"{lesson_id}: rated {res[1]}, {res[0]} fixes. {done} lessons fixed, ${USAGE.cost:.2f}, "
                    f"{(time.time() - started) / 60:.1f} min")
    if skipped:
        log(f"Budget reached: {skipped} lessons not fixed (rerun to continue)")
    # Keep the generation run's numbers (cost, minutes) in the app's stats card; add the fix pass separately.
    old = json.loads((COURSE_DIR / "stats.json").read_text(encoding="utf-8"))
    fixed = [json.loads(p.read_text(encoding="utf-8")).get("opus_fix") for p in LESSONS_DIR.glob("*.json")]
    fixed = [f for f in fixed if f]
    extra = {k: old.get(k) for k in ("cost_usd", "calls", "tokens_written", "minutes", "budget_usd", "time_limit_min")}
    extra.update(opus_fixed=len(fixed), opus_fixes=sum(f["fixes"] for f in fixed),
                 opus_fix_usd=round(old.get("opus_fix_usd", 0) + USAGE.cost, 2))
    stats = build_course_js(outline, time.time(), None, None, extra)
    log(f"Done: {done} lessons fixed, {total_fixes} fixes. Course has {stats['lessons']} lessons.")
    log(USAGE.summary())


if __name__ == "__main__":
    main()
