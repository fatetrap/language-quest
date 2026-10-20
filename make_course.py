"""English <> Mongolian course generator: Claude on AWS Bedrock writes a Duolingo-style course for a fixed time.

Opus plans the curriculum (levels A1-B2, units, lessons). Then parallel workers, each lesson: Sonnet writes it
(words, sentences, grammar, fill-in-the-blank, dialogue, culture note, in both languages), and a second Sonnet call
checks the Mongolian and English as an editor and fixes mistakes. The same content serves both directions
(English speakers learning Mongolian, Mongolian speakers learning English); the app builds the exercises from it.

Stops when the time or budget runs out, whichever comes first. Rerunning continues where it stopped.
  .venv\\Scripts\\python.exe make_course.py --minutes 60 --budget 40
  .venv\\Scripts\\python.exe make_course.py --test        (one lesson only, to check everything works)
Open course\\index.html to use the course (it updates as lessons finish; reload the page).
"""

import argparse
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path

import common
from common import MODEL, MODEL_MID, USAGE, claude_client, effort_args, text_of

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

COURSE_DIR = Path(__file__).with_name("course")
LESSONS_DIR = COURSE_DIR / "lessons"
OUTLINE_FILE = COURSE_DIR / "outline.json"
LOG_FILE = COURSE_DIR / "run_log.txt"
STATS_FILE = COURSE_DIR / "stats.json"

LEVELS = ["A1", "A2", "B1", "B2"]

STYLE = """You write a Duolingo-style course between English and Mongolian (Khalkha, Cyrillic script).
The same lesson content is used in both directions: English speakers learning Mongolian, and Mongolian speakers
learning English. So every item needs natural, correct text in BOTH languages.
- Mongolian: natural modern Khalkha as people in Ulaanbaatar actually speak and write it; correct Cyrillic (ө, ү),
  vowel harmony, case endings, verb suffixes; polite "та" unless the situation is clearly informal.
- English: natural everyday English, American spelling.
- Mongolian-life context is welcome (Ulaanbaatar, ger districts, the countryside, Naadam, Tsagaan Sar, buuz,
  khuushuur, airag, work and university life), mixed with international everyday situations.
- Keep sentences short at A1-A2; longer and richer at B1-B2. No made-up words or rare literary forms.
- Explanations for English speakers are written in English; explanations for Mongolian speakers in Mongolian."""

OUTLINE_PROMPT = """Plan the full course: levels {levels}, {units} units in total (spread across the levels, more at
A1-A2). Units build step by step (no repeats; later units reuse earlier material). Cover both the Mongolian grammar an
English speaker needs (cases, vowel harmony, verb tenses and converbs, question particles, possessive suffixes...)
and the English grammar a Mongolian speaker needs (articles, word order, tenses, prepositions, plurals...).
Only the units now; their lessons are planned later. Keep each "scope" to one short line.

Answer with only JSON in a ```json block:
{{"course_title_en": "...", "course_title_mn": "...",
  "units": [{{"id": "u01", "level": "A1", "title_en": "...", "title_mn": "...",
             "scope": "situations; vocabulary themes; grammar points"}}]}}"""

UNIT_PROMPT = """Course units so far (for context, don't repeat what other units cover):
{all_units}

Plan the {lessons} lessons of unit {id} (level {level}): "{title_en}". Scope: {scope}
Each lesson has one clear goal: a situation plus a vocabulary theme plus a grammar point, building step by step.

Answer with only JSON in a ```json block:
{{"lessons": [{{"id": "{id}l1", "title_en": "...", "title_mn": "...",
               "focus": "situation; vocabulary theme; grammar point (one line)"}}]}}"""

LESSON_PROMPT = """Write lesson {id} (level {level}), in unit "{unit}".
Lesson: "{title_en}" / "{title_mn}". Focus: {focus}
Earlier lessons in this unit: {earlier}

Answer with only JSON in a ```json block:
{{"intro_en": "1-2 sentences: what you will learn", "intro_mn": "same in Mongolian",
  "vocab": [ 8-10 items: {{"mn": "word", "en": "word", "pos": "noun/verb/...", "example_mn": "short sentence",
            "example_en": "its translation"}} ],
  "sentences": [ 12 items, using this lesson's words and grammar: {{"mn": "...", "en": "...",
            "alt_mn": ["other correct translations, if any"], "alt_en": ["other correct translations, if any"]}} ],
  "grammar": {{"title_en": "...", "title_mn": "...",
              "explain_en": "short, friendly explanation of the Mongolian grammar point for English speakers",
              "explain_mn": "short, friendly explanation of the matching English grammar point for Mongolian speakers",
              "examples": [ 3-4 items: {{"mn": "...", "en": "..."}} ]}},
  "fill_blank": [ 6 items, 3 with "lang": "mn" and 3 with "lang": "en":
            {{"lang": "mn", "text": "sentence with ___ for one missing word or ending",
             "answer": "the missing text", "options": ["answer", "3 plausible wrong options"],
             "translation": "the full sentence in the other language",
             "explain_en": "why, for English speakers", "explain_mn": "why, for Mongolian speakers"}} ],
  "dialogue": [ 6-8 lines: {{"speaker": "a Mongolian or English first name", "mn": "...", "en": "..."}} ],
  "culture_note": {{"en": "2-3 sentences", "mn": "same in Mongolian"}}}}"""

REVIEW_PROMPT = """You are a native Mongolian editor and a native English editor checking a language-course lesson
before learners see it. Check every Mongolian and English string: spelling, Cyrillic letters (ө/ү vs о/у), vowel
harmony, case and verb endings, natural word choice, whether each translation pair really means the same thing,
whether fill-in-the-blank answers are the only correct option, and whether explanations are accurate.
Fix only real mistakes (not style preferences).

Lesson JSON:
{lesson}

Answer with only JSON in a ```json block:
{{"rating": 1-10 (quality before fixes), "fixes": [{{"section": "vocab|sentences|grammar|fill_blank|dialogue|culture_note|intro",
  "index": item number counted from 0 (null for grammar, culture_note, intro),
  "field": "field name, e.g. mn, en, example_mn, answer, options, explain_en, intro_mn",
  "new": "the corrected value (a list for options or alt_* fields)", "why": "short reason"}}],
  "notes": "one line on overall quality"}}"""

CYR_TO_LATIN = dict(zip("абвгдеёжзийклмноөпрстуүфхцчшщъыьэюя",
                        ["a", "b", "v", "g", "d", "ye", "yo", "j", "z", "i", "i", "k", "l", "m", "n", "o", "ö", "p",
                         "r", "s", "t", "u", "ü", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "i", "e", "yu", "ya"]))


def romanize(text):
    """Mongolian Cyrillic to Latin letters, a reading aid for English speakers."""
    out = []
    for ch in text:
        low = ch.lower()
        if low in CYR_TO_LATIN:
            latin = CYR_TO_LATIN[low]
            out.append(latin.capitalize() if ch != low else latin)
        else:
            out.append(ch)
    return "".join(out)


log_lock = threading.Lock()


def log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    with log_lock:
        print(line, flush=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


client_lock = threading.Lock()
client = None


def get_client(refresh=False):
    """One shared client; refresh=True reloads keys.txt, so fresh temporary AWS keys work mid-run."""
    global client
    with client_lock:
        if client is None or refresh:
            common.load_keys()
            client = claude_client()
        return client


def ask(prompt, model, stage, effort="medium", max_tokens=32000):
    """One Claude call that must return a JSON object; retries on errors and unreadable JSON."""
    for attempt in range(5):
        try:
            with get_client().messages.stream(
                    model=model, max_tokens=max_tokens, **effort_args(model, effort),
                    system=[{"type": "text", "text": STYLE, "cache_control": {"type": "ephemeral"}}],
                    messages=[{"role": "user", "content": prompt}]) as st:
                msg = st.get_final_message()
            with USAGE.lock:
                USAGE.stage = stage
            USAGE.add(msg.usage, model)
            text = text_of(msg)
            m = re.search(r"```json\s*(.*?)```", text, re.DOTALL)
            raw = m.group(1) if m else text[text.find("{"): text.rfind("}") + 1]
            return json.loads(raw)
        except json.JSONDecodeError:
            debug = COURSE_DIR / "debug"
            debug.mkdir(exist_ok=True)
            (debug / f"{stage}_{int(time.time() * 1000)}.txt").write_text(text, encoding="utf-8")
            log(f"  {stage}: unreadable JSON (stop reason {msg.stop_reason}, {msg.usage.output_tokens} tokens), "
                f"retrying ({attempt + 1})")
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:150]}"
            if "expired" in err.lower() or "security token" in err.lower():
                log(f"  {stage}: AWS keys expired? Reloading keys.txt ({err})")
                get_client(refresh=True)
                time.sleep(30)
            else:
                log(f"  {stage}: call failed ({err}), retrying ({attempt + 1})")
                time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{stage}: gave up after 5 attempts")


MORE_UNITS_PROMPT = """The course so far has these units:
{all_units}

Plan {n} more units that continue the course (higher levels: {levels}), building on everything above without
repeating it. Number them from {first}. Keep each "scope" to one short line.

Answer with only JSON in a ```json block:
{{"units": [{{"id": "u{first}", "level": "...", "title_en": "...", "title_mn": "...",
             "scope": "situations; vocabulary themes; grammar points"}}]}}"""


def unit_list(outline):
    return "\n".join(f"{u['id']} {u['level']} {u['title_en']}: {u.get('scope', '')}" for u in outline["units"])


def plan_lessons(outline, units, lessons, workers):
    all_units = unit_list(outline)

    def plan_unit(u):
        u["lessons"] = ask(UNIT_PROMPT.format(all_units=all_units, lessons=lessons, id=u["id"], level=u["level"],
                                              title_en=u["title_en"], scope=u.get("scope", "")),
                           MODEL_MID, "outline", effort="low")["lessons"]
        for i, l in enumerate(u["lessons"], 1):
            l["id"] = f"{u['id']}l{i}"
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(plan_unit, units))


def add_units(outline, n, lessons, workers):
    """When the planned course is nearly written and time is left: Opus plans n more units (B2-C1)."""
    first = len(outline["units"]) + 1
    log(f"Planned course nearly done; planning {n} more units from u{first:02d}")
    new = ask(MORE_UNITS_PROMPT.format(all_units=unit_list(outline), n=n, levels="B2, then C1", first=f"{first:02d}"),
              MODEL, "outline")["units"]
    for i, u in enumerate(new):
        u["id"] = f"u{first + i:02d}"
    plan_lessons(outline, new, lessons, workers)
    return new


def make_outline(units, lessons, workers):
    """Opus plans the units (one short call); Sonnet plans each unit's lessons, in parallel."""
    if OUTLINE_FILE.exists():
        return json.loads(OUTLINE_FILE.read_text(encoding="utf-8"))
    log(f"Planning the course with Opus: {units} units, levels {'-'.join(LEVELS)}")
    outline = ask(OUTLINE_PROMPT.format(levels=", ".join(LEVELS), units=units), MODEL, "outline")
    log(f"{len(outline['units'])} units planned; planning their lessons with Sonnet")
    plan_lessons(outline, outline["units"], lessons, workers)
    OUTLINE_FILE.write_text(json.dumps(outline, ensure_ascii=False, indent=1), encoding="utf-8")
    n = sum(len(u["lessons"]) for u in outline["units"])
    log(f"Outline ready: {len(outline['units'])} units, {n} lessons")
    return outline


def get_path(lesson, section, index):
    obj = lesson.get(section)
    if index is not None and isinstance(obj, list):
        obj = obj[index] if 0 <= index < len(obj) else None
    return obj


def apply_fixes(lesson, fixes):
    applied = 0
    for fx in fixes or []:
        section, field, index = fx.get("section"), fx.get("field"), fx.get("index")
        if section == "intro":
            if field in ("intro_en", "intro_mn"):
                lesson[field] = fx.get("new")
                applied += 1
            continue
        target = get_path(lesson, section, index)
        if isinstance(target, dict) and field in target:
            target[field] = fx.get("new")
            applied += 1
    return applied


def add_romanization(lesson):
    for section in ("vocab", "sentences", "dialogue"):
        for item in lesson.get(section, []):
            item["mn_latin"] = romanize(item.get("mn", ""))
    for ex in lesson.get("grammar", {}).get("examples", []):
        ex["mn_latin"] = romanize(ex.get("mn", ""))


def make_lesson(unit, lesson_meta):
    lesson_id = lesson_meta["id"]
    title = lambda l, lang: l.get(f"title_{lang}") or l.get("title") or ""  # some unit plans used other keys
    earlier = [title(l, "en") for l in unit["lessons"] if l["id"] < lesson_id] or ["none (first lesson of the unit)"]
    lesson = ask(LESSON_PROMPT.format(id=lesson_id, level=unit["level"], unit=unit["title_en"],
                                      title_en=title(lesson_meta, "en"), title_mn=title(lesson_meta, "mn"),
                                      focus=lesson_meta.get("focus", ""), earlier="; ".join(earlier)), MODEL_MID, "write")
    review = ask(REVIEW_PROMPT.format(lesson=json.dumps(lesson, ensure_ascii=False)), MODEL_MID, "review",
                 max_tokens=16000)
    applied = apply_fixes(lesson, review.get("fixes"))
    add_romanization(lesson)
    lesson["review"] = {"rating": review.get("rating"), "fixes": applied, "notes": review.get("notes", "")}
    (LESSONS_DIR / f"{lesson_id}.json").write_text(json.dumps(lesson, ensure_ascii=False, indent=1), encoding="utf-8")
    return lesson, applied, review.get("rating")


build_lock = threading.Lock()


def build_course_js(outline, started, budget, minutes, extra=None):
    """course.js (window.COURSE = ...) so index.html works by double-click, without a web server."""
    with build_lock:
        totals = {"lessons": 0, "words": 0, "sentences": 0, "exercises": 0, "fixes": 0}
        ratings, units = [], []
        for unit in outline["units"]:
            lessons = []
            for meta in unit["lessons"]:
                path = LESSONS_DIR / f"{meta['id']}.json"
                data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
                if data:
                    totals["lessons"] += 1
                    totals["words"] += len(data.get("vocab", []))
                    totals["sentences"] += len(data.get("sentences", []))
                    totals["exercises"] += (2 * len(data.get("vocab", [])) + 2 * len(data.get("sentences", []))
                                            + len(data.get("fill_blank", [])))
                    totals["fixes"] += data.get("review", {}).get("fixes", 0)
                    if isinstance(data.get("review", {}).get("rating"), (int, float)):
                        ratings.append(data["review"]["rating"])
                lessons.append({**meta, "data": data})
            units.append({**{k: v for k, v in unit.items() if k != "lessons"}, "lessons": lessons})
        stats = {**totals, "planned_lessons": sum(len(u["lessons"]) for u in outline["units"]),
                 "avg_review_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
                 "cost_usd": round(USAGE.cost, 2), "calls": USAGE.calls,
                 "tokens_written": USAGE.output, "minutes": round((time.time() - started) / 60, 1),
                 "budget_usd": budget, "time_limit_min": minutes, "updated": time.strftime("%Y-%m-%d %H:%M"),
                 **(extra or {})}
        course = {"title_en": outline.get("course_title_en"), "title_mn": outline.get("course_title_mn"),
                  "stats": stats, "units": units}
        tmp = COURSE_DIR / "course.js.tmp"
        tmp.write_text("window.COURSE = " + json.dumps(course, ensure_ascii=False) + ";\n", encoding="utf-8")
        tmp.replace(COURSE_DIR / "course.js")
        STATS_FILE.write_text(json.dumps(stats, indent=1), encoding="utf-8")
        return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=60, help="stop starting new lessons after this many minutes")
    ap.add_argument("--budget", type=float, default=40, help="stop starting new lessons after this many dollars")
    ap.add_argument("--workers", type=int, default=10, help="lessons written at the same time")
    ap.add_argument("--units", type=int, default=40)
    ap.add_argument("--lessons", type=int, default=6, help="lessons per unit")
    ap.add_argument("--test", action="store_true", help="write one lesson only")
    ap.add_argument("--no-more", dest="more", action="store_false",
                    help="don't plan extra units when the planned course is done early")
    args = ap.parse_args()

    LESSONS_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()
    outline = make_outline(args.units, args.lessons, args.workers)
    todo = [(u, l) for u in outline["units"] for l in u["lessons"] if not (LESSONS_DIR / f"{l['id']}.json").exists()]
    if args.test:
        todo = todo[:1]
    log(f"{len(todo)} lessons to write, {args.workers} at a time; limits {args.minutes:.0f} min, ${args.budget:.0f}")

    done = failed = 0
    extending = None  # background planning of more units, once the planned course is nearly written
    with ThreadPoolExecutor(args.workers) as pool, ThreadPoolExecutor(1) as planner:
        running = {}
        while todo or running or extending:
            out_of_time = time.time() - started > args.minutes * 60
            out_of_money = USAGE.cost > args.budget
            if extending and extending.done():
                try:
                    new = extending.result()
                    outline["units"].extend(new)
                    OUTLINE_FILE.write_text(json.dumps(outline, ensure_ascii=False, indent=1), encoding="utf-8")
                    todo += [(u, l) for u in new for l in u["lessons"]]
                    log(f"Added {len(new)} units ({sum(len(u['lessons']) for u in new)} lessons) to the plan")
                except Exception as e:
                    log(f"Planning more units FAILED: {e}")
                    args.more = False
                extending = None
            if (args.more and not args.test and not extending and len(todo) < 2 * args.workers
                    and not (out_of_time or out_of_money)):
                extending = planner.submit(add_units, outline, 8, args.lessons, args.workers)
            while todo and len(running) < args.workers and not (out_of_time or out_of_money):
                unit, meta = todo.pop(0)
                running[pool.submit(make_lesson, unit, meta)] = meta["id"]
            if not running and not extending:
                if out_of_time or out_of_money:
                    log("Time limit reached." if out_of_time else "Budget reached.")
                break
            if not running:
                wait([extending], timeout=60)
                continue
            finished, _ = wait(running, timeout=60, return_when=FIRST_COMPLETED)
            for fut in finished:
                lesson_id = running.pop(fut)
                try:
                    _, applied, rating = fut.result()
                    done += 1
                    stats = build_course_js(outline, started, args.budget, args.minutes)
                    log(f"{lesson_id} done (editor rating {rating}, {applied} fixes). Total {stats['lessons']}/"
                        f"{stats['planned_lessons']} lessons, ${USAGE.cost:.2f}, {stats['minutes']} min")
                except Exception as e:
                    failed += 1
                    log(f"{lesson_id} FAILED: {e}")

    stats = build_course_js(outline, started, args.budget, args.minutes)
    log(f"Finished: {done} lessons this run ({failed} failed). Course now has {stats['lessons']} lessons, "
        f"{stats['words']} words, {stats['sentences']} sentences, about {stats['exercises']} exercises.")
    log(USAGE.summary())
    log(USAGE.breakdown())


if __name__ == "__main__":
    main()
