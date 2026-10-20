// Smoke test for course/index.html in jsdom: picks a direction, plays lesson 1 to the complete screen,
// then practice-mistakes, quit dialog, theme/mute toggles. Usage: node smoke.js <en|mn> <file|http> [reduced]
// Uses the real lesson DB (course/db/content.js, run build_db.py first) and the shared modules (course/shared).
// Exits non-zero on any failed check or uncaught page error.
const fs = require('fs'), path = require('path'), os = require('os');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const [native = 'en', mode = 'http', motion = ''] = process.argv.slice(2);
const REDUCED = motion === 'reduced';
const tg = native === 'en' ? 'mn' : 'en';
const ROOT = path.resolve(__dirname, '..');
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'yarya-'));
process.on('exit', () => { try { fs.rmSync(site, { recursive: true, force: true }); } catch (e) {} });
fs.copyFileSync(path.join(ROOT, 'course', 'index.html'), path.join(site, 'index.html'));
for (const f of ['db/content.js', 'shared/progress.js', 'shared/exercises.js']) {
  fs.mkdirSync(path.join(site, path.dirname(f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'course', f), path.join(site, f));
}

const errors = [];
const fail = m => { console.error('FAIL:', m); process.exitCode = 1; throw new Error(m); };
const ok = (c, m) => { if (!c) fail(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.stack || e.message); });
vc.on('error', e => errors.push(String(e)));

// http mode: serve the temp site from memory; anything else counts as a forbidden network request
const local = requestInterceptor(request => {
  const u = new URL(request.url);
  if (u.hostname !== 'yarya.test') { errors.push('network request: ' + request.url); return new Response('', { status: 404 }); }
  return new Response(fs.readFileSync(path.join(site, u.pathname)), { headers: { 'content-type': 'text/javascript' } });
});
function dayKey(offset) { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

async function load() {
  const opts = { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.addEventListener('error', e => errors.push('page error: ' + (e.error && e.error.stack || e.message)));
      // stubs so the canvas confetti, Web Audio and reduced-motion code paths actually run
      const calls = w.__calls = { osc: 0, draw: 0 };
      const ctx2d = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => { calls.draw++; }, set: (o, k, v) => (o[k] = v, true) });
      w.HTMLCanvasElement.prototype.getContext = () => ctx2d;
      const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
      w.AudioContext = class { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
        createOscillator() { calls.osc++; return { frequency: param(), connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: param(), connect() {} }; } };
      w.matchMedia = q => ({ matches: REDUCED && /reduce/.test(q), addListener() {}, addEventListener() {} });
      // progress saved by the old app (per-language keys): must be migrated into the shared learner model
      try { w.localStorage.setItem('streak_' + native, JSON.stringify({ n: 3, last: dayKey(-1) })); w.localStorage.setItem('xp_' + native, '7'); } catch (e) {}
    } };
  let dom;
  if (mode === 'file') dom = await JSDOM.fromFile(path.join(site, 'index.html'), { ...opts, resources: 'usable' });
  else dom = new JSDOM(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), { ...opts, url: 'http://yarya.test/index.html', resources: { interceptors: [local] } });
  await new Promise(r => dom.window.addEventListener('load', r));
  await sleep(20);
  return dom;
}

(async () => {
  const dom = await load(), w = dom.window, d = w.document, C = w.YARYA_DB;
  ok(C && C.units.length > 0 && C.items && w.Yarya.progress && w.Yarya.ex, 'db + shared modules loaded');
  const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  const key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const text = n => [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join('');
  const toks = s => (s || '').split(/\s+/).map(x => x.replace(/^[.,!?;:"“”„«»()'’]+|[.,!?;:"“”„«»()]+$/g, '')).filter(Boolean);
  const lessons = C.lessons.filter(l => l.written), I = id => C.items[id];
  const words = pool => pool.flatMap(l => l.words.map(I)), sents = pool => pool.flatMap(l => l.sentences.map(I));
  const T = { en: { check: 'Check', start: 'Start' }, mn: { check: 'Шалгах', start: 'Эхлэх' } }[native];

  // language chooser
  const choices = $$('.choose button');
  ok(choices.length === 2, 'language chooser shown');
  choices[native === 'en' ? 0 : 1].click(); await sleep(5);
  ok($('.top') && $('.path'), 'home rendered with top bar and path');
  ok($$('.node').length === C.lessons.length, 'one node per lesson');
  ok($$('.node.locked').length === C.lessons.length - lessons.length, 'unwritten lessons locked');
  ok($$('.node.next').length === 1 && $('.node.next .bubble').textContent === T.start, 'next lesson highlighted with Start bubble');
  if (mode === 'http') ok($('.pill.streak').textContent.includes('3') && $('.pill.xp').textContent === '★ 7', 'old streak + XP migrated and shown');
  ok($('details.stats') && $('details.stats').textContent.includes('Course build'), 'stats card present');
  ok(!$('.practice'), 'no practice card before any mistakes');

  // theme + mute toggles
  const ib = $$('.ibtn');
  ib[1].click(); ok(d.documentElement.getAttribute('data-theme') === 'light', 'theme -> light');
  ib[1].click(); ok(d.documentElement.getAttribute('data-theme') === 'dark', 'theme -> dark');
  ib[1].click(); ok(!d.documentElement.hasAttribute('data-theme'), 'theme -> auto');
  ib[0].click(); ib[0].click();

  // quit dialog: open lesson, Esc -> dialog, Esc -> close, X -> dialog, Quit -> home
  $('.node.next').click(); ok($('.pop'), 'popover opens'); $('.pop .btn').click(); await sleep(5);
  ok($('.lesson'), 'lesson opened from popover');
  key('Escape'); ok($('.modal'), 'Esc asks to quit');
  key('Escape'); await sleep(200); ok(!$('.modal') && $('.lesson'), 'Esc again keeps learning');
  $('.x').click(); ok($('.modal'), 'X asks to quit');
  $$('.sheet .btn')[1].click(); await sleep(5); ok($('.path') && !$('.lesson'), 'Quit goes home');

  async function play(label, wrongOnce, pool) {
    // pool = lessons the steps come from (sentences repeat across lessons, e.g. «Сайн байна уу?»)
    let n = 0, retries = 0, wrongDone = !wrongOnce, typoDone = false, kinds = new Set();
    for (; n < 80; n++) {
      const st = $('.step'), k = st && st.getAttribute('data-step');
      ok(k, `${label}: step ${n} rendered`);
      if (k === 'complete') break;
      kinds.add(k);
      if (st.querySelector('.tag')) retries++;
      const go = $('.foot .go'); let expect = 'ok';
      if (k === 'mc') {
        const p = st.querySelector('.prompt .big').textContent;
        const v = words(pool).find(v => v[tg] === p || v[native] === p);
        ok(v, `${label}: mc prompt found in vocab`);
        const want = v[tg] === p ? v[native] : v[tg], opts = $$('.step .opt');
        let idx = opts.findIndex(o => text(o) === want);
        ok(idx >= 0, `${label}: mc answer among options`);
        if (!wrongDone) { idx = (idx + 1) % opts.length; wrongDone = true; expect = 'no'; }
        ok(go.disabled, `${label}: check disabled before choosing`);
        key(String(idx + 1));
        ok(opts[idx].classList.contains('sel'), `${label}: digit key selects option`);
      } else if (k === 'match') {
        const L = $$('.match .col')[0].children, R = [...$$('.match .col')[1].children];
        const V = words(pool);
        const first = V.find(v => v[tg] === text(L[0])), wrongR = R.find(r => text(r) !== first[native]);
        L[0].click(); wrongR.click(); ok(!L[0].classList.contains('gone'), `${label}: wrong pair not matched`);
        for (const lb of L) { const v = V.find(v => v[tg] === text(lb)); lb.click(); R.find(r => text(r) === v[native] && !r.disabled).click(); }
        ok($$('.match .opt.gone').length === L.length * 2, `${label}: all pairs matched`);
      } else if (k === 'build') {
        const p = st.querySelector('.prompt').textContent;
        const s = sents(pool).find(s => s[native] === p);
        ok(s, `${label}: build sentence found`);
        const pickW = w => $$('.bank .chip').find(c => c.getAttribute('data-w') === w && !c.classList.contains('used')).click();
        pickW(toks(s[tg])[0]); $('.answer .chip').click();
        ok(!$('.answer .chip'), `${label}: chip goes back to bank`);
        toks(s[tg]).forEach(pickW);
        ok($$('.answer .chip').length === toks(s[tg]).length, `${label}: chips in answer line`);
      } else if (k === 'type') {
        const p = text(st.querySelector('.prompt'));
        const s = sents(pool).find(s => s[tg] === p);
        ok(s, `${label}: type sentence found`);
        const ta = st.querySelector('textarea');
        ta.value = typoDone || s[native].length < 6 ? s[native] : s[native].slice(0, -2) + s[native].slice(-1); typoDone = true;
        ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      } else if (k === 'blank') {
        const opts = $$('.step .opt'), shown = opts.map(text).sort().join('|');
        const tr = st.querySelector('.prompt .muted').textContent;
        const f = pool.flatMap(l => l.fill_blank.map(I)).find(f => (f.translation || '') === tr && (f.options || []).slice().sort().join('|') === shown);
        ok(f, `${label}: blank found`);
        opts.find(o => text(o) === f.answer).click();
        ok(st.querySelector('.slot').textContent === f.answer, `${label}: slot filled`);
      } else if (k === 'dialogue') {
        const line = st.querySelector('.line'); line.click(); ok(line.classList.contains('open'), `${label}: dialogue line reveals translation`);
      }
      const graded = go.textContent === T.check;
      ok(!go.disabled, `${label}: ${k} ready`);
      key('Enter');
      if (graded) {
        ok($('.foot').classList.contains(expect), `${label}: ${k} footer ${expect} (got ${$('.foot').className}: ${$('.msg').textContent})`);
        key('Enter');
      }
      await sleep(1);
    }
    ok($('.step[data-step="complete"]'), `${label}: reached complete screen`);
    return { n, retries, kinds };
  }

  // lesson 1
  $('.node.next').click(); $('.pop .btn').click(); await sleep(5);
  const r1 = await play('lesson1', true, [lessons[0]]);
  const fresh = r1.n - r1.retries;
  console.log(`lesson 1: ${fresh} steps + ${r1.retries} re-asks; kinds: ${[...r1.kinds].join(',')}`);
  ok(fresh >= 12 && fresh <= 16, 'lesson has 12-16 steps');
  ok(r1.retries === 1, 'wrong answer re-asked once');
  ['tip', 'new', 'mc', 'match', 'build', 'type', 'blank', 'dialogue'].forEach(k => ok(r1.kinds.has(k), 'lesson includes ' + k));
  ok(REDUCED ? !$('.confetti') : $('.confetti'), 'confetti only without reduced motion');
  ok(w.__calls.osc > 0, 'sounds synthesized');
  if (REDUCED) ok(+$('.tile .v').textContent.slice(1) > 10, 'XP shown at once with reduced motion');
  await sleep(1000);
  ok(REDUCED || w.__calls.draw > 100, 'confetti drawn');
  ok(/^\+\d+$/.test($('.tile .v').textContent) && +$('.tile .v').textContent.slice(1) > 10, 'XP counted up: ' + $('.tile .v').textContent);
  ok($$('.tile')[1].textContent.match(/\d+%/), 'accuracy shown');
  key('Enter'); await sleep(5);
  ok($('.path'), 'back home after complete');
  const pr = () => JSON.parse(w.localStorage.getItem('yarya_progress_v1')).dirs[native];
  if (mode === 'http') {
    ok(pr().done[lessons[0].id], 'lesson 1 stored as done');
    ok(pr().xp > 17 && pr().games.duo.xp === pr().xp, 'xp stored (on top of the migrated 7)');
    ok(pr().streak.n === 4, 'streak bumped to 4');
    ok(pr().mistakes.length === 1, 'mistake stored');
    const recs = Object.values(pr().items), graded = recs.reduce((a, r) => a + r.correct + r.wrong, 0);
    ok(graded === pr().games.duo.answers && graded >= 8, 'every answer recorded in the shared model: ' + graded);
    ok(lessons[0].words.some(id => pr().items[id] && pr().items[id].seen), 'new words marked seen');
    ok($$('.node')[0].classList.contains('done') && $$('.node')[1].classList.contains('next'), 'node 1 gold, node 2 next');
    ok($('.practice'), 'practice mistakes card shown');
    const mpool = pr().mistakes.map(m => lessons.find(l => l.id === m.lesson));
    $('.practice .btn').click(); await sleep(5);
    const r2 = await play('practice', false, mpool);
    ok(r2.n === 1, 'practice has the one mistake');
    key('Enter'); await sleep(5);
    ok(pr().mistakes.length === 0 && !$('.practice'), 'mistake cleared after practice');
    // second lesson works too
    $('.node.next').click(); $('.pop .btn').click(); await sleep(5);
    await play('lesson2', false, [lessons[1]]); key('Enter'); await sleep(5);
  }
  ok(!$('body').innerHTML.includes('undefined'), 'no "undefined" text rendered');
  ok(errors.length === 0, 'no page errors:\n' + errors.join('\n'));
  console.log(`OK ${native} ${mode} ${motion}`);
  w.close();
})().catch(e => { if (!process.exitCode) { console.error(e); process.exitCode = 1; } if (errors.length) console.error(errors.join('\n')); });
