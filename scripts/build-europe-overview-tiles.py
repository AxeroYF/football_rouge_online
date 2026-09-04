"""Build a native overview tile pyramid from the Europe DEM relief image.

Leaflet otherwise downscales one 5200px overlay to a few hundred screen pixels
at overview zoom. These tiles bake the same real DEM relief at each map zoom.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "map-relief" / "europe-dem-relief.webp"
OUT_DIR = ROOT / "assets" / "map-relief" / "europe-dem-overview"
BOUNDS = (-25.0, 25.0, 100.0, 75.0)  # west, south, east, north
SOURCE_ZOOM = 8
MIN_ZOOM = 3
MAX_ZOOM = 7
TILE_SIZE = 256


def mercator_y(lat: float) -> float:
    lat = max(-85.05112878, min(85.05112878, lat))
    return (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0


def world_pixel(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    world_size = TILE_SIZE * (2**zoom)
    return ((lon + 180.0) / 360.0 * world_size, mercator_y(lat) * world_size)


def tile_range(zoom: int) -> tuple[int, int, int, int]:
    west, south, east, north = BOUNDS
    left, top = world_pixel(west, north, zoom)
    right, bottom = world_pixel(east, south, zoom)
    return (
        math.floor(left / TILE_SIZE),
        math.floor(top / TILE_SIZE),
        math.floor((right - 1) / TILE_SIZE),
        math.floor((bottom - 1) / TILE_SIZE),
    )


def source_box(x: int, y: int, zoom: int, source_size: tuple[int, int]) -> tuple[float, float, float, float]:
    west, south, east, north = BOUNDS
    left, top = world_pixel(west, north, SOURCE_ZOOM)
    right, bottom = world_pixel(east, south, SOURCE_ZOOM)
    scale = 2 ** (SOURCE_ZOOM - zoom)
    tile_left = x * TILE_SIZE * scale
    tile_top = y * TILE_SIZE * scale
    tile_right = tile_left + TILE_SIZE * scale
    tile_bottom = tile_top + TILE_SIZE * scale
    width, height = source_size
    return (
        (tile_left - left) / (right - left) * width,
        (tile_top - top) / (bottom - top) * height,
        (tile_right - left) / (right - left) * width,
        (tile_bottom - top) / (bottom - top) * height,
    )


def make_tile(source: Image.Image, x: int, y: int, zoom: int) -> Image.Image:
    # Crop with a generous transparent canvas so partially intersecting edge
    # tiles preserve their exact projected position.
    box = source_box(x, y, zoom, source.size)
    canvas = Image.new("RGBA", source.size, (0, 0, 0, 0))
    canvas.alpha_composite(source)
    sampled = canvas.transform(
        (TILE_SIZE, TILE_SIZE),
        Image.Transform.EXTENT,
        box,
        Image.Resampling.BICUBIC,
    )
    if zoom <= 5:
        # Applied after projection/downsampling: this clarifies real, broad
        # mountain faces without adding artificial terrain marks.
        sampled = sampled.filter(ImageFilter.UnsharpMask(radius=1.05, percent=95, threshold=3))
    return sampled


def main() -> None:
    with Image.open(SOURCE) as source_image:
        source = source_image.convert("RGBA")
    written = 0
    for zoom in range(MIN_ZOOM, MAX_ZOOM + 1):
        min_x, min_y, max_x, max_y = tile_range(zoom)
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                output = OUT_DIR / str(zoom) / str(x) / f"{y}.webp"
                output.parent.mkdir(parents=True, exist_ok=True)
                make_tile(source, x, y, zoom).save(output, "WEBP", quality=90, method=4)
                written += 1
        print(f"wrote z{zoom} overview tiles")
    print(f"wrote {written} Europe DEM overview tiles")


if __name__ == "__main__":
    main()