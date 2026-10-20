"""Dev helper: screenshot a page of the quest in headless Chromium.
  python course_tests/shoot.py <url-or-path> <out.png> [width] [height] [wait-ms] [js]"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
w, h = int(sys.argv[3]) if len(sys.argv) > 3 else 1280, int(sys.argv[4]) if len(sys.argv) > 4 else 800
wait = int(sys.argv[5]) if len(sys.argv) > 5 else 600
js = sys.argv[6] if len(sys.argv) > 6 else None
if '://' not in url:
    url = Path(url).resolve().as_uri() if '?' not in url else Path(url.split('?')[0]).resolve().as_uri() + '?' + url.split('?', 1)[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': w, 'height': h})
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(url)
    if js:
        pg.evaluate(js)
    pg.wait_for_timeout(wait)
    pg.screenshot(path=out, full_page='full' in sys.argv)
    print('\n'.join(errs) or 'no errors')
    b.close()
