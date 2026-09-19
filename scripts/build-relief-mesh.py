"""Build compact, real elevation grids for Three.js; read LOCAL cached DEM only."""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import math

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/map-relief/relief-mesh"
STEP = 0.25
REVISION = "20260904-relief-mesh-v1"
spec = importlib.util.spec_from_file_location("cached_dem", ROOT / "scripts/build-soft-relief.py")
dem = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dem)


def sample_pixels(px, py):
    # Integer keys avoid the old two-column lexicographic sort for every sample.
    tx, ty = px // 256, py // 256
    codes = tx * 512 + ty
    result = np.empty(px.shape, dtype=np.float32)
    for code in np.unique(codes):
        x, y = divmod(int(code), 512)
        selected = codes == code
        result[selected] = dem.dem_tile(x, y)[py[selected] % 256, px[selected] % 256]
    return result


dem.sample_pixels = sample_pixels


def world_point(lng, lat):
    return lng / 360 * 1024, -math.asinh(math.tan(math.radians(lat))) / (2*math.pi) * 1024


def coordinates(region, xs, zs):
    lng = np.broadcast_to(xs[None, :] / 1024 * 360, (len(zs), len(xs)))
    lat = np.broadcast_to(np.degrees(np.arctan(np.sinh(-zs[:, None] / 1024 * 2*np.pi))), lng.shape)
    transform = dem.REGIONS[region]["transform"]
    if transform["type"] != "identity":
        source, display = transform["sourceCenter"], transform["displayCenter"]
        lat, lng = source["lat"] + lng - display["lng"], source["lng"] + lat - display["lat"]
    return lat, lng


def land_mask(region, xs, zs):
    # Sample the existing z7 coastline alpha at the same global grid nodes.
    px = np.rint((xs + 512) * 32 - 0.5).astype(int)
    py = np.rint((zs + 512) * 32 - 0.5).astype(int)
    result = np.zeros((len(zs), len(xs)), np.uint8)
    for ty in np.unique(py // 256):
        rows = np.flatnonzero(py // 256 == ty)
        for tx in np.unique(px // 256):
            cols = np.flatnonzero(px // 256 == tx)
            path = dem.classic_root(region) / "7" / str(tx) / f"{ty}.webp"
            if path.exists():
                with Image.open(path) as image:
                    alpha = np.asarray(image.convert("RGBA"))[..., 3]
                result[np.ix_(rows, cols)] = alpha[np.ix_(py[rows] % 256, px[cols] % 256)]
    return result


def build(region):
    bounds = {"west": -25, "south": 25, "east": 100, "north": 74} if region == "europe" else dem.CONFIG["regions"][region]["displayBounds"]
    left, top = world_point(bounds["west"], bounds["north"])
    right, bottom = world_point(bounds["east"], bounds["south"])
    # Global lattice and padded coastline make neighbouring chunks identical.
    x0, z0 = math.floor(left / STEP) * STEP - STEP, math.floor(top / STEP) * STEP - STEP
    xs = np.arange(x0, math.ceil(right / STEP)*STEP + 2*STEP, STEP)
    zs = np.arange(z0, math.ceil(bottom / STEP)*STEP + 2*STEP, STEP)
    alpha = land_mask(region, xs, zs)
    heights = np.full(alpha.shape, np.nan, np.float32)
    dem.dem_tile.cache_clear()
    dem.SOURCES.clear()
    for start in range(0, len(zs), 32):
        end = min(len(zs), start+32)
        active_cols = np.flatnonzero(np.any(alpha[max(0,start-3):min(len(zs),end+3)] > 32, axis=0))
        if active_cols.size:
            first, last = max(0, active_cols[0]-3), min(len(xs), active_cols[-1]+4)
            lat, lng = coordinates(region, xs[first:last], zs[start:end])
            heights[start:end, first:last] = dem.sample_dem(lat, lng)
        if start % 256 == 0:
            print(f"{region}: sampled rows {end}/{len(zs)}", flush=True)
    missing = ~np.isfinite(heights)
    if np.any(missing & (alpha > 32)):
        raise ValueError(f"{region}: local DEM missing at {np.sum(missing & (alpha>32))} land nodes")
    nearest = distance_transform_edt(missing, return_distances=False, return_indices=True)
    heights = heights[tuple(nearest)]
    # Only sub-cell antialiasing. Do not repeat the previous broad smoothing or
    # compress relief into a narrow pre-baked luminance range.
    heights = gaussian_filter(np.maximum(heights, 0), 0.65, truncate=3)
    distance = distance_transform_edt(alpha > 32) * STEP
    coast = np.clip(distance / 0.75, 0, 1)
    coast = coast*coast*(3-2*coast)
    heights *= coast
    heights[alpha <= 32] = 0
    encoded = np.rint(np.clip(heights, 0, 9000)).astype("<u2")
    payload = encoded.tobytes() + alpha.tobytes()
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{region}.bin"
    temp = target.with_suffix(".bin.tmp")
    temp.write_bytes(payload)
    temp.replace(target)
    metadata = {
        "schemaVersion": 1, "revision": REVISION, "region": region,
        "width": len(xs), "height": len(zs), "origin": [x0,z0], "step": STEP,
        "layout": "uint16-le elevation metres, then uint8 coastline alpha",
        "file": f"assets/map-relief/relief-mesh/{region}.bin",
        "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
        "landNodes": int(np.sum(alpha > 32)), "maxElevation": int(encoded.max()),
        "source": "existing local Mapzen Terrarium cache; no downloads",
        "dem": dem.digest(list(dem.SOURCES)),
    }
    path = OUT / f"{region}.json"
    path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(f"{region}: {len(xs)} x {len(zs)}, {metadata['landNodes']} land nodes, {len(payload)/1048576:.2f} MiB", flush=True)


def verify(region):
    meta = json.loads((OUT / f"{region}.json").read_text(encoding="utf-8"))
    data = (ROOT / meta["file"]).read_bytes()
    assert len(data) == meta["bytes"] == meta["width"] * meta["height"] * 3
    assert hashlib.sha256(data).hexdigest() == meta["sha256"]
    print(f"{region}: elevation grid verified", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", choices=list(dem.REGIONS), action="append")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    for region in args.region or dem.REGIONS:
        if not args.verify_only:
            build(region)
        verify(region)
