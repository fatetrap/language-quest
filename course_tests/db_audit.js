// Robustness audit on the REAL database (course/db/content.js + story.js; the fixture course when not built):
// in both directions, every quest encounter (plan, every round's exercise, the story lines, the fight screen and each
// round drawn by quest/index.html) and every lesson of the lessons app (course/index.html: its steps, each drawn).
// Checks: no exceptions, no empty / "undefined" prompts, options unique and containing the answer, word banks
// solvable, match pairs distinct. The content is model-written, so this runs over all of it, not a sample.
// Usage: node db_audit.js [quest|lessons] [en|mn]   (no arguments: all four, each in its own process: one page holds
// the 19 MB DB). Exits non-zero and lists the problems on any failure.
const fs = require('fs'), path = require('path'), os = require('os');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const REAL = process.env.YARYA_DB_JS || path.join(ROOT, 'course', 'db', 'content.js'), STORY = path.join(ROOT, 'course', 'db', 'story.js');
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'yarya-audit-'));
process.on('exit', () => { try { fs.rmSync(site, { recursive: true, force: true }); } catch (e) {} });   // the copy holds the 20 MB DB
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(site, to)), { recursive: true }); fs.copyFileSync(from, path.join(site, to)); };
for (const f of ['index.html', 'quest/index.html', 'quest/campaign.js', 'quest/pixel.js', 'quest/chip.js', 'quest/assets/fonts.js', 'shared/progress.js', 'shared/exercises.js']) copy(path.join(ROOT, 'course', f), f);
copy(fs.existsSync(REAL) ? REAL : path.join(__dirname, 'quest_fixture_db.js'), 'db/content.js');
if (fs.existsSync(STORY)) copy(STORY, 'db/story.js');
const [PART, DIR] = process.argv.slice(2);

const problems = {}, MAXLIST = 5;
const bad = (kind, what) => { (problems[kind] = problems[kind] || []).push(what); };
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented|Could not load script/.test(e.message)) bad('page error', e.message); });
const local = requestInterceptor(request => {
  const u = new URL(request.url), f = path.join(site, u.pathname);
  return fs.existsSync(f) ? new Response(fs.readFileSync(f), { headers: { 'content-type': 'text/javascript' } }) : new Response('', { status: 404 });
});
async function load(page, native) {
  const dom = new JSDOM(fs.readFileSync(path.join(site, page), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: 'http://yarya.test/' + page, resources: { interceptors: [local] },
    beforeParse(w) {
      w.localStorage.setItem('yarya_progress_v1', JSON.stringify({ native }));
      w.localStorage.setItem('quest_' + native, JSON.stringify({ won: {}, best: 0, onb: true }));
      w.addEventListener('error', e => bad('page error', e.error && e.error.stack || e.message));
    } });
  await new Promise(r => dom.window.addEventListener('load', r));
  const w = dom.window;
  w.eval(`native = ${JSON.stringify(native)}; Yarya.progress.setNative(native);`);
  return w;
}
const text = s => typeof s === 'string' && s.trim().length > 0 && !/\bundefined\b|\bnull\b|\[object /.test(s);
const shown = el => (el.textContent || '').replace(/\s+/g, ' ').trim();

// ---------- one exercise, built from the shared builders: the data a game would draw ----------
function checkRound(X, r, native, where) {
  const w = `${where} ${r.t} ${r.id || (r.items || []).join(',')}`;
  if (r.t === 'mc') {
    const q = X.mc(r.id, { native, rev: r.rev, lesson: r.lid, n: r.n || 4 });
    if (!text(q.prompt)) bad('mc: empty prompt', w);
    const ks = q.options.map(o => X.norm(o.text));
    if (q.options.length < 2 || ks.some(k => !k)) bad('mc: too few / empty options', w);
    if (new Set(ks).size !== ks.length) bad('mc: duplicate options', w + ' ' + q.options.map(o => o.text).join(' | '));
    const ix = q.options.findIndex(o => o.text === q.answer);
    if (ix < 0 || ks.filter(k => k === X.norm(q.answer)).length !== 1 || !q.check(ix).ok) bad('mc: answer missing / ambiguous', w);
  } else if (r.t === 'match') {
    const q = X.match(r.items, { native }), L = q.left.map(o => X.norm(o.text)), R = q.right.map(o => X.norm(o.text));
    if (q.left.length < 2) bad('match: fewer than 2 pairs', w);
    if (new Set(L).size !== L.length || new Set(R).size !== R.length || L.some(k => !k) || R.some(k => !k)) bad('match: pairs not distinct', w);
    if (!q.left.every(l => q.right.some(x => q.isPair(l.id, x.id)))) bad('match: unsolvable', w);
  } else if (r.t === 'build') {
    const q = X.wordBank(r.id, { native, lesson: r.lid });
    if (!text(q.prompt) || !q.words.length) bad('build: empty prompt / no words', w);
    const left = q.bank.slice();
    if (!q.words.every(x => { const k = left.indexOf(x); if (k < 0) return false; left.splice(k, 1); return true; }) || !q.check(q.words).ok) bad('build: word bank unsolvable', w);
  } else if (r.t === 'type') {
    const q = X.typeAnswer(r.id, { native });
    if (!text(q.prompt) || !text(q.answer) || !q.check(q.answer).ok) bad('type: empty / unsolvable', w);
  } else if (r.t === 'blank') {
    const q = X.fillBlank(r.id, { native });
    if (!X.blankOk(r.id, { native })) bad('blank: not playable in this direction', w);
    if (!text(q.before + q.after) || q.options.length < 2) bad('blank: empty text / too few options', w);
    if (new Set(q.options).size !== q.options.length || !q.options.includes(q.answer) || !q.check(q.answer).ok) bad('blank: options / answer', w);
  } else bad('unknown round kind', w);
}

async function quest(native) {
  const w = await load('quest/index.html', native), Y = w.Yarya, X = Y.ex, Q = Y.quest, C = Q.campaign(), tg = native === 'en' ? 'mn' : 'en';
  if (new Set(C.map(e => e.id)).size !== C.length) bad('quest: duplicate encounter ids', native);
  const RND = w.eval('RND'), stub = { done() {}, miss() {} };
  let rounds = 0, own = 0;
  for (const e of C) {
    const where = `${native} ${e.id}`;
    try {
      const s = Q.story(e, native);
      if (s.own) own++;
      for (const k of ['art', 'place', 'who', 'role', 'intro']) if (!text(s[k])) bad('story: empty ' + k, where);
      if (e.part === e.parts - 1 && s.own && !text(s.win)) bad('story: no win line on the last part', where);
      const p = Q.plan(e, { native });
      if (!p.rounds.length) bad('quest: encounter without rounds', where);
      for (const id of p.teach) { const v = X.item(id); if (!v || !text(v[tg]) || !text(v[native])) bad('quest: teach card without text', where + ' ' + id); }
      for (const r of p.rounds) {
        rounds++;
        try {
          checkRound(X, r, native, where);
          const ui = RND[r.t](r, stub), prompt = ui.prompt.filter(Boolean).map(shown).join(' ');
          if (!text(ui.head) || !text(prompt) || !text(shown(ui.el))) bad('quest: round drawn empty', `${where} ${r.t} ${r.id || ''}`);
          ui.stop();
        } catch (err) { bad('quest: round throws', `${where} ${r.t} ${r.id || ''}: ${err.message}`); }
      }
      // the fight screen itself: story / bubble / first card drawn, nothing undefined
      w.eval(`fight(Yarya.quest.campaign()[${e.index}])`);
      const d = w.document, bubble = d.querySelector('.stage .bubble'), card = d.querySelector('.board .say');
      if (!bubble || !text(shown(bubble)) || !card || !text(shown(card))) bad('quest: fight opens without a speech line / card', where);
      if (/\bundefined\b|\[object /.test(d.querySelector('.fight').textContent)) bad('quest: "undefined" on the fight screen', where);
      w.eval('if (onKey) onKey({ key: "Escape", preventDefault() {}, target: document.body })');
      const m = d.querySelector('.modal'); if (m) m.remove();
      w.eval('modal = null');
    } catch (err) { bad('quest: encounter throws', `${where}: ${err.stack.split('\n').slice(0, 2).join(' ')}`); }
  }
  console.log(`quest ${native}: ${C.length} encounters, ${rounds} rounds, ${own} with their own story`);
  w.close();
}

async function lessons(native) {
  const w = await load('index.html', native), X = w.Yarya.ex, R = w.eval('R'), buildSteps = w.eval('buildSteps');
  w.Yarya.progress.markSeen = () => {};    // nothing is graded here; saving the growing progress per card only eats memory
  const L = w.YARYA_DB.lessons.filter(l => l.written);
  let steps = 0;
  for (const l of L) {
    const where = `${native} ${l.id}`;
    try {
      for (const st of buildSteps(l)) {
        steps++;
        try {
          if (['mc', 'match', 'build', 'type', 'blank'].includes(st.t)) checkRound(X, st, native, 'lessons ' + where);
          const ui = R[st.t](st), out = shown(ui.el);
          if (!text(out)) bad('lessons: step drawn empty', `${where} ${st.t} ${st.id || ''}`);
          if (/\bundefined\b|\[object /.test(out)) bad('lessons: "undefined" in a step', `${where} ${st.t} ${st.id || ''}`);
        } catch (err) { bad('lessons: step throws', `${where} ${st.t} ${st.id || ''}: ${err.message}`); }
      }
    } catch (err) { bad('lessons: buildSteps throws', `${where}: ${err.message}`); }
  }
  console.log(`lessons ${native}: ${L.length} lessons, ${steps} steps`);
  w.close();
}

if (!PART) {
  // every page + direction in a child process, one after the other
  const { spawnSync } = require('child_process');
  let failed = 0;
  for (const part of ['quest', 'lessons']) for (const n of ['en', 'mn']) {
    const r = spawnSync(process.execPath, [__filename, part, n], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
  process.exitCode = failed ? 1 : 0;
} else (async () => {
  const alive = setInterval(() => {}, 1000);    // jsdom's script loading alone does not keep node running
  await (PART === 'quest' ? quest : lessons)(DIR || 'en');
  const kinds = Object.keys(problems);
  for (const k of kinds) console.log(`PROBLEM ${k}: ${problems[k].length}\n  ` + problems[k].slice(0, MAXLIST).join('\n  '));
  if (kinds.length) process.exitCode = 1; else console.log(`AUDIT OK ${PART} ${DIR || 'en'}`);
  clearInterval(alive);
})().catch(e => { console.error(e); process.exitCode = 1; });
