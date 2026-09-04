"""Build native detail and overview DEM relief tiles for configured map regions.

South America is rendered in its relocated campaign-map coordinates. Every
display pixel is inverse-mapped to the real geographic coordinate before the
Terrarium elevation is sampled; hillshade is then calculated in display space.
"""

from __future__ import annotations

import argparse
import json
import math
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from map_relief_regions import (
    ROOT,
    TERRITORIES_PATH,
    build_plan,
    feature_matches,
    load_config,
    source_to_display,
    tile_range,
)


TILE_SIZE = 256
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE_DIR = ROOT / ".cache" / "terrarium-dem-z8"
META_DIR = ROOT / "assets" / "map-relief"
TRANSPARENT_TILE = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
DOWNLOAD_LOCK = threading.Lock()


def mercator_lat(world_y: np.ndarray | float, zoom: int) -> np.ndarray:
    scale = TILE_SIZE * (2**zoom)
    value = np.pi * (1.0 - 2.0 * np.asarray(world_y, dtype=np.float64) / scale)
    return np.degrees(np.arctan(np.sinh(value)))


def mercator_y(lat: np.ndarray | float, zoom: int) -> np.ndarray:
    values = np.clip(np.asarray(lat, dtype=np.float64), -85.05112878, 85.05112878)
    scale = TILE_SIZE * (2**zoom)
    return (1.0 - np.arcsinh(np.tan(np.radians(values))) / np.pi) / 2.0 * scale


def world_x(lng: np.ndarray | float, zoom: int) -> np.ndarray:
    return (np.asarray(lng, dtype=np.float64) + 180.0) / 360.0 * TILE_SIZE * (2**zoom)


def output_directory(template: str) -> Path:
    return ROOT / Path(template.split("/{z}/", 1)[0])


def iter_polygons(geometry: dict[str, Any]) -> Iterable[list[list[list[float]]]]:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        yield coordinates
    elif geometry.get("type") == "MultiPolygon":
        yield from coordinates


def projected_polygons(region: dict[str, Any], territories: dict[str, Any], zoom: int) -> list[dict[str, Any]]:
    result = []
    for feature in territories.get("features", []):
        if not feature_matches(feature, region["geometryFilter"]):
            continue
        for polygon in iter_polygons(feature.get("geometry") or {}):
            rings = []
            for ring in polygon:
                points = []
                for lng, lat in ring:
                    display_lat, display_lng = source_to_display(region, float(lat), float(lng))
                    points.append(display_pixel(display_lng, display_lat, zoom))
                if points:
                    rings.append(points)
            if rings:
                xs, ys = zip(*rings[0])
                result.append({
                    "rings": rings,
                    "bounds": (min(xs), min(ys), max(xs), max(ys)),
                })
    return result


def display_pixel(lng: float, lat: float, zoom: int) -> tuple[float, float]:
    return float(world_x(lng, zoom)), float(mercator_y(lat, zoom))


def index_polygons_by_tile(polygons: list[dict[str, Any]]) -> dict[tuple[int, int], list[dict[str, Any]]]:
    result: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for polygon in polygons:
        west, north, east, south = polygon["bounds"]
        for y in range(math.floor(north / TILE_SIZE), math.floor(south / TILE_SIZE) + 1):
            for x in range(math.floor(west / TILE_SIZE), math.floor(east / TILE_SIZE) + 1):
                result.setdefault((x, y), []).append(polygon)
    return result


def land_mask(polygons: list[dict[str, Any]], x: int, y: int) -> Image.Image:
    mask = Image.new("L", (TILE_SIZE, TILE_SIZE), 0)
    draw = ImageDraw.Draw(mask)
    left = x * TILE_SIZE
    top = y * TILE_SIZE
    right = left + TILE_SIZE
    bottom = top + TILE_SIZE
    for polygon in polygons:
        for ring_index, points in enumerate(polygon["rings"]):
            if len(points) < 3:
                continue
            draw.polygon([(px - left, py - top) for px, py in points], fill=255 if ring_index == 0 else 0)
    return mask.filter(ImageFilter.GaussianBlur(0.6))


def cache_path(zoom: int, x: int, y: int) -> Path:
    return CACHE_DIR / f"{zoom}-{x}-{y}.png"


def validate_image(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()
        return True
    except (OSError, ValueError):
        return False


def fetch_tile(zoom: int, x: int, y: int) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = cache_path(zoom, x, y)
    if path.exists() and validate_image(path):
        return path
    path.unlink(missing_ok=True)
    request = urllib.request.Request(
        TERRARIUM_URL.format(z=zoom, x=x, y=y),
        headers={"User-Agent": "Rougelite regional DEM builder"},
    )
    last_error = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                data = response.read()
            with Image.open(BytesIO(data)) as decoded:
                decoded.verify()
            temporary = path.with_suffix(f".{threading.get_ident()}.part")
            temporary.write_bytes(data)
            with DOWNLOAD_LOCK:
                if not path.exists():
                    temporary.replace(path)
                else:
                    temporary.unlink(missing_ok=True)
            return path
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            path.unlink(missing_ok=True)
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Unable to fetch complete DEM tile {zoom}/{x}/{y}") from last_error


def elevation_from_rgb(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0


@lru_cache(maxsize=192)
def load_elevation_tile(zoom: int, x: int, y: int) -> np.ndarray:
    with Image.open(fetch_tile(zoom, x, y)) as image:
        return elevation_from_rgb(image)


def inverse_source_grid(region: dict[str, Any], x: int, y: int, zoom: int) -> tuple[np.ndarray, np.ndarray]:
    display_x = x * TILE_SIZE + np.arange(-1, TILE_SIZE + 1, dtype=np.float64) + 0.5
    display_y = y * TILE_SIZE + np.arange(-1, TILE_SIZE + 1, dtype=np.float64) + 0.5
    display_lng = display_x / (TILE_SIZE * (2**zoom)) * 360.0 - 180.0
    display_lat = mercator_lat(display_y, zoom)
    lat_grid = np.broadcast_to(display_lat[:, None], (TILE_SIZE + 2, TILE_SIZE + 2))
    lng_grid = np.broadcast_to(display_lng[None, :], (TILE_SIZE + 2, TILE_SIZE + 2))
    transform = region["transform"]
    if transform["type"] == "identity":
        return lat_grid, lng_grid
    source = transform["sourceCenter"]
    display = transform["displayCenter"]
    source_lat = source["lat"] + (lng_grid - display["lng"])
    source_lng = source["lng"] + (lat_grid - display["lat"])
    return source_lat, source_lng


def source_tiles_for_output(region: dict[str, Any], x: int, y: int, zoom: int) -> set[tuple[int, int]]:
    display_x = np.array([x * TILE_SIZE - 0.5, (x + 1) * TILE_SIZE + 0.5], dtype=np.float64)
    display_y = np.array([y * TILE_SIZE - 0.5, (y + 1) * TILE_SIZE + 0.5], dtype=np.float64)
    display_lng = display_x / (TILE_SIZE * (2**zoom)) * 360.0 - 180.0
    display_lat = mercator_lat(display_y, zoom)
    lat_grid = np.broadcast_to(display_lat[:, None], (2, 2))
    lng_grid = np.broadcast_to(display_lng[None, :], (2, 2))
    transform = region["transform"]
    if transform["type"] == "identity":
        source_lat, source_lng = lat_grid, lng_grid
    else:
        source = transform["sourceCenter"]
        display = transform["displayCenter"]
        source_lat = source["lat"] + (lng_grid - display["lng"])
        source_lng = source["lng"] + (lat_grid - display["lat"])
    source_x = world_x(source_lng, zoom)
    source_y = mercator_y(source_lat, zoom)
    min_x = math.floor(float(np.min(source_x)) / TILE_SIZE)
    max_x = math.floor((float(np.max(source_x)) + 1.0) / TILE_SIZE)
    min_y = math.floor(float(np.min(source_y)) / TILE_SIZE)
    max_y = math.floor((float(np.max(source_y)) + 1.0) / TILE_SIZE)
    return {(tx, ty) for ty in range(min_y, max_y + 1) for tx in range(min_x, max_x + 1)}


def sample_global_pixels(zoom: int, pixel_x: np.ndarray, pixel_y: np.ndarray) -> np.ndarray:
    tile_x = np.floor_divide(pixel_x, TILE_SIZE).astype(np.int32)
    tile_y = np.floor_divide(pixel_y, TILE_SIZE).astype(np.int32)
    local_x = np.mod(pixel_x, TILE_SIZE).astype(np.int32)
    local_y = np.mod(pixel_y, TILE_SIZE).astype(np.int32)
    result = np.empty(pixel_x.shape, dtype=np.float32)
    pairs = np.unique(np.stack([tile_x.ravel(), tile_y.ravel()], axis=1), axis=0)
    for tx, ty in pairs:
        selected = (tile_x == tx) & (tile_y == ty)
        tile = load_elevation_tile(zoom, int(tx), int(ty))
        result[selected] = tile[local_y[selected], local_x[selected]]
    return result


def sample_elevation(region: dict[str, Any], x: int, y: int, zoom: int) -> np.ndarray:
    source_lat, source_lng = inverse_source_grid(region, x, y, zoom)
    source_x = world_x(source_lng, zoom) - 0.5
    source_y = mercator_y(source_lat, zoom) - 0.5
    x0 = np.floor(source_x).astype(np.int64)
    y0 = np.floor(source_y).astype(np.int64)
    fx = (source_x - x0).astype(np.float32)
    fy = (source_y - y0).astype(np.float32)
    top_left = sample_global_pixels(zoom, x0, y0)
    top_right = sample_global_pixels(zoom, x0 + 1, y0)
    bottom_left = sample_global_pixels(zoom, x0, y0 + 1)
    bottom_right = sample_global_pixels(zoom, x0 + 1, y0 + 1)
    top = top_left * (1.0 - fx) + top_right * fx
    bottom = bottom_left * (1.0 - fx) + bottom_right * fx
    return top * (1.0 - fy) + bottom * fy


def shaded(gx: np.ndarray, gy: np.ndarray, slope: np.ndarray, azimuth: float, altitude: float, exaggeration: float) -> np.ndarray:
    az = math.radians(azimuth)
    alt = math.radians(altitude)
    aspect = np.arctan2(-gx, gy)
    slope_angle = np.arctan(slope * exaggeration)
    return np.clip(
        np.sin(alt) * np.cos(slope_angle)
        + np.cos(alt) * np.sin(slope_angle) * np.cos(az - aspect),
        0.0,
        1.0,
    )


def render_relief(
    dem: np.ndarray,
    mask: Image.Image,
    elevation_scale: float,
    hillshade_contrast: float,
    slope_scale: float,
) -> Image.Image:
    gy, gx = np.gradient(dem)
    gx *= slope_scale
    gy *= slope_scale
    slope = np.sqrt(gx * gx + gy * gy)
    light = (
        0.74 * shaded(gx, gy, slope, 315, 39, 0.108)
        + 0.17 * shaded(gx, gy, slope, 35, 25, 0.072)
        + 0.09 * shaded(gx, gy, slope, 225, 18, 0.052)
    )[1:-1, 1:-1]
    light = np.clip(0.16 + light * 1.10, 0.0, 1.0)
    light = np.clip((light - 0.78) * hillshade_contrast + 0.78, 0.0, 1.0)
    center = dem[1:-1, 1:-1]
    center_slope = slope[1:-1, 1:-1]
    elevation_mix = np.clip((center + 120.0) / elevation_scale, 0.0, 1.0)
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
    return Image.fromarray(np.dstack([color, alpha]), mode="RGBA")


def write_webp(image: Image.Image, output: Path, quality: int = 88) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, "WEBP", quality=quality, method=4)


def tune_relief(image: Image.Image, brightness: float, contrast: float) -> Image.Image:
    tuned = image
    if brightness != 1.0 or contrast != 1.0:
        alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
        rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
        rgb = ((rgb - 30.0) * contrast + 30.0) * brightness
        tuned = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")
        tuned.putalpha(Image.fromarray(alpha, mode="L"))
    return tuned.filter(ImageFilter.UnsharpMask(radius=0.75, percent=40, threshold=3))


def build_detail_parent(detail_dir: Path, bounds: dict[str, float], child_zoom: int, parent_zoom: int) -> int:
    written = 0
    current_range = tile_range(bounds, parent_zoom)
    for y in range(current_range["minY"], current_range["maxY"] + 1):
        for x in range(current_range["minX"], current_range["maxX"] + 1):
            mosaic = Image.new("RGBA", (TILE_SIZE * 2, TILE_SIZE * 2), (0, 0, 0, 0))
            for dy in range(2):
                for dx in range(2):
                    child = detail_dir / str(child_zoom) / str(x * 2 + dx) / f"{y * 2 + dy}.webp"
                    if child.exists():
                        with Image.open(child) as image:
                            mosaic.alpha_composite(image.convert("RGBA"), (dx * TILE_SIZE, dy * TILE_SIZE))
            tile = mosaic.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
            write_webp(tile, detail_dir / str(parent_zoom) / str(x) / f"{y}.webp")
            written += 1
    print(f"wrote native z{parent_zoom} detail tiles derived from z{child_zoom}", flush=True)
    return written


def build_overview(detail_dir: Path, overview_dir: Path, bounds: dict[str, float], overview_zooms: list[int], render: dict[str, Any]) -> int:
    child_dir = detail_dir
    written = 0
    tuned_zoom = max(overview_zooms)
    for zoom in sorted(overview_zooms, reverse=True):
        current_range = tile_range(bounds, zoom)
        for y in range(current_range["minY"], current_range["maxY"] + 1):
            for x in range(current_range["minX"], current_range["maxX"] + 1):
                mosaic = Image.new("RGBA", (TILE_SIZE * 2, TILE_SIZE * 2), (0, 0, 0, 0))
                for dy in range(2):
                    for dx in range(2):
                        child = child_dir / str(zoom + 1) / str(x * 2 + dx) / f"{y * 2 + dy}.webp"
                        if child.exists():
                            with Image.open(child) as image:
                                mosaic.alpha_composite(image.convert("RGBA"), (dx * TILE_SIZE, dy * TILE_SIZE))
                tile = mosaic.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
                if zoom == tuned_zoom:
                    tile = tune_relief(
                        tile,
                        float(render.get("overviewBrightness", 1.0)),
                        float(render.get("overviewContrast", 1.0)),
                    )
                if zoom <= 5:
                    tile = tile.filter(ImageFilter.UnsharpMask(radius=1.05, percent=95, threshold=3))
                write_webp(tile, overview_dir / str(zoom) / str(x) / f"{y}.webp", quality=90)
                written += 1
        child_dir = overview_dir
        print(f"wrote z{zoom} overview tiles", flush=True)
    return written


def build_region(region_id: str, region: dict[str, Any], config: dict[str, Any], territories: dict[str, Any], workers: int, force: bool) -> dict[str, Any]:
    zoom = int(config.get("maxNativeZoom", config["nativeZoom"]))
    bounds = region["displayBounds"]
    detail_dir = output_directory(region["output"]["detail"])
    overview_dir = output_directory(region["output"]["overview"])
    polygons_by_tile = index_polygons_by_tile(projected_polygons(region, territories, zoom))
    ranges = tile_range(bounds, zoom)
    jobs = [
        (x, y)
        for y in range(ranges["minY"], ranges["maxY"] + 1)
        for x in range(ranges["minX"], ranges["maxX"] + 1)
    ]
    land_jobs: list[tuple[int, int, Image.Image]] = []
    land_tiles = 0
    transparent_written = 0
    for x, y in jobs:
        output = detail_dir / str(zoom) / str(x) / f"{y}.webp"
        mask = land_mask(polygons_by_tile.get((x, y), []), x, y)
        if mask.getbbox() is None:
            if force or not output.exists():
                write_webp(TRANSPARENT_TILE, output, quality=80)
            transparent_written += 1
        else:
            land_tiles += 1
            if force or not output.exists():
                land_jobs.append((x, y, mask))

    required_sources: set[tuple[int, int]] = set()
    for x, y, _mask in land_jobs:
        required_sources.update(source_tiles_for_output(region, x, y, zoom))
    missing_sources = [(x, y) for x, y in sorted(required_sources) if not validate_image(cache_path(zoom, x, y))]
    if missing_sources:
        print(f"{region_id}: downloading {len(missing_sources)} of {len(required_sources)} required Terrarium tiles", flush=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(fetch_tile, zoom, x, y) for x, y in missing_sources]
            for completed, future in enumerate(as_completed(futures), start=1):
                future.result()
                if completed % 100 == 0 or completed == len(futures):
                    print(f"{region_id}: downloaded {completed}/{len(futures)}", flush=True)

    elevation_scale = float(region.get("render", {}).get("elevationScaleMeters", 4100.0))
    hillshade_contrast = float(region.get("render", {}).get("hillshadeContrast", 1.0))
    def render_job(job: tuple[int, int, Image.Image]) -> None:
        x, y, mask = job
        relief = render_relief(
            sample_elevation(region, x, y, zoom),
            mask,
            elevation_scale,
            hillshade_contrast,
            2.0 ** (zoom - int(config["nativeZoom"])),
        )
        relief = tune_relief(
            relief,
            float(region.get("render", {}).get("detailBrightness", 1.0)),
            float(region.get("render", {}).get("detailContrast", 1.0)),
        )
        write_webp(relief, detail_dir / str(zoom) / str(x) / f"{y}.webp")

    with ThreadPoolExecutor(max_workers=min(4, workers)) as pool:
        futures = [pool.submit(render_job, job) for job in land_jobs]
        for completed, future in enumerate(as_completed(futures), start=1):
            future.result()
            if completed % 100 == 0 or completed == len(land_jobs):
                print(f"{region_id}: rendered {completed}/{len(land_jobs)} land detail tiles", flush=True)

    for parent_zoom in range(zoom - 1, int(config["nativeZoom"]) - 1, -1):
        build_detail_parent(detail_dir, bounds, parent_zoom + 1, parent_zoom)

    overview_written = build_overview(
        detail_dir,
        overview_dir,
        bounds,
        config["overviewZooms"],
        region.get("render", {}),
    )
    result = {
        "region": region_id,
        "source": "AWS Terrain Tiles / Mapzen Terrarium elevation encoding",
        "nativeZoom": int(config["nativeZoom"]),
        "maxNativeZoom": zoom,
        "detailZooms": list(range(int(config["nativeZoom"]), zoom + 1)),
        "bounds": bounds,
        "transform": region["transform"],
        "render": region.get("render", {}),
        "detailTiles": len(jobs),
        "landDetailTiles": land_tiles,
        "renderedLandDetailTiles": len(land_jobs),
        "transparentDetailTiles": transparent_written,
        "sourceTilesRequired": len(required_sources),
        "overviewTiles": overview_written,
        "detailPath": region["output"]["detail"],
        "overviewPath": region["output"]["overview"],
        "processing": f"inverse-mapped native z{zoom} DEM hillshade with campaign territory mask and derived z3-z7 overview pyramid",
    }
    metadata = META_DIR / f"{region_id}-dem-relief.json"
    metadata.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{region_id}: wrote {len(jobs)} detail and {overview_written} overview tiles", flush=True)
    return result


def main() -> None:
    config = load_config()
    parser = argparse.ArgumentParser(description="Build configured campaign DEM relief regions.")
    parser.add_argument("--region", action="append", choices=sorted(config["regions"]), help="Build one region; repeat to select multiple.")
    parser.add_argument("--workers", type=int, default=10, help="Concurrent Terrarium downloads.")
    parser.add_argument("--force", action="store_true", help="Regenerate existing native detail tiles.")
    parser.add_argument("--overview-only", action="store_true", help="Rebuild overview tiles from existing native detail tiles.")
    parser.add_argument("--plan", action="store_true", help="Print the build plan without downloading or writing tiles.")
    arguments = parser.parse_args()
    selected = arguments.region or list(config["regions"])
    if arguments.plan:
        print(json.dumps(build_plan(selected), ensure_ascii=False, indent=2))
        return
    territories = json.loads(TERRITORIES_PATH.read_text(encoding="utf-8"))
    for region_id in selected:
        region = config["regions"][region_id]
        if arguments.overview_only:
            build_overview(
                output_directory(region["output"]["detail"]),
                output_directory(region["output"]["overview"]),
                region["displayBounds"],
                config["overviewZooms"],
                region.get("render", {}),
            )
        else:
            build_region(region_id, region, config, territories, max(1, arguments.workers), arguments.force)


if __name__ == "__main__":
    main()
