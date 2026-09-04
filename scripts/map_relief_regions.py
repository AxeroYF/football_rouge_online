"""Validate and print DEM build plans for relocated campaign-map regions.

This module deliberately separates source geography from display geography.
South America is sampled from its real Terrarium coordinates, then inverse-
projected into the campaign's axis-swapped display position.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Callable, Iterable


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "shared" / "config" / "map-relief-regions.json"
TERRITORIES_PATH = ROOT / "assets" / "data" / "campaign-territories.geojson"
TILE_SIZE = 256


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def bounds_corners(bounds: dict[str, float]) -> list[tuple[float, float]]:
    return [
        (bounds["south"], bounds["west"]),
        (bounds["south"], bounds["east"]),
        (bounds["north"], bounds["west"]),
        (bounds["north"], bounds["east"]),
    ]


def bounds_from_points(points: Iterable[tuple[float, float]]) -> dict[str, float]:
    values = list(points)
    return {
        "west": min(lng for lat, lng in values),
        "south": min(lat for lat, lng in values),
        "east": max(lng for lat, lng in values),
        "north": max(lat for lat, lng in values),
    }


def source_to_display(region: dict[str, Any], lat: float, lng: float) -> tuple[float, float]:
    transform = region["transform"]
    if transform["type"] == "identity":
        return lat, lng
    if transform["type"] == "south-america-axis-swap":
        source = transform["sourceCenter"]
        display = transform["displayCenter"]
        return (
            display["lat"] + (lng - source["lng"]),
            display["lng"] + (lat - source["lat"]),
        )
    raise ValueError(f"Unsupported relief transform: {transform['type']}")


def display_to_source(region: dict[str, Any], lat: float, lng: float) -> tuple[float, float]:
    transform = region["transform"]
    if transform["type"] == "identity":
        return lat, lng
    if transform["type"] == "south-america-axis-swap":
        source = transform["sourceCenter"]
        display = transform["displayCenter"]
        return (
            source["lat"] + (lng - display["lng"]),
            source["lng"] + (lat - display["lat"]),
        )
    raise ValueError(f"Unsupported relief transform: {transform['type']}")


def transformed_bounds(
    bounds: dict[str, float],
    transform: Callable[[float, float], tuple[float, float]],
) -> dict[str, float]:
    return bounds_from_points(transform(lat, lng) for lat, lng in bounds_corners(bounds))


def mercator_y(lat: float) -> float:
    clamped = max(-85.05112878, min(85.05112878, lat))
    return (1.0 - math.asinh(math.tan(math.radians(clamped))) / math.pi) / 2.0


def tile_range(bounds: dict[str, float], zoom: int) -> dict[str, int]:
    scale = 2**zoom
    min_x = math.floor((bounds["west"] + 180.0) / 360.0 * scale)
    max_x = math.floor(((bounds["east"] + 180.0) / 360.0 * scale) - 1e-12)
    min_y = math.floor(mercator_y(bounds["north"]) * scale)
    max_y = math.floor(mercator_y(bounds["south"]) * scale - 1e-12)
    return {
        "minX": min_x,
        "minY": min_y,
        "maxX": max_x,
        "maxY": max_y,
        "count": (max_x - min_x + 1) * (max_y - min_y + 1),
    }


def iter_geometry_points(coordinates: Any) -> Iterable[tuple[float, float]]:
    if (
        isinstance(coordinates, list)
        and len(coordinates) >= 2
        and isinstance(coordinates[0], (int, float))
        and isinstance(coordinates[1], (int, float))
    ):
        yield float(coordinates[1]), float(coordinates[0])
        return
    if isinstance(coordinates, list):
        for child in coordinates:
            yield from iter_geometry_points(child)


def feature_matches(feature: dict[str, Any], geometry_filter: dict[str, Any]) -> bool:
    properties = feature.get("properties") or {}
    if "region" in geometry_filter:
        return properties.get("region") == geometry_filter["region"]
    return properties.get("territoryId") in set(geometry_filter.get("territoryIds", []))


def intersects(left: dict[str, float], right: dict[str, float]) -> bool:
    return not (
        left["east"] < right["west"]
        or left["west"] > right["east"]
        or left["north"] < right["south"]
        or left["south"] > right["north"]
    )


def build_region_plan(
    region_id: str,
    region: dict[str, Any],
    territories: dict[str, Any],
    native_zoom: int,
    overview_zooms: list[int],
) -> dict[str, Any]:
    display_bounds = region["displayBounds"]
    source_bounds = transformed_bounds(
        display_bounds,
        lambda lat, lng: display_to_source(region, lat, lng),
    )
    features = [
        feature
        for feature in territories.get("features", [])
        if feature_matches(feature, region["geometryFilter"])
    ]
    feature_rows = []
    all_points = []
    for feature in features:
        points = list(iter_geometry_points((feature.get("geometry") or {}).get("coordinates", [])))
        if not points:
            continue
        all_points.extend(points)
        feature_bounds = bounds_from_points(points)
        feature_rows.append({
            "territoryId": (feature.get("properties") or {}).get("territoryId"),
            "sourceBounds": feature_bounds,
            "intersectsPlannedSource": intersects(feature_bounds, source_bounds),
        })

    geometry_bounds = bounds_from_points(all_points)
    excluded = [row["territoryId"] for row in feature_rows if not row["intersectsPlannedSource"]]
    return {
        "region": region_id,
        "label": region["label"],
        "transform": region["transform"]["type"],
        "sourceGeometryBounds": geometry_bounds,
        "plannedSourceBounds": source_bounds,
        "plannedDisplayBounds": display_bounds,
        "sourceTerrariumTiles": tile_range(source_bounds, native_zoom),
        "displayDetailTiles": tile_range(display_bounds, native_zoom),
        "displayOverviewTiles": {
            str(zoom): tile_range(display_bounds, zoom) for zoom in overview_zooms
        },
        "matchedTerritories": len(feature_rows),
        "fullyOutsidePlannedSource": excluded,
        "output": region["output"],
    }


def build_plan(region_ids: list[str] | None = None) -> dict[str, Any]:
    config = load_config()
    territories = json.loads(TERRITORIES_PATH.read_text(encoding="utf-8"))
    selected = region_ids or list(config["regions"])
    detail_zoom = int(config.get("maxNativeZoom", config["nativeZoom"]))
    return {
        "schemaVersion": config["schemaVersion"],
        "futureCampaignBounds": config["futureCampaignBounds"],
        "regions": [
            build_region_plan(
                region_id,
                config["regions"][region_id],
                territories,
                detail_zoom,
                config["overviewZooms"],
            )
            for region_id in selected
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Print validated campaign DEM region plans.")
    parser.add_argument(
        "--region",
        action="append",
        choices=sorted(load_config()["regions"]),
        help="Limit output to one region; repeat to select multiple regions.",
    )
    parser.add_argument("--compact", action="store_true", help="Print compact JSON.")
    arguments = parser.parse_args()
    print(json.dumps(
        build_plan(arguments.region),
        ensure_ascii=False,
        indent=None if arguments.compact else 2,
        sort_keys=False,
    ))


if __name__ == "__main__":
    main()
