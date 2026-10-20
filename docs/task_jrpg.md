# Task 4: turn Language Quest into a 16-bit JRPG

`course/quest/` is a survival language duel game on the shared lesson database (read `course/quest/README.md`,
`course/db/README.md`, `course/shared/*.js`, and the tests in `course_tests/`). It works and is well tested. The
founder wants it to look and feel like a 16-bit JRPG (SNES era: Final Fantasy VI, Chrono Trigger, Earthbound,
Dragon Quest V). Go all out on graphics and game feel; keep all learning logic, the database contract, shared
progress, both directions and the tests passing.

New ability: you have a `view_image` tool. Use headless Chromium (playwright is installable, it worked in an
earlier run: see `course_tests/test_quest_visual.py`) to screenshot your work and LOOK at it, often, at 1280x800
and 375x812. Iterate on what you see until it genuinely looks like a polished SNES game, not a web page.

First, look for building blocks you can get offline (the sandbox reaches PyPI and npm, not the general web):
open-licensed pixel fonts (e.g. via @fontsource: Press Start 2P, Pixelify Sans, VT323, Silkscreen, DotGothic16;
check Cyrillic coverage, since Mongolian text needs Cyrillic incl. Ө ө Ү ү; pick fonts that render it or fall
back cleanly), palettes, pixel-art helpers. Bundle any font as a local file in `course/quest/assets/` (with its
license file). No runtime network, still works by double-click (file://), no build step.

Make:
- Pixel art everywhere, drawn by you in code: palette-indexed sprite data (strings/arrays) rendered to canvas or
  as image data URLs, `image-rendering: pixelated`, integer scaling. Characters (player, each NPC role, the bosses
  BATZORIG / Sir Edmund) as chunky 16-bit sprites with 2-4 frame idle animations; scenes (airport, taxi, ger,
  market, canteen, naadam, steppe, clinic, school, square, and their London counterparts) as layered tile/parallax
  backgrounds with sky gradients in banded palette steps, Mongolian details (ger patterns, khadag, horses, mountains).
- JRPG UI: blue gradient windows with bevelled borders (FF style) or your own consistent take, pixel font, a
  typewriter text box with a blinking ▼ cursor for story/teach lines, a command menu with a pointing-hand cursor for
  answers (keyboard/arrow navigation plus touch), HP/MP-style bars (integrity, honor), damage/heal numbers popping
  over sprites, screen flash and shake, battle-start swirl/mosaic transition, victory fanfare screen with EXP and
  "learned new words!" list, game-over screen.
- Camp becomes a world map / overworld (pixel map of the route: Mongolia for en2mn, London for mn2en) with
  encounter nodes on a path, your sprite walking to the next node; chapters as regions.
- Chiptune sound with Web Audio (square/triangle/noise): menu blip, hit, heal, victory jingle, a short looping
  battle theme and map theme (mute toggle remembered; music off by default or a clear toggle).
- Readability first: learning text (Mongolian Cyrillic, romanization, meanings) must stay crisp and large enough;
  use the pixel font for UI chrome and a clean readable font for long Cyrillic text if the pixel font hurts it.
  Keep WCAG AA contrast, reduced-motion support, 360px phones, keyboard.

Keep the existing visual/contrast checks passing (update them to the new design where needed) and add screenshot
tests. Save a set of final screenshots to `course_tests/shots_jrpg/` (PNG) for the founder to look at.
When done, call finish with what you built, what you looked at, and what could be better next.
