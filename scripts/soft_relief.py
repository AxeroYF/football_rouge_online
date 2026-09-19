"""Cartographic terrain generalization in elevation space, before hillshading.

Arrays include a halo supplied by the caller. All filters use the same working
pixel scale across tile boundaries; slope uses the actual geographic distance.
The original DEM is never modified (snow continues to use its original data).
"""
import numpy as np
from scipy.ndimage import gaussian_filter

WORK_ZOOM = 8
HALO = 80  # Covers chained filters, including local-relief and mask smoothing.
REVISION = "20260904-soft-relief-v1"


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def geographic_spacing(latitude, longitude):
    """Metres per working pixel, including the relocated South America axes."""
    lat_y, lat_x = np.gradient(np.radians(latitude))
    lng_y, lng_x = np.gradient(np.radians(longitude))
    cosine = np.cos(np.radians(latitude))
    radius = 6371008.8
    dx = radius * np.hypot(lat_x, lng_x * cosine)
    dy = radius * np.hypot(lat_y, lng_y * cosine)
    return np.maximum(dx, 1.0), np.maximum(dy, 1.0)


def render_relief(dem, metres_x, metres_y):
    """Return unsharpened RGB and diagnostics; lowland noise cannot become ridges."""
    height = np.maximum(np.asarray(dem, dtype=np.float32), 0.0)
    fine = gaussian_filter(height, 2.0, truncate=3.0)
    broad = gaussian_filter(height, 7.0, truncate=3.0)
    mean = gaussian_filter(height, 12.0, truncate=3.0)
    variance = gaussian_filter(height * height, 12.0, truncate=3.0) - mean * mean
    local_relief = 2.0 * np.sqrt(np.maximum(variance, 0.0))
    by, bx = np.gradient(broad)
    broad_slope = np.hypot(bx / metres_x, by / metres_y)
    mountain = smoothstep(140.0, 600.0, local_relief)
    mountain *= 0.45 + 0.55 * smoothstep(0.015, 0.08, broad_slope)
    mountain = gaussian_filter(mountain, 3.0, truncate=3.0)
    hills = smoothstep(35.0, 200.0, local_relief)
    generalized = broad + (fine - broad) * (0.08 + 0.32 * mountain)

    gy, gx = np.gradient(generalized)
    gx = gx / metres_x * 3.8
    gy = gy / metres_y * 3.8
    normal_length = np.sqrt(1.0 + gx * gx + gy * gy)
    # Northwest key light with a gentle northern fill; no ridge-contrast pass.
    light = np.zeros_like(height)
    flat_light = 0.0
    for azimuth, altitude, weight in ((315.0, 55.0, 0.78), (15.0, 65.0, 0.22)):
        az, alt = np.radians(azimuth), np.radians(altitude)
        lx, ly, lz = np.sin(az) * np.cos(alt), -np.cos(az) * np.cos(alt), np.sin(alt)
        light += weight * (-gx * lx - gy * ly + lz) / normal_length
        flat_light += weight * lz
    activity = 0.04 + 0.20 * hills + 0.76 * mountain
    shade = np.clip(1.0 + (light / flat_light - 1.0) * activity * 0.72, 0.80, 1.16)

    elevation = np.clip(broad / 4200.0, 0.0, 1.0) ** 0.8
    low = np.array([22.0, 48.0, 40.0], dtype=np.float32)
    mid = np.array([40.0, 62.0, 48.0], dtype=np.float32)
    high = np.array([95.0, 100.0, 80.0], dtype=np.float32)
    low_mid = smoothstep(0.0, 0.55, elevation)[..., None]
    mid_high = smoothstep(0.55, 1.0, elevation)[..., None]
    color = low * (1.0 - low_mid) + mid * low_mid
    color = color * (1.0 - mid_high) + high * mid_high
    color *= shade[..., None]
    return np.clip(color, 0.0, 255.0), {
        "mountain": mountain, "shade": shade, "generalized": generalized,
    }
