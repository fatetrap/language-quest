// Smoke test for course/quest/index.html in jsdom: picks a direction, onboarding, plays the first encounter to victory,
// the second to defeat and retries it, checks that the lessons app (course/index.html) sees the quest's progress and
// that words known from the app are skipped in the quest; then a timer timeout and the toggles.
// Usage: node quest_smoke.js <en|mn> <file|http> [reduced]
// Uses course/db/content.js when it is built, else the small fixture course (quest_fixture_db.js).
// Exits non-zero on any failed check or uncaught page error.
const fs = require('fs'), path = require('path'), os = require('os');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const [native = 'en', mode = 'http', motion = ''] = process.argv.slice(2);
const REDUCED = motion === 'reduced', HTTP = mode === 'http';
const tg = native === 'en' ? 'mn' : 'en';
const ROOT = path.resolve(__dirname, '..');
const REAL = path.join(ROOT, 'course', 'db', 'content.js');
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'yarya-quest-'));
process.on('exit', () => { try { fs.rmSync(site, { recursive: true, force: true }); } catch (e) {} });   // the copy holds the 20 MB DB
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(site, to)), { recursive: true }); fs.copyFileSync(from, path.join(site, to)); };
for (const f of ['index.html', 'quest/index.html', 'quest/campaign.js', 'quest/pixel.js', 'quest/chip.js', 'quest/assets/fonts.js', 'shared/progress.js', 'shared/exercises.js']) copy(path.join(ROOT, 'course', f), f);
copy(fs.existsSync(REAL) ? REAL : path.join(__dirname, 'quest_fixture_db.js'), 'db/content.js');
const STORY = path.join(ROOT, 'course', 'db', 'story.js'), HAS_STORY = fs.existsSync(STORY);
if (HAS_STORY) copy(STORY, 'db/story.js');

const errors = [];
const fail = m => { console.error('FAIL:', m, errors.join('\n')); process.exitCode = 1; throw new Error(m); };
const ok = (c, m) => { if (!c) fail(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.stack || e.message); });
vc.on('error', e => errors.push(String(e)));
const local = requestInterceptor(request => {
  const u = new URL(request.url);
  if (u.hostname !== 'yarya.test') { errors.push('network request: ' + request.url); return new Response('', { status: 404 }); }
  return new Response(fs.readFileSync(path.join(site, u.pathname)), { headers: { 'content-type': 'text/javascript' } });
});

// one page = one window; `storage` (key -> string) is copied in before the scripts run, like two apps on one computer
async function load(page, storage = {}) {
  const opts = { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.addEventListener('error', e => errors.push('page error: ' + (e.error && e.error.stack || e.message)));
      const calls = w.__calls = { osc: 0 };
      const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
      w.AudioContext = class { constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
        createOscillator() { calls.osc++; return { frequency: param(), connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: param(), connect() {} }; } };
      w.matchMedia = q => ({ matches: REDUCED && /reduce/.test(q), addListener() {}, addEventListener() {} });
      try { for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v); } catch (e) {}
    } };
  let dom;
  if (!HTTP) dom = await JSDOM.fromFile(path.join(site, page), { ...opts, resources: 'usable' });
  else dom = new JSDOM(fs.readFileSync(path.join(site, page), 'utf8'), { ...opts, url: 'http://yarya.test/' + page, resources: { interceptors: [local] } });
  await new Promise(r => dom.window.addEventListener('load', r));
  await sleep(20);
  return dom;
}
const dump = w => { const o = {}; try { for (let k = 0; k < w.localStorage.length; k++) { const key = w.localStorage.key(k); o[key] = w.localStorage.getItem(key); } } catch (e) {} return o; };
const toks = s => (s || '').split(/\s+/).map(x => x.replace(/^[.,!?;:"“”„«»()'’]+|[.,!?;:"“”„«»()]+$/g, '')).filter(Boolean);
const norm = s => (s || '').toLowerCase().replace(/[.,!?;:"“”„«»()—–\-'’]/g, ' ').replace(/\s+/g, ' ').trim();

// plays the current fight until the victory / defeat overlay. wrong = answer every round wrong
async function play(w, label, wrong) {
  const d = w.document, $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)], C = w.YARYA_DB, I = Object.values(C.items);
  const key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const stats = { teach: 0, story: 0, typed: 0, kinds: new Set(), rounds: 0, wrong: 0, firstKind: null, hits: 0 };
  for (let n = 0; n < 300; n++) {
    if ($('.over')) break;
    const cons = $('.console'), k = cons && cons.getAttribute('data-round');
    ok(k, `${label}: console state at step ${n}`);
    // the story is typed out: the first Enter shows all of it, the next one moves on
    if (k === 'story' && $('.board [data-typing]')) { stats.typed++; key('Enter'); await sleep(1); ok(!$('.board [data-typing]'), `${label}: Enter finishes the typewriter`); continue; }
    if (k === 'story') { stats.story++; ok($('.console .got'), `${label}: story step has a button`); key('Enter'); await sleep(1); continue; }
    if (!stats.firstKind) stats.firstKind = k;
    if (k === 'teach') { stats.teach++; key('Enter'); await sleep(1); continue; }
    if (k === 'next') { key('Enter'); await sleep(1); continue; }
    if (k === 'end') { await sleep(500); continue; }
    stats.kinds.add(k); stats.rounds++;
    const ask = $$('.say.ask').pop(), big = ask.querySelector('.big'), p = big ? big.textContent : '';
    ok(ask.getAttribute('data-t') === k, `${label}: opponent asks a ${k} round`);
    const hpBefore = $('.hp').getAttribute('aria-valuenow');
    if (k === 'mc') {
      const v = I.find(v => v.type === 'word' && (v[tg] === p || v[native] === p));
      ok(v, `${label}: mc prompt is a DB word: ${p}`);
      const want = v[tg] === p ? v[native] : v[tg], opts = $$('.console .opt .tx').map(x => x.textContent);
      let idx = opts.findIndex(o => norm(o) === norm(want));
      ok(idx >= 0, `${label}: mc answer among options`);
      if (wrong) idx = (idx + 1) % opts.length;
      key(String(idx + 1));
    } else if (k === 'blank') {
      const tr = ask.querySelector('.tr').textContent, opts = $$('.console .opt .tx').map(x => x.textContent);
      const f = I.find(f => f.type === 'blank' && (f.translation || '') === tr && f.options.slice().sort().join('|') === opts.slice().sort().join('|'));
      ok(f, `${label}: blank found`);
      let idx = opts.indexOf(f.answer); if (wrong) idx = (idx + 1) % opts.length;
      $$('.console .opt')[idx].click();
    } else if (k === 'build') {
      const s = I.find(s => s.type === 'sentence' && s[native] === p);
      ok(s, `${label}: build sentence found: ${p}`);
      const pickW = w2 => $$('.bank .chip').find(c => c.getAttribute('data-w') === w2 && !c.classList.contains('used')).click();
      const words = toks(s[tg]);
      ok($('.console .strike').disabled, `${label}: answer disabled before picking`);
      pickW(words[0]); key('Backspace'); ok(!$('.answer .chip'), `${label}: Backspace gives the chip back`);
      (wrong ? words.slice(0, 1).concat(words.length > 1 ? [] : ['?']).filter(x => x !== '?') : words).forEach(pickW);
      if (wrong && words.length === 1) $$('.bank .chip').find(c => !c.classList.contains('used') && c.getAttribute('data-w') !== words[0]).click();
      key('Enter');
    } else if (k === 'type') {
      const s = I.find(s => s.type === 'sentence' && s[tg] === p);
      ok(s, `${label}: type sentence found: ${p}`);
      const ta = $('.console textarea'); ta.value = wrong ? 'zzz qqq' : s[native];
      ta.dispatchEvent(new w.Event('input', { bubbles: true }));
      key('Enter');
    } else if (k === 'match') {
      const L = $$('.match .col')[0].querySelectorAll('.opt'), R = [...$$('.match .col')[1].querySelectorAll('.opt')];
      if (wrong) { L[0].click(); R.find(r => r.getAttribute('data-id') !== L[0].getAttribute('data-id') && !w.Yarya.ex.match([L[0].getAttribute('data-id'), r.getAttribute('data-id')]).isPair(L[0].getAttribute('data-id'), r.getAttribute('data-id'))).click(); }
      if (!$('.over') && $('.console').getAttribute('data-round') === 'match')
        for (const lb of L) { if (lb.disabled) continue; const id = lb.getAttribute('data-id'); lb.click(); R.find(r => r.getAttribute('data-id') === id && !r.disabled).click(); }
    }
    await sleep(1);

    if (wrong) { stats.wrong++; ok(+$('.hp').getAttribute('aria-valuenow') < +hpBefore || $('.over') || k === 'match', `${label}: integrity drops on a wrong ${k}`); }
    if (wrong && !REDUCED && $('.fight.hit')) stats.hits++;
    if (!$('.over') && !wrong) ok($('.verdict.ok'), `${label}: ${k} answered right (${($('.verdict') || {}).textContent})`);
  }
  await sleep(REDUCED ? 20 : 600);
  ok($('.over'), `${label}: reached the end overlay`);
  return stats;
}

(async () => {
  // ---------- quest, first visit: chooser, onboarding, camp ----------
  let dom = await load('quest/index.html'), w = dom.window, d = w.document;
  let $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  let key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const C = w.YARYA_DB;
  ok(C && w.Yarya.progress && w.Yarya.ex && w.Yarya.quest, 'db + shared modules + campaign loaded');
  const camp = w.Yarya.quest.campaign();
  ok(camp.length >= 3 && camp[0].kind === 'duel' && camp.some(e => e.kind === 'boss'), 'campaign of duels with level bosses');
  const choices = $$('.choose button');
  ok(choices.length === 2 && choices[0].textContent.includes('I speak English') && choices[1].textContent.includes('Би монголоор ярьдаг'), 'language chooser');
  choices[native === 'en' ? 0 : 1].click(); await sleep(5);
  ok(d.documentElement.lang === native, 'page language = native');
  ok($('.onb') && $('.onb h2'), 'onboarding shown on the first visit');
  for (let k = 0; k < 4; k++) { ok($('.onb .card').getAttribute('data-slide') === String(k), 'onboarding slide ' + k); key('Enter'); await sleep(2); }
  ok(!$('.onb') && $('.hero'), 'camp after onboarding');
  ok($('.hero').getAttribute('data-enc') === camp[0].id, 'starts from the very beginning: ' + camp[0].id);
  ok($('.hero .fight-go').textContent.includes(native === 'en' ? 'Fight' : 'Тулалдах'), 'UI in the player\'s language');
  ok($$('.enc').length > 0 && $('.enc.next').getAttribute('data-id') === camp[0].id && $$('.enc.locked').length > 0, 'trail: next + locked encounters');
  const chs = w.Yarya.quest.chapters();
  if (chs.length > 1) {
    ok($$('.enc').length === chs[0].to - chs[0].from + 1 && $$('.lvsum').length === chs.length - 1, 'camp draws only the current chapter');
    const n0 = $$('.enc').length; $('.lvsum').click(); ok($$('.enc').length > n0 && $$('.lvsum').length === chs.length - 2, 'another chapter opens on click');
  }
  ok($('a.applink').getAttribute('href') === '../index.html' && $('a.applink-top').getAttribute('href') === '../index.html', 'links back to the lessons app');
  // toggles: theme cycles, mute flips, timer flips (and back)
  const ib = () => $$('.top .ibtn');
  const th = ib().find(b => b.textContent === '◐');
  th.click(); ok(d.documentElement.getAttribute('data-theme') === 'light', 'theme -> light');
  th.click(); ok(d.documentElement.getAttribute('data-theme') === 'dark', 'theme -> dark');
  th.click(); ok(!d.documentElement.hasAttribute('data-theme'), 'theme -> auto');
  const mute = ib()[0]; mute.click(); ok(mute.getAttribute('aria-pressed') === 'false', 'muted'); mute.click();

  // ---------- encounter 1: teach, then duel to victory ----------
  $('.hero .fight-go').click(); await sleep(5);
  ok($('.fight') && $('.hud .hp') && $('.arena .scene canvas') && $$('.stage .spr').length === 2, 'fight screen with HUD, pixel scene and both fighters');
  const story1 = w.Yarya.quest.story(camp[0], native);
  ok(!HAS_STORY || (w.YARYA_STORY && story1.own), 'db/story.js loaded: the lesson has its own characters');
  ok($('.story') && $('.story').textContent.includes(story1.intro.slice(0, 20)) && $('.console').getAttribute('data-round') === 'story', 'story intro in the player\'s language');
  ok($('.stage .bubble').textContent.length > 0 && $('.stage .plate').textContent === story1.who && $('.opp .nm').textContent === story1.who, 'the opponent speaks in the bubble');
  const lg = w.Yarya.ex.lesson(camp[0].lesson).grammar;
  ok(!lg || ($('.tip summary .gt') && !$('.tip').open), 'grammar as one closed line with "more"');
  const e1 = camp[0], s1 = await play(w, 'enc1', false);
  console.log(`enc1: ${s1.teach} taught, ${s1.rounds} rounds, kinds ${[...s1.kinds].join(',')}`);
  ok(s1.story === 1 && s1.firstKind === 'teach' && s1.teach === e1.words.length, 'story, then every new word first');
  ok(REDUCED ? s1.typed === 0 : s1.typed === 1, 'story typed out (instantly with reduced motion)');
  ok(s1.kinds.has('mc') && s1.kinds.size >= 2, 'more than multiple choice');
  ok(!$('.timer'), 'no time pressure in the first encounter');
  ok($('.over.victory'), 'victory overlay');
  ok($('.over p.line').textContent === (story1.win || ''), 'story win line on the victory overlay (' + e1.parts + ' parts)');
  ok($('.over h1').getAttribute('data-text') === $('.over h1').textContent, 'glitch title');
  ok(w.__calls.osc > 0, 'sounds synthesized');
  const P = w.Yarya.progress;
  ok(e1.words.every(id => P.mastery(id).correct >= 1), 'answers recorded in the shared progress');
  ok(P.gameStats('quest').answers >= s1.rounds && P.xp() > 0, 'quest stats + XP');
  // ---------- encounter 2: everything wrong -> defeat -> retry keeps the learned words ----------
  key('Enter'); await sleep(5);
  const e2 = camp[1];
  ok($('.fight').getAttribute('data-enc') === e2.id, 'victory -> next encounter');
  const s2 = await play(w, 'enc2', true);
  ok($('.over.defeat'), 'defeat overlay: integrity broken');
  ok(+$('.hp').getAttribute('aria-valuenow') === 0, 'integrity at 0');
  ok(REDUCED ? s2.hits === 0 : s2.hits > 0, 'screen shake only without reduced motion');
  const seen2 = e2.words.filter(id => P.mastery(id).seen > 0);
  ok(seen2.length === e2.words.filter(id => !P.mastery(id).known).length, 'words of the lost fight stay learned (seen)');
  ok(P.mistakes().length > 0, 'wrong answers are mistakes in the shared model');
  $('.over .btn').click(); await sleep(5);
  ok($('.fight').getAttribute('data-enc') === e2.id && $('.console').getAttribute('data-round') !== 'teach', 'retry skips the teaching cards');
  ok(!e2.words.length || $$('.sys').some(x => x.textContent.includes(native === 'en' ? 'Remember' : 'Санаарай')), 'retry recaps the words');
  key('Escape'); ok($('.modal'), 'Esc asks to retreat'); key('Escape'); ok(!$('.modal'), 'Esc again keeps fighting');
  key('Escape'); $$('.modal .btn')[1].click(); await sleep(5); ok($('.hero'), 'retreat -> camp');
  ok($('.hero').getAttribute('data-enc') === e2.id, 'camp: the lost encounter is next');
  ok(!d.body.innerHTML.includes('undefined'), 'no "undefined" text rendered');
  const xpQuest = P.xp(), store1 = dump(w);
  w.close();

  // ---------- the lessons app sees the quest's progress ----------
  dom = await load('index.html', store1); w = dom.window; d = w.document; $ = s => d.querySelector(s);
  if (HTTP) {
    ok($('.top') && $('.pill.xp').textContent === '★ ' + xpQuest, 'lessons app shows the quest XP');
    ok(w.Yarya.progress.gameStats('quest').answers > 0, 'lessons app sees the quest answers');
    ok($('.practice'), 'lessons app offers to practise the quest mistakes');
    ok(e1.words.every(id => w.Yarya.progress.mastery(id).seen > 0), 'lessons app sees the words learned in the quest');
  } else ok($('.splash') || $('.top'), 'lessons app loads (no storage on file://)');
  if (!HTTP) { const b = d.querySelectorAll('.choose button')[native === 'en' ? 0 : 1]; if (b) { b.click(); await sleep(5); } }
  ok($('.questcard a.btn') && $('.questcard a.btn').getAttribute('href') === 'quest/index.html', 'lessons home has the Quest entry');
  // the player learns the words of encounters 2 + 3 in the app (two right answers = known)
  const AP = w.Yarya.progress, appKnown = [...camp[1].words, ...camp[2].words];
  appKnown.forEach(id => { AP.record(id, true, { game: 'duo', t: 'mc' }); AP.record(id, true, { game: 'duo', t: 'mc' }); });
  const store2 = dump(w);
  w.close();

  if (HTTP) {
    // ---------- back in the quest: what the app taught is skipped ----------
    dom = await load('quest/index.html', store2); w = dom.window; d = w.document; $ = s => d.querySelector(s); $$ = s => [...d.querySelectorAll(s)];
    key = k => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    ok(!$('.onb') && $('.hero'), 'returning player goes straight to camp');
    const nx = w.Yarya.quest.state(JSON.parse(w.localStorage.getItem('quest_' + native)).won).next;
    ok(nx.index >= 3 && $('.hero').getAttribute('data-enc') === nx.id, 'known encounters skipped: next is ' + nx.id);
    ok($(`.enc[data-id="${camp[1].id}"]`).classList.contains('known') && $('.note.skipped'), 'skipped encounters marked as known');
    // ---------- time pressure from encounter 4 on: a timeout costs integrity ----------
    $('.hero .fight-go').click(); await sleep(5);
    for (let n = 0; n < 20 && ['teach', 'story'].includes($('.console').getAttribute('data-round')); n++) { key('Enter'); await sleep(1); }
    ok($('.timer'), 'timer shown in later encounters');
    const now = w.Date.now, hp0 = +$('.hp').getAttribute('aria-valuenow');
    w.Date.now = () => now.call(w.Date) + 3600e3; await sleep(250); w.Date.now = now;
    ok($('.verdict.no') && $$('.sys').some(x => x.textContent.includes(native === 'en' ? 'Too slow' : 'Хэтэрхий удаан')), 'timeout = wrong answer');
    ok(+$('.hp').getAttribute('aria-valuenow') < hp0, 'timeout costs integrity');
    // ---------- every kind of round once (fixed plan), timer off ----------
    w.Yarya.store.set('quest_timer', false);
    const Q = w.Yarya.quest, realPlan = Q.plan, I = id => w.YARYA_DB.items[id], L1 = w.YARYA_DB.lessons.filter(l => l.written);
    const sent = L1.flatMap(l => l.sentences).find(id => I(id).en && I(id).mn), word = L1[0].words[0];
    const blank = L1.flatMap(l => l.fill_blank).find(id => w.Yarya.ex.blankOk(id, { native }));
    Q.plan = () => ({ teach: [], recap: [], rounds: [{ t: 'type', id: sent, lid: I(sent).lesson }, { t: 'build', id: sent, lid: I(sent).lesson },
      { t: 'mc', id: word, rev: true, lid: I(word).lesson }, { t: 'match', items: L1[0].words.slice(0, 4), lid: L1[0].id },
      ...(blank ? [{ t: 'blank', id: blank, lid: I(blank).lesson }] : [])] });
    w.eval('timerOn = false; fight(Yarya.quest.campaign()[0])'); await sleep(5);
    const s3 = await play(w, 'kinds', false); Q.plan = realPlan;
    ok(['type', 'build', 'mc', 'match'].every(k => s3.kinds.has(k)) && (!blank || s3.kinds.has('blank')), 'all round kinds playable: ' + [...s3.kinds]);
    ok($('.over.victory'), 'fixed plan won');
    // ---------- the level boss: harder hits, plays to victory ----------
    const bossE = Q.campaign().find(e => e.kind === 'boss');
    w.eval(`fight(Yarya.quest.campaign()[${bossE.index}])`); await sleep(5);
    ok($('.fight.boss') && $('.opp .nm').textContent === bossE.scene[native].who, 'boss fight: ' + bossE.scene[native].who);
    ok(Q.rules(bossE).damage > Q.rules(camp[0]).damage, 'bosses hit harder');
    const sb = await play(w, 'boss', false);
    ok($('.over.victory') && sb.rounds >= 5, 'boss beaten in ' + sb.rounds + ' rounds');
    ok(JSON.parse(w.localStorage.getItem('quest_' + native)).won[bossE.id], 'boss stored as won');
    ok(!d.body.innerHTML.includes('undefined'), 'no "undefined" text rendered (later fights)');
    w.close();
  }
  ok(errors.length === 0, 'no page errors:\n' + errors.join('\n'));
  console.log(`OK ${native} ${mode} ${motion}`);
})().catch(e => { if (!process.exitCode) { console.error(e); process.exitCode = 1; } if (errors.length) console.error(errors.join('\n')); });
