"""Checks production CSS cascade; no browser or live account is used."""
from pathlib import Path
import importlib.util
import json
from urllib.parse import urlparse, unquote
from bs4 import BeautifulSoup
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("ui", ROOT / "scripts/check-ui-theme.py")
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
host = BeautifulSoup((ROOT / "index.html").read_text(encoding="utf-8"), "lxml")
files = [(ROOT / link["href"].split("?")[0]).resolve() for link in host.select('link[rel="stylesheet"]')]
samples = list((ROOT / "outputs/facility-actions-review").glob("*.html"))
samples += [ROOT / "outputs/scout-units-review" / (name+".html") for name in ["center-empty","center-full"]]
checks = []
for theme in ["club", "legacy"]:
    for width in [390,820,1600]:
        for path in samples:
            soup = BeautifulSoup(path.read_text(encoding="utf-8"),"lxml")
            soup.html["data-ui-theme"] = theme
            cascade = ui.Cascade(soup,files,width)
            for selector, properties in {
                ".facility-actions":{"display":"grid","grid-template-columns":"minmax(0,1fr)","flex":"none","gap":"8px"},
                ".facility-actions>button":{"min-height":"40px","font-size":"14px"},
                "#facility-demolition-dialog":{"width":"min(440px,calc(100vw - 32px))","overflow":"auto","max-height":"calc(100dvh - 32px)"},
                "#facility-demolition-dialog>footer":{"display":"grid","grid-template-columns":"1fr 1fr"},
                "#facility-demolition-dialog p":{"font-size":"14px"},
                "#facility-demolition-dialog>header button":{"width":"36px","min-height":"36px"},
            }.items():
                for element in soup.select(selector):
                    for prop, expected in properties.items():
                        value=cascade.get(element,prop)
                        assert value==expected,(theme,width,path.name,selector,prop,value,expected)
                        checks.append([theme,width,path.name,selector,prop])
            for footer in soup.select(".facility-actions"):
                assert footer.select_one(".facility-upgrade").has_attr("disabled")
                assert len(footer.select("button"))==2
                assert not footer.select("small")
            if path.stem in ["blocked-training","pending"]:
                assert soup.select_one("[data-demolition-confirm]").has_attr("disabled")
            if path.stem=="confirm-scout":
                assert "已招募球探及发掘任务保留" in soup.get_text()
            for image in soup.select("img[src]"):
                src = image["src"]
                asset = Path(unquote(urlparse(src).path).lstrip("/")) if src.startswith("file:") else ROOT / src.lstrip("./")
                assert asset.exists(), src
(ROOT / "outputs/facility-actions-review/css-checks.json").write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Passed {len(checks)} facility CSS checks across 3 widths and 2 themes.")
