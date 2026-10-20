// Unit tests for course/shared/progress.js + exercises.js against the real DB (course/db/content.json).
// Each "page" is a fresh vm context with its own window; pages can share one fake localStorage, like two games
// open on the same computer. Usage: node --test shared_test.js
const test = require('node:test'), strict = require('node:assert/strict');
// values from the vm realm have other Array/Object prototypes: compare as plain JSON
const plain = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const assert = { ...strict, deepEqual: (a, b, m) => strict.deepEqual(plain(a), plain(b), m) };
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'course', 'db', 'content.json'), 'utf8'));
const SRC = ['progress.js', 'exercises.js'].map(f => fs.readFileSync(path.join(ROOT, 'course', 'shared', f), 'utf8'));
const MIN = 60e3, DAY = 864e5;

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
function page(storage, native = 'en') {
  const ctx = { console, YARYA_DB: DB, addEventListener() {} };
  ctx.window = ctx;
  if (storage) ctx.localStorage = storage;
  else Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError'); } });
  vm.createContext(ctx);
  SRC.forEach(s => vm.runInContext(s, ctx));
  if (native) ctx.Yarya.progress.setNative(native);
  return ctx.Yarya;
}
function dayKey(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const L1 = DB.lessons[0];

// ---------- progress ----------
test('record: spaced repetition strength, due, known', () => {
  const P = page(fakeStorage()).progress, id = L1.words[0], at = 1e12;
  assert.equal(P.mastery(id).seen, 0);
  let m = P.record(id, true, { game: 'duo', at });
  assert.equal(m.strength, 1); assert.equal(m.due, at + 10 * MIN); assert.equal(m.known, false);
  m = P.record(id, true, { game: 'duo', at: at + 1 });
  assert.equal(m.strength, 2); assert.equal(m.due, at + 1 + DAY); assert.equal(m.known, true);
  m = P.record(id, false, { game: 'duo', at: at + 2 });
  assert.deepEqual([m.strength, m.due, m.seen, m.correct, m.wrong], [0, at + 2 + MIN, 3, 2, 1]);
  assert.deepEqual([P.gameStats('duo').answers, P.gameStats('duo').correct], [3, 2]);
});

test('mistakes: wrong adds, right clears, keepMistake keeps, any-kind clear', () => {
  const P = page(fakeStorage()).progress, s = L1.sentences[0], w = L1.words[1];
  P.record(s, false, { t: 'build', lesson: 'u01l1' });
  P.record(s, false, { t: 'build', lesson: 'u01l1' });   // no duplicates
  P.record(w, false, { t: 'mc', rev: true });
  assert.equal(P.mistakes().length, 2);
  assert.equal(P.mistakes().find(m => m.id === w).lesson, 'u01l1', 'lesson defaults to the item lesson');
  P.record(s, true, { t: 'build', keepMistake: true });
  assert.equal(P.mistakes().length, 2);
  P.record(s, true, { t: 'build' });
  assert.deepEqual(P.mistakes().map(m => m.id), [w]);
  P.record(w, true, { game: 'quest' });                   // another game, no kind: clears every mistake of the item
  assert.equal(P.mistakes().length, 0);
  P.record(w, false, { mistake: false });
  assert.equal(P.mistakes().length, 0);
});

test('due and known: filters and order', () => {
  const P = page(fakeStorage()).progress, at = Date.now() - DAY * 30;
  const [w0, w1] = L1.words, s0 = L1.sentences[0], late = DB.lessons.find(l => l.written && l.level === 'B2').words[0];
  P.record(w1, true, { at }); P.record(w1, true, { at });    // due after a day -> long overdue
  P.record(w0, false, { at: at + 5 });
  P.record(s0, true, { at: at + 10 });
  P.record(late, true, { at }); P.record(late, true, { at });
  P.record(L1.words[2], true);                              // due in 10 minutes: not due yet
  // w0: wrong -> due 1 min later; s0: 1 right -> 10 min; w1 + late: 2 right -> 1 day
  assert.deepEqual(P.due(10), [w0, s0, w1, late]);
  assert.deepEqual(P.due(2), [w0, s0]);
  assert.deepEqual(P.due(10, { type: 'sentence' }), [s0]);
  assert.deepEqual(P.due(10, { level: 'A1', type: 'word' }), [w0, w1]);
  assert.deepEqual(P.known(), [w1, late], 'course order');
  assert.deepEqual(P.known({ level: 'B2' }), [late]);
  assert.deepEqual(P.known({ lesson: 'u01l1' }), [w1]);
  assert.deepEqual(P.known((it, m) => it.type === 'word' && m.correct >= 2).length, 2);
  assert.ok(P.known({ topic: 'greetings' }).includes(w1));
});

test('addXP: total, daily, days, per game, streak', () => {
  const st = fakeStorage({ yarya_progress_v1: JSON.stringify({ v: 1, migrated: true,
    dirs: { en: { streak: { n: 5, last: dayKey(-1) } }, mn: { streak: { n: 9, last: dayKey(-3) } } } }) });
  const P = page(st).progress;
  assert.equal(P.streak(), 5);
  assert.equal(P.addXP(12, 'duo'), 12); P.addXP(3, 'quest');
  assert.deepEqual([P.xp(), P.dailyXP(), P.streak(), P.days()[dayKey(0)]], [15, 15, 6, 15]);
  assert.deepEqual([P.gameStats('duo').xp, P.gameStats('quest').xp], [12, 3]);
  P.setNative('mn');                                       // other direction: its own numbers, lapsed streak
  assert.deepEqual([P.xp(), P.streak()], [0, 0]);
  P.addXP(1, 'duo'); assert.equal(P.streak(), 1);
  P.lessonDone('u01l1', 'duo'); P.lessonDone('u01l1', 'duo');
  assert.equal(P.gameStats('duo').lessons, 1); assert.ok(P.done().u01l1);
});

test('words learned in one game count in another (shared storage)', () => {
  const st = fakeStorage(), A = page(st).progress;
  A.record(L1.words[3], true, { game: 'duo' }); A.record(L1.words[3], true, { game: 'duo' });
  const B = page(st).progress;
  assert.equal(B.mastery(L1.words[3]).known, true);
  B.record(L1.words[3], true, { game: 'quest' });
  assert.equal(page(st).progress.mastery(L1.words[3]).correct, 3);
});

test('works without localStorage (memory only)', () => {
  const Y = page(null);
  Y.progress.record(L1.words[0], true); Y.progress.addXP(5);
  assert.equal(Y.progress.mastery(L1.words[0]).correct, 1);
  assert.equal(Y.progress.xp(), 5);
  assert.equal(Y.progress.native(), 'en');
});

test('migrates the old app keys once, per direction, keeping them', () => {
  const merged = DB.items[L1.words[0]];                    // «сайн байна уу» is also u01l2 word 4
  const ref = merged.refs.find(r => r.lesson !== 'u01l1');
  const st = fakeStorage({ native: '"en"', xp_en: '42', done_en: JSON.stringify({ u01l1: 1, u01l2: 2 }),
    daily_en: JSON.stringify({ day: dayKey(0), xp: 12 }), streak_en: JSON.stringify({ n: 3, last: dayKey(-1) }),
    seen_en: JSON.stringify({ [ref.lesson + ':' + ref.i]: 1, 'u01l1:1': 1, 'zz:0': 1 }),
    mist_en: JSON.stringify([{ lid: 'u01l1', t: 'build', i: 2, rev: false }, { lid: 'u01l1', t: 'mc', i: 1, rev: true },
      { lid: 'u01l1', t: 'blank', i: 0, rev: false }, { lid: 'gone', t: 'mc', i: 0 }]),
    xp_mn: '5' });
  const P = page(st, null).progress;
  assert.equal(P.native(), 'en');
  assert.deepEqual([P.xp(), P.dailyXP(), P.streak(), Object.keys(P.done()).length], [42, 12, 3, 2]);
  assert.equal(P.mastery(merged.id).seen, 1, 'seen in a later lesson -> merged word item');
  assert.equal(P.mastery(L1.words[1]).seen, 1);
  assert.deepEqual(P.mistakes().map(m => [m.id, m.t, m.rev]),
    [[L1.sentences[2], 'build', false], [L1.words[1], 'mc', true], [L1.fill_blank[0], 'blank', false]]);
  assert.deepEqual([P.gameStats('duo').xp, P.gameStats('duo').lessons], [42, 2]);
  P.setNative('mn'); assert.equal(P.xp(), 5);
  assert.equal(st.getItem('xp_en'), '42', 'old keys kept');
  const again = page(st, 'en').progress;                   // reload: no second migration
  assert.equal(again.xp(), 42);
});

// ---------- exercises ----------
test('checkAnswer: exact, punctuation, alternatives, typos', () => {
  const X = page(fakeStorage()).ex;
  assert.deepEqual(X.checkAnswer('hello', ['Hello!']), { ok: true, answer: 'Hello!' });
  assert.equal(X.checkAnswer('  HI ', ['Hello!', 'Hi!']).ok, true);
  const t = X.checkAnswer('Good mornin, teacher', ['Good morning, teacher!']);
  assert.deepEqual([t.ok, t.almost], [true, true]);
  assert.equal(X.checkAnswer('Good night', ['Good morning!']).ok, false);
  assert.equal(X.checkAnswer('helo', ['hello'], { typos: false }).ok, false);
  assert.equal(X.checkAnswer('', ['a']).ok, false);
});

test('mc: direction, unique options, same-lesson distractors', () => {
  const X = page(fakeStorage()).ex, id = L1.words[5], v = DB.items[id];
  for (let k = 0; k < 20; k++) {
    const q = X.mc(id, { native: 'en', lesson: 'u01l1' });
    assert.deepEqual([q.prompt, q.from, q.to, q.promptLatin], [v.mn, 'mn', 'en', v.mn_latin]);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options.map(o => o.text)).size, 4);
    assert.ok(q.options.every(o => L1.words.includes(o.id)), 'lesson 1 has enough words: all options from it');
    assert.equal(q.check(q.options.findIndex(o => o.id === id)).ok, true);
    assert.equal(q.check(q.options.findIndex(o => o.id !== id)).ok, false);
  }
  const r = X.mc(id, { native: 'en', rev: true });
  assert.deepEqual([r.prompt, r.answer, r.answerLatin], [v.en, v.mn, v.mn_latin]);
  assert.ok(r.options.every(o => o.latin));
  const m = X.mc(id, { native: 'mn' });
  assert.deepEqual([m.prompt, m.answer, m.promptLatin], [v.en, v.mn, null]);
});

test('distractors fall back to unit/level when the lesson is small', () => {
  const X = page(fakeStorage()).ex, v = DB.items[L1.words[0]];
  const d = X.distractors(v, 'en', 30, 'u01l1');
  assert.equal(d.length, 30);
  assert.ok(d.slice(0, L1.words.length - 1).every(x => L1.words.includes(x.id)), 'same lesson first');
  assert.ok(d.every(x => x.type === 'word' && x.level === 'A1'));
  assert.ok(!d.some(x => [v.en, ...v.alt_en].includes(x.en)));
});

test('match, wordBank, typeAnswer, fillBlank', () => {
  const X = page(fakeStorage()).ex, ids = L1.words.slice(0, 4);
  const mt = X.match(ids, { native: 'en' });
  assert.deepEqual(mt.left.map(x => x.id).sort(), ids.slice().sort());
  assert.ok(mt.left.every(x => x.text === DB.items[x.id].mn && x.latin) && mt.right.every(x => x.text === DB.items[x.id].en));
  assert.ok(mt.isPair(ids[0], ids[0]) && !mt.isPair(ids[0], ids[1]));

  const s = DB.items[L1.sentences[1]], wb = X.wordBank(s.id, { native: 'en' });
  assert.equal(wb.prompt, s.en);
  assert.ok(wb.words.every(w => wb.bank.includes(w)) && wb.bank.length <= wb.words.length + 3);
  assert.equal(wb.check(wb.words).ok, true);
  assert.equal(wb.check(wb.words.slice().reverse()).ok, false);
  assert.equal(X.wordBank(s.id, { native: 'mn' }).prompt, s.mn);

  const ty = X.typeAnswer(s.id, { native: 'en' });
  assert.deepEqual([ty.prompt, ty.answer], [s.mn, s.en]);
  assert.equal(ty.check(s.alt_en[0]).ok, true);

  const fm = DB.items[L1.fill_blank.find(id => DB.items[id].lang === 'mn')];
  assert.ok(X.blankOk(fm.id, { native: 'en' }) && !X.blankOk(fm.id, { native: 'mn' }));
  const fb = X.fillBlank(fm.id, { native: 'en' });
  assert.equal(fb.before + '___' + fb.after, fm.text);
  assert.deepEqual(fb.options.slice().sort(), fm.options.slice().sort());
  assert.deepEqual([fb.check(fm.answer).ok, fb.check(fm.options.find(o => o !== fm.answer)).ok], [true, false]);
  assert.equal(fb.explain, fm.explain_en);
});

test('romanize matches the DB transliteration', () => {
  const X = page(fakeStorage()).ex;
  assert.equal(X.romanize('Өглөөний мэнд'), 'Öglöönii mend');
  const f = DB.items[L1.fill_blank[0]];
  assert.equal(X.romanize(f.text), f.mn_latin);
});

test('match drops pairs that cannot be told apart; fillBlank drops repeated options', () => {
  const X = page(fakeStorage()).ex, w = Object.values(DB.items).filter(x => x.type === 'word');
  const twin = w.find(x => w.some(y => y !== x && X.norm(y.en) === X.norm(x.en)));
  const other = w.find(y => y !== twin && X.norm(y.en) === X.norm(twin.en)), third = w.find(y => X.norm(y.en) !== X.norm(twin.en) && X.norm(y.mn) !== X.norm(twin.mn));
  const q = X.match([twin.id, other.id, third.id], { native: 'en' });
  assert.deepEqual(q.ids, [twin.id, third.id]);
  assert.equal(new Set(q.right.map(x => X.norm(x.text))).size, q.right.length);
  const f = Object.values(DB.items).find(x => x.type === 'blank' && X.blankOk(x, { native: 'en' }));
  const saved = f.options;
  f.options = [...saved, saved[0], f.answer];
  try { const b = X.fillBlank(f.id, { native: 'en' }); assert.deepEqual(b.options.slice().sort(), [...new Set(saved)].sort()); }
  finally { f.options = saved; }
});
