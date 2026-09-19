"""Numerical contracts for gameplay-oriented relief, independent of art approval."""
import importlib.util
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from soft_relief import HALO, geographic_spacing, render_relief

spec = importlib.util.spec_from_file_location("builder", Path(__file__).resolve().parents[1] / "scripts/build-soft-relief.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ReliefTests(unittest.TestCase):
    def test_lowland_microrelief_does_not_look_mountainous(self):
        y, x = np.mgrid[:256, :256]
        dem = 120.0 + 25.0 * np.sin(x * 1.7) * np.cos(y * 1.1)
        color, diagnostic = render_relief(dem, 400.0, 400.0)
        core = np.s_[HALO:-HALO, HALO:-HALO]
        self.assertLess(float(np.std(color[core], axis=(0, 1)).max()), 0.15)
        self.assertLess(float(diagnostic["mountain"][core].max()), 0.01)

    def test_high_plateau_is_not_a_mountain_just_because_of_altitude(self):
        _, diagnostic = render_relief(np.full((256, 256), 3200.0), 400.0, 400.0)
        np.testing.assert_allclose(diagnostic["shade"], 1.0, atol=1e-6)
        np.testing.assert_allclose(diagnostic["mountain"], 0.0, atol=1e-6)

    def test_major_mountain_retains_shape_and_soft_light(self):
        y, x = np.mgrid[:384, :384]
        mountain = 2600.0 * np.exp(-((x - 192.0 - 12.0*np.sin(y/30.0))/25.0)**2)
        _, diagnostic = render_relief(mountain, 300.0, 300.0)
        self.assertGreater(float(diagnostic["generalized"].max()), 2200.0)
        self.assertGreater(float(diagnostic["mountain"].max()), 0.75)
        self.assertGreater(float(np.ptp(diagnostic["shade"])), 0.08)
        self.assertGreaterEqual(float(diagnostic["shade"].min()), 0.80 - 1e-6)

    def test_halo_makes_separate_tiles_match_a_continuous_surface(self):
        y, x = np.mgrid[:400, :700]
        dem = 1200 + 750*np.sin(x/30.0)*np.cos(y/55.0) + 30*np.sin(x*0.7)
        full, _ = render_relief(dem, 350.0, 350.0)
        left, _ = render_relief(dem[:, :350+HALO], 350.0, 350.0)
        right, _ = render_relief(dem[:, 350-HALO:], 350.0, 350.0)
        np.testing.assert_allclose(left[100:300, 330:350], full[100:300, 330:350], atol=0.002)
        np.testing.assert_allclose(right[100:300, HALO:HALO+20], full[100:300, 350:370], atol=0.002)

    def test_source_grid_matches_across_tiles_in_all_regions(self):
        for region, x, y in [("europe", 64, 44), ("south-america", 70, 62), ("svalbard", 70, 18)]:
            lat, lng = builder.source_grid(region, x, y)
            next_lat, next_lng = builder.source_grid(region, x+1, y)
            np.testing.assert_allclose(lat[:, -2*HALO:], next_lat[:, :2*HALO], atol=1e-10)
            np.testing.assert_allclose(lng[:, -2*HALO:], next_lng[:, :2*HALO], atol=1e-10)
            dx, dy = geographic_spacing(lat, lng)
            self.assertTrue(np.isfinite(dx).all() and np.isfinite(dy).all())
            self.assertGreater(float(dx.min()), 1.0)
            self.assertGreater(float(dy.min()), 1.0)

    def test_south_america_samples_real_latitude_once(self):
        lat, lng = builder.source_grid("south-america", 71, 61)
        self.assertTrue(np.allclose(lat[:, 0], lat[0, 0]))
        self.assertTrue(np.allclose(lng[0, :], lng[0, 0]))
        # Its display axis swap puts source latitude along x, longitude along y.
        self.assertGreater(lat[0, -1], lat[0, 0])
        self.assertLess(lng[-1, 0], lng[0, 0])


if __name__ == "__main__":
    unittest.main()
