/* Yarya shared learner model: one progress record for every game (Duolingo-style app, quest game, ...).
   Plain script, no modules: load after db/content.js with <script src="shared/progress.js"></script>.
   Words learned in one game count in all others, because everything keys on the DB item ids (w:u01l1:3, ...).

   Storage: one localStorage key 'yarya_progress_v1' (JSON). Every access is in try/catch; without storage
   (file:// in some browsers, private mode) the data lives in memory for the session.
   {
     v: 1, migrated: true,
     dirs: { en: Dir, mn: Dir }      keyed by the learner's native language: en = English speaker learning Mongolian
   }                                 (direction en->mn), mn = Mongolian speaker learning English (mn->en)
   Dir: {
     items:    { itemId: { seen, correct, wrong, last (ms), strength (0..8), due (ms) } },
     xp, daily: { day: 'YYYY-MM-DD', xp }, days: { day: xp }, streak: { n, last: day },
     done:     { lessonId: ms },                         lessons finished
     mistakes: [{ id, t (exercise kind), rev, lesson }], newest last, max 60
     games:    { name: { xp, answers, correct, lessons, last (ms) } }
   }
   Spaced repetition: a correct answer raises strength by 1 and schedules the next review INTERVALS[strength]
   later; a wrong answer drops strength by 2 and makes the item due again in a minute. strength >= KNOWN = known.
   UI preferences that are not learner data (theme, sound, ...) go through Yarya.store with plain keys. */
(function () {
  'use strict';
  const Y = window.Yarya = window.Yarya || {};
  const KEY = 'yarya_progress_v1', KNOWN = 2, MAX_MISTAKES = 60, MIN = 60e3, DAY = 864e5;
  const INTERVALS = [0, 10 * MIN, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 90 * DAY, 180 * DAY];

  // ---------- storage: try/catch everywhere, memory fallback ----------
  const mem = {};
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch (e) {}
      return k in mem ? JSON.parse(mem[k]) : d;
    },
    set(k, v) {
      mem[k] = JSON.stringify(v);
      try { localStorage.setItem(k, mem[k]); } catch (e) {}
    }
  };
  function dayKey(offset = 0, at) {
    const d = at ? new Date(at) : new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const db = () => window.YARYA_DB || null;
  const item = id => { const D = db(); return D && D.items[id] || null; };

  // ---------- load + migrate the app's old per-language keys (done_en, xp_en, mist_en, seen_en, ...) ----------
  const emptyDir = () => ({ items: {}, xp: 0, daily: { day: null, xp: 0 }, days: {}, streak: { n: 0, last: null },
    done: {}, mistakes: [], games: {} });
  const emptyGame = () => ({ xp: 0, answers: 0, correct: 0, lessons: 0, last: 0 });
  function legacyItem(lid, t, i) {
    // old refs were lesson id + kind + index into vocab / sentences / fill_blank
    const D = db(), l = D && D.lessons.find(x => x.id === lid);
    if (!l) return null;
    return (t === 'mc' || t === 'new' ? l.words : t === 'blank' ? l.fill_blank : l.sentences)[i] || null;
  }
  function migrate(data) {
    for (const n of ['en', 'mn']) {
      const old = k => store.get(k + '_' + n, null);
      if (!['done', 'xp', 'daily', 'streak', 'mist', 'seen'].some(k => old(k) != null)) continue;
      const d = data.dirs[n] = data.dirs[n] || emptyDir();
      d.done = Object.assign({}, old('done') || {}, d.done);
      d.xp += +old('xp') || 0;
      const daily = old('daily'); if (daily && daily.day) { d.daily = daily; d.days[daily.day] = (d.days[daily.day] || 0) + daily.xp; }
      const streak = old('streak'); if (streak && streak.last) d.streak = streak;
      const seen = old('seen') || {};
      for (const k of Object.keys(seen)) {
        const p = k.lastIndexOf(':'), id = legacyItem(k.slice(0, p), 'new', +k.slice(p + 1));
        if (id && !d.items[id]) d.items[id] = { seen: 1, correct: 0, wrong: 0, last: 0, strength: 0, due: 0 };
      }
      for (const m of old('mist') || []) {
        const id = legacyItem(m.lid, m.t, m.i);
        if (id) addMistake(d, { id, t: m.t, rev: !!m.rev, lesson: m.lid });
      }
      d.games.duo = Object.assign(emptyGame(), d.games.duo, { xp: d.xp, lessons: Object.keys(d.done).length });
    }
    data.migrated = true;
    return data;
  }
  let data = null;
  function load() {
    data = store.get(KEY, null);
    if (!data || typeof data !== 'object' || !data.dirs) data = { v: 1, dirs: {} };
    if (!data.migrated) { migrate(data); save(); }
    return data;
  }
  const save = () => store.set(KEY, data);
  // another tab / game wrote progress: pick it up
  try { window.addEventListener('storage', e => { if (e.key === KEY) load(); }); } catch (e) {}

  // ---------- helpers ----------
  let native = store.get('native', null);
  const dir = () => {
    const n = native || 'en';
    return data.dirs[n] = Object.assign(emptyDir(), data.dirs[n]);
  };
  const game = (d, g) => d.games[g || 'duo'] = Object.assign(emptyGame(), d.games[g || 'duo']);
  const mkey = m => m.id + '|' + (m.t || '') + '|' + (m.rev ? 1 : 0);
  function addMistake(d, m) {
    const k = mkey(m);
    d.mistakes = d.mistakes.filter(x => mkey(x) !== k).concat([m]).slice(-MAX_MISTAKES);
  }
  function rec(d, id) { return d.items[id] || (d.items[id] = { seen: 0, correct: 0, wrong: 0, last: 0, strength: 0, due: 0 }); }
  // filter: function(item, mastery) or { type, level, unit, lesson, topic } (each a value or a list)
  function matches(id, filter, m) {
    if (!filter) return true;
    if (typeof filter === 'function') return !!filter(item(id), m);
    const it = item(id); if (!it) return false;
    const has = (want, v) => want == null || (Array.isArray(want) ? want.includes(v) : want === v);
    return has(filter.type, it.type) && has(filter.level, it.level) && has(filter.unit, it.unit) &&
      (filter.lesson == null || [].concat(filter.lesson).some(l => it.lessons.includes(l))) &&
      (filter.topic == null || [].concat(filter.topic).some(tp => (it.topics || []).includes(tp)));
  }
  const view = r => ({ seen: r.seen, correct: r.correct, wrong: r.wrong, last: r.last, strength: r.strength, due: r.due,
    level: Math.min(1, r.strength / 5), known: r.strength >= KNOWN });

  load();
  Y.store = store;
  Y.dayKey = dayKey;
  Y.progress = {
    KNOWN, INTERVALS,
    // the learner's native language ('en' | 'mn' | null); direction = native -> the other language
    native: () => native,
    setNative(n) { native = n; store.set('native', n); },
    target: () => native === 'en' ? 'mn' : 'en',
    direction: () => (native || 'en') + '->' + (native === 'mn' ? 'en' : 'mn'),
    reload: load,

    // one graded answer. opts: { game, t (exercise kind), rev, lesson, keepMistake, mistake: false, at }
    // wrong -> remembered as a mistake; right -> mistake cleared (unless keepMistake, e.g. a re-ask in the same lesson)
    record(id, correct, opts = {}) {
      const d = dir(), r = rec(d, id), at = opts.at || Date.now(), g = game(d, opts.game);
      r.seen++; r.last = at; g.answers++; g.last = at;
      if (correct) {
        r.correct++; g.correct++; r.strength = Math.min(INTERVALS.length - 1, r.strength + 1); r.due = at + INTERVALS[r.strength];
      } else {
        r.wrong++; r.strength = Math.max(0, r.strength - 2); r.due = at + MIN;
      }
      if (opts.mistake !== false) {
        const m = { id, t: opts.t || null, rev: !!opts.rev, lesson: opts.lesson || (item(id) || {}).lesson || null };
        if (!correct) addMistake(d, m);
        else if (!opts.keepMistake) d.mistakes = d.mistakes.filter(x => opts.t ? mkey(x) !== mkey(m) : x.id !== id);
      }
      save();
      return view(r);
    },
    // shown without grading (new word card, dialogue read)
    markSeen(id, opts = {}) {
      const d = dir(), r = rec(d, id); r.seen++; r.last = opts.at || Date.now();
      if (!r.due) r.due = r.last;
      save();
    },
    mastery(id) { const r = dir().items[id]; return view(r || { seen: 0, correct: 0, wrong: 0, last: 0, strength: 0, due: 0 }); },
    // up to n item ids due for review now, most overdue first
    due(n = 20, filter, at) {
      const d = dir(), now = at || Date.now();
      return Object.keys(d.items).filter(id => { const r = d.items[id]; return r.correct + r.wrong > 0 && r.due <= now && matches(id, filter, view(r)); })
        .sort((a, b) => d.items[a].due - d.items[b].due).slice(0, n);
    },
    // ids of known items (strength >= KNOWN), optionally filtered, in course order when the DB is loaded
    known(filter) {
      const d = dir();
      const ids = Object.keys(d.items).filter(id => d.items[id].strength >= KNOWN && matches(id, filter, view(d.items[id])));
      return ids.sort((a, b) => ((item(a) || {}).order ?? 1e9) - ((item(b) || {}).order ?? 1e9));
    },
    seenIds(filter) { const d = dir(); return Object.keys(d.items).filter(id => d.items[id].seen > 0 && matches(id, filter, view(d.items[id]))); },

    addXP(n, gameName) {
      const d = dir(), day = dayKey();
      d.xp += n; d.daily = { day, xp: (d.daily.day === day ? d.daily.xp : 0) + n }; d.days[day] = (d.days[day] || 0) + n;
      game(d, gameName).xp += n;
      if (n > 0 && d.streak.last !== day) { d.streak = { n: d.streak.last === dayKey(-1) ? d.streak.n + 1 : 1, last: day }; }
      save();
      return d.xp;
    },
    xp: () => dir().xp,
    dailyXP() { const d = dir(); return d.daily.day === dayKey() ? d.daily.xp : 0; },
    days: () => Object.assign({}, dir().days),
    // current streak in days (0 if the last active day was before yesterday)
    streak() { const s = dir().streak; return s.last === dayKey() || s.last === dayKey(-1) ? s.n : 0; },

    lessonDone(lessonId, gameName) {
      const d = dir(); if (!d.done[lessonId]) game(d, gameName).lessons++;
      d.done[lessonId] = Date.now(); save();
    },
    done: () => Object.assign({}, dir().done),

    // mistakes still in the DB (an item can disappear when lessons are rewritten)
    mistakes() { const D = db(); return dir().mistakes.filter(m => !D || D.items[m.id]).map(m => Object.assign({}, m)); },
    clearMistake(m) { const d = dir(); d.mistakes = d.mistakes.filter(x => mkey(x) !== mkey(m)); save(); },

    gameStats: g => Object.assign({}, game(dir(), g)),
    games: () => JSON.parse(JSON.stringify(dir().games)),
    // everything (for a stats screen or export)
    snapshot: () => JSON.parse(JSON.stringify(data))
  };
})();
