# Task 1: one lesson database + shared learner progress, used by several games

Today the course is 470 lesson files (`course/lessons/*.json`, format: see any file; written by `make_course.py`,
plan in `course/outline.json`) baked into `course/course.js` for one Duolingo-style app (`course/index.html`).
We want ONE content database and ONE learner model that several games share: (1) the Duolingo-style app,
(2) a survival quest game (built in a later task, in `course/quest/`), more later. Words learned in one game must count
in the others.

Build:
1. `build_db.py` (project root, Python, no new dependencies): reads outline.json + lessons/*.json and writes
   `course/db/content.js` (`window.YARYA_DB = {...}`) plus `course/db/content.json` (same data). Normalized item bank
   with stable ids (e.g. `w:u01l1:3`, and the same word appearing in several lessons merged into one word item with
   all its lesson refs): words, sentences (with alt_*), fill_blank, dialogues, grammar points, culture notes; every
   item tagged with level, unit, lesson, order (position in the course), topic/theme keywords (from titles/focus), and
   `mn_latin`. Keep units/lessons as an index into items. Keep the course stats. Include a schema description at the
   top of the file (comment) and in `course/db/README.md`.
2. `course/shared/progress.js` (vanilla JS, no modules, so it works by double-click via a plain <script> tag): the
   learner model in localStorage (all access in try/catch, works without storage): per direction (en->mn, mn->en):
   per-item mastery (seen, correct, wrong, last seen, simple spaced-repetition strength/due date), XP, streak/days,
   lessons done, mistakes, per-game stats. API like `Yarya.progress.record(itemId, correct, {game})`,
   `.mastery(itemId)`, `.due(n)`, `.known(filter)`, `.addXP(n, game)`. Migrate the current app's existing
   localStorage keys (read `course/index.html`) so nobody loses progress.
3. `course/shared/exercises.js`: exercise builders from DB items (multiple choice with smart distractors from same
   lesson/level, match pairs, word bank, type answer with typo tolerance via a shared `checkAnswer`, fill blank),
   direction-aware (target/native), used by both games.
4. Rewire `course/index.html` to load `db/content.js`, `shared/progress.js`, `shared/exercises.js` instead of
   `course.js` and its own copies of that logic, keeping its current look, features and behavior. Record every
   answer to the shared progress. Keep `course.js` support out (delete the dependency).
5. Tests: pytest for build_db.py (ids stable across runs, merging, counts match lessons), and the existing
   `course_tests` (update them; Node/jsdom works in the sandbox) for the app + shared modules.

Rules: everything works opened by double-click (file://), no network, no build step, no frameworks. Lesson text is
model-written: build DOM with textContent only. Run `python build_db.py` at the end so `course/db/` is filled.
When done, call finish with: the DB schema, the progress API, how a new game plugs in, test results.
