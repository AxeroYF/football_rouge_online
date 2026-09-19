"""Offline CSS cascade audit for live broadcast cards; not browser layout."""
from pathlib import Path
import importlib.util
import json
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'outputs/broadcast-card-review'
spec = importlib.util.spec_from_file_location('cascade', ROOT / 'scripts/check-ui-theme.py')
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
host = BeautifulSoup((ROOT / 'index.html').read_text(encoding='utf-8'), 'lxml')
files = [(ROOT / link['href'].split('?')[0].lstrip('/')).resolve() for link in host.select('link[rel="stylesheet"]')]
soup = BeautifulSoup((OUT / 'pitch.html').read_text(encoding='utf-8'), 'lxml')
nodes = soup.select('.broadcast-card-magnet')
assert len(nodes) == 22
assert not soup.select('canvas, .shield-card-sheen')
checks = 0
def check(cascade, node, prop, expected):
    global checks
    actual = cascade.get(node, prop)
    assert actual == expected, (node.get('class'), prop, actual, expected)
    checks += 1

for theme in ('club', 'legacy'):
    soup.html['data-ui-theme'] = theme
    for width in (1920, 1180, 820, 560, 390):
        cascade = ui.Cascade(soup, files, width)
        for node in nodes:
            for prop, value in {'width': 'clamp(42px,13cqw,80px)', 'min-height': '0', 'height': 'auto', 'padding': '0', 'display': 'block', 'aspect-ratio': '26/35', 'background': 'none', 'opacity': '1'}.items():
                check(cascade, node, prop, value)
            card = node.select_one('.broadcast-shield-card')
            for prop, value in {'width': '100%', 'min-height': '0', 'aspect-ratio': '26/35', 'transform': 'none', 'animation': 'none', 'pointer-events': 'none'}.items():
                check(cascade, card, prop, value)
            portrait = card.select_one('.s4-player-card-profile')
            if portrait:
                check(cascade, portrait, 'z-index', '8' if any(g in card['class'] for g in ['grade-s', 'grade-x']) else '2')
            check(cascade, card.select_one('.shield-card-information'), 'z-index', '4')
            check(cascade, node.select_one('.broadcast-card-team-rim'), 'color', '#5aaeff' if 'broadcast-side-1' in node['class'] else '#ff6d84')
            check(cascade, node.select_one('.league-magnet-fitness'), 'height', '3px')
            check(cascade, node.select_one('.s4-broadcast-rating'), 'top', 'calc(100% + 5px)')
            check(cascade, node.select_one('.live-status-markers'), 'z-index', '5')
            if 'inactive' in node['class']:
                check(cascade, node.select_one('.broadcast-card-face'), 'opacity', '.45')

(OUT / 'cascade-checks.json').write_text(json.dumps({'checks': checks, 'fieldCards': 22, 'widths': [1920, 1180, 820, 560, 390], 'themes': ['club', 'legacy'], 'scope': 'Offline CSS cascade, not browser layout'}, indent=2) + '\n', encoding='utf-8')
print(f'Passed {checks} broadcast card cascade checks.')
