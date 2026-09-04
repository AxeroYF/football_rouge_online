"""Build the Europe relief overlay from real Terrarium DEM tiles.

The generated image is a presentation asset only. Runtime still uses a Leaflet
image overlay, while this script keeps the source/elevation processing
reproducible for future DEM refreshes.
"""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "map-relief"
CACHE_DIR = ROOT / ".cache" / "terrarium-dem-z8"
COUNTRIES = ROOT / "assets" / "data" / "natural-earth-countries-50m.geojson"
OUT_IMAGE = OUT_DIR / "europe-dem-relief.webp"
OUT_META = OUT_DIR / 'europe-dem-relief.json'
OUT_TILE_DIR = OUT_DIR / 'europe-dem-z8'

ZOOM = 8
BOUNDS = (-25.0, 25.0, 100.0, 75.0)  # west, south, east, north
TARGET_SIZE = (5200, 4850)
PROCESS_SIZE = TARGET_SIZE
TILE_SIZE = 256
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def mercator_y(lat: float) -> float:
    lat = max(-85.05112878, min(85.05112878, lat))
    return (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0


def pixel_xy(lon: float, lat: float, n: int) -> tuple[float, float]:
    return ((lon + 180.0) / 360.0 * n * TILE_SIZE, mercator_y(lat) * n * TILE_SIZE)


def tile_range() -> tuple[int, int, int, int]:
    n = 2**ZOOM
    left, top = pixel_xy(BOUNDS[0], BOUNDS[3], n)
    right, bottom = pixel_xy(BOUNDS[2], BOUNDS[1], n)
    return (
        math.floor(left / TILE_SIZE),
        math.floor(top / TILE_SIZE),
        math.floor((right - 1) / TILE_SIZE),
        math.floor((bottom - 1) / TILE_SIZE),
    )


def fetch_tile(x: int, y: int) -> Image.Image:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{ZOOM}-{x}-{y}.png"
    if path.exists():
        try:
            with Image.open(path) as cached:
                cached.verify()
            return Image.open(path).convert("RGB")
        except (OSError, ValueError):
            path.unlink(missing_ok=True)

    url = TILE_URL.format(z=ZOOM, x=x, y=y)
    request = urllib.request.Request(url, headers={"User-Agent": "Rougelite DEM builder"})
    last_error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read()
            with Image.open(BytesIO(data)) as downloaded:
                downloaded.verify()
            temporary = path.with_suffix(".part")
            temporary.write_bytes(data)
            temporary.replace(path)
            return Image.open(path).convert("RGB")
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            path.unlink(missing_ok=True)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch complete DEM tile {ZOOM}/{x}/{y}") from last_error

def read_dem() -> np.ndarray:
    min_x, min_y, max_x, max_y = tile_range()
    n = 2**ZOOM
    left, top = pixel_xy(BOUNDS[0], BOUNDS[3], n)
    right, bottom = pixel_xy(BOUNDS[2], BOUNDS[1], n)
    source_width = right - left
    source_height = bottom - top
    output = Image.new("F", PROCESS_SIZE, 0.0)
    jobs = [(x, y) for y in range(min_y, max_y + 1) for x in range(min_x, max_x + 1)]

    def prepare(pair):
        x, y = pair
        tile = np.asarray(fetch_tile(x, y), dtype=np.float32)
        elevation = tile[..., 0] * 256.0 + tile[..., 1] + tile[..., 2] / 256.0 - 32768.0
        tile_left = x * TILE_SIZE
        tile_top = y * TILE_SIZE
        tile_right = tile_left + TILE_SIZE
        tile_bottom = tile_top + TILE_SIZE
        crop_left = max(left, tile_left)
        crop_top = max(top, tile_top)
        crop_right = min(right, tile_right)
        crop_bottom = min(bottom, tile_bottom)
        if crop_right <= crop_left or crop_bottom <= crop_top:
            return None
        sx0 = int(round(crop_left - tile_left))
        sy0 = int(round(crop_top - tile_top))
        sx1 = int(round(crop_right - tile_left))
        sy1 = int(round(crop_bottom - tile_top))
        dx0 = int(round((crop_left - left) / source_width * PROCESS_SIZE[0]))
        dy0 = int(round((crop_top - top) / source_height * PROCESS_SIZE[1]))
        dx1 = max(dx0 + 1, int(round((crop_right - left) / source_width * PROCESS_SIZE[0])))
        dy1 = max(dy0 + 1, int(round((crop_bottom - top) / source_height * PROCESS_SIZE[1])))
        patch = Image.fromarray(elevation[sy0:sy1, sx0:sx1], mode="F").resize((dx1 - dx0, dy1 - dy0), Image.Resampling.BICUBIC)
        return dx0, dy0, patch

    with ThreadPoolExecutor(max_workers=12) as pool:
        for prepared in pool.map(prepare, jobs):
            if prepared is not None:
                output.paste(prepared[2], (prepared[0], prepared[1]))
    return np.asarray(output, dtype=np.float32)


def draw_ring(draw: ImageDraw.ImageDraw, ring: list[list[float]], n: int, origin: tuple[float, float], size: tuple[int, int], fill: int) -> None:
    left, top = origin
    right, bottom = pixel_xy(BOUNDS[2], BOUNDS[1], n)
    width, height = size
    points = []
    for lon, lat in ring:
        x, y = pixel_xy(float(lon), float(lat), n)
        points.append(((x - left) / (right - left) * width, (y - top) / (bottom - top) * height))
    if len(points) >= 3:
        draw.polygon(points, fill=fill)


def europe_mask(size: tuple[int, int]) -> Image.Image:
    n = 2**ZOOM
    left, top = pixel_xy(BOUNDS[0], BOUNDS[3], n)
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    data = json.loads(COUNTRIES.read_text(encoding="utf-8"))
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        code = props.get("ADM0_A3") or props.get("ISO_A3")
        if code == "RUS" or not (props.get("CONTINENT") == "Europe" or code in {"TUR", "CYP"}):
            continue
        geometry = feature.get("geometry") or {}
        polygons = geometry.get("coordinates", [])
        if geometry.get("type") == "Polygon":
            polygons = [polygons]
        for polygon in polygons:
            if not polygon:
                continue
            draw_ring(draw, polygon[0], n, (left, top), size, 255)
            for hole in polygon[1:]:
                draw_ring(draw, hole, n, (left, top), size, 0)
    return mask.filter(ImageFilter.GaussianBlur(1.4))


def build_relief(dem: np.ndarray, mask: Image.Image) -> Image.Image:
    dem_image = Image.fromarray(np.clip(dem, -500, 9000).astype(np.float32), mode="F")
    dem = np.asarray(dem_image.resize(PROCESS_SIZE, Image.Resampling.BICUBIC), dtype=np.float32)
    land = np.asarray(mask, dtype=np.float32) / 255.0
    valid = dem[land > 0.35]
    low, high = np.percentile(valid, [2.0, 98.5])
    elev = np.clip((dem - low) / max(1.0, high - low), 0.0, 1.0)

    # Render an overview-specific regional hillshade first. At campaign zoom,
    # fine valleys average away; broad mountain faces must remain legible.
    regional_small = Image.fromarray(dem, mode="F").resize(
        (max(1, PROCESS_SIZE[0] // 28), max(1, PROCESS_SIZE[1] // 28)),
        Image.Resampling.BILINEAR,
    )
    regional = np.asarray(regional_small.resize(PROCESS_SIZE, Image.Resampling.BICUBIC), dtype=np.float32)
    regional_gy, regional_gx = np.gradient(regional)
    regional_slope = np.sqrt(regional_gx * regional_gx + regional_gy * regional_gy)

    local_small = Image.fromarray(dem, mode="F").resize(
        (max(1, PROCESS_SIZE[0] // 8), max(1, PROCESS_SIZE[1] // 8)),
        Image.Resampling.BILINEAR,
    )
    local_base = np.asarray(local_small.resize(PROCESS_SIZE, Image.Resampling.BICUBIC), dtype=np.float32)
    local_relief = dem - local_base
    local_scale = np.percentile(np.abs(local_relief[land > 0.35]), 95) + 1e-6
    local_relief = np.clip(local_relief / local_scale, -1.0, 1.0)

    gy, gx = np.gradient(dem)
    slope = np.sqrt(gx * gx + gy * gy)

    def shade(azimuth: float, altitude: float, grad_x: np.ndarray, grad_y: np.ndarray, slope_value: np.ndarray, exaggeration: float) -> np.ndarray:
        az = math.radians(azimuth)
        alt = math.radians(altitude)
        aspect = np.arctan2(-grad_x, grad_y)
        slope_angle = np.arctan(slope_value * exaggeration)
        return np.clip(
            np.sin(alt) * np.cos(slope_angle)
            + np.cos(alt) * np.sin(slope_angle) * np.cos(az - aspect),
            0.0,
            1.0,
        )

    regional_light = (
        0.74 * shade(315, 39, regional_gx, regional_gy, regional_slope, 0.19)
        + 0.17 * shade(35, 25, regional_gx, regional_gy, regional_slope, 0.12)
        + 0.09 * shade(225, 18, regional_gx, regional_gy, regional_slope, 0.08)
    )
    detail_light = (
        0.70 * shade(315, 38, gx, gy, slope, 0.072)
        + 0.20 * shade(45, 24, gx, gy, slope, 0.048)
        + 0.10 * shade(225, 18, gx, gy, slope, 0.035)
    )
    light = np.clip(0.14 + regional_light * 1.06 + detail_light * 0.54 + local_relief * 0.12, 0.0, 1.0)
    ridge = np.clip(slope / (np.percentile(slope[land > 0.35], 96) + 1e-6), 0.0, 1.0)

    # Deep green base with slightly warmer highland faces; all color comes
    # from elevation and slope rather than a flat pattern overlay.
    low_color = np.array([22.0, 57.0, 47.0])
    mid_color = np.array([73.0, 105.0, 72.0])
    high_color = np.array([184.0, 178.0, 122.0])
    color = np.empty((*dem.shape, 3), dtype=np.float32)
    mid = np.clip(elev * 2.0, 0.0, 1.0)[..., None]
    upper = np.clip((elev - 0.5) * 2.0, 0.0, 1.0)[..., None]
    color[:] = low_color
    color = color * (1.0 - mid) + mid_color * mid
    color = color * (1.0 - upper) + high_color * upper
    color *= (0.31 + light[..., None] * 1.02)
    color += ridge[..., None] * (light[..., None] - 0.42) * np.array([30.0, 35.0, 21.0])
    color = np.clip(color, 0, 255).astype(np.uint8)

    rgba = np.dstack([color, np.clip(land * 242.0, 0, 242).astype(np.uint8)])
    return Image.fromarray(rgba, mode="RGBA")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    relief = build_relief(read_dem(), europe_mask(PROCESS_SIZE))
    relief.save(OUT_IMAGE, "WEBP", quality=92, method=6)
    OUT_META.write_text(json.dumps({
        "source": "AWS Terrain Tiles / Mapzen Terrarium elevation encoding",
        "zoom": ZOOM,
        "bounds": {"west": BOUNDS[0], "south": BOUNDS[1], "east": BOUNDS[2], "north": BOUNDS[3]},
        "size": {"width": TARGET_SIZE[0], "height": TARGET_SIZE[1]},
        "processing": "multiscale DEM hillshade with regional mountain faces, local ridges and Natural Earth Europe mask excluding Russia",
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT_IMAGE} ({relief.size[0]}x{relief.size[1]})")


if __name__ == "__main__":
    main()
