"""Build lightweight numeric snow masks and real rivers.

Uses local Terrarium caches only (no DEM download or texture rewrite). River
source: Natural Earth public-domain 1:10m rivers/lake centerlines GeoJSON.
Snow altitude thresholds are art-direction heuristics, not a meteorological snow forecast.
"""
from __future__ import annotations
import base64
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from map_relief_regions import load_config, source_to_display, display_to_source

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "terrarium-dem-z8"
RIVERS = ROOT / ".cache" / "map-environment" / "ne_10m_rivers_lake_centerlines.geojson"
OUTPUT = ROOT / "assets" / "data" / "map-environment.json"
SOURCE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson"

def project(lng, lat):
    return np.asarray(lng) / 360 * 1024, -np.arcsinh(np.tan(np.radians(np.clip(lat, -85, 85)))) / (2 * np.pi) * 1024

def unproject(x, z):
    return np.asarray(x) / 1024 * 360, np.degrees(np.arctan(np.sinh(-np.asarray(z) / 1024 * 2 * np.pi)))

def snowline(lat):
    # A fixed stylized summer snowline, varying with TRUE latitude.
    return np.interp(np.abs(lat), [0, 23, 40, 48, 60, 70, 80], [5100, 5000, 3300, 2450, 1500, 800, 300])

def elevations(lng, lat):
    values = np.full(len(lng), np.nan, np.float32)
    for zoom in [8, 9]:
        missing = np.flatnonzero(np.isnan(values))
        if not len(missing):
            break
        n = 2 ** zoom
        px = (lng[missing] + 180) / 360 * n * 256
        py = (1 - np.arcsinh(np.tan(np.radians(lat[missing]))) / np.pi) / 2 * n * 256
        tx, ty = np.floor(px / 256).astype(int), np.floor(py / 256).astype(int)
        keys = tx * n + ty
        order = np.argsort(keys)
        splits = np.flatnonzero(np.diff(keys[order])) + 1
        for group in np.split(order, splits):
            k = group[0]
            path = CACHE / f"{zoom}-{tx[k]}-{ty[k]}.png"
            if not path.exists():
                continue
            with Image.open(path) as image:
                rgb = np.asarray(image.convert("RGB"), np.float32)
                samples = rgb[np.floor(py[group]).astype(int) % 256, np.floor(px[group]).astype(int) % 256]
                values[missing[group]] = samples[:, 0] * 256 + samples[:, 1] + samples[:, 2] / 256 - 32768
    return values

def encode_rle(array):
    flat = array.ravel()
    edges = np.r_[0, np.flatnonzero(np.diff(flat)) + 1, len(flat)]
    packed = bytearray()
    for start, end in zip(edges[:-1], edges[1:]):
        length = int(end - start)
        while length:
            run = min(length, 65535)
            packed.extend([run & 255, run >> 8, int(flat[start])])
            length -= run
    return base64.b64encode(packed).decode("ascii")

def build_region(key, spec, features, river_source):
    step = .125 if key != "south-america" else .20
    polygons = []
    for feature in features:
        props = feature["properties"]
        matches = (props["region"] == "south-america") if key == "south-america" else (
            props["territoryId"] == "adm1:nor-901" if key == "svalbard"
            else props["region"] == "europe" and props["territoryId"] != "adm1:nor-901")
        if not matches:
            continue
        geometry = feature["geometry"]
        for polygon in ([geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]):
            rings = []
            for ring in polygon:
                points = []
                for lng, lat in ring:
                    dlat, dlng = source_to_display(spec, lat, lng)
                    x, z = project(dlng, dlat)
                    points.append((float(x), float(z)))
                rings.append(points)
            polygons.append(rings)
    vertices = [p for poly in polygons for p in poly[0]]
    min_x = math.floor(min(p[0] for p in vertices) / step) * step - step
    min_z = math.floor(min(p[1] for p in vertices) / step) * step - step
    width = math.ceil((max(p[0] for p in vertices) - min_x) / step) + 2
    height = math.ceil((max(p[1] for p in vertices) - min_z) / step) + 2
    mask_image = Image.new("L", (width, height))
    draw = ImageDraw.Draw(mask_image)
    for poly in polygons:
        for i, ring in enumerate(poly):
            draw.polygon([((x - min_x) / step, (z - min_z) / step) for x, z in ring], fill=255 if i == 0 else 0)
    mask = np.asarray(mask_image) > 0
    rows, cols = np.where(mask)
    dlng, dlat = unproject(min_x + cols * step, min_z + rows * step)
    lat, lng = display_to_source(spec, dlat, dlng)
    heights = elevations(np.asarray(lng), np.asarray(lat))
    missing = int(np.isnan(heights).sum())
    if missing / max(1, len(heights)) > .02:
        raise RuntimeError(f"{key}: local DEM missing for {missing}/{len(heights)} samples")
    cover = np.clip((heights - snowline(lat) + 100) / 480, 0, 1)
    cover = np.nan_to_num(cover, nan=0)
    snow = np.zeros(mask.shape, np.uint8)
    snow[rows, cols] = np.round(cover * 255).astype(np.uint8)
    # Numeric masks only; no generated terrain image files.
    rivers = []
    for feature in river_source["features"]:
        props, geometry = feature["properties"], feature["geometry"]
        rank = int(props.get("scalerank", 6))
        if rank > 8:
            continue
        paths = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
        for path in paths:
            run = []
            def flush():
                if len(run) >= 2:
                    rivers.append({"name": props.get("name_en") or props.get("name") or "", "rank": rank, "points": run[:]})
                run.clear()
            for lng, lat in path:
                dlat, dlng = source_to_display(spec, lat, lng)
                x, z = project(dlng, dlat)
                c, r = round((float(x) - min_x) / step), round((float(z) - min_z) / step)
                if 0 <= c < width and 0 <= r < height and mask[r, c]:
                    run.append([round(float(x), 4), round(float(z), 4)])
                else:
                    flush()
            flush()
    print(f"{key}: DEM {len(heights)-missing}/{len(heights)}, river paths {len(rivers)}, snow pixels {np.count_nonzero(snow)}", flush=True)
    return {"snow": {"width": width, "height": height, "step": step, "origin": [min_x, min_z], "rle": encode_rle(snow)},
            "rivers": rivers, "demSamples": len(heights), "demMissing": missing}

def main():
    if not RIVERS.exists():
        raise SystemExit(f"Download {SOURCE_URL} to {RIVERS} first")
    config = load_config()
    features = json.loads((ROOT / "assets/data/campaign-territories.geojson").read_text(encoding="utf-8"))["features"]
    rivers = json.loads(RIVERS.read_text(encoding="utf-8"))
    specs = {"europe": {"transform": {"type": "identity"}}, **config["regions"]}
    result = {"schemaVersion": 1, "source": {"rivers": SOURCE_URL, "riverLicense": "Natural Earth public domain",
        "riverSha256": hashlib.sha256(RIVERS.read_bytes()).hexdigest(), "elevation": "Existing local Terrarium z8/z9 cache",
        "snow": "Fixed stylized latitude/elevation snowline, not live weather"},
        "regions": {key: build_region(key, spec, features, rivers) for key, spec in specs.items()}}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes)", flush=True)

if __name__ == "__main__":
    main()
