"""Check generated card-management markup against the real CSS; no browser is started."""
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
output = ROOT / "outputs/card-management-review"
checks = []

for filename in ("menu.html", "collection.html", "batch.html", "blocked.html", "confirmation.html", "market.html", "market-selected.html", "market-confirmation.html", "market-empty.html", "market-drag.html", "trade-up.html", "trade-up-partial.html", "trade-up-full.html", "trade-up-filtered.html", "trade-up-confirmation.html", "trade-up-result.html", "trade-up-empty.html", "trade-up-animation.html", "trade-up-history.html", "trade-up-history-expanded.html", "trade-up-history-detail.html"):
    soup = BeautifulSoup((output / filename).read_text(encoding="utf-8"), "lxml")
    for theme in ("club", "legacy"):
        soup.html["data-ui-theme"] = theme
        for width in (1920, 1600, 1366, 1180, 820, 560, 390):
            cascade = ui.Cascade(soup, files, width)
            expectations = {
                ".cm-content": {"overflow": "hidden" if filename.startswith(("market", "trade-up")) and width > 760 else "auto", "min-height": "0"},
                ".cm-surface": {"height": "auto" if filename == "menu.html" else "100%", "display": "flex", "pointer-events": "auto"},
                ".cm-card-grid": {"display": "grid"},
                ".cm-card": {"border": "0", "background": "transparent", "box-shadow": "none", "padding": "0"},
                ".cm-card-art": {"border": "0", "background": "transparent", "box-shadow": "none"},
                ".cm-header button.cm-primary": {"background": "linear-gradient(110deg,#ebcc85,#d2ad58)", "min-height": "44px", "color": "#192218"},
                ".cm-card.is-selected .s4-player-card": {"filter": "drop-shadow(0 0 3px #f4d68b) drop-shadow(0 0 10px #d4b36555)"},
                ".cmm-layout": {"display": "grid", "grid-template-columns": "1fr" if width <= 760 else "repeat(2,minmax(0,1fr))" if width <= 1180 else "minmax(0,1.15fr) minmax(0,.85fr)"},
                ".cmm-pane": {"display": "flex", "min-width": "0", "min-height": "0", "overflow": "hidden"},
                ".cmm-scroll": {"overflow": "auto", "min-height": "0", "overscroll-behavior": "contain"},
                ".cmm-pane-header button.cm-primary": {"background": "linear-gradient(110deg,#ebcc85,#d2ad58)", "min-height": "44px", "color": "#192218"},
                ".cmm-card-name": {"background": "transparent", "border": "0", "box-shadow": "none"},
                ".cmm-filters": {"display": "grid", "grid-template-columns": "repeat(6,minmax(0,1fr))"},
                ".cmm-filters .cm-search": {"grid-column": "span 4", "min-width": "0"},
                ".cmm-price input": {"width": "100%", "min-height": "44px" if width <= 760 else "48px", "padding": "10px 54px 10px 14px"},
                ".cmm-price-field": {"display": "block"},
                ".cmm-drop-hint": {"display": "flex" if filename == "market-drag.html" else "none", "pointer-events": "none", "background": "transparent", "box-shadow": "none", "border": "1px dashed #d4b365"},
                ".cmm-drop-hint > span": {"border-radius": "20px"},
                ".cmm-listed-badge": {"position": "absolute", "pointer-events": "none", "color": "#f2d99d", "white-space": "nowrap"},
                ".cmm-drag-preview": {"position": "fixed", "background": "transparent", "border": "0", "box-shadow": "none", "pointer-events": "none", "isolation": "isolate"},
                ".cmm-drag-preview .s4-player-card.player-card-shield": {"transform": "none", "filter": "none", "width": "100%", "max-width": "none"},
                ".cmm-confirmation": {"display": "grid", "grid-template-columns": "130px minmax(0,1fr)" if width <= 760 else "200px minmax(0,1fr)"},
                ".cmu-layout": {"display": "grid", "grid-template-columns": "1fr" if width <= 760 else "repeat(2,minmax(0,1fr))" if width <= 1180 else "minmax(0,.95fr) minmax(0,1.05fr)"},
                ".cmu-contract-scroll": {"overflow": "visible" if width <= 760 else "auto", "min-height": "0"},
                ".cmu-materials": {"display": "grid", "grid-template-columns": "repeat(5,minmax(0,1fr))"},
                ".cmu-slot-empty": {"aspect-ratio": "26/35"},
                ".cmu-remove": {"position": "absolute", "pointer-events": "none"},
                ".cmu-pool-scroll": {"overflow": "auto", "overscroll-behavior": "contain", "min-height": "200px"},
                ".cmu-history": {"display": "flex", "flex-direction": "column"},
                ".cmu-history-list": {"overflow": "auto", "overscroll-behavior": "contain", "padding": "0"},
                ".cmu-history-row": {"display": "grid", "background": "transparent", "border": "0", "box-shadow": "none"},
                ".cmu-history-result .s4-player-card": {"width": "190px", "max-width": "60%"},
                ".cmu-reveal": {"position": "relative", "height": "420px", "overflow": "hidden", "isolation": "isolate"},
                ".cmu-reveal.is-animating .cmu-reveal-result": {"opacity": "0"},
                ".cmu-reveal.is-revealed .cmu-reveal-result": {"opacity": "1", "animation": "none", "transform": "none"},
                ".cmu-reveal-glow": {"pointer-events": "none", "border-radius": "50%"},
                ".cmu-result": {"display": "flex", "align-items": "center"},
                ".cmu-result .s4-player-card": {"width": "210px", "max-width": "70%"},
                ".cm-menu": {"display": "grid", "grid-template-columns": "1fr" if width <= 760 else "repeat(3,minmax(0,1fr))"},
                ".cm-surface.is-menu": {"width": "min(1120px,100%)", "align-self": "center", "max-height": "100%"},
                ".cm-menu-option:disabled": {"opacity": "1"},
                ".cm-option-footer": {"display": "flex"},
                ".cm-selection-mark": {"display": "grid", "position": "absolute"},
                ".cm-preview-card": {"display": "flex", "min-width": "0"},
                ".cm-quote-summary": {"display": "grid"},
                ".cm-dialog": {"pointer-events": "auto", "display": "flex"},
                ".cm-dialog-body": {"overflow": "auto", "min-height": "0"},
                ".s4-player-card.player-card-shield": {"aspect-ratio": "26/35", "min-height": "0", "padding": "0"},
            }
            for selector, properties in expectations.items():
                for element in soup.select(selector):
                    for property_name, expected in properties.items():
                        if selector == ".cm-selection-mark" and property_name == "display" and element.has_attr("hidden"):
                            expected = "none"
                        actual = cascade.get(element, property_name)
                        assert actual == expected, (filename, theme, width, selector, property_name, actual, expected)
                        checks.append([filename, theme, width, selector, property_name])
    assert not soup.select(".cm-card-art canvas, .cm-preview-cards canvas"), "Collection cards should remain static"

report = {"checks": len(checks), "scope": "Offline selector and CSS cascade verification; not a browser screenshot or visual acceptance", "results": checks}
(output / "style-checks.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Passed {len(checks)} card-management CSS checks")
