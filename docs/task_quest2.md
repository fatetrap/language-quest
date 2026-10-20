# Task 3: polish Language Quest on the REAL database, add the story, harden both games

Your earlier run built `course/quest/` against a fixture because the real `course/db/content.js` (11 MB, ~775
written lessons, 20k items, 1,172 encounters) wasn't uploaded. It is uploaded now, plus `course/db/story.json`
(per lesson id: `en2mn` and `mn2en` objects with scene, npc, role, intro, teach, win, lose; written by Opus; some
lessons may be missing, so fall back to the current generated text).

Observed in a real browser (Chrome, 800px wide), duel screen of encounter 1:
- Readability is poor: the narration bubble, the "THE SPIRITS WHISPER" grammar box and the teach card are
  semi-transparent over the SVG scene; amber/brown text on beige has very low contrast. Make text panels solid
  (or strongly backed), meet WCAG AA contrast in light and dark, keep the scene visible around them.
- The "spirits whisper" box dumps the whole grammar explanation in UPPERCASE as a big block. Show a short
  title line in sentence case with "more" to expand; never uppercase long text.
- The teach card text is small and faint; make the new word the hero (big, high contrast) with romanization,
  meaning and example.
- The layout stacks narration, grammar and card on top of the scene so the scene barely shows; rethink the layout
  so the scene and characters read as a game (character portrait/speech, not a document).

Do:
1. Wire `story.json` into the quest (load it with a plain script tag: generate `course/db/story.js` with
   `window.YARYA_STORY = ...` from story.json via a small addition to `build_db.py`, or a separate tiny script
   in course/db; keep file:// working). Use npc names/roles/scenes/intro/teach/win/lose per encounter (lessons
   split into parts: intro on part 1, short continuation lines on later parts).
2. Fix the readability/layout issues above. Check the whole flow visually by reasoning about CSS carefully
   (you can't see a browser); if you can get a headless Chromium working in the sandbox (e.g. `pip install
   playwright && playwright install chromium`), take screenshots of camp, duel (teach, question, wrong answer),
   victory, defeat at 375px and 1280px in light and dark, and check them by inspecting computed contrast
   via script.
3. Robustness on the real DB: in Node, build the plan and every round for EVERY encounter in both directions
   (and every lesson of the Duolingo app) and assert no exceptions, no undefined/empty prompts, options unique and
   containing the answer, word banks solvable. Fix data-shape problems in the game code (the content is
   model-written; some fields may be missing or odd).
4. Camp performance with 1,172 encounters: render only the current level or virtualize; first paint fast.
5. Keep all existing tests passing; update fixtures as needed.

When done, call finish with what changed, what you checked and how, and what still needs a human eye.
