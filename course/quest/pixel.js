/* Yarya Quest pixel art: every sprite, backdrop and map is drawn here in code (palette-indexed strings and pixel
   rectangles -> canvas), no image files. Plain script, no modules; quest/index.html puts the canvases on screen at an
   integer scale with image-rendering: pixelated. Nothing here touches the learning logic.
     Yarya.pixel.sprite(name)                -> { w, h, frames: [canvas] } cached; null without a 2D canvas (jsdom)
     Yarya.pixel.foe(role, who, region)      -> sprite name of an opponent: archetype by role keywords + colours by name
     Yarya.pixel.scene(ctx, W, H, kind, o)   a battle backdrop; kind = campaign art key (plane, car, ger, stalls, bowl,
                                             flags, hills, clinic, school, city, gate); o = { region: 'mn'|'uk', night, t }
     Yarya.pixel.map(ctx, W, H, o)           the overworld of a chapter; o = { region, level, nodes, hero, t }
     Yarya.pixel.route(W, H, n, seed)        node positions of a chapter's route (index.html puts buttons on them)
     Yarya.pixel.animate(canvas, draw)       redraws at ~12 fps while the canvas is in the page (once without motion)
   Sprites are written as their left half and mirrored; the right end of a colour run gets the palette's shade (upper
   case letter) and every sprite gets a dark outline, so the art stays consistent and short. */
(function () {
  'use strict';
  const Y = window.Yarya = window.Yarya || {};

  // ---------- helpers ----------
  const hash = s => { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  function rng(seed) { let s = (seed >>> 0) || 7; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  const rgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * k)); };
  const dark = (c, k) => mix(c, '#140c24', k == null ? .32 : k);
  const lite = (c, k) => mix(c, '#fff8e8', k == null ? .35 : k);
  let has2d = null;
  function make(w, h) {
    if (has2d === false || typeof document === 'undefined') return null;
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext && c.getContext('2d'); has2d = !!x;
      return x ? c : null;
    } catch (e) { has2d = false; return null; }
  }
  const ok2d = () => { if (has2d === null) make(1, 1); return has2d; };

  // ---------- sprites: rows of palette letters ('.' clear), mirrored halves, auto shade + outline ----------
  const OUT = '#120a1a';
  function grid(def) {
    const g = def.rows.map(r => [...(def.mirror ? r + [...r].reverse().join('') : r)]);
    for (const [r, c, ch] of def.patch || []) if (g[r] && c < g[r].length) g[r][c] = ch;
    return g;
  }
  // light from the left: the right end of each run of one colour takes the palette's shade (the upper-case letter)
  function shade(g, pal) {
    return g.map(row => row.map((ch, x) => {
      if (ch === '.' || ch !== ch.toLowerCase() || !pal[ch.toUpperCase()]) return ch;
      let right = 0, left = 0;
      for (let k = x + 1; k < row.length && row[k] === ch; k++) right++;
      for (let k = x - 1; k >= 0 && row[k] === ch; k--) left++;
      return (right === 0 && left > 0) || (right === 1 && left > 3) ? ch.toUpperCase() : ch;
    }));
  }
  // colours per pixel (1 px clear margin for the outline); usable without a canvas
  function pixels(g, pal, outline) {
    const w = Math.max(...g.map(r => r.length)) + 2, h = g.length + 2, px = new Array(w * h).fill(null);
    g.forEach((row, y) => row.forEach((ch, x) => { if (ch !== '.' && pal[ch]) px[(y + 1) * w + x + 1] = pal[ch]; }));
    const out = px.slice();
    if (outline !== false) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (px[y * w + x]) continue;
      if ((x > 0 && px[y * w + x - 1]) || (x < w - 1 && px[y * w + x + 1]) || (y > 0 && px[(y - 1) * w + x]) || (y < h - 1 && px[(y + 1) * w + x])) out[y * w + x] = outline || OUT;
    }
    return { w, h, px: out };
  }
  function bake(g, pal, outline) {
    const b = pixels(g, pal, outline), c = make(b.w, b.h);
    if (!c) return null;
    const ctx = c.getContext('2d'), im = ctx.createImageData(b.w, b.h);
    b.px.forEach((col, i) => { if (col) { const [r, gg, bl] = rgb(col); im.data[i * 4] = r; im.data[i * 4 + 1] = gg; im.data[i * 4 + 2] = bl; im.data[i * 4 + 3] = 255; } });
    ctx.putImageData(im, 0, 0);
    return c;
  }
  // a prop as CSS box-shadow pixel art (the menu's pointing hand): "x y 0 0 colour" per pixel at `unit` px
  function shadowArt(name, unit) {
    const D = PROPS[name]; if (!D) return 'none';
    const g = grid(D), b = pixels(shade(g, D.pal), D.pal, D.outline), out = [];
    b.px.forEach((c, i) => { if (c) out.push(`${(i % b.w) * unit}px ${Math.floor(i / b.w) * unit}px 0 0 ${c}`); });
    return out.join(',');
  }
  // fill in the shades (upper case) the palette leaves out
  function pal(o) { const p = Object.assign({}, o); for (const k of Object.keys(o)) if (k === k.toLowerCase() && k !== k.toUpperCase() && !(k.toUpperCase() in o)) p[k.toUpperCase()] = dark(o[k]); return p; }

  // ---------- people: head (12 rows) + torso (8) + legs (8), left halves of a 20 px wide figure ----------
  const HEADS = {
    short: ['......hhhh', '.....hhhhh', '....hhhhhh', '....hhssss', '....hsssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    long: ['......hhhh', '.....hhhhh', '....hhhhhh', '...hhhssss', '...hhsssss', '...hhssess', '...hhssess', '...hhsssss', '...hhssssm', '...hhhssss', '...hhh..ss', '...hh...ss'],
    bun: ['........hh', '.......hhh', '.....hhhhh', '....hhhhhh', '....hhssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    cap: ['.....qqqqq', '....qqqqqg', '....QQQQQQ', '...kkkkkkk', '....hsssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    fur: ['.........r', '......qqqq', '....ffffff', '...fffffff', '...ffsssss', '...ffssess', '...ffssess', '...ffsssss', '...ffssssm', '....f.ssss', '........ss', '........ss'],
    chef: ['.....wwwww', '....wwwwww', '.....wwwww', '....WWWWWW', '....hsssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    glasses: ['......hhhh', '.....hhhhh', '....hhhhhh', '....hhssss', '....hkkkks', '....sksesk', '....skkkks', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    pony: ['......hhhh', '.....hhhhh', '....hhhhhh', '....hhssss', '....hsssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    bare: ['......hhhh', '.....hhhhh', '....hhhhhh', '....hsssss', '....sskkss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '.......sss', '.......sss'],
    flat: ['.....qqqqq', '....qqqqqq', '...qqqqqqq', '....hhssss', '....hsssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss'],
    band: ['......hhhh', '.....hhhhh', '....hhhhhh', '....rrrrrr', '....hsssss', '....sssess', '....sssess', '....ssssss', '.....ssssm', '......ssss', '........ss', '........ss']
  };
  // asymmetric bits: [row, col, letter] on the 20 px figure
  const HEAD_PATCH = { pony: [[1, 15, 'h'], [2, 16, 'h'], [2, 17, 'h'], [3, 17, 'h'], [4, 17, 'h'], [5, 18, 'h'], [6, 18, 'h'], [7, 18, 'r']],
    band: [[3, 16, 'r'], [4, 17, 'r'], [5, 17, 'r']], fur: [[0, 10, 'r']] };
  const TORSOS = {
    deel: ['....aaaatt', '...aaaaaat', '..aaaaaaaa', '..aAaaaaaa', '..aAaaaaaa', '..aAaaaaaa', '..aAgggggg', '..sAgggggg'],
    uniform: ['....aaawwt', '...aaaaawt', '..aaaaaaat', '..aAaaaaat', '..aAaaaaat', '..aAaaaaaa', '..aAgggggg', '..sAaaaaaa'],
    jacket: ['....aaaaww', '...aaaaaww', '..aaaaaaww', '..aAaaaaww', '..aAaaaaww', '..aAaaaaww', '..aAaaaaww', '..sAaaaaww'],
    apron: ['....aaaaaa', '...aaaawaa', '..aaaawwww', '..aAaawwww', '..aAaawwww', '..aAaawwww', '..aAaawwww', '..sAaawwww'],
    coat: ['....wwwwcc', '...wwwwwcc', '..wwwwwxcc', '..wWwwwxcc', '..wWwwwwxc', '..wWwwwwww', '..wWwwwwww', '..sWwwwwww'],
    zodog: ['....aaaass', '...aaaasss', '..aaaassss', '..aAaassss', '..aAaassss', '..aAaassss', '..sAssssss', '..s..sssss'],
    pack: ['....aaaaww', '...aaaaacc', '..aaaaaccc', '..aAtaaaaw', '..aAtaaaaw', '..aAtaaaaw', '..aAgggggg', '..sAaaaaaa']
  };
  const TORSO_PATCH = { deel: [[13, 10, 't'], [14, 11, 't'], [15, 12, 't'], [16, 13, 't'], [17, 13, 't']], coat: [[16, 9, 'x'], [17, 9, 'X']],
    pack: [[15, 16, 't'], [16, 16, 't'], [17, 16, 't']] };
  const LEGS = {
    robe: ['..ssaaaaaa', '...aaaaaaa', '...aaaaaaa', '...aaaaaaa', '...ttttttt', '....bbbbb.', '....bbbbb.', '...bbbbbb.'],
    pants: ['..ss.ppppp', '.....pppp.', '.....pppp.', '.....pppp.', '.....pppp.', '.....pppp.', '.....bbbb.', '....bbbbb.'],
    skirt: ['..ss.aaaaa', '....aaaaaa', '....aaaaaa', '...aaaaaaa', '.....sss..', '.....sss..', '.....bbb..', '....bbbb..'],
    briefs: ['..ss.ggggg', '.....ggggg', '.....ssss.', '.....ssss.', '.....bbbb.', '.....bbbb.', '....bbbbb.', '...bbbbbb.']
  };
  const SKIN = ['#f0b890', '#e0a070', '#c88858', '#a86c44'], HAIR = ['#2a1c18', '#181020', '#5a3820', '#3a2418'];
  const DEEL = ['#3058c0', '#b83048', '#2f8a58', '#7848a8', '#d07020', '#2088b0', '#a83878'];
  const COAT = ['#506070', '#685848', '#3a4a68', '#7a3a38', '#4a6a48', '#5a4a78'];
  // archetypes: which parts, and fixed colours (the rest varies with the opponent's name)
  const ARCH = {
    officer: { head: 'cap', torso: 'uniform', legs: 'pants', c: { a: '#2f4a90', q: '#24386e', g: '#d8b040', t: '#c02838', p: '#28345c' } },
    driver: { head: 'short', torso: 'jacket', legs: 'pants', c: { p: '#3a3a48' } },
    granny: { head: 'bun', torso: 'deel', legs: 'robe', c: { h: '#b8b0b8' } },
    elder: { head: 'fur', torso: 'deel', legs: 'robe', c: { f: '#8a6038', q: '#b02838' } },
    trader: { head: 'long', torso: 'apron', legs: 'skirt', c: { w: '#f0e8d0' } },
    cook: { head: 'chef', torso: 'apron', legs: 'pants', c: { p: '#383848' } },
    wrestler: { head: 'bare', torso: 'zodog', legs: 'briefs', c: { a: '#c02838', g: '#2858b8', b: '#a85830' } },
    doctor: { head: 'long', torso: 'coat', legs: 'pants', c: { c: '#4aa0c8', x: '#8890a0', p: '#3a4a68' } },
    teacher: { head: 'glasses', torso: 'jacket', legs: 'pants', c: { p: '#383040' } },
    student: { head: 'pony', torso: 'jacket', legs: 'pants', c: { p: '#3050a0' } },
    clerk: { head: 'long', torso: 'uniform', legs: 'skirt', c: { a: '#283850', g: '#d8b040', t: '#3a7ac8' } },
    local: { head: 'short', torso: 'deel', legs: 'robe', c: {} },
    hero: { head: 'band', torso: 'pack', legs: 'pants', c: { a: '#c83828', c: '#58a8e8', t: '#6a4020', g: '#7a5028', r: '#e8c040', p: '#304068', b: '#5a3418', h: '#3a2418', s: '#f0b890' } }
  };
  const SKINS = {
    traveler: { en: 'Traveler', mn: 'Аялагч', head: 'band', torso: 'pack', legs: 'pants', c: {} },
    nomad: { en: 'Nomad', mn: 'Нүүдэлчин', head: 'fur', torso: 'deel', legs: 'robe',
      c: { a: '#3058c0', t: '#e8b838', g: '#e8b838', q: '#b02838', f: '#8a6038', s: '#c88858', h: '#181020', b: '#5a3418' } },
    scholar: { en: 'Scholar', mn: 'Эрдэмтэн', head: 'glasses', torso: 'jacket', legs: 'pants',
      c: { a: '#7848a8', w: '#f3e5bd', p: '#283850', s: '#a86c44', h: '#2a1c18', r: '#d8b040' } },
    ranger: { en: 'Ranger', mn: 'Байгаль хамгаалагч', head: 'pony', torso: 'pack', legs: 'pants',
      c: { a: '#2f8a58', c: '#e8c040', p: '#685848', s: '#e0a070', h: '#8a4020', r: '#e8c040' } }
  };
  const skinId = id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKINS, id) ? id : 'traveler';
  const hero = id => 'hero:' + skinId(id);
  const walker = id => 'walker:' + skinId(id);
  // a role -> archetype: the head noun of the first phrase ("Taxi driver and part-time herder" -> driver)
  const ROLE_KEYS = [
    ['officer', ['officer', 'guard', 'police', 'customs', 'border', 'soldier', 'security', 'офицер', 'харуул', 'цагдаа']],
    ['granny', ['grandmother', 'grandma', 'granny', 'old woman', 'auntie', 'aunt', 'hostess', 'mother', 'landlady', 'эмээ', 'эзэгтэй', 'ээж', 'хатагтай']],
    ['elder', ['grandfather', 'grandpa', 'elder', 'herder', 'nomad', 'horse', 'shaman', 'monk', 'hunter', 'farmer', 'хоньчин', 'малчин', 'өвөө']],
    ['cook', ['cook', 'chef', 'canteen', 'waiter', 'waitress', 'barista', 'café', 'cafe', 'baker', 'тогооч', 'зөөгч']],
    ['wrestler', ['wrestler', 'champion', 'athlete', 'archer', 'jockey', 'coach', 'бөх', 'дасгалжуулагч']],
    ['doctor', ['doctor', 'nurse', 'pharmac', 'dentist', 'medic', 'эмч', 'сувилагч']],
    ['teacher', ['teacher', 'professor', 'librarian', 'lecturer', 'tutor', 'principal', 'guide', 'багш']],
    ['trader', ['trader', 'seller', 'vendor', 'kiosk', 'shop', 'merchant', 'market', 'bookseller', 'owner', 'худалдаа', 'наймаа']],
    ['driver', ['driver', 'taxi', 'mechanic', 'conductor', 'pilot', 'жолооч']],
    ['clerk', ['receptionist', 'manager', 'clerk', 'cashier', 'office', 'banker', 'agent', 'host', 'менежер', 'ажилтан']],
    ['student', ['student', 'friend', 'volunteer', 'child', 'kid', 'boy', 'girl', 'son', 'daughter', 'pupil', 'neighbour', 'neighbor', 'оюутан', 'найз', 'хүүхэд']]
  ];
  function roleKind(role) {
    const r = String(role || '').toLowerCase(), head = r.split(/\s(?:and|at|on|from|in|of|with|who|for)\s|[(,;:]/)[0];
    let best = null, at = -1;
    for (const [k, keys] of ROLE_KEYS) for (const x of keys) { const i = head.lastIndexOf(x); if (i > at) { at = i; best = k; } }
    if (best) return best;
    at = Infinity;
    for (const [k, keys] of ROLE_KEYS) for (const x of keys) { const i = r.indexOf(x); if (i >= 0 && i < at) { at = i; best = k; } }
    return best || 'local';
  }
  // the parts + colours of one person; abroad (region uk) nobody wears a deel
  function personDef(kind, who, region) {
    const A = ARCH[kind] || ARCH.local, r = rng(hash(who + kind)), pick = a => a[Math.floor(r() * a.length)];
    let { head, torso, legs } = A;
    const fem = r() < .5;
    if (kind === 'student') head = fem ? 'pony' : 'short';
    if (kind === 'doctor' || kind === 'clerk' || kind === 'trader' || kind === 'local') head = fem ? 'long' : 'short';
    if (kind === 'trader' && !fem) legs = 'pants';
    if (kind === 'local' && fem) legs = 'robe';
    if (region === 'uk') {
      if (torso === 'deel') { torso = 'jacket'; legs = kind === 'granny' || fem ? 'skirt' : 'pants'; }
      if (head === 'fur') head = 'flat';
      if (torso === 'zodog') { head = 'short'; torso = 'jacket'; legs = 'pants'; }           // sport abroad: a club jacket
    }
    const c = Object.assign({ s: pick(region === 'uk' ? SKIN.concat(['#f8d0b0', '#f8c8a8']) : SKIN), e: '#181020', m: '#a04040', h: pick(region === 'uk' ? HAIR.concat(['#c89048', '#8a4020']) : HAIR),
      a: pick(torso === 'deel' ? DEEL : COAT), c: '#e8e0d0', t: '#e8b838', g: pick(['#e8a830', '#f0c848', '#d05828']), p: '#3a3448', b: '#3a2418',
      w: '#f0f0f0', x: '#a0a8b8', k: '#20182a', q: pick(['#3a3048', '#5a3a28', '#2a4060']), f: '#9a6a40', r: '#c83040' }, A.c);
    return { head, torso, legs, pal: pal(c) };
  }
  function personGrid(d) {
    const rows = [...HEADS[d.head], ...TORSOS[d.torso], ...LEGS[d.legs]];
    return grid({ rows, mirror: true, patch: [...(HEAD_PATCH[d.head] || []), ...(TORSO_PATCH[d.torso] || [])] });
  }
  function skinDef(id) {
    const S = SKINS[skinId(id)], base = personDef('hero', 'you', 'mn');
    const colors = Object.fromEntries(Object.entries(base.pal).filter(([key]) => key === key.toLowerCase()));
    return { head: S.head, torso: S.torso, legs: S.legs, pal: pal(Object.assign(colors, S.c)) };
  }
  // idle frames: 0 stand, 1 breathe (head + torso one pixel down), 2 blink
  function idleFrames(g, split) {
    const f1 = g.map(r => r.slice()), w = g[0].length;
    for (let y = split; y > 0; y--) f1[y] = g[y - 1].slice();
    f1[0] = new Array(w).fill('.');
    const f2 = g.map(r => r.map(ch => ch === 'e' ? 'S' : ch));
    return [g, f1, f2];
  }

  // ---------- the guards: bigger, drawn in full (14 px left halves of a 28 px figure) ----------
  const BOSSES = {
    batzorig: { rows: [
      '.............r', '............rr', '............rr', '.............x', '............xx', '...........xxx', '..........xxxx', '.........xxxxx', '........gggggg',
      '.......fffffff', '.......ffsssss', '.......fskkkss', '.......fssesss', '.......fssesss', '........ssssss', '........skkkkk', '........kssssm', '........k.ssss',
      '...........kkk', '...ffffff..aaa', '..fffffffxaaxx', '..fFffffxxxxxx', '..ffffffXxxxxx', '..aaa.xxxxxxxx', '..aaa.XXXXXXXX', '..aaa.xxxxxxxx', '..aaa.xxxxxxxx',
      '..ss..gggggggg', '..ss..gggggggg', '......aaaaaaaa', '.....aaaaaaaaa', '.....aaaaaa.aa', '.....tttttt.tt', '......bbbb..bb', '......bbbb..bb', '.....bbbbb..bb', '....bbbbbb..bb'],
      pal: pal({ r: '#d83030', x: '#9aa4b8', X: '#5a6478', g: '#e8b838', f: '#7a4a28', F: '#5a3418', s: '#c88858', e: '#ffffff', k: '#1a1020', m: '#702020',
        a: '#902030', t: '#e8b838', b: '#2a1810' }),
      patch: [[19, 0, 'x'], [20, 0, 'x'], [21, 0, 'x'], [22, 0, 'x'], [23, 0, 'k'], [24, 0, 'k'], [25, 0, 'k'], [26, 0, 'k'], [27, 0, 'k'], [28, 0, 'k'], [29, 0, 'k'], [30, 0, 'k'],
        [31, 0, 'k'], [32, 0, 'k'], [33, 0, 'k'], [34, 0, 'k'], [35, 0, 'k'], [16, 0, 'x'], [17, 0, 'x'], [18, 0, 'x'], [15, 0, 'r'], [14, 1, 'r'], [16, 1, 'r'], [27, 1, 's'], [28, 1, 's']] },
    edmund: { rows: [
      '...........rrr', '..........rrrr', '.........rrr..', '..........xxxx', '.........xxxxx', '........xxxxxx', '........xxxxxx', '........xkkkkk', '........xkekke',
      '........xxxxxx', '........xxkxkx', '.........xxxxx', '..........xxxx', '...xxxxxx..xxx', '..xxxxxxxxwwww', '..xXxxxxxwwwww', '..xxxxxxxwwwrr', '..xxx.wwwwwwrr',
      '..xxx.wwwrrrrr', '..xxx.wwwrrrrr', '..xxx.wwwwwwrr', '..ss..wwwwwwrr', '..ss..gggggggg', '......wwwwwwww', '......wwwwwwww', '.....wwwwwwwww', '.....xxxxx..xx',
      '.....xxxxx..xx', '.....xxxxx..xx', '.....xxxxx..xx', '.....xxxxx..xx', '....bbbbbb..bb', '...bbbbbbb..bb'],
      pal: pal({ r: '#c82030', x: '#b0b8c8', X: '#68708a', k: '#1a1020', e: '#e8d8a0', w: '#f0f0f0', W: '#c0c4d0', g: '#d8a830', s: '#f0b890', b: '#3a3040' }),
      patch: [[11, 0, 'x'], [12, 0, 'x'], [13, 0, 'x'], [14, 0, 'x'], [15, 0, 'x'], [16, 0, 'x'], [17, 0, 'x'], [18, 0, 'x'], [19, 0, 'x'], [20, 0, 'g'], [21, 0, 'k'], [21, 1, 'g'], [20, 1, 'g']] }
  };

  // ---------- props: small sprites the backdrops stamp ----------
  const PROPS = {
    ger: { mirror: true, rows: ['..........tt', '........wwww', '......wwwwww', '....wwwwwwww', '..wwwwwwwwww', '.wwwwwwwwwww', 'bcbbcbbcbbcb', '.wwwwwwwwwrr', '.WwwwwwwwwrG', '.wwwwwwwwwrr', '.WWWWWWWWWrr', '.wwwwwwwwwrr', '.wwwwwwwwwrr'],
      pal: pal({ t: '#e89830', w: '#f4eee0', W: '#c8bca8', b: '#2850a8', c: '#e8b838', r: '#d04828', R: '#a03018', G: '#f0c848' }) },
    horse: { rows: ['...........kk...', '..........kaak..', '..........kaaaa.', '.........kaaaaaa', '........kaaa..aa', '.kaaaaaaaaaa....', 'kkaaaaaaaaaa....', 'k.aaaaaaaaaa....', '..aa.aa...aa.a..', '..a...a...a..a..', '..a...a...a..a..', '..k...k...k..k..'],
      pal: pal({ a: '#8a5028', k: '#2a1810' }), frames: [[], [[6, 0, '.'], [7, 0, '.'], [6, 1, 'k'], [7, 1, 'k'], [8, 1, 'k']]] },
    whorse: { rows: ['...........kk...', '..........kaak..', '..........kaaaa.', '.........kaaaaaa', '........kaaa..aa', '.kaaaaaaaaaa....', 'kkaaaaaaaaaa....', 'k.aaaaaaaaaa....', '..aa.aa...aa.a..', '..a...a...a..a..', '..a...a...a..a..', '..k...k...k..k..'],
      pal: pal({ a: '#e8e0d0', A: '#b8b0a8', k: '#6a6060' }), frames: [[], [[6, 0, '.'], [7, 0, '.'], [6, 1, 'k'], [7, 1, 'k'], [8, 1, 'k']]] },
    sheep: { rows: ['.wwww...', 'wwwwwwkk', 'wwwwwwkk', '.wwwww..', '.k.k.k..'], pal: pal({ w: '#f4f0e4', W: '#c8c0b0', k: '#3a3030' }) },
    pine: { mirror: true, rows: ['...g', '..gg', '..gg', '.ggg', '..gg', '.ggg', 'gggg', '.ggg', 'gggg', '...k', '...k'], pal: pal({ g: '#2a7048', G: '#1a4a38', k: '#5a3820' }) },
    tree: { mirror: true, rows: ['..gggg', '.ggggg', 'gggggg', 'gggggg', 'gggggg', '.ggggg', '..ggkk', '....kk', '....kk'], pal: pal({ g: '#3a9048', G: '#286838', k: '#6a4020' }) },
    cloud: { mirror: true, rows: ['.......www', '....wwwwww', '..wwwwwwww', 'wwwwwwwwww', 'WWWWWWWWWW'], pal: { w: '#ffffff', W: '#d8e0f0' }, outline: false },
    tug: { rows: ['..g..', '.www.', 'wwwww', 'wwwww', 'wWwWw', '.WwW.', '..k..'], pal: pal({ g: '#e8b838', w: '#f8f4ec', W: '#c8c0b8', k: '#4a3020' }) },
    blacktug: { rows: ['..g..', '.www.', 'wwwww', 'wwwww', 'wWwWw', '.WwW.', '..k..'], pal: pal({ g: '#e8b838', w: '#3a3040', W: '#1e1828', k: '#4a3020' }) },
    ovoo: { mirror: true, rows: ['.....k', '....bk', '...bbk', '....gg', '...ggg', '..gggg', '.ggggg', 'gggggg'], pal: pal({ k: '#6a4020', b: '#58a8f0', g: '#9a9488', G: '#6a6458' }) },
    bowl: { mirror: true, rows: ['.wwwww', 'wcccccc'.slice(0, 6), 'aaaaaa', '.aaaaa', '..aaaa'], pal: pal({ w: '#f0e0b8', c: '#e8d8b0', a: '#2858b8' }) },
    buuz: { mirror: true, rows: ['....w', '..www', '.wwww', 'pppppp'.slice(0, 5)], pal: pal({ w: '#f4ecd8', p: '#d8d8e0' }) },
    cup: { rows: ['.www.', 'wcccw', 'wwwwwk', 'wwww.k', '.ww..'], pal: pal({ w: '#f0f0f0', c: '#6a3818', k: '#c0c0c8' }) },
    taxi: { rows: ['.........aaaaaaaaa..........', '........accccaccccaa........', '.......acccc.acccccaa.......', '..aaaaaaaaaaaaaaaaaaaaaaaa..', '.aaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'yaaaaaaaaaaaaaaaaaaaaaaaaaar', '.AAA.....AAAAAAAAAA.....AAA.', '...kkkk............kkkk....', '...kxxk............kxxk....', '....kk..............kk.....'],
      pal: pal({ a: '#f0f0e8', A: '#a8a8b0', c: '#78b8e0', y: '#f8e070', r: '#d83030', k: '#181018', x: '#888898' }) },
    cab: { rows: ['........aaaaaaaaaa.........', '.......acccc.accccaa........', '......acccc..acccccaa.......', '..aaaaaaaaaaaaaaaaaaaaaaa...', '.aaaaaaaaaaaaaaaaaaaaaaaaa..',
      'yaaaaaaaaaaaaaaaaaaaaaaaaar.', '.aaa.....aaaaaaaaaa.....aaa.', '...kkkk............kkkk....', '...kxxk............kxxk....', '....kk..............kk.....'],
      pal: pal({ a: '#2a2a34', A: '#18181e', c: '#7090b0', y: '#f8e070', r: '#d83030', k: '#080808', x: '#888898' }) },
    lion: { rows: ['..kkk.......', '.kkkkk......', 'kkkkkk......', 'kkkkkkkkkkk.', '.kkkkkkkkkkk', '..kk.kk.kkk.'], pal: pal({ k: '#3a3a48' }) },
    hand: { rows: ['..www.....', '.wwwww....', 'wwwwwwwwww', 'wwwwwwwwww', 'wwwwwwww..', 'wwwwwww...', '.wwwwww...', '..wwww....'], pal: { w: '#ffffff', W: '#c8c8d8' }, patch: [[2, 9, 'W'], [3, 9, 'W'], [4, 7, 'W'], [5, 6, 'W'], [6, 6, 'W']] },
    // overworld walker (2 frames) and map icons
    walker: { rows: ['..hhhh..', '.hhhhhh.', '.rrrrrr.', '.sesses.', '..ssss..', '.aaaaaa.', 'saaaaaas', '.aappaa.', '.pp..pp.', '.bb..bb.'],
      pal: pal({ h: '#3a2418', r: '#e8c040', s: '#f0b890', e: '#181020', a: '#c83828', p: '#304068', b: '#5a3418' }), frames: [[], [[8, 1, '.'], [8, 2, 'p'], [9, 1, '.'], [9, 2, 'b'], [8, 6, 'p'], [8, 5, '.'], [9, 6, '.'], [9, 5, 'b']]] },
    i_ger: { mirror: true, rows: ['....', '..ww', '.www', 'bbbb', 'wwwr', 'wwwr'], pal: pal({ w: '#f4eee0', b: '#2850a8', r: '#d04828' }) },
    i_plane: { rows: ['....w...', '....ww..', 'wwwwwwww', '.wwwwwww', '....ww..', '....w...'], pal: pal({ w: '#f0f4ff' }) },
    i_car: { rows: ['..aaaa..', '.acaaca.', 'aaaaaaaa', '.k....k.'], pal: pal({ a: '#f8d040', c: '#78b8e0', k: '#181018' }) },
    i_stalls: { mirror: true, rows: ['rwrw', 'rwrw', 'k..k', 'kaak'], pal: pal({ r: '#d83030', w: '#f8f0e0', k: '#5a3820', a: '#e8a830' }) },
    i_bowl: { mirror: true, rows: ['..w.', '.w..', 'wwww', 'aaaa', '.aaa'], pal: pal({ w: '#f0f0f0', a: '#2858b8' }) },
    i_flags: { rows: ['w...w...w', 'ww..ww..ww', 'w...w...w', 'k...k...k', 'k...k...k'], pal: pal({ w: '#f8f4ec', k: '#6a4020' }) },
    i_hills: { rows: ['.ww.....', 'wwwwk.ww', 'wwwwkwww', '.k.k.k.k'], pal: pal({ w: '#f4f0e4', k: '#3a3030' }) },
    i_clinic: { mirror: true, rows: ['wwww', 'wwrr', 'wrrr', 'wwrr', 'wwww'], pal: pal({ w: '#f0f0f0', r: '#d83030' }) },
    i_school: { mirror: true, rows: ['...r', '..aa', '.aaa', 'acac', 'acac', 'aaak'], pal: pal({ a: '#e8b858', c: '#5890c8', r: '#d83030', k: '#6a4020' }) },
    i_city: { rows: ['...a....', '..aaa...', '..aca.a.', 'a.aaaaaa', 'aaacaaca', 'aaaaaaaa'], pal: pal({ a: '#b8c0d8', c: '#f8e070' }) },
    i_gate: { mirror: true, rows: ['r....', 'k.....'.slice(0, 5), 'xxx.x', 'xxxxx', 'xxxxk', 'xxxkk', 'xxxkk'], pal: pal({ r: '#d83030', k: '#2a2030', x: '#9a98a8' }) }
  };

  // ---------- the sprite cache ----------
  const cache = {};
  function build(name) {
    let frames = null, g, P, split = 19, outline;
    if (name.startsWith('hero:')) {
      const d = skinDef(name.slice(5));
      g = personGrid(d); P = d.pal; frames = idleFrames(g, split);
    } else if (name.startsWith('walker:')) {
      const id = skinId(name.slice(7)), D = PROPS.walker, rows = D.rows.slice();
      if (id === 'nomad') rows.splice(0, 3, '..qqqq..', '.ffffff.', '.fssssf.');
      else if (id === 'scholar') rows.splice(2, 2, '.hssssh.', '.skekes.');
      else if (id === 'ranger') rows[2] = '.hssssh.';
      g = grid({ rows }); P = skinDef(id).pal;
      frames = D.frames.map(p => { const f = g.map(r => r.slice()); for (const [r, c, ch] of p) f[r][c] = ch; return f; });
    } else if (name.startsWith('p:')) {                             // p:<kind>:<region>:<who>
      const [, kind, region, ...w] = name.split(':'), d = personDef(kind, w.join(':'), region);
      g = personGrid(d); P = d.pal; frames = idleFrames(g, split);
    } else if (BOSSES[name]) {
      const B = BOSSES[name]; g = grid(Object.assign({ mirror: true }, B)); P = B.pal; frames = idleFrames(g, 26);
    } else if (PROPS[name]) {
      const D = PROPS[name]; g = grid(D); P = D.pal; outline = D.outline;
      frames = (D.frames || [[]]).map(p => { const f = g.map(r => r.slice()); for (const [r, c, ch] of p) if (f[r]) f[r][c] = ch; return f; });
    } else return null;
    const baked = frames.map(f => bake(shade(f, P), P, outline));
    if (baked.some(b => !b)) return null;
    return { w: baked[0].width, h: baked[0].height, frames: baked };
  }
  function sprite(name) {
    if (!(name in cache)) cache[name] = ok2d() ? build(name) : null;
    return cache[name];
  }
  // the opponent's sprite: the level guards by name, everyone else by role
  function foe(role, who, region, boss) {
    if (boss) return region === 'uk' ? 'edmund' : 'batzorig';
    return `p:${roleKind(role)}:${region === 'uk' ? 'uk' : 'mn'}:${who || ''}`;
  }
  const HERO = 'p:hero:mn:you';
  // idle cycle at 12 fps: stand, breathe, stand, breathe, blink
  const IDLE = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2];
  const idle = (tick, seed) => IDLE[((Math.floor(tick) + (seed || 0)) % IDLE.length + IDLE.length) % IDLE.length];
  function stamp(ctx, name, x, y, frame, flip) {
    const s = sprite(name); if (!s) return;
    const n = s.frames.length, f = s.frames[(((Math.floor(frame) || 0) % n) + n) % n];
    if (flip) { ctx.save(); ctx.translate(Math.round(x) + s.w, Math.round(y)); ctx.scale(-1, 1); ctx.drawImage(f, 0, 0); ctx.restore(); }
    else ctx.drawImage(f, Math.round(x), Math.round(y));
  }

  // ---------- painting primitives (native pixels) ----------
  const R = (x, c, X, Yy, w, h) => { x.fillStyle = c; x.fillRect(Math.round(X), Math.round(Yy), Math.round(w), Math.round(h)); };
  function dither(x, c, X, Yy, w, h, ph) { x.fillStyle = c; for (let j = 0; j < h; j++) for (let i = (j + (ph || 0)) & 1; i < w; i += 2) x.fillRect(X + i, Yy + j, 1, 1); }
  // a sky in palette steps, a dithered row between two bands (no smooth gradients: 16-bit look)
  function bands(x, cols, y0, y1, W) {
    const n = cols.length, bh = (y1 - y0) / n;
    cols.forEach((c, i) => {
      const a = Math.round(y0 + i * bh), b = Math.round(y0 + (i + 1) * bh);
      R(x, c, 0, a, W, b - a);
      if (i < n - 1) { dither(x, cols[i + 1], 0, b - 1, W, 1, 0); dither(x, c, 0, b, W, 1, 1); }
    });
  }
  // a smooth random ridge line (value noise, two octaves)
  function ridge(W, seed, base, amp, step) {
    const r = rng(seed), n = Math.ceil(W / step) + 3, a = [], b = [];
    for (let i = 0; i < n; i++) a.push(r());
    for (let i = 0; i < n * 5; i++) b.push(r());
    const at = (p, f) => { const i = Math.floor(f), k = f - i, s = k * k * (3 - 2 * k); return p[i] * (1 - s) + p[i + 1] * s; };
    const h = [];
    for (let X = 0; X < W; X++) h.push(Math.round(base - amp * (.75 * at(a, X / step) + .25 * at(b, X / (step / 5)))));
    return h;
  }
  function mountains(x, W, seed, base, amp, step, col, snow, ground) {
    const h = ridge(W, seed, base, amp, step), lit = lite(col, .16), sh = dark(col, .22), line = base - amp * .55;
    // shade by the broad slope (light from the left), snow above the line with a ragged edge
    for (let X = 0; X < W; X++) {
      const top = h[X], down = (h[Math.min(W - 1, X + 3)] - h[Math.max(0, X - 3)]) > 0;
      R(x, down ? sh : col, X, top, 1, ground - top);
      if (!down) R(x, lit, X, top, 1, 1);
      if (snow && top < line) R(x, down ? mix(snow, sh, .3) : snow, X, top, 1, Math.max(1, Math.round(line - top + ((X * 7) % 3) - 1)));
    }
    return h;
  }
  function hills(x, W, seed, base, amp, step, col, ground) {
    const h = ridge(W, seed, base, amp, step);
    for (let X = 0; X < W; X++) { R(x, col, X, h[X], 1, ground - h[X]); R(x, lite(col, .15), X, h[X], 1, 1); }
    return h;
  }
  // ground: banded rows (lighter far away) with a scatter of texture pixels
  function ground(x, W, H, y0, cols, seed, spots) {
    bands(x, cols, y0, H, W);
    const r = rng(seed);
    for (let i = 0; i < W * (H - y0) / 18; i++) { const X = Math.floor(r() * W), Yy = y0 + 1 + Math.floor(r() * (H - y0)); R(x, spots[Math.floor(r() * spots.length)], X, Yy, r() < .3 ? 2 : 1, 1); }
  }
  function clouds(x, W, y, n, t, seed, speed) {
    const s = sprite('cloud'); if (!s) return;
    const r = rng(seed);
    for (let i = 0; i < n; i++) {
      const span = W + s.w * 2, base = r() * span, X = ((base + t * (speed || 1) * (.6 + r() * .6)) % span) - s.w, Yy = y + Math.floor(r() * 12);
      x.globalAlpha = .92; stamp(x, 'cloud', X, Yy); x.globalAlpha = 1;
    }
  }
  function stars(x, W, h, t, seed) {
    const r = rng(seed);
    for (let i = 0; i < W / 5; i++) { const X = Math.floor(r() * W), Yy = Math.floor(r() * h), tw = (Math.floor(t / 400) + i) % 7 === 0; R(x, tw ? '#a0a8e0' : '#f8f4ff', X, Yy, 1, 1); }
  }
  // a building: walls, a roof line, a grid of windows (lit at night)
  function building(x, X, Yy, w, h, wall, win, o) {
    o = o || {};
    R(x, dark(wall, .35), X - 1, Yy - 1, w + 2, h + 1); R(x, wall, X, Yy, w, h); R(x, lite(wall, .2), X, Yy, 1, h); R(x, dark(wall, .2), X + w - 1, Yy, 1, h);
    if (o.roof) R(x, o.roof, X - 1, Yy - 2, w + 2, 2);
    const ww = o.ww || 2, wh = o.wh || 2, gx = o.gx || 4, gy = o.gy || 4, r = rng(o.seed || X * 31 + Yy);
    for (let j = Yy + (o.top || 3); j + wh < Yy + h - (o.bottom || 2); j += gy)
      for (let i = X + 2; i + ww <= X + w - 1; i += gx) R(x, o.night && r() < .55 ? '#f8d870' : win, i, j, ww, wh);
  }
  function crowd(x, X, Yy, w, rows, seed) {
    const r = rng(seed), cols = ['#c83040', '#3058c0', '#e8b838', '#2f8a58', '#f0f0f0', '#7848a8', '#d07020'];
    for (let j = 0; j < rows; j++) for (let i = X + (j & 1); i < X + w; i += 2) {
      R(x, cols[Math.floor(r() * cols.length)], i, Yy + j * 3 + 1, 2, 2); R(x, '#e0a070', i, Yy + j * 3, 2, 1);
    }
  }
  function pole(x, X, top, bottom, c) { R(x, c || '#5a3820', X, top, 1, bottom - top); }
  const rain = (x, W, H, t, seed) => { const r = rng(seed); x.fillStyle = '#b8c8e0'; for (let i = 0; i < W / 4; i++) { const X = Math.floor((r() * W + t / 25) % W), Yy = Math.floor((r() * H + t / 6) % H); x.fillRect(X, Yy, 1, 3); } };

  // ---------- skies by region / time of day (dark theme = dusk and night, light = day) ----------
  const SKY = {
    day: ['#3868d8', '#4880e0', '#5898e8', '#70b0f0', '#90c8f8', '#b8e0f8'],
    dusk: ['#201848', '#382868', '#603878', '#904878', '#c86068', '#e88858'],
    night: ['#080820', '#101030', '#181840', '#202850', '#283460', '#304070'],
    grey: ['#687890', '#7888a0', '#8898b0', '#98a8c0', '#a8b8c8', '#b8c4d0'],
    greyNight: ['#101828', '#182030', '#202840', '#283048', '#303850', '#384058'],
    blood: ['#200810', '#401018', '#601820', '#882028', '#b03028', '#d85030'],
    ember: ['#782030', '#982838', '#b83838', '#d05038', '#e87040', '#f8a050'],
    room: ['#6a4a30', '#6a4a30', '#5e4028', '#5e4028', '#523822', '#523822']
  };

  // ---------- backdrops: one painter per scene and region; W x H in native pixels, horizon by H ----------
  function scene(x, W, H, kind, o) {
    o = o || {};
    const uk = o.region === 'uk', night = !!o.night, t = o.t || 0, hz = Math.round(H * .66), seed = hash(kind + (uk ? 'uk' : 'mn'));
    const sky = c => bands(x, c, 0, hz, W);
    const steppeSky = () => { sky(night ? SKY.dusk : SKY.day); if (night) stars(x, W, hz * .45, t, seed); clouds(x, W, 4, Math.ceil(W / 90), t / 120, seed, 1); };
    const ukSky = () => { sky(night ? SKY.greyNight : SKY.grey); clouds(x, W, 2, Math.ceil(W / 60), t / 160, seed, 1); };
    const farMn = (c) => { mountains(x, W, seed + 1, hz - 2, hz * .55, 70, c || (night ? '#4a3a68' : '#6a78a8'), night ? '#c8c0e0' : '#f0f4ff', hz); hills(x, W, seed + 2, hz, hz * .18, 40, night ? '#2e4a40' : '#5a9858', hz); };
    const grass = () => ground(x, W, H, hz, night ? ['#2e4a38', '#2a4434', '#263e30', '#22382c'] : ['#78b858', '#68a848', '#5a9840', '#4c8838'], seed + 3, night ? ['#3a5a44', '#1e3428'] : ['#88c868', '#4a7a30', '#a8d878']);
    const asphalt = () => ground(x, W, H, hz, night ? ['#383848', '#343444', '#303040'] : ['#9898a0', '#8c8c94', '#808088'], seed + 4, night ? ['#404052', '#2c2c3a'] : ['#a8a8b0', '#7a7a82']);
    const pave = () => ground(x, W, H, hz, night ? ['#4a4450', '#443e4a', '#3e3844'] : ['#c8b8a0', '#bcac94', '#b0a088'], seed + 5, night ? ['#544e5a', '#38323e'] : ['#d8c8b0', '#a09078']);
    const ukStreet = () => {
      ukSky();
      for (let X = -4, i = 0; X < W; X += 26, i++) building(x, X, hz - 26 - (i % 3) * 4, 24, 26 + (i % 3) * 4, ['#8a4a38', '#7a4232', '#9a5a40'][i % 3], '#c8d8e8', { night, roof: '#3a3040', seed: i });
      asphalt(); R(x, '#d8d8d0', 0, hz + 1, W, 1);
    };
    switch ((uk ? 'uk:' : '') + kind) {
      case 'plane': {
        steppeSky(); farMn();
        asphalt(); for (let X = 2; X < W; X += 14) R(x, '#f0f0e8', X, hz + Math.round((H - hz) * .55), 7, 1);
        building(x, 6, hz - 26, 6, 26, '#d8d0c0', '#5890c8', { night, gx: 3, gy: 5 }); R(x, '#5890c8', 3, hz - 32, 12, 6); R(x, '#304860', 3, hz - 33, 12, 1);
        building(x, 18, hz - 12, 70, 12, '#c8c8d0', '#4a78a8', { night, gx: 4, gy: 4, roof: '#7888a0' });
        planeBody(x, Math.round(W * .45), hz - 14, '#3a6ac8', t);
        break;
      }
      case 'uk:plane': {
        ukSky();
        building(x, 4, hz - 16, 90, 16, '#a8b8c8', '#506880', { night, gx: 3, gy: 3, roof: '#506070' });
        asphalt(); for (let X = 2; X < W; X += 14) R(x, '#f0f0e8', X, hz + Math.round((H - hz) * .55), 7, 1);
        planeBody(x, Math.round(W * .45), hz - 14, '#c82838', t); rain(x, W, H, t, seed);
        break;
      }
      case 'car': {
        steppeSky(); farMn(); grass();
        R(x, night ? '#3a3438' : '#8a7a68', 0, hz + 4, W, H - hz - 4); R(x, night ? '#4a4448' : '#a0907a', 0, hz + 4, W, 1);
        for (let X = (-(t / 30) % 16 + 16) % 16 - 16; X < W; X += 16) R(x, '#f0e8c0', X, hz + Math.round((H - hz) * .6), 8, 1);
        for (let X = 10; X < W; X += 48) { pole(x, X, hz - 18, hz + 2, '#6a5040'); R(x, '#6a5040', X - 3, hz - 17, 7, 1); }
        stamp(x, 'taxi', Math.round(W * .5) - 14, hz + 2 + (Math.floor(t / 150) % 2));
        break;
      }
      case 'uk:car': {
        ukStreet();
        bus(x, Math.round(W * .12), hz - 6, night);
        stamp(x, 'cab', Math.round(W * .5) - 14, hz + 2 + (Math.floor(t / 150) % 2));
        break;
      }
      case 'ger': {
        steppeSky(); farMn(); grass();
        stamp(x, 'ovoo', Math.round(W * .82), hz - 7);
        stamp(x, 'ger', Math.round(W * .2), hz - 8); stamp(x, 'ger', Math.round(W * .62), hz - 6);
        stamp(x, 'ger', Math.round(W * .38), hz - 2);
        R(x, '#5a3820', Math.round(W * .74), hz + 2, 12, 1); pole(x, Math.round(W * .74), hz - 2, hz + 6); pole(x, Math.round(W * .74) + 11, hz - 2, hz + 6);
        stamp(x, 'horse', Math.round(W * .76), hz - 5, Math.floor(t / 900) % 2);
        smoke(x, Math.round(W * .38) + 12, hz - 4, t);
        break;
      }
      case 'uk:ger': {
        ukSky();
        hills(x, W, seed + 2, hz, hz * .2, 50, night ? '#2e4a40' : '#6aa060', hz);
        for (let i = 0; i < 3; i++) house(x, Math.round(W * (.12 + i * .3)), hz, night, i);
        grass(); for (let X = 0; X < W; X += 3) R(x, '#f0f0f0', X, hz + 3, 1, 4); R(x, '#f0f0f0', 0, hz + 3, W, 1);
        stamp(x, 'tree', Math.round(W * .9), hz - 9);
        break;
      }
      case 'stalls': {
        steppeSky(); farMn(); pave();
        market(x, W, hz, ['#d83030', '#2858b8', '#e8b838', '#2f8a58'], night, t);
        break;
      }
      case 'uk:stalls': {
        ukSky();
        const fac = ['#e84878', '#38a8c8', '#f8c838', '#78c048', '#a858c8'];
        for (let X = -2, i = 0; X < W; X += 22, i++) building(x, X, hz - 24, 21, 24, fac[i % fac.length], '#fff8e0', { night, roof: '#302838', gx: 5, gy: 6, ww: 3, wh: 3 });
        pave(); market(x, W, hz + 2, ['#302838', '#c83040', '#f0f0f0'], night, t);
        break;
      }
      case 'bowl': case 'uk:bowl': {
        // inside: wall, a window on the world, the table with the food
        const wall = uk ? (night ? '#5a3030' : '#9a5040') : (night ? '#4a3420' : '#8a6038');
        R(x, wall, 0, 0, W, hz + 4);
        if (uk) { for (let j = 0; j < hz; j += 4) for (let i = (j / 4 & 1) * 4; i < W; i += 8) R(x, dark(wall, .25), i, j, 1, 4); for (let j = 3; j < hz; j += 4) R(x, dark(wall, .25), 0, j, W, 1); }
        else { for (let i = 0; i < W; i += 6) R(x, dark(wall, .2), i, 0, 1, hz); band(x, W, Math.round(hz * .25), '#c83030', '#e8b838'); }
        const wx = Math.round(W * .3), ww = Math.max(40, Math.round(W * .4)), wy = Math.round(hz * .38), wh = Math.round(hz * .45);
        R(x, '#3a2418', wx - 2, wy - 2, ww + 4, wh + 4);
        x.save(); x.beginPath(); x.rect(wx, wy, ww, wh); x.clip();
        bands(x, uk ? (night ? SKY.greyNight : SKY.grey) : (night ? SKY.dusk : SKY.day), wy, wy + wh, W);
        if (uk) for (let X = wx; X < wx + ww; X += 12) building(x, X, wy + wh - 12, 10, 12, '#7a4232', '#c8d8e8', { night, seed: X });
        else mountains(x, W, seed + 9, wy + wh, wh * .6, 30, '#6a78a8', '#f0f4ff', wy + wh);
        x.restore();
        R(x, '#3a2418', wx + ww / 2 - 1, wy, 2, wh); R(x, '#3a2418', wx, wy + wh / 2, ww, 1);
        R(x, uk ? '#4a3a30' : '#c83030', 0, hz + 4, W, H - hz - 4);
        for (let i = 0; i < W; i += 8) R(x, dark(uk ? '#4a3a30' : '#c83030', .2), i, hz + 4, 1, H - hz - 4);
        const ty = hz + Math.round((H - hz) * .1);
        R(x, '#6a4020', Math.round(W * .18), ty, Math.round(W * .64), 4); R(x, '#8a5830', Math.round(W * .18), ty, Math.round(W * .64), 1);
        R(x, '#4a2c18', Math.round(W * .22), ty + 4, 2, H); R(x, '#4a2c18', Math.round(W * .78), ty + 4, 2, H);
        if (uk) { stamp(x, 'cup', W * .4, ty - 6); stamp(x, 'cup', W * .56, ty - 6); smoke(x, W * .4 + 3, ty - 6, t); }
        else { stamp(x, 'bowl', W * .36, ty - 6); stamp(x, 'buuz', W * .5, ty - 5); stamp(x, 'bowl', W * .6, ty - 6); smoke(x, W * .36 + 6, ty - 6, t); smoke(x, W * .6 + 6, ty - 6, t + 400); }
        lamp(x, Math.round(W * .15), t, night); lamp(x, Math.round(W * .85), t + 300, night);
        break;
      }
      case 'flags': {
        steppeSky(); farMn(); grass();
        R(x, night ? '#4a3a30' : '#a08058', 0, hz - 10, W, 10); crowd(x, 0, hz - 10, W, 3, seed);
        for (let i = 0; i < 9; i++) { const X = Math.round(W * .5 - 36 + i * 9); pole(x, X + 2, hz - 26, hz + 4); stamp(x, i === 4 ? 'tug' : 'tug', X, hz - 30 - (i === 4 ? 2 : 0)); }
        R(x, night ? '#5a4a3a' : '#c8a878', Math.round(W * .3), hz + 6, Math.round(W * .4), 6);
        stamp(x, 'horse', ((t / 20) % (W + 40)) - 20, hz + 2, Math.floor(t / 120) % 2); stamp(x, 'whorse', ((t / 20 + 30) % (W + 40)) - 20, hz + 4, Math.floor(t / 120 + 1) % 2);
        break;
      }
      case 'uk:flags': {
        ukSky();
        R(x, night ? '#303040' : '#5a6070', 0, hz - 18, W, 18); crowd(x, 0, hz - 16, W, 5, seed);
        for (const X of [8, W - 12]) { pole(x, X + 1, hz - 34, hz, '#808898'); R(x, night ? '#fff8c0' : '#d0d8e0', X - 2, hz - 38, 8, 4); }
        for (let j = hz; j < H; j += 4) R(x, (j / 4) & 1 ? (night ? '#2a5a30' : '#58a848') : (night ? '#2e6234' : '#68b858'), 0, j, W, 4);
        R(x, '#f0f0f0', Math.round(W / 2), hz, 1, H - hz);
        break;
      }
      case 'hills': {
        steppeSky();
        mountains(x, W, seed + 1, hz - 6, hz * .4, 90, night ? '#4a3a68' : '#7888b0', night ? '#c8c0e0' : '#f0f4ff', hz);
        hills(x, W, seed + 2, hz - 2, hz * .3, 60, night ? '#2e5040' : '#80b860', hz); hills(x, W, seed + 7, hz + 2, hz * .15, 30, night ? '#2a4434' : '#6aa850', hz + 2);
        grass();
        const r = rng(seed + 8);
        for (let i = 0; i < W / 30; i++) stamp(x, 'sheep', r() * W, hz + 2 + r() * (H - hz - 8));
        stamp(x, 'horse', W * .7, hz - 4, Math.floor(t / 900) % 2); stamp(x, 'whorse', W * .78, hz - 2, Math.floor(t / 700) % 2);
        stamp(x, 'ger', W * .12, hz - 8); stamp(x, 'ovoo', W * .9, hz - 4);
        break;
      }
      case 'uk:hills': {
        ukSky();
        hills(x, W, seed + 1, hz - 4, hz * .45, 70, night ? '#2a3a40' : '#5a7a68', hz); hills(x, W, seed + 2, hz, hz * .25, 40, night ? '#2e4a3a' : '#6a9a58', hz);
        castle(x, Math.round(W * .7), hz - 18, night);
        grass(); for (let X = 0; X < W; X += 2) R(x, '#8a8478', X, hz + 6 + (X % 4 ? 0 : 1), 2, 2);
        const r = rng(seed + 8);
        for (let i = 0; i < W / 24; i++) stamp(x, 'sheep', r() * W, hz + 2 + r() * (H - hz - 8));
        break;
      }
      case 'clinic': case 'uk:clinic': {
        if (uk) ukSky(); else { steppeSky(); farMn(); }
        const bx = Math.round(W * .25), bw = Math.round(W * .5);
        building(x, bx, hz - 28, bw, 28, uk ? '#e0e4ea' : '#e8e0d0', uk ? '#78a0c8' : '#5890c8', { night, roof: uk ? '#3a68b8' : '#8a7060', gx: 6, gy: 7, ww: 3, wh: 3 });
        const cx = bx + Math.round(bw / 2);
        R(x, '#f8f8f8', cx - 6, hz - 26, 12, 12); R(x, '#d83030', cx - 1, hz - 25, 3, 10); R(x, '#d83030', cx - 5, hz - 21, 11, 3);
        R(x, '#4a6070', cx - 4, hz - 9, 8, 9);
        pave(); stamp(x, 'tree', bx - 14, hz - 9); stamp(x, 'tree', bx + bw + 4, hz - 9);
        break;
      }
      case 'school': {
        steppeSky(); farMn();
        const bx = Math.round(W * .2), bw = Math.round(W * .6);
        building(x, bx, hz - 26, bw, 26, '#e8c070', '#4a78b0', { night, roof: '#8a3828', gx: 6, gy: 7, ww: 3, wh: 4 });
        R(x, '#c8a058', bx + bw / 2 - 8, hz - 30, 16, 4); R(x, '#5a3820', bx + bw / 2 - 3, hz - 8, 6, 8);
        pole(x, bx - 6, hz - 30, hz); R(x, '#d83030', bx - 5, hz - 30, 3, 6); R(x, '#2858b8', bx - 2, hz - 30, 3, 6); R(x, '#d83030', bx + 1, hz - 30, 3, 6); R(x, '#e8b838', bx - 4, hz - 28, 1, 2);
        pave(); stamp(x, 'tree', bx + bw + 6, hz - 9);
        break;
      }
      case 'uk:school': {
        ukSky();
        building(x, Math.round(W * .1), hz - 30, 24, 30, '#5a6a80', '#a8c8e0', { night, gx: 3, gy: 3 });
        building(x, Math.round(W * .38), hz - 44, 30, 44, '#7890a8', '#c8e0f0', { night, gx: 3, gy: 3, ww: 2, wh: 2 });
        building(x, Math.round(W * .72), hz - 34, 26, 34, '#4a5868', '#98b8d0', { night, gx: 3, gy: 3 });
        pave();
        break;
      }
      case 'city': {
        steppeSky(); farMn();
        sail(x, Math.round(W * .82), hz, night);
        palace(x, Math.round(W * .5), hz, night);
        pave(); for (let i = 0; i < W; i += 10) R(x, dark('#c8b8a0', .15), i, hz, 1, H - hz);
        statue(x, Math.round(W * .5), hz + 6);
        break;
      }
      case 'uk:city': {
        ukSky();
        const cx = Math.round(W * .5);
        building(x, cx - 50, hz - 16, 100, 16, '#c8b898', '#806848', { night, roof: '#a09070', gx: 6, gy: 6, ww: 2, wh: 5 });
        R(x, '#d8c8a8', cx - 10, hz - 22, 20, 6);
        R(x, '#a8a090', cx - 1, hz - 48, 3, 48); R(x, '#8a8478', cx - 3, hz - 50, 7, 2); R(x, '#4a4a58', cx - 1, hz - 54, 3, 4);
        pave(); stamp(x, 'lion', cx - 26, hz); stamp(x, 'lion', cx + 14, hz, 0, true);
        bus(x, Math.round(W * .76), hz - 4, night);
        break;
      }
      case 'gate': {
        sky(night ? SKY.blood : SKY.ember); stars(x, W, hz * .3, t, seed);
        mountains(x, W, seed + 1, hz - 2, hz * .6, 60, night ? '#2a1420' : '#5a2830', null, hz);
        const cx = Math.round(W / 2);
        palaceGer(x, cx, hz, night);
        for (const X of [cx - 46, cx + 42]) { pole(x, X + 2, hz - 34, hz); stamp(x, 'blacktug', X, hz - 38); }
        for (const X of [cx - 30, cx + 26]) brazier(x, X, hz, t);
        ground(x, W, H, hz, night ? ['#3a2420', '#342020', '#2e1c1c'] : ['#8a5a40', '#7a4e38', '#6a4230'], seed + 3, ['#4a2a20', '#a06848']);
        break;
      }
      case 'uk:gate': {
        sky(night ? SKY.night : SKY.grey); if (night) stars(x, W, hz * .4, t, seed);
        const cx = Math.round(W / 2);
        castle(x, cx - 36, hz - 30, night, 72);
        ground(x, W, H, hz, night ? ['#3a3a44', '#34343e', '#2e2e38'] : ['#8a8a90', '#7e7e86', '#72727a'], seed + 3, ['#a0a0a8', '#5a5a64']);
        for (const X of [cx - 46, cx + 42]) brazier(x, X, hz, t);
        break;
      }
      default: steppeSky(); farMn(); grass();
    }
  }
  // scene pieces
  function planeBody(x, X, Yy, tail, t) {
    R(x, '#f0f0f4', X, Yy + 4, 60, 7); R(x, '#d0d4e0', X, Yy + 9, 60, 2); R(x, '#f0f0f4', X + 60, Yy + 5, 4, 5); R(x, '#d0d4e0', X + 64, Yy + 7, 2, 2);
    R(x, tail, X, Yy - 4, 8, 8); R(x, tail, X + 2, Yy - 7, 5, 3); R(x, '#a8b0c0', X + 22, Yy + 9, 20, 2); R(x, '#888898', X + 28, Yy + 11, 6, 3);
    for (let i = X + 12; i < X + 56; i += 4) R(x, '#486890', i, Yy + 6, 2, 2);
    R(x, '#283850', X + 58, Yy + 6, 4, 2); R(x, tail, X + 8, Yy + 8, 50, 1);
    R(x, '#282830', X + 14, Yy + 13, 3, 2); R(x, '#282830', X + 46, Yy + 13, 3, 2);
    if ((Math.floor(t / 500) & 1) === 0) R(x, '#f83838', X + 3, Yy - 8, 1, 1);
  }
  function smoke(x, X, Yy, t) { const k = Math.floor(t / 250) % 3; for (let i = 0; i < 3; i++) R(x, '#e8e8f0', Math.round(X + ((i + k) % 2 ? 1 : -1)), Math.round(Yy - 3 - i * 3 - k), 2, 2); }
  function lamp(x, X, t, night) { R(x, '#3a2418', X, 0, 1, 6); R(x, '#e8b838', X - 2, 6, 5, 3); if (night || (Math.floor(t / 600) & 1)) R(x, '#fff0b0', X - 1, 7, 3, 1); }
  function band(x, W, Yy, a, b) { R(x, a, 0, Yy, W, 4); for (let i = 0; i < W; i += 8) { R(x, b, i + 1, Yy + 1, 3, 1); R(x, b, i + 2, Yy + 2, 1, 1); R(x, b, i + 5, Yy + 2, 2, 1); } }
  function market(x, W, hz, cols, night, t) {
    for (let X = 0, i = 0; X < W; X += 34, i++) {
      const c = cols[i % cols.length], top = hz - 18;
      for (let j = 0; j < 6; j++) R(x, j % 2 ? '#f8f0e0' : c, X + 2 + j * 5, top, 5, 5);
      R(x, dark(c, .3), X + 2, top + 5, 30, 1); pole(x, X + 3, top + 5, hz + 2); pole(x, X + 30, top + 5, hz + 2);
      R(x, '#8a5830', X + 4, hz - 6, 26, 6); R(x, '#a87040', X + 4, hz - 6, 26, 1);
      const r = rng(X + 9); for (let k = 0; k < 5; k++) R(x, ['#e8b838', '#d83030', '#78c048', '#f0f0f0', '#2858b8'][Math.floor(r() * 5)], X + 6 + k * 5, hz - 9, 3, 3);
      if (i % 2) { R(x, ['#2858b8', '#c83030', '#7848a8'][i % 3], X + 12, top + 6, 6, 8); R(x, '#e8b838', X + 12, top + 9, 6, 1); }
    }
  }
  function house(x, X, hz, night, i) {
    const w = 26, h = 22, wall = ['#9a5a40', '#8a4a38', '#a86848'][i % 3];
    R(x, '#3a3040', X - 2, hz - h - 6, w + 4, 6); R(x, '#4a4050', X, hz - h - 9, w, 3);
    R(x, wall, X, hz - h, w, h); R(x, dark(wall, .3), X + w - 1, hz - h, 1, h);
    for (const wx of [X + 3, X + 17]) { R(x, '#f0f0f0', wx - 1, hz - h + 3, 7, 6); R(x, night ? '#f8d870' : '#88a8c8', wx, hz - h + 4, 5, 4); R(x, '#f0f0f0', wx, hz - 8, 5, 5); R(x, night ? '#f8d870' : '#88a8c8', wx + 1, hz - 7, 3, 3); }
    R(x, ['#284898', '#b82838', '#2a6a48'][i % 3], X + 11, hz - 10, 5, 10); R(x, '#e8b838', X + 15, hz - 5, 1, 1);
    R(x, '#5a4a40', X + 20, hz - h - 12, 3, 4);
  }
  function castle(x, X, Yy, night, w) {
    w = w || 40; const c = night ? '#5a5868' : '#a8a498', d = dark(c, .3), h = 30;
    R(x, c, X, Yy, w, h); R(x, d, X, Yy + h - 2, w, 2);
    for (let i = 0; i < w; i += 4) R(x, c, X + i, Yy - 2, 2, 2);
    for (const tx of [X - 4, X + w - 8]) { R(x, c, tx, Yy - 10, 12, h + 10); for (let i = 0; i < 12; i += 4) R(x, c, tx + i, Yy - 12, 2, 2); R(x, '#202030', tx + 5, Yy - 4, 2, 4); R(x, d, tx + 11, Yy - 10, 1, h + 10); }
    R(x, '#201828', X + w / 2 - 4, Yy + h - 12, 8, 12); R(x, '#201828', X + w / 2 - 3, Yy + h - 13, 6, 1);
    pole(x, X + w / 2, Yy - 16, Yy - 2, '#3a3040'); R(x, '#f0f0f0', X + w / 2 + 1, Yy - 16, 7, 5); R(x, '#c82030', X + w / 2 + 1, Yy - 14, 7, 1); R(x, '#c82030', X + w / 2 + 4, Yy - 16, 1, 5);
    if (night) for (let i = 6; i < w - 6; i += 8) R(x, '#f8d870', X + i, Yy + 8, 2, 3);
  }
  function bus(x, X, Yy, night) {
    R(x, '#c82030', X, Yy - 18, 30, 22); R(x, '#a01828', X, Yy + 2, 30, 2); R(x, '#e84040', X, Yy - 18, 30, 1);
    for (let i = 2; i < 28; i += 5) { R(x, night ? '#f8e898' : '#a8c0d8', X + i, Yy - 15, 4, 4); R(x, night ? '#f8e898' : '#a8c0d8', X + i, Yy - 7, 4, 4); }
    R(x, '#181018', X + 4, Yy + 3, 5, 3); R(x, '#181018', X + 21, Yy + 3, 5, 3);
  }
  function palace(x, cx, hz, night) {
    const w = 84, c = night ? '#8a8478' : '#d8d0c0';
    R(x, dark(c, .2), cx - w / 2 - 2, hz - 22, w + 4, 22); R(x, c, cx - w / 2, hz - 21, w, 21);
    R(x, c, cx - 16, hz - 30, 32, 9); R(x, dark(c, .25), cx - 18, hz - 31, 36, 1);
    for (let i = cx - w / 2 + 4; i < cx + w / 2 - 2; i += 6) R(x, dark(c, .25), i, hz - 18, 2, 18);
    R(x, '#3a6ac8', cx - 1, hz - 38, 1, 8); R(x, '#d83030', cx, hz - 38, 4, 3);
  }
  function statue(x, cx, Yy) { R(x, '#686070', cx - 6, Yy - 2, 12, 6); R(x, '#4a4450', cx - 3, Yy - 10, 6, 8); R(x, '#4a4450', cx - 5, Yy - 7, 10, 3); R(x, '#4a4450', cx - 2, Yy - 13, 4, 3); }
  function sail(x, X, hz, night) { const c = night ? '#4a6890' : '#78a8d8'; for (let j = 0; j < 46; j++) R(x, j % 4 ? c : lite(c, .3), X - Math.round(6 * Math.sin(j / 46 * Math.PI)), hz - 46 + j, 8 + Math.round(4 * j / 46), 1); }
  function palaceGer(x, cx, hz, night) {
    const w = 64, c = night ? '#c8bca8' : '#f4eee0';
    for (let j = 0; j < 18; j++) R(x, j === 17 ? dark(c, .2) : c, cx - Math.round(w / 2 * (j + 6) / 24), hz - 40 + j, Math.round(w * (j + 6) / 24), 1);
    R(x, c, cx - w / 2, hz - 22, w, 22); R(x, dark(c, .25), cx + w / 2 - 3, hz - 22, 3, 22);
    band(x, 0, 0, c, c);
    R(x, '#2850a8', cx - w / 2, hz - 22, w, 3); for (let i = cx - w / 2; i < cx + w / 2; i += 6) R(x, '#e8b838', i + 2, hz - 21, 2, 1);
    R(x, '#e8b838', cx - 3, hz - 44, 6, 4); R(x, '#d83030', cx - 1, hz - 48, 2, 4);
    R(x, '#a02818', cx - 8, hz - 16, 16, 16); R(x, '#e8b838', cx - 6, hz - 14, 12, 1); R(x, '#e8b838', cx, hz - 14, 1, 14);
  }
  function brazier(x, X, hz, t) {
    R(x, '#3a3040', X, hz - 10, 6, 10); R(x, '#5a5060', X - 1, hz - 11, 8, 2);
    const k = Math.floor(t / 120) % 3;
    R(x, '#e84820', X, hz - 15 - (k === 1 ? 1 : 0), 6, 4); R(x, '#f8a830', X + 1, hz - 17 + (k === 2 ? 1 : 0), 4, 4); R(x, '#fff0a0', X + 2, hz - 16, 2, 2);
  }

  // ---------- the overworld: one region per chapter (level), the route through its units ----------
  const REGIONS = {
    mn: [{ base: '#78b858', b2: '#68a848', feat: 'valley' }, { base: '#6aa850', b2: '#5a9440', feat: 'mount' }, { base: '#e0c080', b2: '#d0ac68', feat: 'gobi' },
      { base: '#4a9050', b2: '#3e8048', feat: 'taiga' }, { base: '#c8d8e0', b2: '#b0c4d0', feat: 'snow' }, { base: '#c8b860', b2: '#b8a850', feat: 'valley' }],
    uk: [{ base: '#70a860', b2: '#609850', feat: 'town' }, { base: '#68a058', b2: '#589048', feat: 'river' }, { base: '#78b068', b2: '#68a058', feat: 'town' },
      { base: '#8a8a90', b2: '#7a7a82', feat: 'city' }, { base: '#909098', b2: '#80808a', feat: 'river' }, { base: '#5a8a58', b2: '#4a7a48', feat: 'highland' }]
  };
  // n nodes on a winding road from left to right (the last node is the level's guard); a narrow map snakes in rows
  function route(W, H, n, seed) {
    const r = rng(seed || 1), out = [], m = 14, per = Math.max(2, Math.floor((W - 2 * m) / 22)), rows = Math.ceil(n / per);
    for (let i = 0; i < n; i++) {
      let X, Yy;
      if (rows <= 1) {
        const k = n === 1 ? .5 : i / (n - 1);
        X = m + k * (W - 2 * m); Yy = H * .5 + Math.sin(k * Math.PI * 2.2 + seed % 7) * H * .26 + (r() - .5) * H * .1;
      } else {
        const row = Math.floor(i / per), k = i % per, step = (W - 2 * m) / per;
        X = m + (row % 2 ? per - 1 - k + .5 : k + .5) * step; Yy = (row + .5) * H / rows + (r() - .5) * H / rows * .35;
      }
      out.push({ x: Math.round(X), y: Math.max(12, Math.min(H - 10, Math.round(Yy))) });
    }
    return out;
  }
  function map(x, W, H, o) {
    const uk = o.region === 'uk', lv = Math.max(0, Math.min(5, o.level || 0)), Rg = REGIONS[uk ? 'uk' : 'mn'][lv], seed = 101 + lv * 17 + (uk ? 5 : 0), r = rng(seed), t = o.t || 0;
    R(x, Rg.base, 0, 0, W, H);
    for (let j = 0; j < H; j += 2) for (let i = (j / 2 & 1); i < W; i += 4) if (r() < .35) R(x, Rg.b2, i, j, 2, 1);
    const water = night => (Math.floor(t / 500) & 1) ? '#4888d8' : '#4080d0';
    // features under the road
    if (Rg.feat === 'river' || Rg.feat === 'taiga' || Rg.feat === 'valley') {
      for (let X = 0; X < W; X++) { const Yy = Math.round(H * (Rg.feat === 'valley' ? .82 : .2) + Math.sin(X / 23 + lv) * 5); R(x, water(), X, Yy, 1, 4); R(x, '#a8d0f8', X, Yy, 1, 1); }
    }
    if (Rg.feat === 'taiga') { const lx = W * .78; for (let j = -8; j <= 8; j++) R(x, '#4080d0', lx - Math.sqrt(64 - j * j) * 2.2, H * .74 + j, Math.sqrt(64 - j * j) * 4.4, 1); }
    if (Rg.feat === 'gobi') for (let k = 0; k < W / 14; k++) { const X = r() * W, Yy = r() * H; R(x, '#c89850', X, Yy, 8, 1); R(x, '#f0d8a0', X + 2, Yy - 1, 5, 1); }
    if (Rg.feat === 'city' || Rg.feat === 'town') {
      const step = Rg.feat === 'city' ? 10 : 16;
      for (let j = 4; j < H; j += step) for (let i = 4; i < W; i += step) if (r() < (Rg.feat === 'city' ? .8 : .45)) { const c = Rg.feat === 'city' ? ['#b0aaa0', '#a09888', '#c0b8a8'][Math.floor(r() * 3)] : ['#a85a40', '#985038'][Math.floor(r() * 2)]; R(x, '#585460', i, j + 1, step - 4, step - 4); R(x, c, i, j, step - 4, step - 5); }
      for (let j = 2; j < H; j += step) R(x, '#d0ccc0', 0, j, W, 1);
      if (Rg.feat === 'city') for (let X = 0; X < W; X++) { const Yy = Math.round(H * .78 + Math.sin(X / 19) * 4); R(x, water(), X, Yy, 1, 5); }
    }
    // mountains / forests / scenery away from the road
    const dots = route(W, H, Math.max(2, (o.nodes || []).length || 8), seed);
    const near = (X, Yy, d) => dots.some(p => Math.abs(p.x - X) < d && Math.abs(p.y - Yy) < d);
    for (let k = 0, n = W * H / (Rg.feat === 'valley' ? 300 : 160); k < n; k++) {
      const X = Math.round(r() * W), Yy = Math.round(r() * H);
      if (near(X, Yy, 12)) continue;
      const f = Rg.feat;
      if (f === 'mount' || f === 'snow' || (f === 'valley' && Yy < H * .3) || (f === 'highland' && r() < .5)) mtn(x, X, Yy, f === 'snow' || r() < .4);
      else if (f === 'taiga' || f === 'highland') stamp(x, 'pine', X - 4, Yy - 6);
      else if (f === 'gobi' && r() < .3) R(x, '#b08048', X, Yy, 3, 2);
      else if ((f === 'town' || f === 'river') && r() < .4) stamp(x, 'tree', X - 6, Yy - 5);
      else if (f === 'valley') { const q = r(); if (q < .07) stamp(x, 'i_ger', X - 4, Yy - 3); else if (q < .2) stamp(x, 'sheep', X - 4, Yy - 3); else if (q < .26) stamp(x, 'tree', X - 6, Yy - 5); }
    }
    // the road, then the nodes on it
    const nodes = o.nodes || [];
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i], b = nodes[i + 1], n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let k = 0; k <= n; k++) { const X = a.x + (b.x - a.x) * k / n, Yy = a.y + (b.y - a.y) * k / n; R(x, i < (o.hereIx || 0) ? '#f8e8a8' : '#e8d098', X - 1, Yy - 1, 2, 2); }
    }
    nodes.forEach((p, i) => {
      const cur = p.state === 'next', ring = p.boss ? '#d83030' : p.state === 'done' ? '#e8b838' : p.state === 'locked' ? '#605870' : '#f8f8f8';
      R(x, '#201828', p.x - 7, p.y - 6, 14, 13); R(x, ring, p.x - 6, p.y - 5, 12, 11); R(x, p.state === 'locked' ? '#484058' : '#283868', p.x - 5, p.y - 4, 10, 9);
      if (cur && (Math.floor(t / 300) & 1)) { R(x, '#f8e070', p.x - 8, p.y - 7, 16, 1); R(x, '#f8e070', p.x - 8, p.y + 7, 16, 1); R(x, '#f8e070', p.x - 8, p.y - 7, 1, 15); R(x, '#f8e070', p.x + 7, p.y - 7, 1, 15); }
      const ic = sprite('i_' + (p.boss ? 'gate' : p.art));
      if (ic) { x.globalAlpha = p.state === 'locked' ? .7 : 1; x.drawImage(ic.frames[0], Math.round(p.x - ic.w / 2), Math.round(p.y - ic.h / 2)); x.globalAlpha = 1; }
      if (p.state === 'done') { pole(x, p.x + 5, p.y - 12, p.y - 5, '#3a2418'); R(x, '#e8b838', p.x + 6, p.y - 12, 4, 3); }
    });
    // the hero walks from the last won node to the next one
    if (o.hero) {
      const name = walker(o.hero.skin), s = sprite(name), { x: hx, y: hy, moving } = o.hero;
      if (s) stamp(x, name, hx - s.w / 2, hy - s.h - 3 + (moving ? 0 : (Math.floor(t / 400) & 1)), moving ? Math.floor(t / 150) % 2 : 0);
    }
  }
  function mtn(x, X, Yy, snow) {
    for (let j = 0; j < 8; j++) { R(x, '#7a6a58', X - j, Yy + j, j + 1, 1); R(x, '#5a4a40', X + 1, Yy + j, j, 1); }
    if (snow) { R(x, '#f8f8ff', X - 1, Yy + 1, 2, 1); R(x, '#f8f8ff', X, Yy, 1, 1); R(x, '#d8d8e8', X + 1, Yy + 1, 1, 2); }
  }

  // ---------- animation: one ticker for every canvas in the page; without motion each one is drawn once ----------
  const live = [];
  let raf = 0, last = 0, motion = () => true;
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const kick = () => { if (!raf && live.length && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop); };
  function loop(ts) {
    raf = 0;
    const still = !motion(), due = ts - last >= 80;
    if (due) last = ts;
    let more = false;
    for (let i = live.length - 1; i >= 0; i--) {
      const L = live[i];
      if (L.cv.isConnected) L.seen = true;
      else { if (L.seen || ts - L.t0 > 4000) live.splice(i, 1); else more = true; continue; }
      if (still && L.drawn) continue;
      if (still || due || !L.drawn) { try { L.draw(still ? 0 : Math.max(0, ts - L.t0)); } catch (e) { live.splice(i, 1); setTimeout(() => { throw e; }); continue; } L.drawn = true; }   // a broken one is reported, the others go on
      if (!still) more = true;
    }
    if (more) kick();
  }
  function animate(cv, draw) {
    if (!cv || !ok2d()) return;
    live.push({ cv, draw, t0: now(), seen: false, drawn: false });
    kick();
  }
  // after a resize / theme change: draw the still canvases again
  function refresh() { live.forEach(L => { L.drawn = false; }); kick(); }

  Y.pixel = { hash, rng, mix, dark, lite, sprite, shadowArt, refresh, foe, HERO, hero, walker, skinId, skinDef, SKINS, roleKind, personDef, idle, stamp, scene, map, route, animate, ok2d,
    setMotion: f => { motion = f; }, SKY, PROPS, BOSSES, HEADS, TORSOS, LEGS, ARCH };
})();
