"""The 16-bit JRPG layer of Yarya Quest in headless Chromium (optional: `pip install playwright` + `playwright install
chromium`): pixel art drawn at an integer scale, the pixel fonts with Mongolian Cyrillic, typewriter text, the menu
cursor on the keyboard, the battle swirl, damage numbers, music off by default and remembered, 360 px phones, the art
gallery. Also the pixel_test.js unit tests (node). Screenshots of every screen (motion on, both directions, both
themes, 1280x800 and 375x812) go to course_tests/shots_jrpg/ for people to look at:
  .venv\\Scripts\\python.exe -m pytest course_tests\\test_quest_jrpg.py -q
"""
import shutil
import subprocess
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent
ROOT = TESTS.parent
QUEST = (ROOT / 'course' / 'quest' / 'index.html').as_uri()
GALLERY = (ROOT / 'course' / 'quest' / 'gallery.html').as_uri()
SHOTS = TESTS / 'shots_jrpg'
NODE = shutil.which('node')


@pytest.mark.skipif(not NODE, reason='node not installed')
def test_pixel_and_chip_unit():
    r = subprocess.run([NODE, '--test', 'pixel_test.js'], capture_output=True, text=True, timeout=120, cwd=TESTS)
    assert r.returncode == 0 and 'fail 0' in r.stdout, r.stdout + r.stderr


playwright = pytest.importorskip('playwright.sync_api')

# a fixed one-round fight on the first lesson's first word (teach it, then ask it); kind 'lose' = one hit kills
FIX = """kind => { const Q = Yarya.quest, real = Q.plan, rr = Q.rules, w = YARYA_DB.lessons.find(l => l.written).words[0];
  Q.plan = () => ({ teach: [w], recap: [], rounds: [{ t: 'mc', id: w, rev: false, lid: YARYA_DB.items[w].lesson, n: 4 }] });
  if (kind === 'lose') Q.rules = e => Object.assign(rr(e), { damage: 100 });
  fight(Q.campaign()[kind === 'lose' ? 1 : 0]); Q.plan = real; Q.rules = rr; }"""
# the index of the right / a wrong option of the multiple choice on screen (looked up in the DB like a player who knows)
PICK = """right => { const tg = native === 'en' ? 'mn' : 'en', p = document.querySelector('.say.ask .big').textContent;
  const v = Object.values(YARYA_DB.items).find(v => v.type === 'word' && (v[tg] === p || v[native] === p));
  const want = v[tg] === p ? v[native] : v[tg], opts = [...document.querySelectorAll('.console .opt')];
  const k = opts.findIndex(o => o.querySelector('.tx').textContent === want); return right ? k : (k + 1) % opts.length; }"""


@pytest.fixture(scope='module')
def browser():
    with playwright.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # noqa: BLE001  browser not installed
            pytest.skip(f'chromium not available: {e}')
        yield b
        b.close()


def page_for(browser, native, w, h, theme=2, motion='no-preference', fresh=False):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, reduced_motion=motion, color_scheme='light' if theme == 1 else 'dark')
    page = ctx.new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    seed = "localStorage.setItem('theme', '%d'); localStorage.setItem('quest_timer', 'false');" % theme
    if not fresh:
        seed += """localStorage.setItem('native', '"%s"'); localStorage.setItem('quest_%s', JSON.stringify({ won: {}, best: 0, onb: true }));""" % (native, native)
    page.add_init_script('(() => { try { if (!sessionStorage.getItem("seeded")) { %s sessionStorage.setItem("seeded", "1"); } } catch (e) {} })();' % seed)
    return ctx, page


def to_round(page):
    # through the story / teach cards (Enter: the first one finishes the typewriter, then it moves on)
    for _ in range(40):
        if page.get_attribute('.console', 'data-round') not in ('story', 'teach'):
            return
        page.keyboard.press('Enter')
        page.wait_for_timeout(60)


def shoot(page, name):
    SHOTS.mkdir(exist_ok=True)
    page.screenshot(path=str(SHOTS / f'{name}.png'))


@pytest.mark.parametrize('native,w,h,theme', [('en', 1280, 800, 2), ('mn', 1280, 800, 1), ('en', 375, 812, 1), ('mn', 375, 812, 2)])
def test_screens_and_screenshots(browser, native, w, h, theme):
    ctx, page = page_for(browser, native, w, h, theme, fresh=True)
    tag = f"{native}-{w}-{'light' if theme == 1 else 'dark'}"
    page.goto(QUEST)
    page.wait_for_selector('.choose button', timeout=60000)
    page.wait_for_timeout(700)
    shoot(page, f'{tag}-01-title')
    page.click('.choose button >> nth=%d' % (0 if native == 'en' else 1))
    page.wait_for_selector('.onb .card')
    page.wait_for_timeout(1400)
    shoot(page, f'{tag}-02-onboarding')
    page.keyboard.press('Escape')
    page.wait_for_selector('.mapbox canvas')
    page.wait_for_timeout(900)
    shoot(page, f'{tag}-03-worldmap')
    # the fight: the swirl, then the story typed out
    page.click('.hero .fight-go')
    assert page.query_selector('.swirl'), 'battle swirl'
    page.wait_for_timeout(250)
    shoot(page, f'{tag}-04-battle-swirl')
    page.wait_for_selector('.console[data-round="story"]')
    page.wait_for_timeout(700)
    assert not page.query_selector('.swirl'), 'the swirl is gone'
    page.wait_for_function("!document.querySelector('.board [data-typing]')", timeout=20000)
    shoot(page, f'{tag}-05-story')
    page.click('.console .got')
    page.wait_for_selector('.console[data-round="teach"]')
    page.wait_for_timeout(700)
    shoot(page, f'{tag}-06-teach')
    to_round(page)
    page.wait_for_selector('.console .opt.cur')
    page.wait_for_timeout(400)
    shoot(page, f'{tag}-07-command-menu')
    # a wrong answer: shake, a damage number over the player
    page.click('.console .opt >> nth=%d' % page.evaluate(f'({PICK})(false)'))
    page.wait_for_selector('.pop.dmg')
    page.wait_for_timeout(180)
    shoot(page, f'{tag}-08-hit')
    page.wait_for_timeout(900)
    shoot(page, f'{tag}-09-answer')
    # victory fanfare (with the words learned) and game over
    page.evaluate(f'({FIX})("win")')
    page.wait_for_timeout(800)
    to_round(page)
    page.click('.console .opt >> nth=%d' % page.evaluate(f'({PICK})(true)'))
    page.wait_for_selector('.over.victory .learned li', timeout=8000)
    page.wait_for_timeout(1500)
    shoot(page, f'{tag}-10-victory')
    page.evaluate(f'({FIX})("lose")')
    page.wait_for_timeout(800)
    to_round(page)
    page.click('.console .opt >> nth=%d' % page.evaluate(f'({PICK})(false)'))
    page.wait_for_selector('.over.defeat', timeout=8000)
    page.wait_for_timeout(1200)
    shoot(page, f'{tag}-11-game-over')
    page.keyboard.press('Escape')
    page.wait_for_selector('.mapbox canvas')
    assert not page.errors, page.errors
    ctx.close()


def test_pixel_art_is_drawn_at_an_integer_scale(browser):
    for w, h, scale in ((1280, 800, 3), (375, 812, 2)):
        ctx, page = page_for(browser, 'en', w, h)
        page.goto(QUEST)
        page.wait_for_selector('.mapbox canvas', timeout=60000)
        page.click('.hero .fight-go')
        page.wait_for_selector('.console[data-round="story"]')
        page.wait_for_timeout(900)
        info = page.evaluate("""() => [...document.querySelectorAll('.stage canvas, .hud canvas')].filter(c => c.width && c.getBoundingClientRect().width).map(c => {
          const r = c.getBoundingClientRect(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, cols = new Set();
          for (let i = 0; i < d.length; i += 4 * 7) cols.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
          return { k: c.className || 'scene', ratio: r.width / c.width, ry: r.height / c.height, pix: getComputedStyle(c).imageRendering, cols: cols.size }; })""")
        assert len(info) >= 3, info                      # scene, opponent, player (+ the HUD portrait on wide screens)
        for c in info:
            mini = c['k'] == 'spr mini'
            want = (2 if w >= 900 else 1) if mini else scale
            assert abs(c['ratio'] - want) < .01 and abs(c['ry'] - want) < .01, (w, c)
            assert c['pix'] == 'pixelated', c
            assert c['cols'] >= (20 if c['k'] == 'scene' else 6), ('canvas looks empty', c)
        assert page.evaluate("document.fonts.check('24px \"Yarya Uni\"', 'Өө Үү') && document.fonts.check('16px \"Yarya Pixel\"', 'Өө Үү')")
        assert not page.errors, page.errors
        ctx.close()


def test_typewriter_menu_cursor_and_keys(browser):
    ctx, page = page_for(browser, 'mn', 1280, 800)
    page.goto(QUEST)
    page.wait_for_selector('.mapbox canvas', timeout=60000)
    page.keyboard.press('Enter')                          # Enter in the camp: fight the next encounter
    page.wait_for_selector('.console[data-round="story"]')
    page.wait_for_timeout(300)
    assert page.query_selector('.board [data-typing]'), 'the story is typed out'
    full = page.text_content('.story p')
    page.keyboard.press('Enter')                          # the first Enter shows all of it, ▼ waits for the next
    assert not page.query_selector('.board [data-typing]') and page.query_selector('.story p.typed.more')
    assert page.text_content('.story p') == full and page.get_attribute('.console', 'data-round') == 'story'
    to_round(page)
    page.wait_for_selector('.console .opt.cur')
    opts = page.query_selector_all('.console .opt')
    assert 'cur' in opts[0].get_attribute('class'), 'the hand starts on the first command'
    page.keyboard.press('ArrowDown' if len(opts) > 2 and page.evaluate("innerWidth < 560") else 'ArrowRight')
    cur = page.evaluate("[...document.querySelectorAll('.console .opt')].findIndex(o => o.classList.contains('cur'))")
    assert cur == 1, cur
    page.keyboard.press('Enter')
    page.wait_for_selector('.verdict')
    assert page.evaluate("[...document.querySelectorAll('.console .opt')].some(o => o.classList.contains('good'))")
    assert not page.errors, page.errors
    ctx.close()


def test_music_off_by_default_and_remembered(browser):
    ctx, page = page_for(browser, 'en', 1280, 800)
    page.goto(QUEST)
    page.wait_for_selector('.mapbox canvas', timeout=60000)
    assert page.evaluate('Yarya.chip.playing()') is None, 'music is off by default'
    page.click('.top .ibtn[aria-label="Music"]')
    assert page.evaluate("localStorage.getItem('quest_music')") == 'true'
    assert page.evaluate('Yarya.chip.playing()') == 'map', 'the map theme in the camp'
    page.click('.hero .fight-go')
    assert page.evaluate('Yarya.chip.playing()') == 'battle', 'the battle theme in a fight'
    page.reload()
    page.wait_for_selector('.mapbox canvas', timeout=60000)
    page.mouse.click(5, 300)                              # a gesture (browsers start audio after one)
    assert page.get_attribute('.top .ibtn[aria-label="Music"]', 'aria-pressed') == 'true', 'remembered'
    assert page.evaluate('Yarya.chip.playing()') == 'map'
    page.click('.top .ibtn[aria-label="Sound"]')          # mute stops the music too
    assert page.evaluate('Yarya.chip.playing()') is None
    assert not page.errors, page.errors
    ctx.close()


@pytest.mark.parametrize('native', ['en', 'mn'])
def test_360px_phone(browser, native):
    ctx, page = page_for(browser, native, 360, 740, theme=1)
    page.goto(QUEST)
    page.wait_for_selector('.mapbox canvas', timeout=60000)
    page.wait_for_timeout(400)
    over = "document.documentElement.scrollWidth <= innerWidth + 1"
    assert page.evaluate(over), 'camp wider than the phone'
    nodes = page.evaluate("""() => { const m = document.querySelector('.mapbox').getBoundingClientRect();
      return [...document.querySelectorAll('.mapnode')].map(b => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2 - m.left, r.top + r.height / 2 - m.top, m.width, m.height]; }); }""")
    assert nodes and all(0 <= x <= mw and 0 <= y <= mh for x, y, mw, mh in nodes), nodes
    page.click('.hero .fight-go')
    page.wait_for_selector('.console[data-round="story"]')
    to_round(page)
    page.wait_for_selector('.console .opt')
    page.wait_for_selector('.swirl', state='detached')
    assert page.evaluate(over), 'fight wider than the phone'
    shoot(page, f'{native}-360-light-12-phone-question')
    assert not page.errors, page.errors
    ctx.close()


def test_gallery(browser):
    ctx, page = page_for(browser, 'en', 1280, 800)
    page.goto(GALLERY)
    page.wait_for_timeout(1200)
    assert page.evaluate("document.querySelectorAll('canvas').length") > 60
    page.screenshot(path=str(SHOTS / 'gallery.png'), full_page=True)
    assert not page.errors, page.errors
    ctx.close()
