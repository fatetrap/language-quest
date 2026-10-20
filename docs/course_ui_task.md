# Task: make the language-course app feel polished, animated and fun

`course/index.html` is a single-file, Duolingo-style app for an English <> Mongolian course (vanilla JS, no build
step, no libraries). It loads `course.js` (`window.COURSE = {...}`) from the same folder. A small copy of the real data
is in `course/sample/course.js` (12 units; only units 1-2 have lesson `data`, the rest have `data: null` = "not
written yet"). The real course.js has ~90 units and 470 written lessons, same format. Read both before changing anything.

It works today (both directions tested), but it looks plain. Rewrite and improve `course/index.html` so it feels like a
modern, polished learning game. Keep it one self-contained HTML file.

## Must keep
- The data contract: read `window.COURSE` exactly as today (units -> lessons -> data with vocab, sentences, grammar,
  fill_blank, dialogue, culture_note, intro_*; `mn_latin` romanization; `stats`). Don't require any other files.
- Works opened by double-click (file://) and from a local web server. No network requests, no CDNs, no fonts from the web.
- Both directions: the learner picks "I speak English" (learns Mongolian) or "Би монголоор ярьдаг" (learns English);
  all UI text in the learner's own language (keep/extend the T dictionary), lesson content in the target language.
- All exercise types (grammar tip, new word, multiple choice, match pairs, build sentence from word bank, type
  translation with typo tolerance, fill in the blank, dialogue + culture note), wrong answers re-asked at the end,
  XP and progress in localStorage (wrap every access in try/catch, as now). Build DOM with textContent (lesson text is
  model-written; never innerHTML it).
- The "Course build" stats card (it's for the founder's demo); it can be smaller/collapsible.
- Light and dark mode via CSS custom properties on :root, `prefers-color-scheme`, and `:root[data-theme]` overrides.

## Improve
- Home: a winding lesson path (nodes zig-zag down the page, connected), unit banners with level color, the next lesson
  highlighted with a gentle pulse and a "Start" bubble, completed nodes gold, unwritten nodes locked. Sticky top bar
  with streak (days in a row), XP, daily goal ring (e.g. 30 XP), language switch.
- Lessons shorter and punchier: about 12-16 steps (pick a varied subset each time), plus the re-asks.
- Motion: slide/fade transitions between steps; word-bank chips fly into the answer line and back (FLIP); correct ->
  footer slides up green with a little bounce; wrong -> gentle shake and red footer; match tiles pop when paired;
  progress bar animates with a streak "combo" glow after 3+ correct in a row; lesson complete screen with confetti
  (canvas, self-written), XP counting up, accuracy and time.
- Sound effects synthesized with Web Audio (no files): correct, wrong, match, complete; a mute toggle (remembered).
- Hearts are optional; don't add if it hurts learning. A "practice mistakes" button on home that builds a lesson
  from items the learner got wrong before (store them) is welcome.
- Keyboard: 1-4 pick options, Enter = check/continue, Esc = quit (with confirm). Big touch targets on phones; layout
  works at 360px width with no horizontal scroll.
- Respect `prefers-reduced-motion` (turn off big motion and confetti).
- Visual design: friendly and clean, your own identity ("Language Quest"), not a copy of Duolingo's owl, name or exact
  brand. System fonts only. Consistent spacing, rounded cards, chunky 3D buttons, clear focus states.

## Testing (in the sandbox)
- Check the script parses: e.g. extract the <script> and run `node --check` if node exists. If you can install
  jsdom (`npm i jsdom`) or a Python equivalent, write a smoke test that loads index.html with the sample course.js,
  picks each direction, opens lesson 1 and clicks through every step to the complete screen without errors.
  If no JS runtime is available, say so in the summary.
- Copy `course/sample/course.js` next to index.html only inside a test folder; don't change `course/sample/`.

When done, call finish with what changed, what you tested and how, and anything not tested.
