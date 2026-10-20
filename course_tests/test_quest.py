"""Tests for the quest game (course/quest/index.html + campaign.js): static checks in Python, the Node unit tests of
campaign.js (quest_test.js) and the jsdom smoke test (quest_smoke.js) when node + jsdom exist.
Both use course/db/content.js(on) when it is built, else the small fixture course quest_fixture_db.js.

Run from the project root:  python -m pytest course_tests -q
(jsdom: `npm install` inside course_tests once)
"""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
QUEST = ROOT / 'course' / 'quest'
HTML = (QUEST / 'index.html').read_text(encoding='utf-8')
CAMPAIGN = (QUEST / 'campaign.js').read_text(encoding='utf-8')
PIXEL = (QUEST / 'pixel.js').read_text(encoding='utf-8')
CHIP = (QUEST / 'chip.js').read_text(encoding='utf-8')
FONTS = (QUEST / 'assets' / 'fonts.js').read_text(encoding='utf-8')
APP = (ROOT / 'course' / 'index.html').read_text(encoding='utf-8')
TESTS = Path(__file__).resolve().parent
NODE = shutil.which('node')
HAS_JSDOM = (TESTS / 'node_modules' / 'jsdom').is_dir()


def script():
    blocks = re.findall(r'<script>(.*?)</script>', HTML, re.S)
    assert len(blocks) == 1
    return blocks[0]


def test_local_scripts_only_no_network():
    # the bundled fonts, the DB + shared modules (relative to quest/), the campaign, the pixel art and the chiptune;
    # no CDNs, web fonts from the net, images, imports or fetches (fonts.js holds the fonts as base64 for FontFace)
    assert re.findall(r'<script src="([^"]+)"', HTML) == ['assets/fonts.js', '../db/content.js', '../db/story.js', '../shared/progress.js',
                                                         '../shared/exercises.js', 'campaign.js', 'pixel.js', 'chip.js']
    assert '<link' not in HTML and '@import' not in HTML and '@font-face' not in HTML and '<img' not in HTML
    assert 'new FontFace(' in FONTS and 'url(' not in FONTS and 'fetch(' not in FONTS
    for lic in ('OFL-PressStart2P.txt', 'OFL-Unifont.txt'):
        assert 'SIL OPEN FONT LICENSE' in (QUEST / 'assets' / lic).read_text(encoding='utf-8')
    for src in (HTML, CAMPAIGN, PIXEL, CHIP):
        for bad in ('fetch(', 'XMLHttpRequest', 'import(', 'url(', 'import ', 'export ', 'require(', 'type="module"'):
            assert bad not in src, bad
        urls = set(re.findall(r'https?://[^\s\'")]+', src))
        assert urls <= {'http://www.w3.org/2000/svg'}, urls


def test_text_only_and_storage_through_the_shared_store():
    for js in (script(), CAMPAIGN, PIXEL, CHIP):
        assert 'innerHTML' not in js and 'insertAdjacentHTML' not in js and 'document.write' not in js and 'outerHTML' not in js
        assert 'localStorage' not in js
    assert "store.get(qkey()" in script() and "store.set(qkey()" in script()


def test_uses_shared_modules():
    js = script()
    # every answer goes to the shared learner model, as game 'quest'; exercises come from Yarya.ex
    assert "GAME = 'quest'" in js and 'P.record(st.id, r.ok, { game: GAME' in js and 'P.addXP(' in js and 'P.markSeen(' in js
    for b in ('X.mc(', 'X.match(', 'X.wordBank(', 'X.typeAnswer(', 'X.fillBlank('):
        assert b in js, b
    for copy in ('function lev(', 'const norm =', 'const tokens =', 'function romanize(', 'const CYR', 'const INTERVALS'):
        assert copy not in js and copy not in CAMPAIGN, copy
    assert 'Yarya.quest = ' not in js and 'Y.quest = {' in CAMPAIGN


def test_links_both_ways():
    assert 'href: \'../index.html\'' in script()
    assert "href: 'quest/index.html'" in APP
    body = APP[APP.index('const T = {'):APP.index('let native')]
    for k in ('quest', 'questSub', 'questGo'):
        assert body.count(k + ': ') == 2, k


def test_theme_motion_and_small_screens():
    assert '@media (prefers-color-scheme: light)' in HTML
    assert ':root[data-theme="light"]' in HTML and ':root:not([data-theme="dark"])' in HTML
    assert '@media (prefers-reduced-motion: reduce)' in HTML and 'reduceMotion()' in script()
    assert 'width=device-width' in HTML and '@media (max-width:420px)' in HTML and '@media (max-width:560px)' in HTML
    # same preference keys as the lessons app: one theme / sound setting for both
    assert "store.get('theme', 0)" in script() and "store.get('muted', false)" in script()


def test_ui_dictionary_has_same_keys_in_both_languages():
    js = script()
    body = js[js.index('const T = {'):js.index('let native')]
    en, mn = body[body.index('en: {'):body.index('mn: {')], body[body.index('mn: {'):]
    keys = lambda s: set(re.findall(r"[{,]\s*(\w+): ", s)) - {'en', 'mn'}
    assert keys(en) == keys(mn) and len(keys(en)) > 50
    used = set(re.findall(r"\bt[f]?\('(\w+)'", js))
    assert used <= keys(en), used - keys(en)
    # Mongolian UI really is Mongolian
    assert re.search('[а-яөү]', mn) and 'Тулалдах' in mn


def test_story_and_readable_panels():
    # the lesson's story comes from db/story.js (optional: campaign.js falls back to its own scenes)
    assert 'window.YARYA_STORY' in CAMPAIGN and 'Q.story(' in script()
    css = HTML[HTML.index('<style>'):HTML.index('</style>')]
    # text sits on solid panels: no see-through text backgrounds, no faded scene behind the cards
    assert '--art-op' not in css and '.veil' not in css
    for rule in re.findall(r'\.(?:bubble|say|sys|tip|plate|board)[^{]*\{([^}]*)\}', css):
        assert not re.search(r'background:\s*#[0-9a-f]{8}\b', rule), rule
    # long text is never shouted: only short labels are uppercase
    for sel, rule in re.findall(r'([^{}]+)\{([^}]*text-transform:uppercase[^}]*)\}', css):
        assert not re.search(r'\.(sys|say|tip|bubble|story|unit h3|role|intro)\b', sel), sel
    # the camp draws one chapter at a time
    assert 'Q.chapters()' in script() and 'lvsum' in script()


@pytest.mark.skipif(not NODE, reason='node not installed')
def test_scripts_parse(tmp_path):
    f = tmp_path / 'quest.js'
    f.write_text(script(), encoding='utf-8')
    for path in (f, QUEST / 'campaign.js', QUEST / 'pixel.js', QUEST / 'chip.js', QUEST / 'assets' / 'fonts.js', TESTS / 'quest_fixture_db.js'):
        r = subprocess.run([NODE, '--check', str(path)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr


@pytest.mark.skipif(not NODE, reason='node not installed')
def test_campaign_unit():
    r = subprocess.run([NODE, '--test', 'quest_test.js'], capture_output=True, text=True, timeout=120, cwd=TESTS)
    assert r.returncode == 0 and re.search(r'\bfail 0\b', r.stdout), r.stdout + r.stderr


@pytest.mark.skipif(not (NODE and HAS_JSDOM), reason='node/jsdom not installed (npm install in course_tests)')
@pytest.mark.parametrize('args', [
    ['en', 'http'], ['mn', 'http'],          # with localStorage: shared progress with the lessons app, skipping, timer, boss
    ['en', 'file'], ['mn', 'file'],          # double-click (file://): storage unavailable, must still work
    ['en', 'http', 'reduced'], ['mn', 'http', 'reduced'],
])
def test_quest_smoke(args):
    r = subprocess.run([NODE, str(TESTS / 'quest_smoke.js'), *args], capture_output=True, text=True, timeout=180, cwd=TESTS)
    assert r.returncode == 0 and 'OK ' in r.stdout, r.stdout + r.stderr


@pytest.mark.skipif(not (NODE and HAS_JSDOM), reason='node/jsdom not installed (npm install in course_tests)')
@pytest.mark.parametrize('part', ['quest', 'lessons'])
@pytest.mark.parametrize('native', ['en', 'mn'])
def test_db_audit(part, native):
    # every encounter / lesson of the real DB, both directions: no exceptions, no empty prompts, solvable exercises
    r = subprocess.run([NODE, str(TESTS / 'db_audit.js'), part, native], capture_output=True, text=True, timeout=600, cwd=TESTS)
    assert r.returncode == 0 and 'AUDIT OK' in r.stdout, r.stdout + r.stderr
