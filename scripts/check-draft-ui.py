"""Validate initial-draft fixture markup with the application's CSS without opening a browser."""
from pathlib import Path
import importlib.util
import json
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ui_cascade", ROOT / "scripts/check-ui-theme.py")
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
host = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "lxml")
files = [(ROOT / link["href"].split("?")[0].lstrip("/")).resolve() for link in host.select('link[rel="stylesheet"]')]
output = ROOT / "outputs/draft-review"
checks = []
for filename in ("pools.html", "offer.html", "partial.html"):
    soup = BeautifulSoup((output / filename).read_text(encoding="utf-8"), "lxml")
    assert len(soup.select('.draft-position-counts > span')) == 11
    assert len(soup.select('.draft-line-total')) == 4
    assert len(soup.select('.inventory-opening-meteors > i')) == 48
    assert not soup.select('.line-requirements, small, [data-card-motion], canvas, .draft-warp')
    for theme in ("club", "legacy"):
        soup.html["data-ui-theme"] = theme
        for width in (2560, 1920, 1366, 1024, 760, 560, 390):
            cascade = ui.Cascade(soup, files, width)
            expectations = {
                "#campaign-entry": {"isolation": "isolate", "backdrop-filter": "none", "background": "radial-gradient(ellipse at 50% 10%,#143c68 0%,#081c36 48%,#040c1b 100%)"},
                ".inventory-opening-meteors": {"position": "absolute", "pointer-events": "none", "z-index": "0"},
                ".inventory-opening-meteors i": {"background": "linear-gradient(to top,transparent 0%,rgba(87,156,255,.16) 20%,rgba(160,210,255,.94) 78%,#f0f8ff 100%)"},
                ".draft-content": {"width": "min(1120px,100%)", "min-width": "0"},
                ".draft-panel": {"background": "rgba(17,30,25,.93)", "border-radius": "18px"},
                ".draft-line-counts": {"display": "grid", "grid-template-columns": "repeat(2,minmax(0,1fr))" if width <= 760 else "minmax(80px,.6fr) 1fr 1.25fr 1fr"},
                ".draft-line-total b": {"font-size": "22px"},
                ".draft-position-counts": {"display": "flex", "justify-content": "center"},
                ".draft-position-counts b": {"font-size": "17px"},
                ".draft-pools": {"display": "grid", "grid-template-columns": "repeat(2,minmax(0,1fr))" if width <= 760 else "repeat(4,minmax(0,1fr))"},
                "button.draft-pool": {"display": "flex", "flex-direction": "column", "min-width": "0", "border-radius": "12px"},
                ".draft-pool-art img": {"object-fit": "contain"},
                ".draft-offer": {"grid-template-columns": "repeat(2,minmax(0,1fr))" if width <= 560 else "repeat(3,minmax(0,1fr))" if width <= 760 else "repeat(3,minmax(0,250px))", "justify-content": "center"},
                ".draft-candidate": {"min-width": "0", "perspective": "1200px"},
                ".draft-flip": {"position": "relative", "transform-style": "preserve-3d"},
                ".draft-card-front": {"transform": "rotateY(0deg)", "backface-visibility": "hidden"},
                ".draft-card-back": {"transform": "rotateY(180deg)", "backface-visibility": "hidden", "pointer-events": "none"},
                ".draft-offer .s4-player-card": {"aspect-ratio": "26/35", "border": "0", "background": "transparent", "width": "100%", "transform": "none"},
                ".draft-error": {"display": "none"},
            }
            for selector, expected in expectations.items():
                element = soup.select_one(selector)
                if element is None:
                    continue
                actual = cascade.raw(element)
                for prop, value in expected.items():
                    observed = actual.get(prop, (None, None))[1]
                    assert observed == value, (filename, theme, width, selector, prop, observed, value)
                    checks.append([filename, theme, width, selector, prop, observed])

(output / "css-checks.json").write_text(json.dumps({"count": len(checks), "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"PASS: {len(checks)} draft CSS checks across two themes and seven screen widths")
