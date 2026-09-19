"""Build an independent z3-z7 game terrain from LOCAL Terrarium height data.

Does not download data or overwrite the classic terrain. Uses its alpha masks
to preserve every existing coastline; colors/shadows come from generalized DEM.
Python dependencies: numpy, scipy, Pillow. Run --samples before the full build.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import threading

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

from soft_relief import HALO, REVISION, WORK_ZOOM, geographic_spacing, render_relief

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache/terrarium-dem-z8"
ASSETS = ROOT / "assets/map-relief"
TILE = 256
MAX_ZOOM = 7
SOURCES = set()
SOURCE_LOCK = threading.Lock()
CONFIG = json.loads((ROOT / "shared/config/map-relief-regions.json").read_text(encoding="utf-8"))
REGIONS = {
    "europe": {"transform": {"type": "identity"}, "output": {
        "overview": "assets/map-relief/europe-dem-overview/{z}/{x}/{y}.webp"}},
    **CONFIG["regions"],
}


def classic_root(region):
    return ROOT / REGIONS[region]["output"]["overview"].split("{z}")[0]


def soft_root(region):
    return ASSETS / f"{region}-soft-relief"


def read_dem(path):
    if not path.exists():
        return None
    with Image.open(path) as image:
        if image.size != (TILE, TILE):
            raise ValueError(f"Invalid DEM dimensions: {path}")
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    with SOURCE_LOCK:
        SOURCES.add(path)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


@lru_cache(maxsize=256)
def dem_tile(x, y):
    # Area-average the native z9 DEM before sampling the z8 working grid.
    # Existing z8 cache is an explicit, georeferenced fallback for absent z9.
    result = np.full((TILE, TILE), np.nan, dtype=np.float32)
    for dy in range(2):
        for dx in range(2):
            child = read_dem(CACHE / f"9-{x * 2 + dx}-{y * 2 + dy}.png")
            if child is not None:
                result[dy * 128:(dy + 1) * 128, dx * 128:(dx + 1) * 128] = child.reshape(128, 2, 128, 2).mean(axis=(1, 3))
    if np.isnan(result).any():
        fallback = read_dem(CACHE / f"8-{x}-{y}.png")
        if fallback is not None:
            result = np.where(np.isfinite(result), result, fallback)
    return result


def source_grid(region, x, y):
    width = TILE * 2 + HALO * 2
    axis = np.arange(-HALO, TILE * 2 + HALO, dtype=np.float64) + 0.5
    world = TILE * 2 ** WORK_ZOOM
    display_lng = (x * TILE * 2 + axis) / world * 360.0 - 180.0
    display_lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * (y * TILE * 2 + axis) / world))))
    lat = np.broadcast_to(display_lat[:, None], (width, width))
    lng = np.broadcast_to(display_lng[None, :], (width, width))
    transform = REGIONS[region]["transform"]
    if transform["type"] != "identity":
        source, display = transform["sourceCenter"], transform["displayCenter"]
        lat, lng = source["lat"] + lng - display["lng"], source["lng"] + lat - display["lat"]
    return lat, lng


def sample_pixels(px, py):
    tx, ty = px // TILE, py // TILE
    pairs = np.unique(np.stack([tx.ravel(), ty.ravel()], axis=1), axis=0)
    result = np.empty(px.shape, dtype=np.float32)
    for x, y in pairs:
        selected = (tx == x) & (ty == y)
        result[selected] = dem_tile(int(x), int(y))[py[selected] % TILE, px[selected] % TILE]
    return result


def sample_dem(lat, lng):
    world = TILE * 2 ** WORK_ZOOM
    px = (lng + 180.0) / 360.0 * world - 0.5
    py = (1.0 - np.arcsinh(np.tan(np.radians(np.clip(lat, -85.0511, 85.0511)))) / np.pi) / 2.0 * world - 0.5
    x, y = np.floor(px).astype(np.int32), np.floor(py).astype(np.int32)
    fx, fy = px - x, py - y
    total, weights = np.zeros(px.shape, np.float32), np.zeros(px.shape, np.float32)
    for dx, dy, weight in ((0, 0, (1-fx)*(1-fy)), (1, 0, fx*(1-fy)), (0, 1, (1-fx)*fy), (1, 1, fx*fy)):
        values = sample_pixels(x + dx, y + dy)
        valid = np.isfinite(values)
        total += np.where(valid, values, 0.0) * weight
        weights += valid * weight
    return np.where(weights > 0.999, total / np.maximum(weights, 1e-8), np.nan)


def create_tile(region, x, y):
    with Image.open(classic_root(region) / "7" / str(x) / f"{y}.webp") as old:
        alpha = old.convert("RGBA").getchannel("A")
    if alpha.getbbox() is None:
        return Image.new("RGBA", (TILE, TILE))
    lat, lng = source_grid(region, x, y)
    dem = sample_dem(lat, lng)
    missing = ~np.isfinite(dem)
    core = np.s_[HALO:-HALO, HALO:-HALO]
    mask = np.asarray(alpha.resize((512, 512), Image.Resampling.NEAREST))
    missing_land = missing[core] & (mask > 32)
    if missing_land.any():
        raise ValueError(f"{region} 7/{x}/{y}: {missing_land.sum()} land samples missing from LOCAL DEM; no download or fabricated terrain")
    if missing.any():
        # Missing halo/sea only: extend known elevations before filtering, so
        # source-cache edges do not introduce artificial ridges along the coast.
        nearest = distance_transform_edt(missing, return_distances=False, return_indices=True)
        dem = dem[tuple(nearest)]
    color, _ = render_relief(dem, *geographic_spacing(lat, lng))
    rgb = Image.fromarray(np.round(color[core]).astype(np.uint8), "RGB")
    rgb = rgb.resize((TILE, TILE), Image.Resampling.LANCZOS).convert("RGBA")
    rgb.putalpha(alpha)
    return rgb


def write_tile(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".webp.tmp")
    # Lossless encoding keeps quiet lowland gradients free from codec ringing.
    image.save(temporary, "WEBP", lossless=True, method=4, exact=True)
    temporary.replace(path)


def digest(paths, base=ROOT):
    combined = hashlib.sha256()
    size = 0
    for path in sorted(paths):
        data = path.read_bytes()
        size += len(data)
        combined.update(path.relative_to(base).as_posix().encode())
        combined.update(hashlib.sha256(data).digest())
    return {"files": len(paths), "bytes": size, "sha256": combined.hexdigest()}


def downsample(region):
    root = soft_root(region)
    # A common generalized source and mild area resampling keep zoom transitions
    # coherent. Smaller zooms shed fine detail instead of sharpening it again.
    for zoom in range(6, 2, -1):
        for old_path in sorted((classic_root(region) / str(zoom)).glob("*/*.webp")):
            x, y = int(old_path.parent.name), int(old_path.stem)
            mosaic = Image.new("RGBA", (512, 512))
            for dy in range(2):
                for dx in range(2):
                    child = root / str(zoom + 1) / str(x*2+dx) / f"{y*2+dy}.webp"
                    if child.exists():
                        with Image.open(child) as image:
                            mosaic.paste(image.convert("RGBA"), (dx*256, dy*256))
            tile = mosaic.resize((256, 256), Image.Resampling.BOX)
            # Keep every coastline identical to the classic version at each LOD.
            with Image.open(old_path) as image:
                tile.putalpha(image.convert("RGBA").getchannel("A"))
            write_tile(tile, root / str(zoom) / str(x) / f"{y}.webp")


def verify(region):
    old_paths = sorted(classic_root(region).glob("[3-7]/*/*.webp"))
    for old_path in old_paths:
        new_path = soft_root(region) / old_path.relative_to(classic_root(region))
        with Image.open(old_path) as old, Image.open(new_path) as new:
            if new.size != (256, 256) or new.format != "WEBP":
                raise ValueError(f"Invalid output: {new_path}")
            if not np.array_equal(np.asarray(old.convert("RGBA"))[..., 3], np.asarray(new.convert("RGBA"))[..., 3]):
                raise ValueError(f"Coastline alpha changed: {new_path}")
    return digest([soft_root(region) / p.relative_to(classic_root(region)) for p in old_paths])


def samples():
    output = ROOT / "outputs/soft-terrain"
    output.mkdir(parents=True, exist_ok=True)
    cases = [("France", "europe", 64, 44), ("Alps", "europe", 67, 45), ("Lowlands", "europe", 65, 42)]
    sheet = Image.new("RGB", (256 * 3, 256 * 2 + 64), "#101d1b")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 17)
    for index, (label, region, x, y) in enumerate(cases):
        new = create_tile(region, x, y)
        write_tile(new, output / f"{label.lower()}-soft.webp")
        with Image.open(classic_root(region) / "7" / str(x) / f"{y}.webp") as old:
            sheet.paste(old.convert("RGBA"), (index*256, 32), old.convert("RGBA"))
        sheet.paste(new, (index*256, 320), new)
        draw.text((index*256 + 8, 6), label + " / Classic", font=font, fill="#dde6d5")
        draw.text((index*256 + 8, 294), label + " / Soft", font=font, fill="#dde6d5")
    sheet.save(output / "comparison.png")
    print(f"Samples: {output / 'comparison.png'}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", choices=sorted(REGIONS), action="append")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--samples", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.samples:
        samples()
        return
    for region in args.region or REGIONS:
        original = digest(list(classic_root(region).glob("[3-7]/*/*.webp")))
        metadata_path = ASSETS / f"{region}-soft-relief.json"
        if args.verify_only:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata["classic"] != original or metadata["output"] != verify(region):
                raise ValueError(f"{region}: resource manifest mismatch")
            print(f"{region}: verified {metadata['output']['files']} tiles; classic unchanged", flush=True)
            continue
        paths = sorted((classic_root(region) / "7").glob("*/*.webp"))
        def build(path):
            x, y = int(path.parent.name), int(path.stem)
            write_tile(create_tile(region, x, y), soft_root(region) / "7" / str(x) / path.name)
        with SOURCE_LOCK:
            SOURCES.clear()
        dem_tile.cache_clear()
        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
            for index, _ in enumerate(pool.map(build, paths), 1):
                if index % 50 == 0 or index == len(paths):
                    print(f"{region}: generalized {index}/{len(paths)} z7 tiles", flush=True)
        downsample(region)
        result = verify(region)
        if original != digest(list(classic_root(region).glob("[3-7]/*/*.webp"))):
            raise ValueError(f"{region}: classic resources were modified")
        metadata = {
            "schemaVersion": 1, "revision": REVISION, "region": region,
            "source": "Local cached Mapzen Terrarium DEM; area-averaged z9, cached z8 fallback",
            "processing": "generalize elevation -> local-relief mountain mask -> metric gentle hillshade -> independent z3-z7 pyramid; no sharpening",
            "template": f"assets/map-relief/{region}-soft-relief/{{z}}/{{x}}/{{y}}.webp",
            "classic": original, "dem": digest(list(SOURCES)), "output": result,
            "buildCode": digest([Path(__file__), ROOT / "scripts/soft_relief.py"]),
        }
        temporary = metadata_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(metadata_path)
        print(f"{region}: verified {result['files']} tiles, {result['bytes']/1024/1024:.2f} MiB; original preserved", flush=True)


if __name__ == "__main__":
    main()
