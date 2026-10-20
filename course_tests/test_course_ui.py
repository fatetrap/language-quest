"""Tests for course/index.html + the shared modules (course/shared): static checks in Python, the Node unit tests
of progress.js/exercises.js (shared_test.js) and the jsdom smoke test (smoke.js) when node + jsdom exist.
Both use the real lesson DB, course/db/content.js(on) - run build_db.py first.

Run from the project root:  python -m pytest course_tests -q
(jsdom: `npm install` inside course_tests once)
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'course' / 'index.html').read_text(encoding='utf-8')
SHARED = {f: (ROOT / 'course' / 'shared' / f).read_text(encoding='utf-8') for f in ('progress.js', 'exercises.js')}
HAS_DB = (ROOT / 'course' / 'db' / 'content.js').is_file() and (ROOT / 'course' / 'db' / 'content.json').is_file()
TESTS = Path(__file__).resolve().parent
NODE = shutil.which('node')
HAS_JSDOM = (TESTS / 'node_modules' / 'jsdom').is_dir()


def script():
    blocks = re.findall(r'<script>(.*?)</script>', HTML, re.S)
    assert len(blocks) == 1
    return blocks[0]


def test_local_scripts_only_no_network():
    # only the DB + shared modules are loaded (relative paths, plain scripts); no CDNs, web fonts, imports or fetches
    assert re.findall(r'<script src="([^"]+)"', HTML) == ['db/content.js', 'shared/progress.js', 'shared/exercises.js']
    assert 'course.js' not in HTML and 'COURSE' not in HTML
    assert '<link' not in HTML and '@import' not in HTML and '@font-face' not in HTML
    for src in (HTML, *SHARED.values()):
        for bad in ('fetch(', 'XMLHttpRequest', 'import(', 'url(', 'import ', 'export ', 'require('):
            assert bad not in src, bad
        urls = set(re.findall(r'https?://[^\s\'")]+', src))
        assert urls <= {'http://www.w3.org/2000/svg'}, urls


def test_no_innerhtml_and_storage_wrapped():
    for js in (script(), *SHARED.values()):
        assert 'innerHTML' not in js and 'insertAdjacentHTML' not in js and 'document.write' not in js
    # the app has no storage code of its own; every localStorage access lives in progress.js's try/catch store
    assert 'localStorage' not in script()
    assert 'localStorage' not in SHARED['exercises.js']
    lines = [l for l in SHARED['progress.js'].splitlines() if 'localStorage.' in l]
    assert len(lines) == 2 and all('try {' in l for l in lines), lines


def test_app_uses_shared_modules():
    js = script()
    # answers go to the shared learner model; no copies of the shared helpers in the app
    assert 'P.record(st.id, r.ok' in js and 'P.addXP(' in js and 'P.lessonDone(' in js
    for copy in ('function lev(', 'const norm =', 'const tokens =', 'function romanize(', 'const CYR'):
        assert copy not in js, copy


def test_theme_and_motion_css():
    assert '@media (prefers-color-scheme: dark)' in HTML
    assert ':root[data-theme="dark"]' in HTML and ':root:not([data-theme="light"])' in HTML
    assert '@media (prefers-reduced-motion: reduce)' in HTML
    assert 'reduceMotion()' in script()


def test_ui_dictionary_has_same_keys_in_both_languages():
    js = script()
    body = js[js.index('const T = {'):js.index('let native')]
    en = body[body.index('en: {'):body.index('mn: {')]
    mn = body[body.index('mn: {'):]
    keys = lambda s: set(re.findall(r"(?<![\w'])(\w+): ", s)) - {'en', 'mn'}
    assert keys(en) == keys(mn) and len(keys(en)) > 50
    # every t('key') used in the code exists
    used = set(re.findall(r"\bt\('(\w+)'\)", js))
    assert used <= keys(en), used - keys(en)


@pytest.mark.skipif(not NODE, reason='node not installed')
def test_script_parses(tmp_path):
    f = tmp_path / 'app.js'
    f.write_text(script(), encoding='utf-8')
    for path in (f, *(ROOT / 'course' / 'shared' / n for n in SHARED)):
        r = subprocess.run([NODE, '--check', str(path)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr


@pytest.mark.skipif(not (NODE and HAS_DB), reason='node not installed or course/db not built')
def test_shared_modules():
    r = subprocess.run([NODE, '--test', 'shared_test.js'], capture_output=True, text=True, timeout=120, cwd=TESTS)
    assert r.returncode == 0 and re.search(r'\bfail 0\b', r.stdout), r.stdout + r.stderr


@pytest.mark.skipif(not (NODE and HAS_JSDOM and HAS_DB), reason='node/jsdom not installed (npm install in course_tests) or no course/db')
@pytest.mark.parametrize('args', [
    ['en', 'http'], ['mn', 'http'],          # with localStorage: progress, streak, mistakes, practice
    ['en', 'file'], ['mn', 'file'],          # double-click (file://): storage unavailable, must still work
    ['en', 'http', 'reduced'], ['mn', 'http', 'reduced'],
])
def test_smoke_click_through(args):
    r = subprocess.run([NODE, str(TESTS / 'smoke.js'), *args], capture_output=True, text=True, timeout=120, cwd=TESTS)
    assert r.returncode == 0 and 'OK ' in r.stdout, r.stdout + r.stderr


@pytest.mark.skipif(not HAS_DB, reason='course/db not built (python build_db.py)')
def test_db_shape_for_smoke():
    # the smoke test plays lessons 1 and 2 of the real DB and expects every step kind in lesson 1
    db = json.loads((ROOT / 'course' / 'db' / 'content.json').read_text(encoding='utf-8'))
    l1, l2 = db['lessons'][:2]
    assert l1['written'] and l2['written'] and l1['grammar'] and l1['dialogue']
    assert len(set(l1['words'])) >= 4 and len(l1['sentences']) >= 4
    assert {db['items'][f]['lang'] for f in l1['fill_blank']} == {'en', 'mn'}
    assert any(not l['written'] for l in db['lessons'])
