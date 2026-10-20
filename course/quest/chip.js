/* Yarya Quest chiptune: sound effects and two short looping themes, synthesized with Web Audio (square, triangle,
   noise), no audio files. Plain script, no modules.
     Yarya.chip.sfx(name)        blip, select, learn, correct, slash, hit, heal, tick, drum, swirl, text, victory, defeat
     Yarya.chip.music(name)      'map' | 'battle' | 'boss' | null (stop); plays only while enabled (setMusic) and not muted
     Yarya.chip.setMuted(b), setMusic(b)
   The melodies are original (pentatonic, a nod to Mongolian long songs on the map; minor pentatonic in battle). */
(function () {
  'use strict';
  const Y = window.Yarya = window.Yarya || {};
  let ctx = null, master = null, noiseBuf = null, muted = false, musicOn = false, want = null, cur = null, timer = null;
  function ac() {
    if (!ctx) {
      const A = window.AudioContext || window.webkitAudioContext; if (!A) return null;
      try { ctx = new A(); } catch (e) { return null; }
      master = ctx.createGain(); master.gain.setValueAtTime(.8, 0); master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  // one note: an oscillator through an attack / decay envelope
  function tone(f, at, dur, type, vol, f2) {
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(vol || .08, t0 + .008); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    o.connect(g); g.connect(master || c.destination); o.start(t0); o.stop(t0 + dur + .02);
  }
  // white noise (snare, hat, impacts); skipped where the audio engine cannot make buffers
  function noise(at, dur, vol) {
    const c = ac(); if (!c || !c.createBuffer || !c.createBufferSource) return;
    if (!noiseBuf) { noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * .5), c.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t0 = c.currentTime + at, s = c.createBufferSource(), g = c.createGain();
    s.buffer = noiseBuf; g.gain.setValueAtTime(vol || .06, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
    s.connect(g); g.connect(master || c.destination); s.start(t0); s.stop(t0 + dur + .02);
  }
  const notes = (seq, step, type, vol, at) => { let t = at || 0; for (const [m, n] of seq) { if (m) tone(hz(m), t, step * n * .95, type, vol); t += step * n; } return t; };
  const FX = {
    blip: () => tone(1320, 0, .035, 'square', .035),
    select: () => { tone(988, 0, .05, 'square', .05); tone(1480, .05, .07, 'square', .045); },
    text: () => tone(1760, 0, .012, 'square', .012),
    learn: () => { [84, 88, 91, 96].forEach((m, i) => tone(hz(m), i * .05, .12, 'square', .035)); tone(hz(72), 0, .3, 'triangle', .1); },
    correct: () => { tone(hz(79), 0, .08, 'square', .06); tone(hz(84), .07, .16, 'square', .06); },
    slash: () => { noise(0, .12, .08); tone(1800, 0, .12, 'square', .04, 300); tone(hz(84), .1, .14, 'square', .05); },
    hit: () => { noise(0, .25, .14); tone(220, 0, .28, 'square', .1, 55); tone(110, .02, .3, 'triangle', .16, 40); },
    heal: () => { [72, 76, 79, 84, 88].forEach((m, i) => tone(hz(m), i * .06, .16, 'triangle', .12)); [84, 88, 91].forEach((m, i) => tone(hz(m), .1 + i * .06, .1, 'square', .025)); },
    tick: () => tone(2000, 0, .025, 'square', .03),
    drum: () => { [0, .3, .6, .75].forEach((t, i) => { tone(i === 3 ? 90 : 70, t, .22, 'triangle', .3, 40); noise(t, .08, .05); }); },
    swirl: () => { noise(0, .6, .05); for (let i = 0; i < 12; i++) tone(hz(96 - i * 3), i * .04, .06, 'square', .035); },
    victory: () => {
      const s = .1;
      notes([[67, 1], [67, 1], [67, 1], [72, 3], [0, 1], [76, 2], [74, 2], [72, 2], [76, 2], [79, 6]], s, 'square', .07);
      notes([[64, 1], [64, 1], [64, 1], [67, 3], [0, 1], [72, 2], [71, 2], [67, 2], [72, 2], [76, 6]], s, 'square', .035);
      notes([[48, 3], [48, 4], [43, 4], [48, 8]], s, 'triangle', .16);
    },
    defeat: () => { notes([[76, 3], [74, 3], [72, 3], [71, 3], [69, 10]], .13, 'square', .06); notes([[57, 6], [53, 6], [45, 10]], .13, 'triangle', .16); }
  };

  // ---------- music: tracks of [midi or 0, sixteenths], each loops on its own length ----------
  const SONGS = {
    map: { bpm: 96, tracks: [
      { type: 'square', vol: .035, seq: [[69, 4], [71, 2], [69, 2], [66, 4], [64, 4], [62, 6], [64, 2], [66, 4], [69, 4], [71, 4], [74, 4], [71, 2], [69, 2], [66, 4], [64, 12], [0, 4],
        [66, 4], [69, 4], [71, 4], [69, 2], [71, 2], [74, 6], [71, 2], [69, 8], [66, 4], [64, 2], [66, 2], [69, 4], [66, 4], [62, 12], [0, 4]] },
      { type: 'triangle', vol: .11, seq: [[50, 8], [45, 8], [47, 8], [42, 8], [43, 8], [50, 8], [45, 8], [45, 8]] },
      { type: 'noise', vol: .012, seq: [[1, 4], [0, 4], [1, 4], [0, 2], [1, 2]] }] },
    battle: { bpm: 150, tracks: [
      { type: 'square', vol: .035, seq: [[76, 2], [74, 2], [72, 2], [69, 2], [72, 4], [74, 4], [76, 6], [79, 2], [76, 4], [74, 4], [72, 2], [74, 2], [76, 4], [69, 4], [72, 4], [74, 8], [71, 4], [67, 4],
        [69, 4], [72, 4], [76, 4], [81, 4], [79, 6], [76, 2], [74, 4], [72, 4], [74, 2], [76, 2], [79, 4], [76, 4], [74, 4], [69, 12], [0, 4]] },
      { type: 'triangle', vol: .13, seq: [[45, 2], [57, 2], [45, 2], [57, 2], [45, 2], [57, 2], [45, 2], [57, 2], [43, 2], [55, 2], [43, 2], [55, 2], [41, 2], [53, 2], [43, 2], [55, 2]] },
      { type: 'noise', vol: .03, seq: [[1, 2], [1, 2], [2, 2], [1, 2], [1, 2], [1, 2], [2, 2], [1, 1], [1, 1]] }] }
  };
  SONGS.boss = { bpm: 164, tracks: SONGS.battle.tracks.map(tr => tr.type === 'noise' ? tr : Object.assign({}, tr, { seq: tr.seq.map(([m, n]) => [m ? m - 3 : 0, n]) })) };
  function start(name) {
    stop();
    const c = ac(), S = SONGS[name]; if (!c || !S) return;
    const step = 60 / S.bpm / 4, st = S.tracks.map(() => ({ i: 0, at: c.currentTime + .1 }));
    cur = name;
    timer = setInterval(() => {
      if (!ctx) return;
      const ahead = ctx.currentTime + .25;
      S.tracks.forEach((tr, k) => {
        const s = st[k];
        while (s.at < ahead) {
          const [m, n] = tr.seq[s.i % tr.seq.length], at = s.at - ctx.currentTime;
          if (m && at >= -.02) {
            if (tr.type === 'noise') noise(Math.max(0, at), m === 2 ? .09 : .03, m === 2 ? tr.vol * 2.5 : tr.vol);
            else tone(hz(m), Math.max(0, at), step * n * .9, tr.type, tr.vol);
          }
          s.at += step * n; s.i++;
        }
      });
    }, 40);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } cur = null; }
  function sync() { const w = !muted && musicOn ? want : null; if (w !== cur) { if (w) start(w); else stop(); } }

  Y.chip = {
    sfx(name) { if (muted || !FX[name]) return; try { FX[name](); } catch (e) {} },
    music(name) { want = name || null; try { sync(); } catch (e) {} },
    setMuted(b) { muted = !!b; try { sync(); } catch (e) {} },
    setMusic(b) { musicOn = !!b; try { sync(); } catch (e) {} },
    playing: () => cur, SONGS, FX
  };
})();
