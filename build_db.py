"""Builds the shared lesson database for all Yarya games from the lessons make_course.py wrote.

Reads course/outline.json + course/lessons/*.json and writes
  course/db/content.js    window.YARYA_DB = {...}   (loaded by a plain <script> tag, works by double-click)
  course/db/content.json  the same data, for tools and tests
  course/db/story.js      window.YARYA_STORY = {...} from course/db/story.json (Yarya Quest's characters and lines), if present
No Claude calls, no new dependencies; rerun any time the lessons change:
  .venv\\Scripts\\python.exe build_db.py
  .venv\\Scripts\\python.exe build_db.py --story     (only story.js, after story.json changes)
Ids are built from lesson ids and positions only, so they stay the same across runs (learner progress keys on them).
Schema: see SCHEMA below and course/db/README.md.
"""

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

COURSE_DIR = Path(__file__).with_name("course")
LESSONS_DIR = COURSE_DIR / "lessons"
OUTLINE_FILE = COURSE_DIR / "outline.json"
STATS_FILE = COURSE_DIR / "stats.json"
DB_DIR = COURSE_DIR / "db"
STORY_FILE = DB_DIR / "story.json"
STORY_FIELDS = ("scene", "npc", "role", "intro", "teach", "win", "lose")
VERSION = 1

SCHEMA = """YARYA_DB schema (version 1)
{
  version, title_en, title_mn,
  stats: course build stats (stats.json from make_course.py, content counts recomputed) + db counts,
  units:   [{ id, level, title_en, title_mn, scope, order, topics, lessons: [lesson id, ...] }],
  lessons: [{ id, unit, level, order, title_en, title_mn, focus, topics, written,
              intro_en, intro_mn,                      (only when written)
              words: [item id], sentences: [item id], fill_blank: [item id],
              dialogue: item id | null, grammar: item id | null, culture: item id | null }],
  items: { id: item }   every item has: id, type, level, unit, lesson (first lesson), lessons (all lessons),
                        order (position in the course, 0..), topics (keywords from titles/focus), mn_latin
    word      w:<lesson>:<i>   mn, en, alt_en (other glosses), pos, example_mn, example_en,
                               refs: [{lesson, i}]  (the same Mongolian word in several lessons = one item)
    sentence  s:<lesson>:<i>   mn, en, alt_mn, alt_en
    blank     f:<lesson>:<i>   lang (language of text), text (with ___), answer, options, translation,
                               explain_en, explain_mn
    dialogue  d:<lesson>       lines: [{speaker, mn, en, mn_latin}]
    grammar   g:<lesson>       title_en, title_mn, explain_en, explain_mn, examples: [{mn, en, mn_latin}]
    culture   c:<lesson>       en, mn
  <lesson>/<i> = the lesson and position where the item first appears.
}"""

STOP = set("""a an and the of to in on at for with from by or as is are am be was were do does did you your i my me
we our he she it its they their this that these those what who how when where why which there here not no yes
can will would should could about into out up over than then so but if all any some very more most much many
one ones s t vs versus etc using use used say saying talk talking ask asking someone something own new before after
full first""".split())
CYR = dict(zip("абвгдеёжзийклмноөпрстуүфхцчшщъыьэюя",
               ["a", "b", "v", "g", "d", "ye", "yo", "j", "z", "i", "i", "k", "l", "m", "n", "o", "ö", "p", "r", "s", "t",
                "u", "ü", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "i", "e", "yu", "ya"]))


def romanize(s):
    """Same transliteration as the app's romanize() (course/shared/exercises.js), for items without mn_latin."""
    out = []
    for ch in s or "":
        low = ch.lower()
        r = CYR.get(low)
        out.append(ch if r is None else (r[:1].upper() + r[1:] if ch != low else r))
    return "".join(out)


def word_key(mn):
    """Merge key for words: the Mongolian form, case/space/punctuation-insensitive."""
    return re.sub(r"\s+", " ", re.sub(r"[.,!?;:\"“”„«»()]", " ", (mn or "").lower())).strip()


def keywords(*texts):
    """Topic keywords from English titles/focus: lowercase words, no stopwords, first-seen order."""
    out = []
    for text in texts:
        for w in re.findall(r"[a-z][a-z'-]+", (text or "").lower()):
            w = re.sub(r"'s$", "", w).strip("'-")
            if len(w) > 2 and w not in STOP and w not in out:
                out.append(w)
    return out


def scene(text):
    """The English scene part of a focus/scope line ('Meeting someone at school; сайн уу; EN: ...')."""
    return (text or "").split(";")[0]


def fill_blank(f):
    # tolerate entries written as { mn: '... ___ ...' } instead of { lang, text } (as the app did)
    lang = f.get("lang") or ("mn" if f.get("mn") else "en" if f.get("en") else None)
    return lang, f.get("text") or f.get(lang) or ""


def load_lessons(outline):
    out = {}
    for unit in outline["units"]:
        for meta in unit["lessons"]:
            path = LESSONS_DIR / f"{meta['id']}.json"
            if path.exists():
                out[meta["id"]] = json.loads(path.read_text(encoding="utf-8"))
    return out


def content_stats(outline, data):
    """The content counts make_course.py puts in stats.json, recomputed from the lesson files."""
    totals = {"lessons": 0, "words": 0, "sentences": 0, "exercises": 0, "fixes": 0}
    ratings = []
    for d in data.values():
        totals["lessons"] += 1
        totals["words"] += len(d.get("vocab", []))
        totals["sentences"] += len(d.get("sentences", []))
        totals["exercises"] += 2 * len(d.get("vocab", [])) + 2 * len(d.get("sentences", [])) + len(d.get("fill_blank") or [])
        totals["fixes"] += (d.get("review") or {}).get("fixes", 0)
        if isinstance((d.get("review") or {}).get("rating"), (int, float)):
            ratings.append(d["review"]["rating"])
    return {**totals, "planned_lessons": sum(len(u["lessons"]) for u in outline["units"]),
            "avg_review_rating": round(sum(ratings) / len(ratings), 1) if ratings else None}


def build(outline, data, old_stats=None):
    """Pure function: outline + {lesson id: lesson json} -> db dict."""
    items, units, lessons, words_by_key = {}, [], [], {}
    order = 0

    def add(item):
        nonlocal order
        item["order"] = order
        order += 1
        items[item["id"]] = item
        return item["id"]

    for ui, unit in enumerate(outline["units"]):
        unit_topics = keywords(unit.get("title_en"), scene(unit.get("scope")))
        units.append({"id": unit["id"], "level": unit.get("level"), "title_en": unit.get("title_en"),
                      "title_mn": unit.get("title_mn"), "scope": unit.get("scope"), "order": ui,
                      "topics": unit_topics, "lessons": [m["id"] for m in unit["lessons"]]})
        for meta in unit["lessons"]:
            lid, d = meta["id"], data.get(meta["id"])
            topics = keywords(meta.get("title_en"), scene(meta.get("focus")), *unit_topics)
            lesson = {"id": lid, "unit": unit["id"], "level": unit.get("level"), "order": len(lessons),
                      "title_en": meta.get("title_en"), "title_mn": meta.get("title_mn"), "focus": meta.get("focus"),
                      "topics": topics, "written": bool(d), "words": [], "sentences": [], "fill_blank": [],
                      "dialogue": None, "grammar": None, "culture": None}
            lessons.append(lesson)
            if not d:
                continue
            lesson["intro_en"], lesson["intro_mn"] = d.get("intro_en", ""), d.get("intro_mn", "")
            base = lambda id_, type_: {"id": id_, "type": type_, "level": unit.get("level"), "unit": unit["id"],
                                       "lesson": lid, "lessons": [lid], "topics": list(topics)}
            for i, v in enumerate(d.get("vocab") or []):
                k = word_key(v.get("mn"))
                if k in words_by_key:   # same word met before: one item, one more lesson ref
                    w = items[words_by_key[k]]
                    w["refs"].append({"lesson": lid, "i": i})
                    if lid not in w["lessons"]:
                        w["lessons"].append(lid)
                    w["topics"] += [x for x in topics if x not in w["topics"]]
                    if v.get("en") and v["en"] != w["en"] and v["en"] not in w["alt_en"]:
                        w["alt_en"].append(v["en"])
                    lesson["words"].append(w["id"])
                    continue
                w = {**base(f"w:{lid}:{i}", "word"), "mn": v.get("mn", ""), "en": v.get("en", ""), "alt_en": [],
                     "pos": v.get("pos", ""), "example_mn": v.get("example_mn", ""), "example_en": v.get("example_en", ""),
                     "mn_latin": v.get("mn_latin") or romanize(v.get("mn")), "refs": [{"lesson": lid, "i": i}]}
                words_by_key[k] = w["id"]
                lesson["words"].append(add(w))
            for i, s in enumerate(d.get("sentences") or []):
                lesson["sentences"].append(add({**base(f"s:{lid}:{i}", "sentence"), "mn": s.get("mn", ""),
                    "en": s.get("en", ""), "alt_mn": s.get("alt_mn") or [], "alt_en": s.get("alt_en") or [],
                    "mn_latin": s.get("mn_latin") or romanize(s.get("mn"))}))
            for i, f in enumerate(d.get("fill_blank") or []):
                lang, text = fill_blank(f)
                lesson["fill_blank"].append(add({**base(f"f:{lid}:{i}", "blank"), "lang": lang, "text": text,
                    "answer": f.get("answer", ""), "options": f.get("options") or [], "translation": f.get("translation", ""),
                    "explain_en": f.get("explain_en", ""), "explain_mn": f.get("explain_mn", ""),
                    "mn_latin": romanize(text if lang == "mn" else f.get("translation"))}))
            if d.get("dialogue"):
                lines = [{"speaker": x.get("speaker", ""), "mn": x.get("mn", ""), "en": x.get("en", ""),
                          "mn_latin": x.get("mn_latin") or romanize(x.get("mn"))} for x in d["dialogue"]]
                lesson["dialogue"] = add({**base(f"d:{lid}", "dialogue"), "lines": lines,
                                          "mn_latin": " / ".join(x["mn_latin"] for x in lines)})
            g = d.get("grammar")
            if g:
                lesson["grammar"] = add({**base(f"g:{lid}", "grammar"), "title_en": g.get("title_en", ""),
                    "title_mn": g.get("title_mn", ""), "explain_en": g.get("explain_en", ""), "explain_mn": g.get("explain_mn", ""),
                    "examples": [{"mn": e.get("mn", ""), "en": e.get("en", ""), "mn_latin": e.get("mn_latin") or romanize(e.get("mn"))}
                                 for e in g.get("examples") or []],
                    "mn_latin": romanize(g.get("title_mn"))})
            c = d.get("culture_note")
            if c and (c.get("en") or c.get("mn")):
                lesson["culture"] = add({**base(f"c:{lid}", "culture"), "en": c.get("en", ""), "mn": c.get("mn", ""),
                                         "mn_latin": romanize(c.get("mn"))})

    counts = {}
    for it in items.values():
        counts[it["type"]] = counts.get(it["type"], 0) + 1
    stats = {**(old_stats or {}), **content_stats(outline, data), "db_items": len(items), "db_counts": counts}
    return {"version": VERSION, "title_en": outline.get("course_title_en"), "title_mn": outline.get("course_title_mn"),
            "stats": stats, "units": units, "lessons": lessons, "items": items}


def write(db, out_dir=DB_DIR):
    out_dir.mkdir(parents=True, exist_ok=True)
    text = json.dumps(db, ensure_ascii=False, separators=(",", ":"))
    comment = "/* Generated by build_db.py - do not edit. " + SCHEMA.replace("*/", "* /") + "\n*/\n"
    for name, body in (("content.json", text), ("content.js", comment + "window.YARYA_DB = " + text + ";\n")):
        tmp = out_dir / (name + ".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(out_dir / name)


def write_story(story_file=STORY_FILE, out_dir=DB_DIR):
    """story.js from story.json: {lesson id: {en2mn, mn2en: {scene, npc, role, intro, teach, win, lose}}}.
    Only text fields are kept (the quest falls back to its own text for anything missing). Returns the lesson count."""
    if not story_file.exists():
        return 0
    raw = json.loads(story_file.read_text(encoding="utf-8"))
    story = {}
    for lid, dirs in (raw.items() if isinstance(raw, dict) else []):
        out = {d: {k: v.strip() for k, v in dirs[d].items() if k in STORY_FIELDS and isinstance(v, str) and v.strip()}
               for d in ("en2mn", "mn2en") if isinstance(dirs, dict) and isinstance(dirs.get(d), dict)}
        if any(out.values()):
            story[lid] = out
    text = json.dumps(story, ensure_ascii=False, separators=(",", ":"))
    body = ("/* Generated by build_db.py from story.json - do not edit. Yarya Quest story per lesson id:\n"
            "   { en2mn, mn2en: { scene, npc, role, intro, teach, win, lose } } */\nwindow.YARYA_STORY = " + text + ";\n")
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / "story.js.tmp"
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(out_dir / "story.js")
    return len(story)


def main():
    if "--story" in sys.argv[1:]:
        print(f"course/db/story.js: {write_story()} lessons")
        return
    outline = json.loads(OUTLINE_FILE.read_text(encoding="utf-8"))
    old_stats = json.loads(STATS_FILE.read_text(encoding="utf-8")) if STATS_FILE.exists() else {}
    db = build(outline, load_lessons(outline), old_stats)
    write(db)
    s = db["stats"]
    print(f"course/db: {s['lessons']}/{s['planned_lessons']} lessons, {s['db_items']} items {s['db_counts']}")
    if STORY_FILE.exists():
        print(f"course/db/story.js: {write_story()} lessons")


if __name__ == "__main__":
    main()
