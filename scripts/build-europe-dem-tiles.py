"""Build native z9 Europe DEM relief tiles for the Leaflet campaign map."""

from __future__ import annotations

import json
import math
import argparse
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "map-relief" / "europe-dem-z8"
CACHE_DIR = ROOT / ".cache" / "terrarium-dem-z8"
COUNTRIES = ROOT / "assets" / "data" / "natural-earth-countries-50m.geojson"
META = ROOT / "assets" / "map-relief" / "europe-dem-relief.json"
ZOOM = 9
TILE_SIZE = 256
BOUNDS = (-25.0, 25.0, 100.0, 75.0)
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
DETAIL_BRIGHTNESS = 1.08
DETAIL_CONTRAST = 1.08
HILLSHADE_CONTRAST = 1.32
MAX_WORKERS = 16
FETCH_LOCKS = tuple(threading.Lock() for _ in range(128))
SLOPE_SCALE = 2.0 ** (ZOOM - 8)


def mercator_y(lat: float) -> float:
    lat = max(-85.05112878, min(85.05112878, lat))
    return (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0


def pixel_xy(lon: float, lat: float) -> tuple[float, float]:
    world_size = (2**ZOOM) * TILE_SIZE
    return ((lon + 180.0) / 360.0 * world_size, mercator_y(lat) * world_size)


def tile_range() -> tuple[int, int, int, int]:
    west, south, east, north = BOUNDS
    left, top = pixel_xy(west, north)
    right, bottom = pixel_xy(east, south)
    return (
        math.floor(left / TILE_SIZE),
        math.floor(top / TILE_SIZE),
        math.floor((right - 1) / TILE_SIZE),
        math.floor((bottom - 1) / TILE_SIZE),
    )


def fetch_tile(x: int, y: int) -> Image.Image:
    lock = FETCH_LOCKS[hash((x, y)) % len(FETCH_LOCKS)]
    with lock:
        return fetch_tile_locked(x, y)


def fetch_tile_locked(x: int, y: int) -> Image.Image:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{ZOOM}-{x}-{y}.png"
    if path.exists():
        try:
            with Image.open(path) as cached:
                cached.verify()
            return Image.open(path).convert("RGB")
        except (OSError, ValueError):
            path.unlink(missing_ok=True)

    request = urllib.request.Request(
        TILE_URL.format(z=ZOOM, x=x, y=y),
        headers={"User-Agent": "Rougelite DEM tile builder"},
    )
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read()
            with Image.open(BytesIO(data)) as decoded:
                decoded.verify()
            temporary = path.with_suffix(".part")
            temporary.write_bytes(data)
            temporary.replace(path)
            return Image.open(path).convert("RGB")
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            path.unlink(missing_ok=True)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch complete DEM tile {ZOOM}/{x}/{y}") from last_error


def elevation(tile: Image.Image) -> np.ndarray:
    rgb = np.asarray(tile, dtype=np.float32)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


def europe_polygons() -> list[list[list[list[float]]]]:
    features = json.loads(COUNTRIES.read_text(encoding="utf-8")).get("features", [])
    result = []
    for feature in features:
        properties = feature.get("properties") or {}
        code = properties.get("ADM0_A3") or properties.get("ISO_A3")
        if code == "RUS" or not (properties.get("CONTINENT") == "Europe" or code in {"TUR", "CYP"}):
            continue
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates", [])
        if geometry.get("type") == "Polygon":
            coordinates = [coordinates]
        result.extend(polygon for polygon in coordinates if polygon)
    return result


POLYGONS = europe_polygons()


def projected_polygon_index() -> dict[tuple[int, int], list[list[list[tuple[float, float]]]]]:
    result: dict[tuple[int, int], list[list[list[tuple[float, float]]]]] = {}
    for polygon in POLYGONS:
        rings = [[pixel_xy(float(lon), float(lat)) for lon, lat in ring] for ring in polygon]
        if not rings or not rings[0]:
            continue
        xs, ys = zip(*rings[0])
        for y in range(math.floor(min(ys) / TILE_SIZE), math.floor(max(ys) / TILE_SIZE) + 1):
            for x in range(math.floor(min(xs) / TILE_SIZE), math.floor(max(xs) / TILE_SIZE) + 1):
                result.setdefault((x, y), []).append(rings)
    return result


PROJECTED_POLYGONS_BY_TILE = projected_polygon_index()


def land_mask(x: int, y: int) -> Image.Image:
    mask = Image.new("L", (TILE_SIZE, TILE_SIZE), 0)
    draw = ImageDraw.Draw(mask)
    left, top = x * TILE_SIZE, y * TILE_SIZE
    right, bottom = left + TILE_SIZE, top + TILE_SIZE
    for polygon in PROJECTED_POLYGONS_BY_TILE.get((x, y), []):
        for ring_index, projected in enumerate(polygon):
            if not projected:
                continue
            xs, ys = zip(*projected)
            if max(xs) < left or min(xs) > right or max(ys) < top or min(ys) > bottom:
                continue
            points = [(px - left, py - top) for px, py in projected]
            if len(points) >= 3:
                draw.polygon(points, fill=255 if ring_index == 0 else 0)
    return mask.filter(ImageFilter.GaussianBlur(0.6))


def tune_detail(image: Image.Image) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    rgb = ((rgb - 30.0) * DETAIL_CONTRAST + 30.0) * DETAIL_BRIGHTNESS
    tuned = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")
    tuned.putalpha(Image.fromarray(alpha, mode="L"))
    return tuned


def build_tile(x: int, y: int, force: bool = False) -> bool:
    output = OUT_DIR / str(ZOOM) / str(x) / f"{y}.webp"
    if output.exists() and not force:
        try:
            with Image.open(output) as existing:
                existing.verify()
            return True
        except (OSError, ValueError):
            output.unlink(missing_ok=True)

    mask = land_mask(x, y)
    if mask.getbbox() is None:
        return False

    neighborhood = np.empty((TILE_SIZE * 3, TILE_SIZE * 3), dtype=np.float32)
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            px = (dx + 1) * TILE_SIZE
            py = (dy + 1) * TILE_SIZE
            neighborhood[py:py + TILE_SIZE, px:px + TILE_SIZE] = elevation(fetch_tile(x + dx, y + dy))

    gy, gx = np.gradient(neighborhood)
    gx *= SLOPE_SCALE
    gy *= SLOPE_SCALE
    slope = np.sqrt(gx * gx + gy * gy)
    aspect = np.arctan2(-gx, gy)

    def shaded(azimuth: float, altitude: float, exaggeration: float) -> np.ndarray:
        az = math.radians(azimuth)
        alt = math.radians(altitude)
        slope_angle = np.arctan(slope * exaggeration)
        return np.clip(
            np.sin(alt) * np.cos(slope_angle)
            + np.cos(alt) * np.sin(slope_angle) * np.cos(az - aspect),
            0.0,
            1.0,
        )

    center = neighborhood[TILE_SIZE:TILE_SIZE * 2, TILE_SIZE:TILE_SIZE * 2]
    center_slope = slope[TILE_SIZE:TILE_SIZE * 2, TILE_SIZE:TILE_SIZE * 2]
    light = (
        0.74 * shaded(315, 39, 0.108)
        + 0.17 * shaded(35, 25, 0.072)
        + 0.09 * shaded(225, 18, 0.052)
    )[TILE_SIZE:TILE_SIZE * 2, TILE_SIZE:TILE_SIZE * 2]
    light = np.clip(0.16 + light * 1.10, 0.0, 1.0)
    light = np.clip((light - 0.78) * HILLSHADE_CONTRAST + 0.78, 0.0, 1.0)
    elevation_mix = np.clip((center + 120.0) / 4100.0, 0.0, 1.0)
    ridge = np.clip(center_slope / 28.0, 0.0, 1.0)

    low = np.array([14.0, 42.0, 36.0])
    mid = np.array([49.0, 77.0, 52.0])
    high = np.array([146.0, 137.0, 86.0])
    low_to_mid = np.clip(elevation_mix * 2.0, 0.0, 1.0)[..., None]
    mid_to_high = np.clip((elevation_mix - 0.5) * 2.0, 0.0, 1.0)[..., None]
    color = low * (1.0 - low_to_mid) + mid * low_to_mid
    color = color * (1.0 - mid_to_high) + high * mid_to_high
    color *= 0.30 + light[..., None] * 0.96
    color *= 0.84 + elevation_mix[..., None] * 0.16
    color += ridge[..., None] * (light[..., None] - 0.43) * np.array([20.0, 23.0, 14.0])
    color = np.clip(color, 0, 255).astype(np.uint8)

    alpha = np.clip(np.asarray(mask, dtype=np.float32) / 255.0 * 242.0, 0, 242).astype(np.uint8)
    output.parent.mkdir(parents=True, exist_ok=True)
    tune_detail(Image.fromarray(np.dstack([color, alpha]), mode="RGBA")).filter(
        ImageFilter.UnsharpMask(radius=0.75, percent=40, threshold=3),
    ).save(
        output,
        "WEBP",
        quality=88,
        method=4,
    )
    return True


def build_z8_from_z9() -> int:
    original_zoom = globals()["ZOOM"]
    globals()["ZOOM"] = 8
    try:
        min_x, min_y, max_x, max_y = tile_range()
    finally:
        globals()["ZOOM"] = original_zoom
    written = 0
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            mosaic = Image.new("RGBA", (TILE_SIZE * 2, TILE_SIZE * 2), (0, 0, 0, 0))
            for dy in range(2):
                for dx in range(2):
                    child = OUT_DIR / "9" / str(x * 2 + dx) / f"{y * 2 + dy}.webp"
                    if child.exists():
                        with Image.open(child) as image:
                            mosaic.alpha_composite(image.convert("RGBA"), (dx * TILE_SIZE, dy * TILE_SIZE))
            tile = mosaic.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
            output = OUT_DIR / "8" / str(x) / f"{y}.webp"
            if tile.getchannel("A").getbbox() is None:
                output.unlink(missing_ok=True)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            tile.save(output, "WEBP", quality=88, method=4)
            written += 1
    print(f"wrote {written} native z8 Europe tiles derived from z9", flush=True)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Build native Europe DEM relief tiles.")
    parser.add_argument("--force", action="store_true", help="Regenerate existing z9 tiles before deriving z8.")
    arguments = parser.parse_args()
    min_x, min_y, max_x, max_y = tile_range()
    jobs = [(x, y) for y in range(min_y, max_y + 1) for x in range(min_x, max_x + 1)]
    written = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(build_tile, x, y, arguments.force) for x, y in jobs]
        for completed, future in enumerate(as_completed(futures), start=1):
            written += int(future.result())
            if completed % 200 == 0:
                print(f"processed {completed}/{len(jobs)} DEM tiles", flush=True)
    z8_written = build_z8_from_z9()
    META.write_text(json.dumps({
        "source": "AWS Terrain Tiles / Mapzen Terrarium elevation encoding",
        "zoom": ZOOM,
        "bounds": {"west": BOUNDS[0], "south": BOUNDS[1], "east": BOUNDS[2], "north": BOUNDS[3]},
        "tilePath": "assets/map-relief/europe-dem-z8/{z}/{x}/{y}.webp",
        "maxNativeZoom": ZOOM,
        "detailZooms": [8, 9],
        "tiles": written,
        "z8Tiles": z8_written,
        "processing": "Native z9 DEM hillshade with deep olive elevation tint, softer ridge detail and Natural Earth Europe mask excluding Russia",
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {written} native z{ZOOM} Europe DEM relief tiles", flush=True)


if __name__ == "__main__":
    main()
