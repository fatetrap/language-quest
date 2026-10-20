# course/quest: Language Quest, the survival game (a 16-bit JRPG)

Open `quest/index.html` by double-click (file://) or from a local server. No build step, no network: it loads
`assets/fonts.js`, `../db/content.js`, `../db/story.js` (optional), `../shared/progress.js`, `../shared/exercises.js` (see
`course/db/README.md`), `campaign.js`, `pixel.js` and `chip.js`.

- `campaign.js` (`Yarya.quest`): what is played. The course becomes a chain of encounters in course order: every
  written lesson is split into parts of up to 4 new words (a word is taught in the lesson where it first appears),
  the lesson's sentences and blanks go to its later parts, and after the level's last duel comes its boss
  (BATZORIG, the Khan's Guard / Sir Edmund, the King's Guard; B2 / C1 units interleave, so that is one boss per level,
  not one per level change). Each unit gets a scene by its topics (airport, taxi,
  ger family, market, guanz, Naadam, steppe, clinic, school, city). `plan(e)` = new words to teach on cards, then
  the duel rounds: recognise each new word, then match / build / type / blank, then produce the words, mixed with
  items that `Yarya.progress.due()` says are due (from any game). Words known from the lessons app are not taught;
  an encounter whose words are all known is skipped. `rules(e)`: damage, healing, timer by level (no timer in the
  first 3 encounters, bosses hit harder).
- `index.html`: the UI (title screen = language chooser, onboarding, camp = world map, duel, victory / game over). Every
  answer: `Yarya.progress.record(id, ok, { game: 'quest', t })`; XP via `addXP(n, 'quest')`; a lesson whose parts are all
  won is `lessonDone(lesson, 'quest')`. Quest-only state: `Yarya.store` key `quest_<native>` = `{ won, best, onb }`;
  timer setting `quest_timer`, music `quest_music` (off by default); theme / sound use the lessons app's `theme` / `muted` keys.
- `pixel.js` (`Yarya.pixel`): all the art, drawn in code (no image files). Sprites are palette-letter strings written as
  their left half and mirrored; the right end of a colour run takes the shade, every sprite gets a dark outline. People
  = head + torso + legs parts with 2-4 idle frames (stand, breathe, blink); the opponent's archetype comes from the
  role's head noun (`roleKind`: officer, driver, granny, elder, trader, cook, wrestler, doctor, teacher, student, clerk,
  local), colours from the name; nobody wears a deel in London. The guards BATZORIG and Sir Edmund are drawn in full.
  `scene()` paints every backdrop in both regions (Mongolia for en, London for mn), day in the light theme and dusk /
  night in the dark one: banded skies with dithered steps, mountains, clouds, gers, horses, ovoo with khadag, tug
  banners, markets, the guanz inside... `map()` paints a chapter's region (one per level) with the route through its
  units, `route()` places the nodes (rows on a narrow map). `animate()` = one ticker at ~12 fps; with reduced motion
  every canvas is drawn once. `gallery.html` shows every sprite, backdrop and map on one page.
- `chip.js` (`Yarya.chip`): Web Audio chiptune (square / triangle / noise): menu blip, hit, heal, learn, swirl, victory
  fanfare, game over, and two original loops (map theme, battle theme; the boss plays it lower and faster).
- `assets/`: the fonts as base64 in `fonts.js` (loaded with `FontFace`): "Yarya Pixel" = Press Start 2P (UI chrome,
  titles, commands), "Yarya Uni" = a GNU Unifont subset (every learning text: Latin + Cyrillic incl. Ө ө Ү ү, crisp at
  16 / 24 / 32 / 48 px). Both SIL OFL 1.1 (`OFL-*.txt`); `make_fonts.py` rebuilds `fonts.js`.

Tests: `course_tests/test_quest.py` (static), `quest_test.js` (campaign unit tests), `quest_smoke.js` (jsdom),
`pixel_test.js` (art data, roles, routes, sound API).

Story: `story(e, native)` uses the lesson's own character and lines from `db/story.js` (`window.YARYA_STORY`, built
from `db/story.json` by `build_db.py --story`): part 1 opens with the story intro (+ the lesson's grammar as one line
with "more"), later parts with a short line, the last part's victory shows the story's `win`, a defeat its `lose`.
Missing lessons or fields fall back to the unit scene's text. `chapters()` = runs of one level; the camp draws the
chapter with the next encounter (its world map + its units as trails of encounter stones) and every other one as a
line that opens on click.

Duel layout: HUD window (integrity as HP, honor streak as a charge bar, rounds + the opponent's resolve, the opponent) /
stage (the scene at full strength, the opponent and the player as sprites, the opponent's speech window, typed out) /
board (one window: the story typed out with a ▼, the word to learn, or the question) / command window (answers, a
pointing hand on the current one: arrows + Enter, 1-4, mouse or touch). Hits shake the screen, flash red and pop the
damage over the player; right answers make the player strike. A battle starts with a spiral of blocks (skipped with
reduced motion). Text sits on windows only, never on the art; colours meet WCAG AA on both ends of every window
gradient in both themes (dark = blue windows, light = parchment).

More tests: `db_audit.js` (every encounter and every lessons-app lesson of the real DB, both directions; via
`test_quest.py`), `test_quest_visual.py` (headless Chromium: screenshots + computed contrast at 375 / 1280 px, light /
dark, en / mn), `test_quest_jrpg.py` (headless Chromium: integer pixel scale, fonts, typewriter, menu keys, swirl,
damage numbers, music toggle, 360 px phones, the gallery; saves the screenshots to `course_tests/shots_jrpg/`);
both skipped without `pip install playwright` + `playwright install chromium`.
