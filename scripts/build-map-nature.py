"""Build atlas-only lake polygons, river mouths and safe decoration masks.

Sources: existing territory/river/DEM data and public-domain Natural Earth lakes.
Install build-only dependencies with pip --target .cache/map-nature-python shapely.
No original map assets or save data are rewritten.
"""
from pathlib import Path
import sys
import json
import math
import hashlib
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / ".cache/map-nature-python"))
from shapely.geometry import Polygon, shape, Point
from shapely.ops import unary_union, transform
from map_relief_regions import load_config, source_to_display
import importlib.util
spec = importlib.util.spec_from_file_location('map_environment_builder', ROOT / 'scripts/build-map-environment.py')
environment_builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(environment_builder)
encode_rle, project = environment_builder.encode_rle, environment_builder.project

SOURCE = ROOT / ".cache/map-environment/ne_10m_lakes.geojson"
URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson"


def build_region(region, spec, features, lake_source, environment, coastlines):
    meta = json.loads((ROOT / f"assets/map-relief/relief-mesh/{region}.json").read_text())
    width, height, step = meta["width"], meta["height"], meta["step"]
    ox, oz = meta["origin"]
    source = np.fromfile(ROOT / meta["file"], dtype=np.uint8)
    land = source[width * height * 2:].reshape(height, width) > 200
    blocked = Image.new("L", (width, height))
    draw = ImageDraw.Draw(blocked)
    filled = []
    coast_points = []

    def display(lng, lat, *_):
        dlat, dlng = source_to_display(spec, np.asarray(lat), np.asarray(lng))
        return project(dlng, dlat)

    def pixels(points):
        return [((x - ox) / step, (z - oz) / step) for x, z in points]

    for feature in features:
        props = feature["properties"]
        matches = props["region"] == "south-america" if region == "south-america" else (
            props["territoryId"] == "adm1:nor-901" if region == "svalbard" else
            props["region"] == "europe" and props["territoryId"] != "adm1:nor-901")
        if not matches:
            continue
        geometry = transform(display, shape(feature["geometry"]))
        polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
        for polygon in polygons:
            filled.append(Polygon(polygon.exterior))
            for ring in [polygon.exterior, *polygon.interiors]:
                draw.line(pixels(ring.coords), fill=255, width=3)
        # Match the geographic bounding-box center used by live facility icons.
        all_points = np.array([p for poly in polygons for p in poly.exterior.coords])
        lng = all_points[:, 0] / 1024 * 360
        lat = np.degrees(np.arctan(np.sinh(-all_points[:, 1] / 1024 * 2 * np.pi)))
        ax, az = project((lng.min() + lng.max()) / 2, (lat.min() + lat.max()) / 2)
        px, pz = (float(ax) - ox) / step, (float(az) - oz) / step
        radius = .85 / step
        draw.ellipse((px-radius, pz-radius, px+radius, pz+radius), fill=255)
        for coast in coastlines["territories"].get(props["territoryId"], {}).get("coastlines", []):
            points = [tuple(map(float, display(*p))) for p in coast]
            for a, b in zip(points, points[1:]):
                length = math.dist(a, b)
                coast_points.extend([(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
                                     for t in np.linspace(0, 1, max(2, math.ceil(length / .15)+1))])

    footprint = unary_union(filled).buffer(0)
    lakes = []
    for feature in lake_source["features"]:
        geo = feature.get("geometry")
        if not geo:
            continue
        water = transform(display, shape(geo))
        if not water.is_valid:
            water = water.buffer(0)
        if not footprint.intersects(water):
            continue
        water = water.intersection(footprint).simplify(.012, preserve_topology=True)
        polygons = [water] if water.geom_type == "Polygon" else getattr(water, "geoms", [])
        for polygon in polygons:
            if polygon.geom_type != "Polygon" or polygon.area < .025:
                continue
            rings = [[[round(x, 4), round(z, 4)] for x, z in ring.coords]
                     for ring in [polygon.exterior, *polygon.interiors]]
            lakes.append({"name": feature["properties"].get("name_en") or feature["properties"].get("name") or "",
                          "rings": rings, "area": round(polygon.area, 4)})
            for ring in rings:
                draw.polygon(pixels(ring), fill=255)
                draw.line(pixels(ring), fill=255, width=4)

    river_paths = environment["rivers"]
    for river in river_paths:
        draw.line(pixels(river["points"]), fill=255, width=3 if river["rank"] <= 3 else 2)
    safe = land & (np.asarray(blocked) == 0) & (distance_transform_edt(land) >= 2)
    tree = cKDTree(coast_points) if coast_points else None
    mouths = []
    for river in river_paths:
        points = river["points"]
        if tree is None or river["rank"] > 4 or len(points) < 3:
            continue
        for ordered in [points, list(reversed(points))]:
            endpoint = ordered[0]
            distance, index = tree.query(endpoint)
            if distance > .65 or any(math.dist(endpoint, m["coast"]) < .7 for m in mouths):
                continue
            coast = coast_points[index]
            # Lake outlets and inland segment breaks are not ocean estuaries.
            if any(Polygon(lake["rings"][0], lake["rings"][1:]).distance(Point(coast)) < .5 for lake in lakes):
                continue
            inside = next((p for p in ordered[1:] if math.dist(p, coast) > .55), ordered[-1])
            if math.dist(inside, coast) > 3:
                continue
            mouths.append({"name": river["name"], "coast": [round(v, 4) for v in coast],
                           "inland": inside, "width": .075 if river["rank"] > 2 else .11})
    print(f"{region}: {len(lakes)} lakes, {len(mouths)} mouths, {safe.sum()} safe nodes", flush=True)
    return {"placement": {"width": width, "height": height, "origin": meta["origin"], "step": step,
                           "rle": encode_rle(safe.astype(np.uint8)*255)}, "lakes": lakes, "mouths": mouths}


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Download {URL} to {SOURCE}")
    config = load_config()
    features = json.loads((ROOT / "assets/data/campaign-territories.geojson").read_text(encoding="utf8"))["features"]
    lakes = json.loads(SOURCE.read_text(encoding="utf8"))
    env = json.loads((ROOT / "assets/data/map-environment.json").read_text(encoding="utf8"))
    coasts = json.loads((ROOT / "assets/data/campaign-coastlines.json").read_text(encoding="utf8"))
    specs = {"europe": {"transform": {"type": "identity"}}, **config["regions"]}
    result = {"schemaVersion": 1, "revision": "20260905-nature-v1",
              "source": {"lakes": URL, "lakeSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                         "license": "Natural Earth public domain", "mouths": "Existing rivers matched to existing coastline",
                         "vegetation": "Procedural art approximation, not a land-cover survey"},
              "regions": {key: build_region(key, spec, features, lakes, env["regions"][key], coasts) for key, spec in specs.items()}}
    output = ROOT / "assets/data/map-nature.json"
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    print(f"Wrote {output.name}: {output.stat().st_size} bytes", flush=True)


if __name__ == "__main__":
    main()
