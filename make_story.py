"""Opus writes the quest story for every written lesson, in both settings, into course/db/story.json.

  .venv\\Scripts\\python.exe make_story.py [--workers 16]
en2mn: an English speaker surviving in Mongolia (text in English); mn2en: a Mongolian speaker surviving abroad
(text in Mongolian). Rerun continues where it stopped.
"""

import argparse
import json
import threading
from concurrent.futures import ThreadPoolExecutor

from common import MODEL, USAGE
from make_course import COURSE_DIR, LESSONS_DIR, ask, log

STORY_FILE = COURSE_DIR / "db" / "story.json"
SCENES = "airport, taxi, ger, market, canteen, naadam, steppe, clinic, school, square"

PROMPT = """You write the story for a survival language-learning game. Each lesson of the course is an encounter:
a character the player meets, who teaches the lesson's words and then tests the player in a "duel".
Two campaigns run on the same lessons:
- en2mn: an English speaker who lands in Mongolia knowing nothing (all text in English; the character is Mongolian).
- mn2en: a Mongolian speaker who lands in London knowing nothing (all text in Mongolian Cyrillic; the character is
  British or an international Londoner).
The story continues across the course; keep it warm, a bit funny, with stakes (no violence). Level ends have a guard
boss (BATZORIG the Khan's Guard / Sir Edmund the King's Guard), so earlier lessons can foreshadow them.

Unit {unit} ({level}): {unit_title}. Lesson {id}: {title}. Focus: {focus}
Lesson words: {words}
Lesson dialogue (for flavor): {dialogue}
Previous lesson's story (for continuity): {previous}

Scene must be one of: {scenes}.
Answer with only JSON in a ```json block:
{{"en2mn": {{"scene": "...", "npc": "name", "role": "short role", "intro": "2-3 sentences setting the scene and the
  stakes", "teach": "one line the character says before teaching", "win": "1-2 sentences after winning",
  "lose": "1-2 sentences after losing (encouraging)"}},
  "mn2en": {{same fields, in Mongolian}}}}"""

lock = threading.Lock()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()
    outline = json.loads((COURSE_DIR / "outline.json").read_text(encoding="utf-8"))
    story = json.loads(STORY_FILE.read_text(encoding="utf-8")) if STORY_FILE.exists() else {}
    pairs = [(u, l) for u in outline["units"] for l in u["lessons"] if (LESSONS_DIR / f"{l['id']}.json").exists()]
    todo = [i for i, (u, l) in enumerate(pairs) if l["id"] not in story]
    log(f"Story: {len(todo)} lessons to write")

    def write(i):
        u, l = pairs[i]
        lesson = json.loads((LESSONS_DIR / f"{l['id']}.json").read_text(encoding="utf-8"))
        prev = pairs[i - 1][1]["id"] if i else None
        r = ask(PROMPT.format(unit=u["id"], level=u["level"], unit_title=u.get("title_en", ""), id=l["id"],
                              title=l.get("title_en") or l.get("title", ""), focus=l.get("focus", ""),
                              words=", ".join(f"{v.get('mn')}={v.get('en')}" for v in lesson.get("vocab", [])),
                              dialogue=" / ".join(d.get("en", "") for d in lesson.get("dialogue", []))[:600],
                              previous=json.dumps(story.get(prev, {}).get("en2mn", {}), ensure_ascii=False) or "start",
                              scenes=SCENES), MODEL, "story", effort="low")
        with lock:
            story[l["id"]] = r
            if len(story) % 25 == 0:
                STORY_FILE.write_text(json.dumps(story, ensure_ascii=False), encoding="utf-8")
                log(f"{len(story)} stories, ${USAGE.cost:.2f}")

    with ThreadPoolExecutor(args.workers) as pool:
        list(pool.map(write, todo))
    STORY_FILE.write_text(json.dumps(story, ensure_ascii=False), encoding="utf-8")
    log(f"Done: {len(story)} stories. {USAGE.summary()}")


if __name__ == "__main__":
    main()
