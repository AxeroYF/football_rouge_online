"""Offline cascade / asset checks using production markup. Does not launch a browser."""
from pathlib import Path
import importlib.util
import json
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ui", ROOT / "scripts/check-ui-theme.py")
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
host = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "lxml")
files = [(ROOT / link["href"].split("?")[0]).resolve() for link in host.select('link[rel="stylesheet"]')]
output = ROOT / "outputs/scout-units-review"
checks = []
for theme in ["club", "legacy"]:
    for width in [390, 820, 1600]:
        for name in ["center-empty", "center-full", "unit-idle", "unit-noncore", "unit-working", "unit-moving"]:
            soup = BeautifulSoup((output / (name + ".html")).read_text(encoding="utf-8"), "lxml")
            soup.html["data-ui-theme"] = theme
            cascade = ui.Cascade(soup, files, width)
            expected = {
                "#scouting-window .scouting-content": {"display": "flex" if name.startswith("center") else "grid", "overflow": "auto"},
                ".scout-recruit-actions": {"display": "grid", "grid-template-columns": "1fr"},
                ".scout-unit-slot": {"min-height": "98px", "flex-shrink": "0"},
                ".scout-unit-row strong": {"font-size": "15px"},
                ".scout-unit-overview": {"flex-direction": "row", "text-align": "left"},
                ".scout-pools": {"display": "grid", "grid-template-rows": "minmax(0,1fr) minmax(0,1fr)"},
                ".scout-move-route": {"display": "grid", "grid-template-columns": "minmax(0,1fr) auto minmax(0,1fr)"},
                ".scout-move-footer": {"display": "flex"},
                ".scout-move-footer [data-scout-move-percent]": {"font-size": "16px"},
                ".scout-move-footer [data-scout-move-countdown]": {"font-size": "13px"},
                ".scout-movement-notice>header>strong": {"font-size": "15px"},
                ".scout-unit-actions": {"grid-template-columns": "minmax(0,1fr) 76px"},
                ".scout-unit-map-icon": {"pointer-events": "none"},
                ".scout-map-token": {"pointer-events": "auto", "background": "transparent"},
                ".scout-map-token>img": {"object-fit": "contain"},
            }
            for selector, props in expected.items():
                element = soup.select_one(selector)
                if element is None: continue
                for prop, value in props.items():
                    actual = cascade.get(element, prop)
                    assert actual == value, (theme, width, name, selector, prop, actual, value)
                    checks.append([theme, width, name, selector, prop])
            for button in soup.select(".scout-primary"):
                assert cascade.get(button, "font-size") == "14px"
                if theme == "club" and not button.has_attr("disabled"):
                    assert cascade.get(button, "background") == cascade.variable(button, "--ui-gold")
                    assert cascade.get(button, "color") == cascade.variable(button, "--ui-on-gold")
                checks.append([theme, width, name, "primary"])
            if name.startswith("center"):
                assert not soup.select("[data-scout-start]")
                assert len(soup.select("[data-scout-recruit]")) == 1
                assert soup.select_one("[data-scout-recruit]").get_text(strip=True) == "招募球探"
                assert len(soup.select(".scout-unit-slot")) == 2
                assert len(soup.select(".scout-unit-slot.is-empty")) == (2 if name == "center-empty" else 0)
                assert not soup.select(".scout-roster-heading strong")
                assert "暂无球探" not in soup.get_text()
            if name == "center-full":
                assert all(b.has_attr("disabled") for b in soup.select("[data-scout-recruit]"))
            if name == "unit-moving":
                assert not soup.select("#scouting-window .scout-pool")
                assert soup.select_one("#scouting-window [data-scout-move-progress]")
                assert soup.select_one("#scouting-window").get("class")[-1] == "is-scout-moving"
            elif name.startswith("unit"):
                assert len(soup.select("#scouting-window .scout-pool-pie")) == 2
                assert soup.select_one("#scouting-window .scout-country-pool")
            assert soup.select_one(".campaign-notifications [data-scout-move-progress]")
            assert soup.select_one(".campaign-notifications [data-scout-cancel-move]")
            assert not soup.select("#scouting-window small")
svg = ET.parse(ROOT / "assets/scout-tokens/default.svg").getroot()
assert svg.attrib["viewBox"] == "0 0 100 128"
assert len(list(svg)) > 15
(output / "css-checks.json").write_text(json.dumps({"count":len(checks),"checks":checks},ensure_ascii=False,indent=2),encoding="utf-8")
print(f"PASS: {len(checks)} scout UI cascade checks; SVG parsed; no browser launched")
