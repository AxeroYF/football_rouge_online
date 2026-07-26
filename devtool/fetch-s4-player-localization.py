import concurrent.futures
import json
import re
import time
import urllib.parse
import urllib.request
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "s4-player-candidates-500.json"
OUTPUT = ROOT / "data" / "sources" / "wikipedia-zh-localization.json"
USER_AGENT = "YellowDogsLeague-S4/1.0 (player localization audit)"


def fetch_json(base_url, parameters, attempts=2):
    url = f"{base_url}?{urllib.parse.urlencode(parameters)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(0.75 * (2**attempt))


def normalize(value):
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def search_zh(name):
    payload = fetch_json(
        "https://zh.wikipedia.org/w/api.php",
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "list": "search",
            "srlimit": "3",
            "srnamespace": "0",
            "srsearch": name,
        },
    )
    results = payload.get("query", {}).get("search", [])
    return {
        "sourceName": name,
        "candidates": [
            {
                "zhTitle": item.get("title", ""),
                "pageId": item.get("pageid"),
                "snippet": re.sub(r"<[^>]+>", "", item.get("snippet", "")),
            }
            for item in results
        ],
    }


source = json.loads(INPUT.read_text(encoding="utf-8"))
names = sorted({player["sourceName"] for player in source["players"] if not player["isLegend"]})
cache = {}
if OUTPUT.exists():
    cache = json.loads(OUTPUT.read_text(encoding="utf-8"))

pending = [name for name in names if not cache.get(name, {}).get("zhTitle")]
completed = 0
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    future_by_name = {executor.submit(search_zh, name): name for name in pending}
    for future in concurrent.futures.as_completed(future_by_name):
        name = future_by_name[future]
        try:
            result = future.result()
            first = result["candidates"][0] if result["candidates"] else {}
            cache[name] = {
                "zhTitle": first.get("zhTitle", ""),
                "pageId": first.get("pageId"),
                "snippet": first.get("snippet", ""),
                "alternatives": [item["zhTitle"] for item in result["candidates"][1:]],
                "method": "zhwiki-search" if first else "unresolved",
                "confidence": "medium" if first else "low",
            }
        except Exception as error:
            cache[name] = {
                "zhTitle": "",
                "pageId": None,
                "snippet": "",
                "alternatives": [],
                "method": "request-error",
                "confidence": "low",
                "error": str(error),
            }
        completed += 1
        if completed % 25 == 0 or completed == len(pending):
            OUTPUT.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"localized {completed}/{len(pending)}", flush=True)

summary = {}
for item in cache.values():
    summary[item["confidence"]] = summary.get(item["confidence"], 0) + 1
print(json.dumps({"total": len(names), "summary": summary}, ensure_ascii=False, indent=2))
