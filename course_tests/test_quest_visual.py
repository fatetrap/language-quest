"""Visual check of Yarya Quest in headless Chromium (optional: needs `pip install playwright` + `playwright install chromium`).

Drives camp, duel (story, teach card, question, wrong answer, word bank), victory and defeat at 375 px and 1280 px,
light and dark, on the real course/db. In every state it measures the computed contrast of each visible text element
against the solid background behind it, or against every stop of its window's gradient (WCAG AA: 4.5:1, large text
3:1), fails on text drawn straight over the scene art, long uppercase text, the board / console pushed off screen, or
horizontal overflow; the bundled pixel fonts must be loaded (Mongolian Cyrillic included).
Screenshots go to $YARYA_SHOTS (default: a temp folder), e.g.
  set YARYA_SHOTS=work\\shots && .venv\\Scripts\\python.exe -m pytest course_tests\\test_quest_visual.py -q
"""
import json
import os
import tempfile
from pathlib import Path

import pytest

playwright = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).resolve().parent.parent
QUEST = (ROOT / "course" / "quest" / "index.html").as_uri()
SHOTS = Path(os.environ.get("YARYA_SHOTS") or tempfile.mkdtemp(prefix="yarya-shots-"))

# contrast of every visible text node's element against the first opaque background up the tree (alpha composited)
AUDIT_JS = r"""
() => {
  const rgba = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
  const bad = [], seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement, txt = n.textContent.trim();
    if (!txt || !el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('svg,[aria-hidden="true"],.grain,.used,[disabled],.locked')) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
    if (el.closest('details:not([open]) > :not(summary)')) continue;
    let layers = [], onArt = false, op = 1, stops = null;
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a); op *= +s.opacity;
      if (a.classList && (a.classList.contains('stage') || a.classList.contains('scene'))) { onArt = true; break; }
      // a window: a plain linear gradient of opaque colours; the text must pass on every stop of it
      if (s.backgroundImage !== 'none' && !a.matches('.ruler i')) {
        const cols = (s.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(rgba);
        if (/^linear-gradient/.test(s.backgroundImage) && !/url\(/.test(s.backgroundImage) && cols.length && cols.every(c => c[3] >= .999)) { stops = cols; break; }
        onArt = true; break;
      }
      const b = rgba(s.backgroundColor); if (b && b[3] > 0) { layers.push(b); if (b[3] >= .999) break; }
    }
    // a fixed overlay sits over the page: its own background ends the walk above (handled by the loop)
    let ratio = Infinity;
    for (const base of stops || [[255, 255, 255, 1]]) {
      let bg = base;
      for (const l of layers.slice().reverse()) bg = over(l, bg);
      let fg = rgba(cs.color); fg = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
      const L1 = lum(fg), L2 = lum(bg);
      ratio = Math.min(ratio, (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05));
    }
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
    const where = (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ' "' + txt.slice(0, 40) + '"';
    if (onArt) bad.push({ kind: 'text on the scene art', where });
    else if (ratio < (large ? 3 : 4.5)) bad.push({ kind: 'contrast ' + ratio.toFixed(2), where, fg: cs.color, size });
    if (cs.textTransform === 'uppercase' && txt.length > 40) bad.push({ kind: 'long uppercase text', where });
  }
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) bad.push({ kind: 'horizontal overflow', where: doc.scrollWidth + 'px' });
  return bad;
}
"""
# a fixed plan / rules for the end screens; answers via the DB like a player who knows (or not) the word
HELP_JS = r"""() => {
window.__answer = right => {
  const tg = native === 'en' ? 'mn' : 'en', p = document.querySelector('.say.ask .big').textContent;
  const v = Object.values(YARYA_DB.items).find(v => v.type === 'word' && (v[tg] === p || v[native] === p));
  const want = v[tg] === p ? v[native] : v[tg], opts = [...document.querySelectorAll('.console .opt')];
  const k = opts.findIndex(o => o.querySelector('.tx').textContent === want);
  opts[right ? k : (k + 1) % opts.length].click();
};
}
"""


def seed(page, theme, native="en"):
    page.add_init_script("""(() => { try {
      localStorage.setItem('native', '"%s"'); localStorage.setItem('theme', '%d'); localStorage.setItem('quest_timer', 'false');
      localStorage.setItem('quest_%s', JSON.stringify({ won: {}, best: 0, onb: true }));
    } catch (e) {} })();""" % (native, theme, native))


def skip_story(page):
    while page.get_attribute(".console", "data-round") in ("story", "teach"):
        page.click(".console .got")


def states(page):
    """Yields (name, page) at each state of the flow."""
    page.goto(QUEST)
    page.wait_for_selector(".hero .fight-go", timeout=60000)
    page.evaluate(HELP_JS)
    yield "camp"
    page.click(".hero .fight-go")
    page.wait_for_selector('.console[data-round="story"]')
    yield "story"
    page.click(".tip summary")
    yield "story-grammar-open"
    page.click(".console .got")
    page.wait_for_selector('.console[data-round="teach"]')
    yield "teach"
    skip_story(page)
    page.wait_for_selector('.console[data-round="mc"]')
    yield "question"
    page.evaluate("__answer(false)")
    page.wait_for_selector(".verdict.no")
    yield "wrong"
    # a word bank round (fixed plan) on the first lesson's first sentence
    page.evaluate("""(() => { const Q = Yarya.quest, real = Q.plan, s = YARYA_DB.lessons.find(l => l.written).sentences[0];
      Q.plan = () => ({ teach: [], recap: [], rounds: [{ t: 'build', id: s, lid: YARYA_DB.items[s].lesson }] });
      fight(Q.campaign()[0]); Q.plan = real; })()""")
    skip_story(page)
    page.wait_for_selector('.console[data-round="build"]')
    yield "build"
    page.evaluate("""(() => { const Q = Yarya.quest, real = Q.plan, w = YARYA_DB.lessons.find(l => l.written).words[0];
      Q.plan = () => ({ teach: [], recap: [], rounds: [{ t: 'mc', id: w, rev: false, lid: YARYA_DB.items[w].lesson, n: 4 }] });
      fight(Q.campaign()[0]); Q.plan = real; })()""")
    skip_story(page)
    page.wait_for_selector('.console[data-round="mc"]')
    page.evaluate("__answer(true)")
    page.wait_for_selector(".over.victory", timeout=5000)
    page.wait_for_timeout(500)
    yield "victory"
    page.evaluate("""(() => { const Q = Yarya.quest, real = Q.rules; Q.rules = e => Object.assign(real(e), { damage: 100 });
      camp(); fight(Q.campaign()[1]); Q.rules = real; })()""")
    skip_story(page)
    page.wait_for_selector('.console[data-round="mc"]')
    page.evaluate("__answer(false)")
    page.wait_for_selector(".over.defeat", timeout=5000)
    page.wait_for_timeout(500)
    yield "defeat"


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # noqa: BLE001  browser not installed
            pytest.skip(f"chromium not available: {e}")
        yield b
        b.close()


@pytest.mark.parametrize("width,height", [(375, 667), (1280, 800)])
@pytest.mark.parametrize("theme", [1, 2], ids=["light", "dark"])
@pytest.mark.parametrize("native", ["en", "mn"])
def test_screens_readable(browser, width, height, theme, native):
    ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme="light" if theme == 1 else "dark",
                              reduced_motion="reduce")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    seed(page, theme, native)
    problems, layout = {}, {}
    for name in states(page):
        if name == "camp":
            assert page.evaluate("document.fonts.check('16px \"Yarya Uni\"', 'Өө Үү') && document.fonts.check('16px \"Yarya Pixel\"', 'Өө Үү')"), "pixel fonts not loaded"
        tag = f"{native}-{width}-{'light' if theme == 1 else 'dark'}-{name}"
        page.wait_for_function("document.getAnimations().every(a => a.playState !== 'running' || a.effect.getTiming().iterations === Infinity)")
        page.wait_for_timeout(50)
        page.screenshot(path=str(SHOTS / f"{tag}.png"))
        bad = page.evaluate(AUDIT_JS)
        if bad:
            problems[tag] = bad
        if name in ("story", "teach", "question", "wrong", "build"):
            # the scene, the card and the answers all on screen together
            box = {s: page.eval_on_selector(s, "e => { const r = e.getBoundingClientRect(); return [r.top, r.bottom]; }")
                   for s in (".stage", ".board .say", ".console")}
            wide = page.evaluate("[...document.querySelectorAll('.board .say,.board .tip,.bubble')].some(e => e.getBoundingClientRect().right > innerWidth + 1)")
            assert not wide, (tag, "a card is wider than the screen")
            assert page.evaluate("document.querySelector('.board').clientHeight") >= 60, (tag, "board squeezed", box)
            layout[tag] = box
            assert box[".stage"][1] - box[".stage"][0] >= 120, (tag, "scene too small", box)
            assert box[".board .say"][0] < height and box[".console"][1] <= height + 1, (tag, "card / console off screen", box)
    ctx.close()
    assert not errors, errors
    assert not problems, json.dumps(problems, ensure_ascii=False, indent=1)
