// Optional real-browser checks: install playwright and its Chromium browser, then
// node --test course_tests/skins_test.js. BROWSER_EXECUTABLE can select a local Chrome.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

test('skins preview, save, cancel, reload and follow the player in both languages', { skip: !chromium, timeout: 120000 }, async t => {
  const root = path.resolve(__dirname, '../course');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    for (const [native, width, colorScheme, reducedMotion] of [['en', 1280, 'dark', 'no-preference'], ['mn', 360, 'light', 'reduce']]) await t.test(`${native} at ${width}px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 812 }, reducedMotion, colorScheme });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/quest/`);
        await page.evaluate(n => {
          Yarya.progress.setNative(n);
          Yarya.store.set('quest_' + n, { won: {}, best: 0, onb: true });
          Yarya.store.set('quest_skin', '__proto__');
        }, native);
        await page.reload();
        await page.locator('.skin-change').waitFor();
        assert.equal(await page.locator('.character canvas').getAttribute('data-sprite'), 'hero:traveler', 'invalid saved choice falls back');
        const before = await page.evaluate(() => ({ en: Yarya.store.get('quest_en', null), mn: Yarya.store.get('quest_mn', null), xp: Yarya.progress.xp() }));
        await page.locator('.skin-change').click();
        assert.equal(await page.locator('.skin-option').count(), 4);
        assert.equal(await page.evaluate(() => document.activeElement.dataset.skin), 'traveler');
        assert.equal(await page.evaluate(() => document.getElementById('app').inert), true);
        const previews = await page.locator('.skin-option canvas').evaluateAll(canvases => canvases.map(c => c.toDataURL()));
        assert.equal(new Set(previews).size, 4, 'each skin has its own rendered preview');
        const renders = await page.evaluate(() => {
          const px = Yarya.pixel;
          return Object.keys(px.SKINS).map(id => {
            const actor = px.sprite(px.hero(id)), walker = px.sprite(px.walker(id));
            return { actor: actor.frames[0].toDataURL(), walker: walker.frames[0].toDataURL(), frames: actor.frames.length };
          });
        });
        assert.equal(new Set(renders.map(r => r.walker)).size, 4, 'map walkers match the different looks');
        assert.ok(renders.every(r => r.frames === 3));
        await page.locator('[data-skin="scholar"]').click();
        await page.locator('.skin-save').click();
        assert.equal(await page.locator('.character canvas').getAttribute('data-sprite'), 'hero:scholar');
        assert.equal(await page.evaluate(() => Yarya.store.get('quest_skin')), 'scholar');
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains('skin-change')), true);
        await page.reload();
        await page.locator('.skin-change').waitFor();
        assert.equal(await page.locator('.character canvas').getAttribute('data-sprite'), 'hero:scholar', 'choice survives a reload');
        await page.locator('.skin-change').click();
        await page.locator('[data-skin="nomad"]').click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.skin-modal').count(), 0);
        assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
        assert.equal(await page.evaluate(() => Yarya.store.get('quest_skin')), 'scholar', 'Escape discards the preview');
        await page.locator('.skin-change').click();
        await page.locator('[data-skin="ranger"]').click();
        await page.locator('.skin-cancel').click();
        assert.equal(await page.evaluate(() => Yarya.store.get('quest_skin')), 'scholar', 'Cancel discards the preview');
        await page.locator('.skin-change').click();
        await page.locator('.skin-save').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.skin), 'traveler', 'Tab stays inside the dialog');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains('skin-save')), true);
        if (process.env.SKIN_SCREENSHOTS) {
          fs.mkdirSync(process.env.SKIN_SCREENSHOTS, { recursive: true });
          await page.screenshot({ path: path.join(process.env.SKIN_SCREENSHOTS, `skins-${native}-${width}.png`) });
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, 'no horizontal overflow');
        const dialogFits = await page.locator('.skin-sheet').evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        });
        assert.equal(dialogFits, true, 'picker fits the viewport');
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
          const drawMap = Yarya.pixel.map;
          Yarya.pixel.map = function(ctx, w, h, options) { window.__mapSkin = options.hero.skin; return drawMap(ctx, w, h, options); };
          Yarya.pixel.refresh();
        });
        await page.waitForFunction(() => window.__mapSkin === 'scholar');
        assert.deepEqual(await page.evaluate(() => ({ en: Yarya.store.get('quest_en', null), mn: Yarya.store.get('quest_mn', null), xp: Yarya.progress.xp() })), before, 'cosmetics preserve progress');
        await page.evaluate(() => {
          Yarya.progress.setNative(Yarya.progress.native() === 'en' ? 'mn' : 'en');
          Yarya.store.set('quest_' + Yarya.progress.native(), { won: {}, best: 0, onb: true });
        });
        await page.reload();
        await page.locator('.skin-change').waitFor();
        assert.equal(await page.locator('.character canvas').getAttribute('data-sprite'), 'hero:scholar', 'look is shared across language directions');
        await page.locator('.fight-go').click();
        await page.locator('.actor.me canvas').waitFor();
        assert.equal(await page.locator('.actor.me canvas').getAttribute('data-sprite'), 'hero:scholar', 'selected character enters battle');
        await page.evaluate(() => {
          const Q = Yarya.quest;
          Q.rules = () => ({ damage: 100, heal: 0, healEvery: 3, time: 0, xp: 0 });
          Q.plan = () => ({ teach: [], recap: [], rounds: [] });
          fight(Q.campaign()[0]);
        });
        await page.locator('.console .got').click();
        await page.locator('.over.victory canvas[data-sprite="hero:scholar"]').waitFor();
        assert.deepEqual(errors, [], 'no browser errors');
      } finally { await context.close(); }
    });
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
