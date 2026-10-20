/* Yarya Quest campaign: turns the course (window.YARYA_DB) into a chain of survival encounters.
   Plain script, no modules: load after db/content.js, shared/progress.js and shared/exercises.js.
   No UI here (quest/index.html draws everything); this file only decides WHAT is played, so it can be unit tested.
     Yarya.quest.campaign()          [{ id, kind: 'duel'|'boss', index, level, unit, ui, lesson, part, parts,
                                        words, again, sentences, blanks, scene }]   course order, built once per DB
       duel  e:<lesson>:<part>       a few new words of one lesson (CHUNK) + that lesson's sentences / blanks
       boss  b:<level>               after the level's last duel (levels may interleave): the level's items, weakest first
     Yarya.quest.chapters()          [{ level, from, to }]   runs of encounters of one level (the camp shows one at a time)
     Yarya.quest.story(e, native)    -> { art, place, who, role, intro, teach, win, lose }   the lesson's own characters
                                        and lines (db/story.js, window.YARYA_STORY), else the unit scene's
     Yarya.quest.state(won)          -> { next, open(e), status(e) }   status: won | known | open | locked
     Yarya.quest.plan(e, { retry })  -> { teach, recap, rounds: [{ t: mc|match|build|type|blank, id|items, rev, lid, n, review }] }
     Yarya.quest.rules(e)            -> { damage, heal, healEvery, time (s per round, 0 = no timer), xp }
   Words the learner already knows (from any game, Yarya.progress) are not taught again: a duel whose words are all
   known is skipped ('known'), a duel with some known words only teaches the rest. Bosses are always fought.
   Story text (scenes, characters, quotes) is in the learner's native language: en = an English speaker surviving in
   Mongolia, mn = a Mongolian speaker surviving abroad. */
(function () {
  'use strict';
  const Y = window.Yarya = window.Yarya || {};
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], CHUNK = 4, GENTLE = 3;
  const lvIx = lv => Math.max(0, LEVELS.indexOf(lv));
  const db = () => window.YARYA_DB || { units: [], lessons: [], items: {} };
  const X = () => Y.ex, P = () => Y.progress;
  const item = id => db().items[id] || null;
  const uniq = a => [...new Set(a)];
  const list = a => Array.isArray(a) ? a : [];
  const str = x => typeof x === 'string' ? x.trim() : '';
  // the content is model-written: only play items of the right type with both sides filled in
  const usable = (id, type) => { const it = item(id); return !!it && it.type === type && (type === 'blank' || (!!str(it.mn) && !!str(it.en))); };

  // ---------- story: one scene per unit (picked by the unit's topics), the guard boss at every level end ----------
  // art = which CSS/SVG backdrop quest/index.html draws; keys = topic keywords that pick the scene for a unit
  const SCENES = [
    { id: 'arrival', art: 'plane', keys: ['greet', 'hello', 'introduc', 'name', 'meet', 'arriv', 'airport', 'alphabet', 'sound', 'basic', 'polite'],
      en: { place: 'Chinggis Khaan Airport', who: 'Saraa', role: 'Border officer',
        intro: 'You step off the plane into the wind of the steppe. Officer Saraa will not stamp your passport until you can greet her properly.' },
      mn: { place: 'Лондон, Хийтроу нисэх буудал', who: 'Эмма', role: 'Хилийн офицер',
        intro: 'Онгоцноос буухад бороо шивэрч байна. Офицер Эмма таныг зөв мэндэлж сурахаас нааш паспортод тамга дарахгүй.' } },
    { id: 'taxi', art: 'car', keys: ['taxi', 'transport', 'direction', 'travel', 'car', 'bus', 'road', 'number', 'count', 'where'],
      en: { place: 'Taxi to Ulaanbaatar', who: 'Bat', role: 'Taxi driver',
        intro: 'A battered taxi, a driver who speaks no English and a long road into the city. Bargain in Mongolian, or walk.' },
      mn: { place: 'Лондонгийн хар такси', who: 'Том', role: 'Таксины жолооч',
        intro: 'Хар такси, монгол хэл огт мэдэхгүй жолооч, хот руу урт зам. Англиар тохиролц, эсвэл алхаарай.' } },
    { id: 'family', art: 'ger', keys: ['family', 'home', 'ger', 'house', 'relativ', 'people', 'parent', 'child', 'live'],
      en: { place: 'The ger of the Dorj family', who: 'Dulmaa', role: 'Grandmother',
        intro: 'Steam rises from the milk tea. Grandmother Dulmaa watches you closely: a guest who cannot talk is a guest who cannot stay.' },
      mn: { place: 'Хүлээн авагч гэр бүл', who: 'Хатагтай Смит', role: 'Гэрийн эзэгтэй',
        intro: 'Халуун цайнаас уур савсана. Хатагтай Смит таныг анхааралтай ажиглана: ярьж чадахгүй зочин удаан байж чадахгүй.' } },
    { id: 'market', art: 'stalls', keys: ['market', 'shop', 'buy', 'sell', 'price', 'money', 'cloth', 'colo', 'size'],
      en: { place: 'Narantuul Market', who: 'Oyunaa', role: 'Trader',
        intro: 'Thousands of stalls and one honest price. Oyunaa doubles it for anyone who cannot haggle in Mongolian.' },
      mn: { place: 'Камдены зах', who: 'Люси', role: 'Худалдаачин',
        intro: 'Мянга мянган лангуу, ганц шударга үнэ. Англиар наймаалцаж чадахгүй хүнд Люси үнээ хоёр дахин өсгөнө.' } },
    { id: 'food', art: 'bowl', keys: ['food', 'eat', 'drink', 'restaurant', 'meal', 'cook', 'tea', 'cafe', 'menu', 'hungry'],
      en: { place: 'The roadside guanz', who: 'Tsetseg', role: 'Cook',
        intro: 'Buuz, khuushuur, salty milk tea. Tsetseg only serves those who order in her language.' },
      mn: { place: 'Булангийн кафе', who: 'Жак', role: 'Зөөгч',
        intro: 'Кофе, сэндвич, шөл. Жак зөвхөн англиар захиалсан хүнд үйлчилнэ.' } },
    { id: 'naadam', art: 'flags', keys: ['naadam', 'festival', 'sport', 'horse', 'wrestl', 'archer', 'holiday', 'celebrat', 'game', 'hobby'],
      en: { place: 'Naadam Festival', who: 'Ganbold', role: 'Wrestler',
        intro: 'Drums, horses and wrestlers. Ganbold the champion wants to know if your tongue is as strong as your grip.' },
      mn: { place: 'Хөлбөмбөгийн цэнгэлдэх', who: 'Майк', role: 'Дасгалжуулагч',
        intro: 'Бөмбөр, хашгираан, хөлбөмбөг. Дасгалжуулагч Майк таны хэл хөл шиг чинь хурдан эсэхийг шалгана.' } },
    { id: 'steppe', art: 'hills', keys: ['weather', 'nature', 'season', 'animal', 'countryside', 'steppe', 'time', 'day', 'week', 'month', 'clock'],
      en: { place: 'The endless steppe', who: 'Tömör', role: 'Herder',
        intro: 'Nothing but grass, sky and five kinds of livestock. Tömör the herder tests travellers before he shows them the way.' },
      mn: { place: 'Шотландын өндөрлөг', who: 'Ангус', role: 'Хоньчин',
        intro: 'Өвс, тэнгэр, хонь л харагдана. Хоньчин Ангус замаа заахаасаа өмнө аялагчдыг шалгадаг.' } },
    { id: 'health', art: 'clinic', keys: ['health', 'body', 'doctor', 'hospital', 'ill', 'sick', 'feel', 'pain', 'medic'],
      en: { place: 'The district clinic', who: 'Naraa', role: 'Doctor',
        intro: 'You caught the steppe cold. Doctor Naraa can help, if you can tell her where it hurts.' },
      mn: { place: 'Эмнэлэг', who: 'Пател', role: 'Эмч',
        intro: 'Та ханиад хүрчээ. Хаана өвдөж байгаагаа англиар хэлж чадвал эмч Пател тусална.' } },
    { id: 'school', art: 'school', keys: ['work', 'job', 'school', 'study', 'office', 'educat', 'learn', 'class', 'teacher', 'profession'],
      en: { place: 'School Number One', who: 'Bold', role: 'Teacher',
        intro: 'Teacher Bold has forty pupils and no patience. Answer like a good student, or wait outside.' },
      mn: { place: 'Оффис', who: 'Сара', role: 'Менежер',
        intro: 'Менежер Сарад тэвчээр гэж байхгүй. Сайн ажилтан шиг хариул, эс бөгөөс гадаа хүлээ.' } },
    { id: 'city', art: 'city', keys: ['city', 'place', 'hotel', 'plan', 'friend', 'free', 'weekend', 'routine', 'daily', 'describ'],
      en: { place: 'Sükhbaatar Square', who: 'Anu', role: 'Student',
        intro: 'The capital never sleeps. Anu will show you the city, once you can keep up with her.' },
      mn: { place: 'Трафальгарын талбай', who: 'Хлоэ', role: 'Оюутан',
        intro: 'Нийслэл хэзээ ч унтдаггүй. Хлоэтой хөл нийлүүлж чадвал тэр танд хотоо үзүүлнэ.' } }
  ];
  const BOSS = { id: 'boss', art: 'gate', keys: [],
    en: { place: "The Khan's Camp", who: 'BATZORIG', role: "Khan's Guard",
      intro: 'BATZORIG blocks the gate of the camp. He respects only strength and the tongue of his people. Everything you learned on this level, he will test.' },
    mn: { place: 'Тауэр цайз', who: 'Сэр Эдмунд', role: 'Хааны харуул',
      intro: 'Сэр Эдмунд цайзын хаалгыг хаажээ. Тэр зөвхөн хүч чадал болон өөрийн ард түмний хэлийг хүндэтгэнэ. Энэ түвшинд сурсан бүхнийг чинь шалгана.' } };
  // what the opponent says after an answer (bosses are harsher), per native language
  const QUOTES = {
    en: { ok: ['Good.', 'Not bad, traveller.', 'You learn fast.', 'Exactly.', 'Well said.'],
      no: ['No.', 'Try again, traveller.', 'Hmm. Not quite.', 'That will cost you.', 'Wrong word.'],
      bossOk: ['Your spirit is strong.', 'The Khan would approve.', "A warrior's tongue.", 'You ride well.', 'Keep your guard up.'],
      bossNo: ['You shame your ancestors.', 'Weakness is death.', 'The wolves will eat you.', 'Silence, fool.', 'My blade is sharp.'] },
    mn: { ok: ['Сайн.', 'Муугүй шүү, аялагч аа.', 'Хурдан сурдаг юм аа.', 'Яг зөв.', 'Сайн хэллээ.'],
      no: ['Үгүй.', 'Дахиад оролдоорой.', 'Хм. Арай өөр.', 'Энэ чамд үнэтэй тусна.', 'Буруу үг.'],
      bossOk: ['Сүнс чинь хүчтэй.', 'Хаан сайшаах байх.', 'Дайчны хэл.', 'Сайн морддог юм.', 'Хамгаалалтаа бүү сулруул.'],
      bossNo: ['Өвөг дээдсээ ичээлээ.', 'Сул дорой бол үхэл.', 'Чоно чамайг идэх болно.', 'Дуугүй, тэнэг минь.', 'Миний сэлэм хурц.'] } };

  // best keyword match on the unit's topics + English title; ties and no match: the next scene not used just before
  function sceneFor(u, ui, prev) {
    const hay = [...(u.topics || []), u.title_en || '', u.scope || ''].join(' ').toLowerCase();
    let best = null, score = 0;
    for (const s of SCENES) {
      const n = s.keys.filter(k => hay.includes(k)).length;
      if (n > score || (n === score && n > 0 && best === prev)) { best = s; score = n; }
    }
    if (!best || (best === prev && score < 2)) best = ui === 0 ? SCENES[0] : SCENES[(SCENES.indexOf(prev) + 1) % SCENES.length];
    return best;
  }

  // ---------- campaign ----------
  let camp = null, campFor = null;
  function campaign() {
    const D = db();
    if (campFor === D && camp) return camp;
    const out = [], last = {}; let prev = null;
    const duels = list(D.units).map((u, ui) => {
      const scene = sceneFor(u, ui, prev), ds = []; prev = scene;
      for (const lid of list(u.lessons)) {
        const l = X().lesson(lid);
        if (!l || !l.written) continue;
        // a word is taught in the lesson where it first appears; later lessons only review it
        const all = uniq(list(l.words)).filter(id => usable(id, 'word')), fresh = all.filter(id => item(id).lesson === l.id), again = all.filter(id => !fresh.includes(id));
        const chunks = [];
        for (let i = 0; i < fresh.length; i += CHUNK) chunks.push(fresh.slice(i, i + CHUNK));
        if (chunks.length > 1 && chunks[chunks.length - 1].length < 2) chunks[chunks.length - 2].push(...chunks.pop());
        const S = uniq(list(l.sentences)).filter(id => usable(id, 'sentence')), F = uniq(list(l.fill_blank)).filter(id => usable(id, 'blank'));
        if (!chunks.length) { if (!S.length && !F.length && !again.length) continue; chunks.push([]); }
        const n = chunks.length;
        // sentences / blanks go to the later parts of the lesson (they use the lesson's words)
        const at = j => n - 1 - (j % n);
        chunks.forEach((words, k) => ds.push({ id: `e:${l.id}:${k}`, kind: 'duel', level: u.level, unit: u.id, ui, lesson: l.id,
          part: k, parts: n, words, again: k === n - 1 ? again : [], sentences: S.filter((_, j) => at(j) === k),
          blanks: F.filter((_, j) => at(j) === k), scene }));
      }
      if (ds.length) last[u.level] = ui;
      return ds;
    });
    // one boss per level, right after its last duel (B2 / C1 units interleave in the course, so not at every level change)
    list(D.units).forEach((u, ui) => {
      out.push(...duels[ui]);
      if (last[u.level] === ui) out.push({ id: 'b:' + u.level, kind: 'boss', level: u.level, unit: u.id, ui, lesson: null, part: 0, parts: 1,
        words: [], again: [], sentences: [], blanks: [], scene: BOSS });
    });
    out.forEach((e, i) => { e.index = i; });
    camp = out; campFor = D; chaps = null;
    return out;
  }
  // runs of consecutive encounters on one level (a level's boss closes its last run)
  let chaps = null;
  function chapters() {
    const C = campaign();
    if (chaps) return chaps;
    chaps = [];
    for (const e of C) {
      const c = chaps[chaps.length - 1];
      if (c && c.level === e.level) c.to = e.index; else chaps.push({ level: e.level, from: e.index, to: e.index });
    }
    return chaps;
  }

  // ---------- story: the lesson's own characters and lines (db/story.js), the unit scene when a lesson has none ----------
  // story.json scene names -> the backdrops quest/index.html draws
  const STORY_ART = { airport: 'plane', taxi: 'car', ger: 'ger', market: 'stalls', canteen: 'bowl', naadam: 'flags', steppe: 'hills',
    clinic: 'clinic', school: 'school', square: 'city' };
  // later parts of a lesson: a short line instead of the whole intro; won parts before the last one: a short line instead of `win`
  const MORE = {
    en: { cont: ['{who} is not done with you yet. More words, then another test.', '{who} raises a hand: "Wait. There is more you must know."',
        '{who} nods, but does not step aside. Part {k} of {n}.', '"Again," says {who}. "New words this time."'],
      mid: '{who} nods. Part {k} of {n} done, but the lesson goes on.' },
    mn: { cont: ['{who} таныг тавьж явуулаагүй байна. Хэдэн шинэ үг, дараа нь дахин сорилт.', '{who} гараа өргөв: "Хүлээ. Чи өөр юм мэдэх ёстой."',
        '{who} толгой дохисон ч замаа тавьсангүй. {n}-ын {k}-р хэсэг.', '"Дахиад" гэж {who} хэлэв. "Энэ удаа шинэ үгс."'],
      mid: '{who} толгой дохив. {n}-ын {k}-р хэсэг дууслаа, гэхдээ хичээл үргэлжилнэ.' } };
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, x) => o[x]);
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function story(e, native) {
    native = native === 'mn' ? 'mn' : 'en';
    const base = (e.scene || BOSS)[native], all = window.YARYA_STORY || {};
    const raw = e.lesson && all[e.lesson] && all[e.lesson][native === 'en' ? 'en2mn' : 'mn2en'];
    const s = raw && typeof raw === 'object' ? raw : {};
    const sc = SCENES.find(x => x.art === STORY_ART[str(s.scene).toLowerCase()]) || e.scene || BOSS;
    const who = str(s.npc) || base.who, k = e.part + 1, n = e.parts, o = { who, k, n };
    const last = e.part >= e.parts - 1;
    return { art: sc.art, place: sc[native].place, who, role: cap(str(s.role)) || base.role, own: !!str(s.npc),
      intro: e.part > 0 ? fill(MORE[native].cont[(e.part - 1) % MORE[native].cont.length], o) : str(s.intro) || base.intro,
      teach: e.part > 0 ? '' : str(s.teach), win: last ? str(s.win) : fill(MORE[native].mid, o), lose: str(s.lose) };
  }

  // ---------- progress through the campaign ----------
  // known = every word (or, without words, every sentence/blank) is known in the shared learner model
  function isKnown(e) {
    if (e.kind === 'boss') return false;
    const ids = e.words.length ? e.words : [...e.sentences, ...e.blanks];
    return ids.length > 0 && ids.every(id => P().mastery(id).known);
  }
  // won = { encounterId: ms } (quest's own store). next = the first encounter neither won nor known
  function state(won) {
    won = won || {};
    const C = campaign(), next = C.find(e => !won[e.id] && !isKnown(e)) || null, top = next ? next.index : C.length;
    const status = e => won[e.id] ? 'won' : isKnown(e) ? 'known' : e.index <= top ? 'open' : 'locked';
    return { next, status, open: e => status(e) !== 'locked', skipped: C.filter(e => e.index < top && !won[e.id]).length };
  }

  // ---------- difficulty: grows with the level; bosses hit harder; the first encounters have no timer ----------
  function rules(e) {
    const li = lvIx(e.level), boss = e.kind === 'boss';
    return { damage: Math.round((12 + 3 * li) * (boss ? 1.6 : 1)), heal: Math.max(4, 10 - li), healEvery: 3,
      time: !boss && e.index < GENTLE ? 0 : Math.round(Math.max(12, 30 - 3 * li) * (boss ? .85 : 1)),
      xp: boss ? 20 : 5, maxRounds: (boss ? 12 : 8) + li, options: !boss && li === 0 && e.index < GENTLE ? 3 : 4 };
  }
  // seconds for one round: reading / building / typing get more time than picking
  const timeFor = (r, t) => r.time ? Math.round(r.time * ({ mc: 1, blank: 1.2, match: 2, build: 2.2, type: 2.5 }[t] || 1)) : 0;

  // ---------- one encounter's content ----------
  // a review / boss round for any item the quest can draw: words as multiple choice, sentences built or typed,
  // blanks only when written in the target language
  function roundFor(id, li, native, extra) {
    const it = item(id); if (!it) return null;
    const lid = it.lesson, rnd = Math.random();
    if (it.type === 'word') return it.mn && it.en ? Object.assign({ t: 'mc', id, rev: rnd < .5, lid, n: 4 }, extra) : null;
    if (it.type === 'sentence') return it.mn && it.en ? Object.assign({ t: li >= 2 && rnd < .5 || li === 1 && rnd < .25 ? 'type' : 'build', id, lid }, extra) : null;
    if (it.type === 'blank') return X().blankOk(id, { native }) ? Object.assign({ t: 'blank', id, lid }, extra) : null;
    return null;
  }
  // match pairs must be told apart: no two items with the same text on either side
  function distinct(ids) {
    const seen = new Set(), out = [];
    for (const id of ids) {
      const it = item(id); if (!it) continue;
      const a = 'mn:' + X().norm(it.mn), b = 'en:' + X().norm(it.en);
      if (seen.has(a) || seen.has(b)) continue;
      seen.add(a); seen.add(b); out.push(id);
    }
    return out;
  }
  const interleave = (base, extra) => { const out = base.slice(); for (const x of extra) out.splice(1 + Math.floor(Math.random() * out.length), 0, x); return out; };
  function plan(e, opts = {}) {
    const native = opts.native || P().native() || 'en', li = lvIx(e.level), r = rules(e), m = id => P().mastery(id), sh = X().shuffle;
    const mine = new Set([...e.words, ...e.again, ...e.sentences, ...e.blanks]);
    const reviews = (n, not) => P().due(40).filter(id => !not.has(id)).map(id => roundFor(id, li, native, { review: true })).filter(Boolean).slice(0, n);
    if (e.kind === 'boss') {
      // the level's items the player has met, weakest first (never met: still fair game, they were in the level)
      const C = campaign().filter(x => x.level === e.level && x.kind === 'duel');
      const W = uniq(C.flatMap(x => x.words)), S = uniq(C.flatMap(x => x.sentences)), F = uniq(C.flatMap(x => x.blanks)).filter(id => X().blankOk(id, { native }));
      const weak = ids => sh(ids).sort((a, b) => (m(b).seen > 0) - (m(a).seen > 0) || m(a).strength - m(b).strength);
      const w = weak(W), rounds = [];
      const mw = distinct(w).slice(0, 4);
      if (mw.length >= 4) rounds.push({ t: 'match', items: mw, lid: item(mw[0]).lesson });
      w.slice(0, 6).forEach(id => rounds.push(roundFor(id, li, native)));
      weak(S).slice(0, 3).forEach(id => rounds.push(roundFor(id, li, native)));
      weak(F).slice(0, 1).forEach(id => rounds.push(roundFor(id, li, native)));
      const all = sh(rounds.filter(Boolean)).slice(0, r.maxRounds - 2);
      return { teach: [], recap: [], rounds: interleave(all, reviews(2, new Set(all.map(x => x.id)))) };
    }
    // words not known yet are taught on a card first; on a retry the ones already shown get a quick recap instead
    const fresh = e.words.filter(id => !m(id).known), known = e.words.filter(id => m(id).known);
    const teach = fresh.filter(id => !(opts.retry && m(id).seen)), recap = fresh.filter(id => !teach.includes(id));
    const mc = (id, rev) => ({ t: 'mc', id, rev, lid: e.lesson, n: r.options });
    const first = fresh.map(id => mc(id, false));                    // recognise the new word first
    // then other kinds of exercise (match, sentences, a blank: up to 3), then produce the words (pick the target word)
    const variety = [], sk = e.sentences.filter(id => !m(id).known);
    const mw = distinct(sh([...e.words, ...e.again])).slice(0, 5);
    if (fresh.length >= 3 && mw.length >= 3) variety.push({ t: 'match', items: mw, lid: e.lesson });
    (sk.length ? sk : e.sentences).slice(0, 2).map(id => roundFor(id, li, native, { lid: e.lesson })).filter(Boolean).forEach(x => variety.push(x));
    e.blanks.filter(id => X().blankOk(id, { native })).slice(0, 1).forEach(id => variety.push({ t: 'blank', id, lid: e.lesson }));
    const more = [...sh(fresh).map(id => mc(id, true)), ...sh([...known, ...e.again]).slice(0, 2).map(id => mc(id, Math.random() < .5))];
    const budget = Math.max(3, r.maxRounds - first.length), v = sh(variety).slice(0, Math.min(3, budget));
    let rounds = [...first, ...sh([...v, ...more.slice(0, budget - v.length)])];
    if (!rounds.length) rounds = e.words.map(id => mc(id, Math.random() < .5));
    return { teach, recap, rounds: interleave(rounds, reviews(2 + (li >> 1), mine)) };
  }

  Y.quest = { LEVELS, CHUNK, SCENES, BOSS, QUOTES, STORY_ART, lvIx, sceneFor, campaign, chapters, story, isKnown, state, rules, timeFor, plan, roundFor, distinct };
})();
