/* Yarya shared exercise builders: turn DB items (window.YARYA_DB) into exercises, for every game.
   Plain script, no modules: load after db/content.js (and shared/progress.js for the default direction).
   Builders return plain data + a check() function; each game draws its own UI from it (textContent only).
   Direction: opts.native = the learner's language ('en' | 'mn', default Yarya.progress.native());
   target = the other one. Prompts/answers say which side they are on (from/to).
     Yarya.ex.mc(wordId, { native, rev, lesson, n })   multiple choice, smart distractors
     Yarya.ex.match(wordIds, { native })               match pairs (left = target, right = native)
     Yarya.ex.wordBank(sentenceId, { native, lesson }) build the target sentence from word chips
     Yarya.ex.typeAnswer(sentenceId, { native })       write the native translation, typo tolerant
     Yarya.ex.fillBlank(blankId, { native })           pick the word for ___ (only blanks in the target language)
     Yarya.ex.checkAnswer(given, accepted)             -> { ok, almost, answer }, shared typo tolerance */
(function () {
  'use strict';
  const Y = window.Yarya = window.Yarya || {};
  const PUNCT = /[.,!?;:"“”„«»()—–\-'’]/g;

  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pickOne = a => a[Math.random() * a.length | 0];
  const norm = s => (s || '').toLowerCase().replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
  const tokens = s => (s || '').split(/\s+/).map(w => w.replace(/^[.,!?;:"“”„«»()'’]+|[.,!?;:"“”„«»()]+$/g, '')).filter(Boolean);
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const CYR = Object.fromEntries([...'абвгдеёжзийклмноөпрстуүфхцчшщъыьэюя'].map((c, i) =>
    [c, ['a','b','v','g','d','ye','yo','j','z','i','i','k','l','m','n','o','ö','p','r','s','t','u','ü','f','kh','ts','ch','sh','shch','','y','i','e','yu','ya'][i]]));
  function romanize(s) { return [...(s || '')].map(ch => { const l = ch.toLowerCase(), r = CYR[l]; return r == null ? ch : (ch !== l ? r.charAt(0).toUpperCase() + r.slice(1) : r); }).join(''); }

  const answersFor = (s, lang) => [s[lang], ...(s['alt_' + lang] || [])].filter(Boolean);
  // exact (ignoring case/punctuation) = ok; within ~8% edits of an accepted answer = ok but "almost" (typo)
  function checkAnswer(given, accepted, opts = {}) {
    const got = norm(given), list = [].concat(accepted).filter(Boolean);
    const exact = list.find(a => norm(a) === got);
    if (exact != null) return { ok: true, answer: list[0] };
    if (opts.typos !== false && got) {
      const close = list.find(a => lev(norm(a), got) <= Math.max(1, Math.floor(norm(a).length * .08)));
      if (close) return { ok: true, almost: true, answer: close };
    }
    return { ok: false, answer: list[0] };
  }

  // ---------- DB access ----------
  const db = () => window.YARYA_DB || { units: [], lessons: [], items: {} };
  let lessonIx = null, byType = null, ixFor = null;
  function index() {
    const D = db();
    if (ixFor !== D) {
      ixFor = D; lessonIx = Object.fromEntries(D.lessons.map(l => [l.id, l])); byType = {};
      for (const x of Object.values(D.items)) (byType[x.type] = byType[x.type] || []).push(x);
    }
  }
  function lesson(id) { index(); return lessonIx[id] || null; }
  const item = id => db().items[id] || null;
  const sides = opts => {
    const n = opts && opts.native || (Y.progress && Y.progress.native()) || 'en';
    return { native: n, target: n === 'en' ? 'mn' : 'en' };
  };
  const latinFor = (it, lang) => lang === 'mn' && it && it.mn_latin ? it.mn_latin : null;
  const lessonList = (lid, kind) => ((lesson(lid) || {})[kind] || []).map(item).filter(Boolean);

  // Distractor items for `it` shown on side `to`: same lesson first, then same unit, then same level, then any;
  // same part of speech preferred within each group; never the same text as the answer (or its alternatives).
  function distractors(it, to, n, ctxLesson) {
    const bad = new Set(answersFor(it, to).map(norm)), out = [], seen = new Set();
    const lid = ctxLesson || it.lesson, l = lesson(lid) || {};
    const pool = byType[it.type].filter(x => x !== it);
    const tiers = [
      lessonList(lid, it.type === 'word' ? 'words' : 'sentences').filter(x => x !== it),
      pool.filter(x => x.unit === (l.unit || it.unit)), pool.filter(x => x.level === (l.level || it.level)), pool];
    for (const tier of tiers) {
      const ordered = shuffle(tier).sort((a, b) => (b.pos === it.pos) - (a.pos === it.pos));
      for (const x of ordered) {
        const k = norm(x[to]);
        if (!k || bad.has(k) || seen.has(k)) continue;
        seen.add(k); out.push(x);
        if (out.length >= n) return out;
      }
    }
    return out;
  }

  // ---------- builders ----------
  function mc(id, opts = {}) {
    const v = item(id), { native, target } = sides(opts), from = opts.rev ? native : target, to = opts.rev ? target : native;
    const options = shuffle([v, ...distractors(v, to, (opts.n || 4) - 1, opts.lesson)])
      .map(x => ({ id: x.id, text: x[to], latin: latinFor(x, to) }));
    return { kind: 'mc', id, from, to, prompt: v[from], promptLatin: latinFor(v, from), options,
      answer: v[to], answerLatin: latinFor(v, to),
      // pick = option index or text
      check(pick) { const o = typeof pick === 'number' ? options[pick] : options.find(x => x.text === pick);
        return { ok: !!o && (o.id === id || norm(o.text) === norm(v[to])), answer: v[to] }; } };
  }
  function match(ids, opts = {}) {
    // a pair must be told apart: an item whose text repeats an earlier one (either side) is left out
    const { native, target } = sides(opts), seen = new Set(), its = [];
    for (const x of ids.map(item)) {
      if (!x || !norm(x[target]) || !norm(x[native]) || seen.has('t' + norm(x[target])) || seen.has('n' + norm(x[native]))) continue;
      seen.add('t' + norm(x[target])); seen.add('n' + norm(x[native])); its.push(x);
    }
    const left = shuffle(its).map(x => ({ id: x.id, text: x[target], latin: latinFor(x, target) }));
    const right = shuffle(its).map(x => ({ id: x.id, text: x[native], latin: latinFor(x, native) }));
    return { kind: 'match', ids: its.map(x => x.id), left, right,
      // two words with the same translation are both right
      isPair: (l, r) => l === r || (item(l) && item(r) && norm(item(l)[native]) === norm(item(r)[native])) };
  }
  function wordBank(id, opts = {}) {
    const s = item(id), { native, target } = sides(opts), words = tokens(s[target]);
    const others = new Set(lessonList(opts.lesson || s.lesson, 'sentences').filter(x => x !== s).flatMap(x => tokens(x[target])));
    words.forEach(w => others.delete(w));
    const bank = shuffle([...words, ...shuffle([...others]).slice(0, opts.extra ?? 3)]);
    return { kind: 'build', id, prompt: s[native], words, bank, lang: target,
      answer: s[target], answerLatin: latinFor(s, target),
      check: picked => { const got = norm([].concat(picked).join(' '));
        return { ok: answersFor(s, target).some(a => norm(a) === got), answer: s[target] }; } };
  }
  function typeAnswer(id, opts = {}) {
    const s = item(id), { native, target } = sides(opts), accepted = answersFor(s, native);
    return { kind: 'type', id, prompt: s[target], promptLatin: latinFor(s, target), accepted, answer: s[native], lang: native,
      check: text => checkAnswer(text, accepted) };
  }
  const blankOk = (f, opts) => { f = typeof f === 'string' ? item(f) : f;
    return !!f && f.lang === sides(opts).target && (f.text || '').includes('___') && (f.options || []).includes(f.answer); };
  function fillBlank(id, opts = {}) {
    const f = item(id), { native } = sides(opts), parts = (f.text || '').split('___');
    return { kind: 'blank', id, before: parts[0], after: parts.slice(1).join('___'), options: shuffle([...new Set(f.options || [])]),
      answer: f.answer, translation: f.translation || '', explain: f['explain_' + native] || '',
      check: pick => ({ ok: pick === f.answer, answer: f.answer, explain: f['explain_' + native] || '' }) };
  }

  Y.ex = { shuffle, pickOne, norm, tokens, lev, romanize, answersFor, checkAnswer, item, lesson, sides, distractors,
    blankOk, mc, match, wordBank, typeAnswer, fillBlank };
})();
