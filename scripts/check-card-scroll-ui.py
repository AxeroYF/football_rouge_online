"""Offline card/history CSS checks against generated fixtures; never starts a browser."""
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
output = ROOT / "outputs/card-scroll-review"
checks = []

def container_rules(container_width):
    def rules_from(text, viewport_width):
        def visit(rules):
            for rule in rules:
                if rule.type == "qualified-rule":
                    yield rule
                elif rule.type == "at-rule" and rule.content:
                    query = ui.css.serialize(rule.prelude)
                    if (rule.lower_at_keyword == "media" and ui.media_applies(query, viewport_width)) or (
                        rule.lower_at_keyword == "container" and "enhancement-history" in query and ui.media_applies(query, container_width)
                    ):
                        yield from visit(ui.css.parse_rule_list(rule.content, skip_comments=True, skip_whitespace=True))
        return visit(ui.css.parse_stylesheet(text, skip_comments=True, skip_whitespace=True))
    return rules_from

for theme in ("club", "legacy"):
    for viewport, container_width in ((1920, 980), (1600, 770), (1366, 625), (1180, 535), (820, 780), (560, 520), (390, 350)):
        ui.rules_from = container_rules(container_width)
        for filename in ("enhancement.html", "history.html"):
            soup = BeautifulSoup((output / filename).read_text(encoding="utf-8"), "lxml")
            soup.html["data-ui-theme"] = theme
            cascade = ui.Cascade(soup, files, viewport)
            expectations = {
                ".enhancement-history-mini li": {"grid-template-areas": '"player chance result" "time protection protection"' if container_width <= 600 else '"time player protection chance result"', "min-height": "76px"},
                ".enhancement-history-mini li > div > b": {"font-size": "15px"},
                ".enhancement-history-mini li > div > small": {"font-size": "12px"},
                ".enhancement-history-mini li time": {"font-size": "12px", "display": "block"},
                ".enhancement-history-mini li > strong": {"font-size": "14px"},
                ".enhancement-history-mini li > .enhancement-history-protection": {"display": "flex" if container_width <= 600 else "grid"},
                ".enhancement-history-mini .enhancement-history-protection small": {"font-size": "13px"},
                ".enhancement-history-mini .enhancement-history-protection b": {"font-size": "14px"},
                ".enhancement-history-mini > header button": {"font-size": "14px"},
                ".enhancement-history-mini > ol": {"overflow-y": "scroll", "min-height": "0"},
                ".enhancement-history-entry > footer > span": {"font-size": "15px"},
                ".enhancement-history-entry > footer small": {"font-size": "13px"},
                ".player-card-deferred": {"aspect-ratio": "26/35", "background": "transparent", "border": "0"},
                ".player-card-deferred > .shield-card-surface": {"position": "absolute", "inset": "0", "overflow": "hidden"},
            }
            for selector, expected in expectations.items():
                element = soup.select_one(selector)
                if element is None:
                    continue
                actual = cascade.raw(element)
                for prop, value in expected.items():
                    observed = actual.get(prop, (None, None))[1]
                    assert observed == value, (theme, viewport, container_width, filename, selector, prop, observed, value)
                    checks.append([theme, viewport, container_width, filename, selector, prop, observed])
            assert "已保卡" in soup.get_text() and "未保卡" in soup.get_text()
            assert not soup.select('[data-card-motion]')
            assert all(not card.select('svg,img,canvas') for card in soup.select('[data-card-render]'))

(output / "css-checks.json").write_text(json.dumps({"count": len(checks), "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"PASS: {len(checks)} history/card CSS checks across two themes and seven viewport/container sizes")
