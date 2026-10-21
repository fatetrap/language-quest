// Unit tests for quest/pixel.js (sprites, roles, map routes) and quest/chip.js (sound API) in plain Node, no canvas:
// the art data must be well formed, the pure helpers right, and both modules quiet where the browser lacks features.
// Usage: node --test pixel_test.js
const test = require('node:test'), assert = require('node:assert');
const path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'course', 'quest', 'pixel.js'));
require(path.join(__dirname, '..', 'course', 'quest', 'chip.js'));
const PX = window.Yarya.pixel, CH = window.Yarya.chip;

test('people parts: left halves 10 px wide, 12 + 8 + 8 rows', () => {
  for (const [set, rows] of [[PX.HEADS, 12], [PX.TORSOS, 8], [PX.LEGS, 8]])
    for (const [k, r] of Object.entries(set)) {
      assert.strictEqual(r.length, rows, k);
      r.forEach((row, i) => assert.strictEqual(row.length, 10, `${k} row ${i}`));
    }
  for (const [k, b] of Object.entries(PX.BOSSES)) b.rows.forEach((row, i) => assert.strictEqual(row.length, 14, `${k} row ${i}`));
});

test('every archetype uses parts that exist; colours are hex', () => {
  for (const kind of Object.keys(PX.ARCH))
    for (const region of ['mn', 'uk']) {
      const d = PX.personDef(kind, 'Someone ' + kind, region);
      assert.ok(PX.HEADS[d.head] && PX.TORSOS[d.torso] && PX.LEGS[d.legs], `${kind} ${region}`);
      for (const c of Object.values(d.pal)) assert.match(c, /^#[0-9a-f]{6}$/, kind);
      if (region === 'uk') assert.notStrictEqual(d.torso, 'deel', 'nobody wears a deel in London: ' + kind);
    }
});

test('roles pick the archetype by the head noun', () => {
  const cases = { 'Taxi driver and part-time herder': 'driver', 'Herder grandmother': 'granny', "Herder's daughter and etiquette coach": 'student',
    'District clinic doctor': 'doctor', 'Canteen cook': 'cook', 'Border officer': 'officer', 'Wrestler': 'wrestler', 'Kiosk owner at Narantuul market': 'trader',
    'Geography teacher': 'teacher', 'Хилийн офицер': 'officer', 'Эмч': 'doctor', 'Airport cleaner and self-appointed greeter': 'local' };
  for (const [role, kind] of Object.entries(cases)) assert.strictEqual(PX.roleKind(role), kind, role);
  assert.strictEqual(PX.foe('x', 'BATZORIG', 'mn', true), 'batzorig');
  assert.strictEqual(PX.foe('x', 'Sir Edmund', 'uk', true), 'edmund');
  assert.strictEqual(PX.foe('Canteen cook', 'Tsetseg', 'mn', false), 'p:cook:mn:Tsetseg');
});

test('character looks keep the original traveler and provide complete, distinct palettes', () => {
  assert.deepStrictEqual(PX.skinDef('traveler'), PX.personDef('hero', 'you', 'mn'));
  const looks = Object.keys(PX.SKINS).map(id => {
    const d = PX.skinDef(id);
    assert.ok(PX.SKINS[id].en && PX.SKINS[id].mn, 'each look has both display names');
    assert.ok(PX.HEADS[d.head] && PX.TORSOS[d.torso] && PX.LEGS[d.legs]);
    const used = [...PX.HEADS[d.head], ...PX.TORSOS[d.torso], ...PX.LEGS[d.legs]].join('');
    for (const key of new Set(used.replace(/\./g, ''))) assert.match(d.pal[key], /^#[0-9a-f]{6}$/, id + ' ' + key);
    assert.strictEqual(PX.hero(id), 'hero:' + id);
    assert.strictEqual(PX.walker(id), 'walker:' + id);
    return JSON.stringify(d);
  });
  assert.strictEqual(new Set(looks).size, 4, 'four visibly different looks');
});

test('missing, corrupt and inherited skin IDs safely fall back to the traveler', () => {
  for (const id of [null, undefined, '', 'missing', '__proto__', 'constructor', 'toString', {}, 42]) {
    assert.strictEqual(PX.skinId(id), 'traveler');
    assert.strictEqual(PX.hero(id), 'hero:traveler');
    assert.deepStrictEqual(PX.skinDef(id), PX.skinDef('traveler'));
  }
});

test('the map route: n nodes inside the map, left to right on a wide map, rows on a narrow one', () => {
  for (const [W, H] of [[420, 80], [170, 75], [60, 50]])
    for (const n of [1, 2, 5, 13]) {
      const r = PX.route(W, H, n, 118);
      assert.strictEqual(r.length, n);
      for (const p of r) assert.ok(p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H, JSON.stringify([W, H, n, p]));
    }
  const wide = PX.route(420, 80, 13, 118);
  wide.slice(1).forEach((p, i) => assert.ok(p.x > wide[i].x, 'wide map goes left to right'));
  const narrow = PX.route(170, 75, 13, 118);
  assert.ok(new Set(narrow.map(p => Math.round(p.y / 25))).size > 1, 'narrow map snakes in rows');
  for (let i = 1; i < narrow.length; i++) assert.ok(Math.hypot(narrow[i].x - narrow[i - 1].x, narrow[i].y - narrow[i - 1].y) >= 12, 'nodes do not overlap');
});

test('the pointing hand as CSS pixel art; idle frames cycle; no canvas = no sprite, no crash', () => {
  const s = PX.shadowArt('hand', 2);
  assert.match(s, /^\d+px \d+px 0 0 #[0-9a-f]{6}(,\d+px \d+px 0 0 #[0-9a-f]{6})+$/);
  assert.ok(s.split(',').length > 40);
  assert.strictEqual(PX.shadowArt('nope', 2), 'none');
  for (let k = -30; k < 60; k++) assert.ok([0, 1, 2].includes(PX.idle(k, 5)), 'idle frame ' + k);
  assert.strictEqual(PX.sprite('horse'), null);
  assert.doesNotThrow(() => PX.animate(null, () => {}));
});

test('chip: silent without Web Audio; songs are well formed; music only when enabled and not muted', () => {
  assert.doesNotThrow(() => { for (const n of Object.keys(CH.FX)) CH.sfx(n); CH.music('battle'); });
  assert.strictEqual(CH.playing(), null, 'no AudioContext: nothing plays');
  for (const [name, S] of Object.entries(CH.SONGS)) {
    assert.ok(S.bpm > 60 && S.tracks.length >= 2, name);
    for (const tr of S.tracks) {
      assert.ok(['square', 'triangle', 'noise'].includes(tr.type), name);
      assert.ok(tr.seq.every(([m, n]) => n > 0 && (m === 0 || (tr.type === 'noise' ? m <= 2 : m >= 36 && m <= 96))), name);
    }
  }
  // a fake audio engine: music starts only after setMusic(true), stops when muted
  let osc = 0;
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  window.AudioContext = class { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.sampleRate = 8000; }
    createOscillator() { osc++; return { frequency: param(), connect() {}, start() {}, stop() {} }; } createGain() { return { gain: param(), connect() {} }; } };
  CH.setMusic(false); CH.music('map'); assert.strictEqual(CH.playing(), null, 'music is off by default');
  CH.setMusic(true); assert.strictEqual(CH.playing(), 'map');
  CH.setMuted(true); assert.strictEqual(CH.playing(), null, 'mute stops the music');
  CH.sfx('hit'); assert.strictEqual(osc, 0, 'muted: no sound');
  CH.setMuted(false); assert.strictEqual(CH.playing(), 'map');
  CH.sfx('victory'); assert.ok(osc > 0);
  CH.music(null); CH.setMusic(false); assert.strictEqual(CH.playing(), null);
});
