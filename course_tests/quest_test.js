// Unit tests for course/quest/campaign.js (which encounter teaches / tests what) on top of the shared modules.
// Uses course/db/content.json when it is built, else the small fixture course (quest_fixture_db.js).
// Each "page" is a fresh vm context with its own window and fake localStorage. Usage: node --test quest_test.js
const test = require('node:test'), strict = require('node:assert/strict');
const plain = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const assert = { ...strict, deepEqual: (a, b, m) => strict.deepEqual(plain(a), plain(b), m) };
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REAL = path.join(ROOT, 'course', 'db', 'content.json');
const DB = fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : require('./quest_fixture_db.js');
const SRC = ['shared/progress.js', 'shared/exercises.js', 'quest/campaign.js'].map(f => fs.readFileSync(path.join(ROOT, 'course', f), 'utf8'));
const MIN = 60e3;

function fakeStorage() {
  const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
function page(native = 'en', storage = fakeStorage(), story) {
  const ctx = { console, YARYA_DB: DB, YARYA_STORY: story, addEventListener() {}, localStorage: storage };
  ctx.window = ctx;
  vm.createContext(ctx);
  SRC.forEach(s => vm.runInContext(s, ctx));
  ctx.Yarya.progress.setNative(native);
  return ctx.Yarya;
}
const written = DB.lessons.filter(l => l.written);
const known = (P, ids) => ids.forEach(id => { P.record(id, true, { game: 'duo' }); P.record(id, true, { game: 'duo' }); });

test('campaign follows the course: duels per lesson part, a boss at every level end', () => {
  const Y = page(), C = Y.quest.campaign();
  assert.equal(Y.quest.campaign(), C, 'built once per DB');
  assert.deepEqual(C.map(e => e.index), C.map((_, i) => i));
  // lessons in course order, unwritten lessons skipped
  const lessons = [...new Set(C.filter(e => e.kind === 'duel').map(e => e.lesson))];
  assert.deepEqual(lessons, written.map(l => l.id).filter(id => lessons.includes(id)));
  assert.ok(!C.some(e => e.lesson && !DB.lessons.find(l => l.id === e.lesson).written));
  // every word is taught exactly once, in the lesson where it first appears, at most CHUNK + 1 per encounter
  const taught = C.flatMap(e => e.words);
  assert.equal(new Set(taught).size, taught.length);
  assert.ok(taught.every(id => C.find(e => e.words.includes(id)).lesson === DB.items[id].lesson));
  const firstWords = written.flatMap(l => [...new Set(l.words)].filter(id => DB.items[id].lesson === l.id));
  assert.deepEqual(new Set(taught), new Set(firstWords));
  assert.ok(C.every(e => e.words.length <= Y.quest.CHUNK + 1));
  // a later lesson's repeated words are reviewed, not taught
  for (const e of C.filter(e => e.again.length)) assert.ok(e.again.every(id => DB.items[id].lesson !== e.lesson));
  // sentences + blanks of a lesson are spread over its parts, none lost
  for (const l of written) {
    const parts = C.filter(e => e.lesson === l.id);
    if (!parts.length) continue;
    assert.deepEqual(parts.flatMap(e => e.sentences).sort(), l.sentences.slice().sort());
    assert.deepEqual(parts.flatMap(e => e.blanks).sort(), l.fill_blank.slice().sort());
  }
  // bosses: one per level, right after the level's last duel (B2 / C1 units interleave in the real course)
  const lastDuel = L => Math.max(...C.filter(e => e.kind === 'duel' && e.level === L).map(e => e.index));
  const levels = [...new Set(C.filter(e => e.kind === 'duel').map(e => e.level))].sort((a, b) => lastDuel(a) - lastDuel(b));
  assert.equal(new Set(C.map(e => e.id)).size, C.length, 'encounter ids are unique');
  assert.deepEqual(C.filter(e => e.kind === 'boss').map(e => e.id), levels.map(l => 'b:' + l));
  for (const b of C.filter(e => e.kind === 'boss')) {
    assert.equal(C[b.index - 1].level, b.level);
    assert.ok(!C.slice(b.index + 1).some(e => e.level === b.level));
    assert.equal(b.scene, Y.quest.BOSS);
  }
  assert.equal(C[0].scene.id, 'arrival', 'the journey starts at the airport');
  assert.ok(C.every(e => e.scene.en.place && e.scene.mn.place && e.scene.en.intro && e.scene.mn.intro));
});

test('scenes and quotes exist in both languages', () => {
  const Q = page().quest;
  for (const s of [...Q.SCENES, Q.BOSS]) assert.deepEqual(Object.keys(s.en).sort(), Object.keys(s.mn).sort());
  assert.deepEqual(Object.keys(Q.QUOTES.en), Object.keys(Q.QUOTES.mn));
  assert.equal(Q.sceneFor({ topics: ['market', 'shopping'], title_en: 'At the market' }, 3, null).id, 'market');
  assert.equal(Q.sceneFor({ topics: [], title_en: 'Something else' }, 0, null).id, 'arrival');
  const prev = Q.SCENES[2];
  assert.notEqual(Q.sceneFor({ topics: [], title_en: '?' }, 5, prev), prev, 'no match: not the same scene twice');
});

test('state: start at the very beginning; known encounters are skipped, bosses are not', () => {
  const Y = page(), Q = Y.quest, C = Q.campaign();
  let S = Q.state({});
  assert.equal(S.next, C[0]);
  assert.equal(S.status(C[0]), 'open'); assert.equal(S.status(C[1]), 'locked'); assert.equal(S.skipped, 0);
  S = Q.state({ [C[0].id]: 1 });
  assert.equal(S.next, C[1]); assert.equal(S.status(C[0]), 'won');
  // words learned in the lessons app (game 'duo'): those encounters count as known
  known(Y.progress, [...C[1].words, ...C[2].words]);
  S = Q.state({ [C[0].id]: 1 });
  assert.equal(S.status(C[1]), 'known'); assert.equal(S.next, C.find(e => e.index > 2 && !Q.isKnown(e)));
  assert.equal(S.skipped, S.next.index - 1);
  // knowing every word of a level never skips its boss
  const boss = C.find(e => e.kind === 'boss');
  known(Y.progress, C.slice(0, boss.index).flatMap(e => e.words.length ? e.words : [...e.sentences, ...e.blanks]));
  assert.equal(Q.state({}).next, boss);
});

test('plan: teach new words first, then test them; known words are not taught again', () => {
  const Y = page(), Q = Y.quest, P = Y.progress, e = Q.campaign()[0];
  let p = Q.plan(e);
  assert.deepEqual(p.teach, e.words); assert.deepEqual(p.recap, []);
  assert.deepEqual(p.rounds.slice(0, e.words.length).map(r => [r.t, r.id, r.rev]), e.words.map(id => ['mc', id, false]), 'recognise each new word first');
  assert.ok(p.rounds.length <= Q.rules(e).maxRounds + 3);
  assert.ok(p.rounds.every(r => r.t === 'match' ? r.items.length >= 2 : !!DB.items[r.id]));
  assert.ok(p.rounds.some(r => r.t !== 'mc'), 'not only multiple choice');
  assert.equal(p.rounds[0].n, 3, 'gentle start: 3 options');
  // compress: a word known from the app is not taught, and tested at most once
  known(P, [e.words[0]]);
  p = Q.plan(e);
  assert.deepEqual(p.teach, e.words.slice(1));
  assert.ok(p.rounds.filter(r => r.id === e.words[0]).length <= 1);
  // retry after a defeat: words already shown get a recap, not a card
  e.words.slice(1).forEach(id => P.markSeen(id, { game: 'quest' }));
  p = Q.plan(e, { retry: true });
  assert.deepEqual(p.teach, []); assert.deepEqual(p.recap, e.words.slice(1));
});

test('plan: due review items from any game are mixed in; blanks only in the target language', () => {
  for (const native of ['en', 'mn']) {
    const Y = page(native), Q = Y.quest, P = Y.progress, C = Q.campaign(), e = C[1];
    const old = C.find(x => x.index > 2 && x.words.length).words[0];
    P.record(old, false, { game: 'duo', t: 'mc', at: Date.now() - 5 * MIN });   // wrong -> due again after a minute
    const p = Q.plan(e, { native });
    const rv = p.rounds.filter(r => r.review);
    assert.deepEqual(rv.map(r => r.id), [old], native);
    assert.ok(p.rounds.indexOf(rv[0]) > 0, 'never the very first round');
    for (const x of C.filter(x => x.kind === 'duel'))
      Q.plan(x, { native }).rounds.filter(r => r.t === 'blank').forEach(r => assert.equal(DB.items[r.id].lang, native === 'en' ? 'mn' : 'en'));
  }
});

test('boss plan: the level\'s items, weakest first, no teaching', () => {
  const Y = page(), Q = Y.quest, P = Y.progress, C = Q.campaign(), boss = C.find(e => e.kind === 'boss');
  const lvl = C.filter(e => e.level === boss.level && e.kind === 'duel'), W = lvl.flatMap(e => e.words);
  W.forEach(id => P.record(id, true, { game: 'quest' }));
  P.record(W[1], false, { game: 'quest' });
  const p = Q.plan(boss);
  assert.deepEqual(p.teach, []);
  const ids = p.rounds.flatMap(r => r.items || [r.id]);
  assert.ok(ids.every(id => DB.items[id].level === boss.level || p.rounds.find(r => r.id === id).review));
  assert.ok(ids.includes(W[1]), 'the weak word is in');
  assert.ok(p.rounds.length >= 5 && p.rounds.length <= Q.rules(boss).maxRounds);
});

test('rules: gentle start, harder with level, bosses hit harder', () => {
  const Q = page().quest, C = Q.campaign();
  const r0 = Q.rules(C[0]), boss = Q.rules(C.find(e => e.kind === 'boss'));
  assert.equal(r0.time, 0, 'no timer in the first encounters');
  assert.ok(Q.rules({ kind: 'duel', level: 'A1', index: 5 }).time > 0);
  assert.ok(boss.damage > r0.damage && boss.time > 0);
  const lv = Q.LEVELS.map(level => Q.rules({ kind: 'duel', level, index: 10 }));
  for (let i = 1; i < lv.length; i++) { assert.ok(lv[i].damage > lv[i - 1].damage); assert.ok(lv[i].time <= lv[i - 1].time); assert.ok(lv[i].heal <= lv[i - 1].heal); }
  const r = Q.rules({ kind: 'duel', level: 'B1', index: 10 });
  assert.ok(Q.timeFor(r, 'type') > Q.timeFor(r, 'mc')); assert.equal(Q.timeFor(r0, 'mc'), 0);
});

test('chapters: runs of one level cover the campaign in order, the camp draws one at a time', () => {
  const Q = page().quest, C = Q.campaign(), H = Q.chapters();
  assert.equal(H[0].from, 0); assert.equal(H[H.length - 1].to, C.length - 1);
  H.forEach((c, k) => {
    if (k) { assert.equal(c.from, H[k - 1].to + 1); assert.notEqual(c.level, H[k - 1].level); }
    assert.ok(C.slice(c.from, c.to + 1).every(e => e.level === c.level));
  });
  for (const b of C.filter(e => e.kind === 'boss')) assert.equal(H.find(c => b.index >= c.from && b.index <= c.to).to, b.index, 'a boss closes its chapter');
});

test('story: the lesson\'s own characters and lines, intro on part 1, short lines later, fallbacks for missing / odd data', () => {
  const C0 = page().quest.campaign(), multi = C0.find(e => e.kind === 'duel' && e.parts >= 2), one = C0.find(e => e.kind === 'duel' && e.lesson !== multi.lesson);
  const story = { [multi.lesson]: { en2mn: { scene: 'Market', npc: ' Oyuna ', role: 'fruit seller', intro: 'Long intro.', teach: 'Learn!', win: 'You won.', lose: 'Again.' },
      mn2en: { npc: 'Lucy', intro: 7, role: '' } },
    [one.lesson]: 'nonsense' };
  for (const native of ['en', 'mn']) {
    const Q = page(native, fakeStorage(), story).quest, C = Q.campaign(), parts = C.filter(e => e.lesson === multi.lesson), base = parts[0].scene[native];
    const s0 = Q.story(parts[0], native), s1 = Q.story(parts[1], native), last = Q.story(parts[parts.length - 1], native);
    if (native === 'en') {
      assert.deepEqual([s0.who, s0.role, s0.art, s0.intro, s0.teach, s0.lose, s0.own], ['Oyuna', 'Fruit seller', 'stalls', 'Long intro.', 'Learn!', 'Again.', true]);
      assert.equal(s0.place, Q.SCENES.find(x => x.art === 'stalls').en.place);
      assert.equal(last.win, 'You won.');
    } else {
      // only the name is usable: everything else from the unit scene
      assert.deepEqual([s0.who, s0.role, s0.intro, s0.teach, last.win, s0.art], ['Lucy', base.role, base.intro, '', '', parts[0].scene.art]);
    }
    assert.ok(s1.intro.includes(s0.who) && s1.intro.length < 120 && s1.teach === '', 'later parts: a short line');
    if (parts.length > 1) assert.ok(s0.win.includes(s0.who) && s0.win !== 'You won.', 'parts before the last: a short win line');
    // a lesson whose story is not an object, a lesson without a story, a boss: the unit / boss scene
    const o = Q.story(C.find(e => e.lesson === one.lesson), native), b = C.find(e => e.kind === 'boss');
    assert.equal(o.who, one.scene[native].who); assert.equal(o.own, false);
    assert.deepEqual([Q.story(b, native).who, Q.story(b, native).art], [Q.BOSS[native].who, 'gate']);
    for (const e of C) { const x = Q.story(e, native); assert.ok(['art', 'place', 'who', 'role', 'intro'].every(k => typeof x[k] === 'string' && x[k])); }
  }
  // no story file at all
  const Q = page('en').quest;
  assert.equal(Q.story(Q.campaign()[0], 'en').intro, Q.campaign()[0].scene.en.intro);
});

test('match rounds never pair two items with the same text', () => {
  const Y = page(), Q = Y.quest, w = Object.values(DB.items).filter(x => x.type === 'word');
  const a = w[0], twin = w.find(x => x !== a && Y.ex.norm(x.en) !== Y.ex.norm(a.en) && Y.ex.norm(x.mn) === Y.ex.norm(a.mn))
    || w.find(x => x !== a && Y.ex.norm(x.en) === Y.ex.norm(a.en));
  const ids = [a.id, ...(twin ? [twin.id] : []), w[5].id];
  assert.deepEqual(Q.distinct([...ids, a.id]), twin ? [a.id, w[5].id] : [a.id, w[5].id]);
});
