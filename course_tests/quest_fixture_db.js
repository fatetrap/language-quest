// A small course in the YARYA_DB schema (version 1, see course/db/README.md) for the quest tests, used when the
// real DB (course/db/content.js, built by build_db.py) is not there. 3 units over 2 levels, one unwritten lesson,
// a word that comes back in a later lesson, blanks in both languages. Loads as a browser script or a node module.
(function () {
  const U = [
    ['u01', 'A1', 'Greetings and introductions', 'Мэндчилгээ, танилцуулга', ['greetings', 'introductions'], [
      ['u01l1', 'Hello!', 'Сайн байна уу!', [
        ['Сайн байна уу', 'hello', 'Sain baina uu', 'phrase'], ['баярлалаа', 'thank you', 'bayarlalaa', 'phrase'],
        ['баяртай', 'goodbye', 'bayartai', 'phrase'], ['тийм', 'yes', 'tiim', 'particle'], ['үгүй', 'no', 'ügüi', 'particle'],
        ['уучлаарай', 'sorry', 'uuchlaarai', 'phrase']],
       [['Сайн байна уу?', 'Hello, how are you?', 'Sain baina uu?'], ['Баярлалаа, баяртай.', 'Thank you, goodbye.', 'Bayarlalaa, bayartai.'],
        ['Тийм, баярлалаа.', 'Yes, thank you.', 'Tiim, bayarlalaa.'], ['Үгүй, уучлаарай.', 'No, sorry.', 'Ügüi, uuchlaarai.']],
       [['mn', '___ байна уу?', 'Сайн', ['Сайн', 'Тийм', 'Үгүй'], 'Hello?'], ['en', 'Thank ___.', 'you', ['you', 'yes', 'no'], 'Баярлалаа.']]],
      ['u01l2', 'My name is...', 'Миний нэр...', [
        ['нэр', 'name', 'ner', 'noun'], ['би', 'I', 'bi', 'pronoun'], ['та', 'you', 'ta', 'pronoun'], ['миний', 'my', 'minii', 'pronoun']],
       [['Миний нэр Бат.', 'My name is Bat.', 'Minii ner Bat.'], ['Би Бат.', 'I am Bat.', 'Bi Bat.'], ['Таны нэр хэн бэ?', 'What is your name?', 'Tanii ner khen be?']],
       [['mn', 'Миний ___ Бат.', 'нэр', ['нэр', 'би', 'та'], 'My name is Bat.'], ['en', 'My ___ is Bat.', 'name', ['name', 'I', 'you'], 'Миний нэр Бат.']]]]],
    ['u02', 'A1', 'Taxi and numbers', 'Такси, тоо', ['taxi', 'numbers'], [
      ['u02l1', 'One, two, three', 'Нэг, хоёр, гурав', [
        ['нэг', 'one', 'neg', 'number'], ['хоёр', 'two', 'khoyor', 'number'], ['гурав', 'three', 'gurav', 'number'],
        ['дөрөв', 'four', 'döröv', 'number'], ['тав', 'five', 'tav', 'number'], ['би', 'I', 'bi', 'pronoun']],
       [['Нэг, хоёр, гурав.', 'One, two, three.', 'Neg, khoyor, gurav.'], ['Хоёр такси.', 'Two taxis.', 'Khoyor taksi.']],
       [['mn', 'Нэг, ___, гурав.', 'хоёр', ['хоёр', 'тав', 'нэг'], 'One, two, three.']]],
      ['u02l2', 'Directions', 'Чиглэл', null, [], []]]],
    ['u03', 'A2', 'At the market', 'Зах дээр', ['market', 'shopping'], [
      ['u03l1', 'How much?', 'Хэд вэ?', [
        ['үнэ', 'price', 'üne', 'noun'], ['хямд', 'cheap', 'khyamd', 'adjective'], ['үнэтэй', 'expensive', 'ünetei', 'adjective'],
        ['мөнгө', 'money', 'möngö', 'noun']],
       [['Энэ хэд вэ?', 'How much is this?', 'Ene khed ve?'], ['Энэ хямд.', 'This is cheap.', 'Ene khyamd.']],
       [['en', 'This is ___.', 'cheap', ['cheap', 'money', 'price'], 'Энэ хямд.']]]]]
  ];
  const db = { version: 1, title_en: 'Yarya test course', title_mn: 'Ярья туршилтын курс', stats: { lessons: 4, planned_lessons: 5, words: 18, sentences: 11, exercises: 60, fixes: 0, avg_review_rating: null, minutes: 1, cost_usd: 0, updated: 'test' },
    units: [], lessons: [], items: {} };
  let order = 0, lorder = 0;
  const byMn = {};
  const add = (it, l) => { it.order = order++; it.level = l.level; it.unit = l.unit; it.lesson = l.id; it.lessons = [l.id]; it.topics = l.topics.slice(); db.items[it.id] = it; return it.id; };
  for (const [uid, level, te, tm, topics, lessons] of U) {
    const u = { id: uid, level, title_en: te, title_mn: tm, scope: te, order: db.units.length, topics, lessons: [] };
    db.units.push(u);
    for (const [lid, lte, ltm, words, sents, blanks] of lessons) {
      const l = { id: lid, unit: uid, level, order: lorder++, title_en: lte, title_mn: ltm, focus: lte, topics: [...topics, lte.toLowerCase()],
        written: !!words, words: [], sentences: [], fill_blank: [], dialogue: null, grammar: null, culture: null };
      u.lessons.push(lid); db.lessons.push(l);
      if (!words) continue;
      l.intro_en = 'In this lesson: ' + lte; l.intro_mn = 'Энэ хичээлээр: ' + ltm;
      words.forEach(([mn, en, lat, pos], i) => {
        const k = mn.toLowerCase();
        if (byMn[k]) { const it = db.items[byMn[k]]; it.lessons.push(lid); it.refs.push({ lesson: lid, i }); l.words.push(it.id); return; }
        byMn[k] = add({ id: `w:${lid}:${i}`, type: 'word', mn, en, alt_en: [], pos, mn_latin: lat, example_mn: '', example_en: '', refs: [{ lesson: lid, i }] }, l);
        l.words.push(byMn[k]);
      });
      sents.forEach(([mn, en, lat], i) => l.sentences.push(add({ id: `s:${lid}:${i}`, type: 'sentence', mn, en, alt_mn: [], alt_en: [], mn_latin: lat }, l)));
      blanks.forEach(([lang, text, answer, options, translation], i) => l.fill_blank.push(add({ id: `f:${lid}:${i}`, type: 'blank', lang, text, answer,
        options, translation, explain_en: 'The missing word is ' + answer + '.', explain_mn: 'Дутуу үг: ' + answer + '.', mn_latin: '' }, l)));
      l.dialogue = add({ id: `d:${lid}`, type: 'dialogue', mn_latin: '', lines: sents.map(([mn, en, lat], i) => ({ speaker: i % 2 ? 'Saraa' : 'Bat', mn, en, mn_latin: lat })) }, l);
      l.grammar = add({ id: `g:${lid}`, type: 'grammar', mn_latin: '', title_en: 'Word order', title_mn: 'Үгийн дараалал',
        explain_en: 'The verb comes last.', explain_mn: 'Үйл үг төгсгөлд орно.', examples: [{ mn: sents[0][0], en: sents[0][1], mn_latin: sents[0][2] }] }, l);
    }
  }
  if (typeof window !== 'undefined') window.YARYA_DB = db;
  if (typeof module !== 'undefined') module.exports = db;
})();
