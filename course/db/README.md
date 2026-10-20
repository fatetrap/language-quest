# course/db: the shared Language Quest content database

`content.js` (`window.YARYA_DB = {...}`) and `content.json` (same data) are **generated** by `build_db.py`
from `course/outline.json` + `course/lessons/*.json`. Do not edit them; rebuild after lessons change:

    .venv\Scripts\python.exe build_db.py

Every game loads the same three plain scripts (no modules, no server, works by double-click / `file://`):

```html
<script src="../db/content.js"></script>        <!-- window.YARYA_DB (path relative to the game's html) -->
<script src="../shared/progress.js"></script>   <!-- Yarya.progress, Yarya.store: the learner model -->
<script src="../shared/exercises.js"></script>  <!-- Yarya.ex: exercise builders, checkAnswer -->
```

Optional for Language Quest: `story.js` (`window.YARYA_STORY`, per lesson id `{en2mn, mn2en: {scene, npc, role, intro,
teach, win, lose}}`), generated from the model-written `story.json` by `build_db.py` (or `build_db.py --story` for only
that file); the quest loads it with `<script src="../db/story.js">` before the shared modules.

## Schema

```
YARYA_DB schema (version 1)
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
}
```

Ids are made only from the lesson id and the position where an item first appears, so rebuilding gives the same
ids; learner progress keys on them. A word is "the same" when its Mongolian form matches (case, spaces and
punctuation ignored): it becomes one item, the first gloss is `en`, other glosses go to `alt_en`, and `refs` lists
every lesson + vocab position. Sentences are not merged (each lesson has its own `alt_*` answers).
`topics` are English keywords from the unit title/scope and lesson title/focus scene (for a word: all its lessons).

## Learner model: `Yarya.progress` (course/shared/progress.js)

One localStorage key `yarya_progress_v1`, separate data per direction (by the learner's native language:
`en` = English speaker learning Mongolian, `mn` = Mongolian speaker learning English). Without storage it works in
memory. The old app keys (`done_en`, `xp_en`, `daily_en`, `streak_en`, `mist_en`, `seen_en`, same for `mn`) are
migrated once on first load (they are left in place).

| call | what |
|---|---|
| `native()`, `setNative(n)`, `target()`, `direction()` | current direction (`'en'`/`'mn'`/null; `'en->mn'`) |
| `record(id, correct, {game, t, rev, lesson, keepMistake, mistake})` | one graded answer: mastery + spaced repetition, game stats, mistakes; returns `mastery` |
| `markSeen(id, {game})` | shown without grading (new word card, dialogue) |
| `mastery(id)` | `{seen, correct, wrong, last, strength, due, level (0..1), known}` |
| `due(n, filter)` | up to n item ids due for review, most overdue first |
| `known(filter)` / `seenIds(filter)` | ids known (strength >= 2) / ever shown, course order |
| `addXP(n, game)` | XP total + today + per game; counts the day for the streak; returns total |
| `xp()`, `dailyXP()`, `days()`, `streak()` | totals, `{day: xp}`, current streak |
| `lessonDone(lessonId, game)`, `done()` | finished lessons `{id: ms}` |
| `mistakes()`, `clearMistake(m)` | `[{id, t, rev, lesson}]` wrong answers to practise |
| `gameStats(game)`, `games()`, `snapshot()` | `{xp, answers, correct, lessons, last}` per game, everything |

`filter` is `{type, level, unit, lesson, topic}` (values or lists) or `function (item, mastery) -> bool`.
Spaced repetition: right = strength + 1, next review after 0 / 10 min / 1 / 3 / 7 / 16 / 35 / 90 / 180 days;
wrong = strength - 2, due again in a minute.

## Exercises: `Yarya.ex` (course/shared/exercises.js)

Builders return data plus `check()`; each game draws its own UI (use `textContent`, lesson text is model-written).
`opts.native` defaults to `Yarya.progress.native()`; the target is the other language.

- `mc(wordId, {rev, lesson, n})` -> `{prompt, promptLatin, options: [{id, text, latin}], answer, check(index|text)}`;
  distractors from the same lesson, then unit, then level, same part of speech first, never a synonym of the answer
- `match(wordIds)` -> `{left (target), right (native), isPair(leftId, rightId)}`
- `wordBank(sentenceId, {lesson, extra})` -> `{prompt (native), words, bank, check(pickedWords)}`
- `typeAnswer(sentenceId)` -> `{prompt (target), accepted, check(text)}` (typo tolerant)
- `fillBlank(blankId)` -> `{before, after, options, answer, translation, explain, check(option)}`; `blankOk(id)`:
  only blanks written in the target language
- `checkAnswer(given, accepted, {typos})` -> `{ok, almost, answer}`; also `norm`, `tokens`, `romanize`, `shuffle`

## Plugging in a new game

1. Put it in its own folder (e.g. `course/quest/index.html`) and load the three scripts above.
2. Pick content from `YARYA_DB` (e.g. `Yarya.progress.known({type: 'word'})`, `due(10)`, or items of a unit/topic).
3. Build questions with `Yarya.ex`, and for every answer call
   `Yarya.progress.record(id, ok, {game: 'quest', t: 'mc'})`; give XP with `addXP(n, 'quest')`.
4. Store game-only state (inventory, map, ...) under your own key with `Yarya.store.get/set('quest_...')`.
