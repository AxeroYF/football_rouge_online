"""Offline selector/cascade audit of the production shield in its host pages.

Run review-shield-cards.mjs first to generate the real shared-renderer fixture.
This checks CSS resolution, not browser geometry or screenshots.
"""
from pathlib import Path
import importlib.util
import json
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ui_cascade", ROOT / "scripts/check-ui-theme.py")
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
soup = BeautifulSoup((ROOT / "outputs/card-shield-release/cascade-fixture.html").read_text(encoding="utf-8"), "lxml")
for card in soup.select(".training-seat > .player-card-shield"):
    card["class"].append("training-seat-card")

checks = 0
def check(cascade, node, prop, expected):
    global checks
    actual = cascade.get(node, prop)
    assert actual == expected, (node.get("class"), prop, actual, expected)
    checks += 1

for page in ("index.html", "admin-v2.html"):
    host = BeautifulSoup((ROOT / page).read_text(encoding="utf-8"), "lxml")
    files = [(ROOT / link["href"].split("?")[0].lstrip("/")).resolve() for link in host.select('link[rel="stylesheet"]')]
    assert files[-1].name == "player-card-shield.css"
    for theme in ("club", "legacy"):
        soup.html["data-ui-theme"] = theme
        for width in (1920, 560):
            cascade = ui.Cascade(soup, files, width)
            for card in soup.select(".player-card-shield"):
                for prop, value in {"aspect-ratio": "26/35", "min-height": "0", "padding": "0", "border-radius": "0", "background": "transparent", "overflow": "visible", "container-type": "inline-size"}.items():
                    check(cascade, card, prop, value)
                surface = card.select_one(".shield-card-surface")
                check(cascade, surface, "pointer-events", "none")
                for selector, level in ((".shield-card-background", "0"), (".shield-card-plate", "3"), (".shield-card-information", "4"), (".shield-card-rim", "7")):
                    check(cascade, card.select_one(selector), "z-index", level)
                portrait = card.select_one(".s4-player-card-profile")
                if portrait:
                    check(cascade, portrait, "z-index", "8" if "grade-s" in card["class"] else "2")
                    for prop, var in (("left", "--profile-x"), ("top", "--profile-y"), ("width", "--profile-width")):
                        check(cascade, portrait, prop, cascade.variable(card, var))
                badge = card.select_one(".s4-player-card-upgrade")
                if badge:
                    for prop, value in {"right": "12.1%", "top": "11.7%", "height": "7.6%", "width": "14%", "z-index": "6"}.items():
                        check(cascade, badge, prop, value)
                canvas = card.select_one("canvas")
                if canvas:
                    check(cascade, canvas, "pointer-events", "none")
                    check(cascade, canvas, "z-index", "1")
            if page == "index.html":
                check(cascade, soup.select_one(".training-seat-card"), "width", "min(100%,118px)")
                picker = soup.select_one(".training-card-list .player-card-shield")
                check(cascade, picker, "height", "calc(100% - 22px)")
                check(cascade, picker, "width", "auto")

report = {"checks": checks, "cards": len(soup.select('.player-card-shield')), "hostPages": ["index.html", "admin-v2.html"], "widths": [1920, 560], "themes": ["club", "legacy"], "scope": "Offline CSS cascade, not browser layout"}
(ROOT / "outputs/card-shield-release/cascade-checks.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Passed {checks} shield cascade checks.")
