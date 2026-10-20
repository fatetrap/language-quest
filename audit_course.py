"""Opus spot-check of the generated course: how many mistakes are left after the Sonnet editor pass?

  .venv\\Scripts\\python.exe audit_course.py [--n 20]
Picks n finished lessons spread across the course, asks Opus (as a native Mongolian and English editor) to list the
remaining mistakes, and writes course/audit.json and course/audit.md.
"""

import argparse
import json
import random
from concurrent.futures import ThreadPoolExecutor

from common import MODEL, USAGE
from make_course import COURSE_DIR, LESSONS_DIR, ask, log

AUDIT_PROMPT = """You are a native Mongolian (Khalkha) editor and a native English editor auditing a lesson from an
English <> Mongolian course that learners will use. It was already edited once. List every REMAINING real mistake:
wrong or unnatural Mongolian (spelling, ө/ү, vowel harmony, case or verb endings, word choice), wrong English,
translation pairs that don't match, fill-in-the-blank items with a wrong or non-unique answer, wrong explanations.
Ignore style preferences.

Severity: "major" = teaches something wrong; "minor" = awkward but understandable.

Lesson {id} (level {level}): {title}
{lesson}

Answer with only JSON in a ```json block:
{{"rating": 1-10 (fit to put in front of learners), "mistakes": [{{"where": "section and item", "text": "the wrong text",
  "fix": "corrected text", "severity": "major|minor", "why": "short reason"}}], "summary": "one line"}}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20)
    args = ap.parse_args()
    outline = json.loads((COURSE_DIR / "outline.json").read_text(encoding="utf-8"))
    done = [(u, l) for u in outline["units"] for l in u["lessons"] if (LESSONS_DIR / f"{l['id']}.json").exists()]
    random.seed(7)
    step = max(1, len(done) // args.n)
    picks = [random.choice(done[i:i + step]) for i in range(0, len(done), step)][:args.n]
    log(f"Opus audit of {len(picks)} lessons")

    def audit(pair):
        u, l = pair
        lesson = json.loads((LESSONS_DIR / f"{l['id']}.json").read_text(encoding="utf-8"))
        lesson.pop("review", None)
        for section in ("vocab", "sentences", "dialogue"):
            for item in lesson.get(section, []):
                item.pop("mn_latin", None)
        r = ask(AUDIT_PROMPT.format(id=l["id"], level=u["level"], title=l.get("title_en", ""),
                                    lesson=json.dumps(lesson, ensure_ascii=False)), MODEL, "audit")
        return {"id": l["id"], "level": u["level"], **r}

    with ThreadPoolExecutor(10) as pool:
        results = list(pool.map(audit, picks))
    (COURSE_DIR / "audit.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

    major = sum(m.get("severity") == "major" for r in results for m in r.get("mistakes", []))
    minor = sum(m.get("severity") != "major" for r in results for m in r.get("mistakes", []))
    avg = sum(r.get("rating", 0) for r in results) / len(results)
    lines = [f"# Opus audit of {len(results)} lessons", "",
             f"Average rating {avg:.1f}/10; {major} major and {minor} minor mistakes left "
             f"({major / len(results):.1f} major per lesson). {USAGE.summary()}", ""]
    for r in results:
        lines.append(f"## {r['id']} ({r['level']}): {r.get('rating')}/10. {r.get('summary', '')}")
        lines += [f"- [{m.get('severity')}] {m.get('where')}: \"{m.get('text')}\" -> \"{m.get('fix')}\" ({m.get('why')})"
                  for m in r.get("mistakes", [])]
        lines.append("")
    (COURSE_DIR / "audit.md").write_text("\n".join(lines), encoding="utf-8")
    log(lines[2])


if __name__ == "__main__":
    main()
