# Task 2: "Quest" survival game on the shared lesson database

Read first: `course/db/README.md` (content database), `course/shared/progress.js` and `course/shared/exercises.js`
(shared learner model and exercise builders, made in Task 1), and `course/index.html` (the Duolingo-style game that
already uses them). Then read the founder's concept prototype `work/quest_src/quest_mgl-main/` (React/Vite, made
in AI Studio): a survival duel against BATZORIG, the Khan's Guard; "integrity" health 0-100, streak, screen shake and
flash on hits, scene backgrounds, onboarding, victory/defeat overlays, multiple-choice challenges with phonetic hints.

Build `course/quest/index.html` (+ any files in `course/quest/`): the survival experience, "start from the very
beginning". Keep the spirit, look and feel of the prototype (read its components and styles), but:
- No build step, no React, no network (works by double-click from file:// and from a local server; the user has no
  Node). Plain <script> tags: `../db/content.js`, `../shared/progress.js`, `../shared/exercises.js`.
- Content comes ONLY from the database, in course order: the player starts knowing nothing; each encounter first
  teaches a few new items (from the next lessons) in-story, then tests them in duel form, mixed with review items
  that progress.js says are due. Every answer goes to the shared progress (so the Duolingo app sees it, and quest
  skips/compresses what the player already knows from the app).
- A campaign: a chain of encounters/scenes following the course units (e.g. for an English speaker in Mongolia:
  arrival, taxi, ger family, market, Naadam, ... up to the Khan's guard bosses at level ends). Both directions:
  pick "I speak English" (survive in Mongolia, learn Mongolian) or "Би монголоор ярьдаг" (survive abroad, learn
  English), UI text in the player's language. Scenes/characters drawn with CSS/SVG (no image files from the web).
- Survival mechanics: integrity drops on wrong answers (more for bosses), recovers a bit on streaks; defeat ->
  retry the encounter (keep learned items); time pressure optional and gentle at the start; difficulty grows with
  level. Exercise variety from exercises.js (not only multiple choice). Sounds via Web Audio, mute toggle,
  prefers-reduced-motion, keyboard (1-4, Enter), works at 360px width, light/dark.
- Link both ways: the Duolingo app's home gets a "Quest" entry, and quest links back.
- Model-written text: textContent only.
- Tests in `course_tests/` (jsdom): start both directions, play the first encounter to victory and one to defeat,
  check progress is shared with the Duolingo app.

When done, call finish with: what the game does, how content is chosen, what was tested, what wasn't.
