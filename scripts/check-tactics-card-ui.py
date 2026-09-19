"""Inspect the real tactics fixture and loaded styles without a browser."""
from pathlib import Path
import importlib.util
import json
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "outputs/tactics-card-review"
spec = importlib.util.spec_from_file_location("cascade", ROOT / "scripts/check-ui-theme.py")
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
host = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "lxml")
files = [(ROOT / link["href"].split("?")[0].lstrip("/")).resolve() for link in host.select('link[rel="stylesheet"]')]
cards = json.loads((OUT / "cards.json").read_text(encoding="utf-8"))
board = (OUT / "board.html").read_text(encoding="utf-8")
soup = BeautifulSoup('<html data-ui-theme="club"><body><section id="campaign-tactics">' + board + '</section></body></html>', "lxml")
pitch = soup.select_one('#league-tactics-pitch')
nodes = soup.select('[data-league-magnet]')
assert len(nodes) == 11
for node in nodes:
    node.insert(0, BeautifulSoup(cards[node['data-league-magnet']], 'lxml').select_one('.league-magnet-card'))
    node['class'].append('is-card-mode')
assert not soup.select('canvas, .shield-card-sheen')
checks = 0
def check(cascade, node, prop, expected):
    global checks
    actual = cascade.get(node, prop)
    assert actual == expected, (node.get('class'), prop, actual, expected)
    checks += 1

for theme in ('club', 'legacy'):
    soup.html['data-ui-theme'] = theme
    for width in (1920, 1366, 560):
        for preview in (False, True):
            pitch['class'] = ['pitch'] + (['is-tactical-shape-previewing'] if preview else [])
            cascade = ui.Cascade(soup, files, width)
            switcher = soup.select_one('.league-piece-display-switcher')
            check(cascade, switcher, 'grid-column', '1' if width <= 650 else '2')
            check(cascade, switcher, 'grid-row', 'auto' if width <= 650 else '1')
            for node in nodes:
                face = node.select_one('.league-magnet-card')
                card = node.select_one('.tactics-shield-card')
                if preview:
                    check(cascade, node, 'width', '30px')
                    check(cascade, node, 'height', '30px')
                    check(cascade, face, 'display', 'none')
                else:
                    check(cascade, node, 'width', 'clamp(72px,13.5cqw,110px)')
                    check(cascade, node, 'min-height', '0')
                    check(cascade, node, 'padding', '0')
                    check(cascade, node, 'background', 'none')
                    check(cascade, node, 'aspect-ratio', '26/35')
                    check(cascade, node.select_one('.league-magnet-fitness'), 'bottom', '-4px')
                    duty = node.select_one('.league-magnet-duty')
                    check(cascade, duty, 'display', 'none' if width <= 1050 else 'grid')
                    check(cascade, duty, 'top', 'calc(100% + 10px)')
                check(cascade, face, 'pointer-events', 'none')
                for prop, value in {'aspect-ratio': '26/35', 'width': '100%', 'min-height': '0', 'transform': 'none', 'animation': 'none', 'background': 'transparent'}.items():
                    check(cascade, card, prop, value)
                portrait = card.select_one('.s4-player-card-profile')
                if portrait:
                    check(cascade, portrait, 'z-index', '8' if any(g in card['class'] for g in ['grade-s', 'grade-x']) else '2')
                check(cascade, card.select_one('.shield-card-information'), 'z-index', '4')
            # The old magnet mode must remain unchanged when only the display class is removed.
            for node in nodes:
                node['class'].remove('is-card-mode')
            legacy = ui.Cascade(soup, files, width)
            baseline = ui.Cascade(soup, [f for f in files if f.name != 'tactics-cards.css'], width)
            for node in nodes:
                for prop in ('width', 'min-height', 'height', 'padding', 'border-radius', 'background', 'transform'):
                    check(legacy, node, prop, baseline.get(node, prop))
                node['class'].append('is-card-mode')

soup.html['data-ui-theme'] = 'club'
pitch['class'] = ['pitch']
for b in soup.select('[data-tactics-piece-display]'):
    active = b['data-tactics-piece-display'] == 'cards'
    b['class'] = ['active'] if active else []
    b['aria-pressed'] = str(active).lower()
(OUT / 'fixture.html').write_text(str(soup), encoding='utf-8')
(OUT / 'cascade-checks.json').write_text(json.dumps({'checks': checks, 'widths': [1920, 1366, 560], 'themes': ['club', 'legacy'], 'fieldCards': 11, 'scope': 'Actual controller markup and CSS cascade; no browser geometry'}, indent=2) + '\n', encoding='utf-8')
print(f'Passed {checks} tactics-card cascade checks.')
