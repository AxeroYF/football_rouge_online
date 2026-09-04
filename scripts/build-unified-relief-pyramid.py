"""Build the single runtime z3-z7 relief pyramid from native z8 DEM tiles.

The browser should render one TileLayer per geographic region. Native z8/z9
tiles remain build sources for future expansion, while every runtime zoom is
derived recursively from the same z8 styling to avoid cross-layer visual pops.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "shared" / "config" / "map-relief-regions.json"
TILE_SIZE = 256
SOURCE_ZOOM = 8
MIN_RUNTIME_ZOOM = 3
MAX_RUNTIME_ZOOM = 7
TRANSPARENT_TILE = Image.new("RGBA", (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))


def mercator_y(latitude: float) -> float:
    clamped = max(-85.05112878, min(85.05112878, latitude))
    return (1.0 - math.asinh(math.tan(math.radians(clamped))) / math.pi) / 2.0


def world_pixel(longitude: float, latitude: float, zoom: int) -> tuple[float, float]:
    world_size = TILE_SIZE * (2**zoom)
    return ((longitude + 180.0) / 360.0 * world_size, mercator_y(latitude) * world_size)


def tile_range(bounds: dict[str, float], zoom: int) -> tuple[int, int, int, int]:
    left, top = world_pixel(bounds["west"], bounds["north"], zoom)
    right, bottom = world_pixel(bounds["east"], bounds["south"], zoom)
    return (
        math.floor(left / TILE_SIZE),
        math.floor(top / TILE_SIZE),
        math.floor((right - 1) / TILE_SIZE),
        math.floor((bottom - 1) / TILE_SIZE),
    )


def directory_from_template(template: str) -> Path:
    marker = template.find("{z}")
    if marker < 0:
        raise ValueError(f"Tile template has no {{z}} placeholder: {template}")
    return ROOT / template[:marker].rstrip("/\\")


def region_specs() -> dict[str, dict[str, Any]]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    specs: dict[str, dict[str, Any]] = {
        "europe": {
            "bounds": {"west": -25.0, "south": 25.0, "east": 100.0, "north": 74.0},
            "source": ROOT / "assets" / "map-relief" / "europe-dem-z8",
            "output": ROOT / "assets" / "map-relief" / "europe-dem-overview",
        },
    }
    for region_id, region in config["regions"].items():
        specs[region_id] = {
            "bounds": region["displayBounds"],
            "source": directory_from_template(region["output"]["detail"]),
            "output": directory_from_template(region["output"]["overview"]),
        }
    return specs


def load_child(root: Path, zoom: int, x: int, y: int) -> Image.Image | None:
    path = root / str(zoom) / str(x) / f"{y}.webp"
    if not path.exists():
        return None
    with Image.open(path) as image:
        return image.convert("RGBA")


def write_tile(image: Image.Image, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".webp.tmp")
    image.save(temporary, "WEBP", quality=90, method=4)
    temporary.replace(output)


def build_region(region_id: str, spec: dict[str, Any]) -> int:
    written = 0
    output_root: Path = spec["output"]
    for zoom in range(MAX_RUNTIME_ZOOM, MIN_RUNTIME_ZOOM - 1, -1):
        child_root: Path = spec["source"] if zoom == MAX_RUNTIME_ZOOM else output_root
        child_zoom = SOURCE_ZOOM if zoom == MAX_RUNTIME_ZOOM else zoom + 1
        min_x, min_y, max_x, max_y = tile_range(spec["bounds"], zoom)
        zoom_written = 0
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                mosaic = Image.new("RGBA", (TILE_SIZE * 2, TILE_SIZE * 2), (0, 0, 0, 0))
                for dy in range(2):
                    for dx in range(2):
                        child = load_child(child_root, child_zoom, x * 2 + dx, y * 2 + dy)
                        if child is not None:
                            mosaic.alpha_composite(child, (dx * TILE_SIZE, dy * TILE_SIZE))
                # LANCZOS downsampling supplies the only runtime-pyramid
                # resampling. Do not add another UnsharpMask at any zoom.
                tile = mosaic.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.LANCZOS)
                write_tile(tile, output_root / str(zoom) / str(x) / f"{y}.webp")
                written += 1
                zoom_written += 1
        print(f"{region_id}: wrote {zoom_written} unified z{zoom} tiles", flush=True)
    return written


def verify_region(region_id: str, spec: dict[str, Any]) -> int:
    checked = 0
    for zoom in range(MIN_RUNTIME_ZOOM, MAX_RUNTIME_ZOOM + 1):
        min_x, min_y, max_x, max_y = tile_range(spec["bounds"], zoom)
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                path = spec["output"] / str(zoom) / str(x) / f"{y}.webp"
                if not path.exists():
                    raise FileNotFoundError(f"Missing {region_id} runtime tile: {path}")
                with Image.open(path) as image:
                    if image.size != (TILE_SIZE, TILE_SIZE) or image.format != "WEBP":
                        raise ValueError(f"Invalid {region_id} runtime tile: {path}")
                    image.verify()
                checked += 1
    print(f"{region_id}: verified {checked} unified runtime tiles", flush=True)
    return checked


def main() -> None:
    specs = region_specs()
    parser = argparse.ArgumentParser(description="Build the unified z3-z7 runtime relief pyramid.")
    parser.add_argument("--region", action="append", choices=sorted(specs), help="Build one region; repeat to select multiple.")
    parser.add_argument("--verify-only", action="store_true", help="Only validate existing runtime tiles.")
    arguments = parser.parse_args()
    selected = arguments.region or list(specs)
    for region_id in selected:
        if not arguments.verify_only:
            build_region(region_id, specs[region_id])
        verify_region(region_id, specs[region_id])


if __name__ == "__main__":
    main()
