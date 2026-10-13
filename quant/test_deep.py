"""Unit tests for quant.deep — synthetic series with known answers.

The swing/despike/shelf math is a port of the app's seriesSignals.ts;
these tests pin the same expectations the mobile Jest fixtures pin on
the TypeScript side. Both engines agreeing on the same synthetic cases
IS the parity check.

Run: py -m unittest quant.test_deep   (from PokeQuant-main/)
"""
import unittest
from datetime import date, timedelta

from quant import deep


def series_from(prices, start='2024-01-01', step=7):
    """[(iso_date, price)] — sparse event rows like price_history."""
    base = date.fromisoformat(start)
    return [
        ((base + timedelta(days=i * step)).isoformat(), p)
        for i, p in enumerate(prices)
    ]


class DespikeTests(unittest.TestCase):
    def test_wick_removed(self):
        # 2.5x single-point wick that reverts next tick = data error.
        s = series_from([10, 10, 10, 25, 10, 10, 10])
        out = deep.despike(s)
        self.assertEqual(len(out), 6)
        self.assertNotIn(25, [p for _, p in out])

    def test_real_jump_kept(self):
        # A jump that holds is a repricing, not a wick — next point
        # stays elevated so nothing is dropped.
        s = series_from([10, 10, 10, 25, 26, 25, 26])
        out = deep.despike(s)
        self.assertEqual(len(out), 7)

    def test_crash_wick_removed(self):
        s = series_from([10, 10, 10, 3, 10, 10, 10])
        out = deep.despike(s)
        self.assertEqual(len(out), 6)


class SwingTests(unittest.TestCase):
    def test_flat_line_no_swings(self):
        s = series_from([10.0] * 30)
        self.assertEqual(deep.swings(s), [])

    def test_noise_under_threshold_ignored(self):
        # ±2% wobble never crosses the 8% threshold — no swing points.
        s = series_from([10.0 + (0.2 if i % 2 else -0.2) for i in range(30)])
        self.assertEqual(deep.swings(s), [])

    def test_alternating_noise_crossing_threshold_swing(self):
        # ±5% wobble DOES cross 8% trough-to-peak — real zigzag points.
        s = series_from([10.0 + (0.5 if i % 2 else -0.5) for i in range(10)])
        self.assertGreater(len(deep.swings(s)), 2)

    def test_clear_zigzag(self):
        # The zigzag emits the series start as its first point — a
        # 'trough' at 10 — then alternates peak/trough at each 8% turn.
        s = series_from(
            [10, 12, 15, 20, 18, 15, 12, 13, 15, 18, 20, 19, 17])
        sw = deep.swings(s)
        kinds = [k for k, _, _ in sw]
        self.assertEqual(kinds[:4], ['trough', 'peak', 'trough', 'peak'])
        self.assertAlmostEqual(sw[0][1], 10.0, places=1)
        self.assertAlmostEqual(sw[1][1], 20.0, places=1)
        self.assertAlmostEqual(sw[2][1], 12.0, places=1)


class ShelfTests(unittest.TestCase):
    def test_nearest_shelf_under_price(self):
        s = series_from(
            [10, 15, 8, 12, 6, 10, 14, 20, 16, 12.2])
        feats, _ = deep.deep_features(s)
        # last = 12.2; swing troughs at 8 and 6 — nearest under = ~8*?
        # whichever the zigzag produces, the shelf must be <= last*1.02.
        self.assertIsNotNone(feats['shelf_price'])
        self.assertLessEqual(feats['shelf_price'], 12.2 * 1.02)

    def test_no_shelf_above_all_lows(self):
        # A card at its all-time low has no shelf under it.
        s = series_from([10, 15, 20, 15, 10, 8, 6, 5])
        feats, _ = deep.deep_features(s)
        self.assertIsNone(feats['shelf_price'])

    def test_repeated_floor_tests_counted(self):
        # 5.0 floor touched 3x with 20%+ rallies between — bellibolt shape.
        s = series_from(
            [5.0, 6.5, 5.0, 6.4, 5.0, 6.2, 5.02],
            step=30)
        feats, _ = deep.deep_features(s)
        self.assertIsNotNone(feats['shelf_price'])
        self.assertAlmostEqual(feats['shelf_price'], 5.0, delta=0.5)
        self.assertGreaterEqual(feats['shelf_tests'], 2)
        self.assertGreaterEqual(feats['analog_n'], 2)

    def test_bounce_memory(self):
        # Each 5.0 touch ran to ~6.5 → median bounce ~+30%.
        s = series_from(
            [5.0, 6.5, 5.0, 6.4, 5.0, 6.3, 5.02],
            step=30)
        feats, _ = deep.deep_features(s)
        self.assertIsNotNone(feats['bounce_pct_med'])
        self.assertGreater(feats['bounce_pct_med'], 15)

    def test_target_capped_by_bounce_memory(self):
        # Shelf $10 tested twice, bounces ran ~+25-30% — the eject
        # target stays near $13, not the far-off defended $18 peak.
        s = series_from(
            [10, 13, 10, 14, 18, 12, 10, 12.5, 10.2],
            step=40)
        feats, _ = deep.deep_features(s)
        self.assertIsNotNone(feats['shelf_price'])
        self.assertIsNotNone(feats['bounce_pct_med'])
        if feats['target_price'] is not None:
            self.assertLess(feats['target_price'], 15)

    def test_cycle_rhythm(self):
        # Regular 5-mo spacing → cycle_days near the step.
        s = series_from(
            [5.0, 6.5, 5.0, 6.4, 5.0, 6.3, 5.0, 6.2],
            step=30)
        feats, _ = deep.deep_features(s)
        self.assertIsNotNone(feats['cycle_days'])
        self.assertGreater(feats['cycle_days'], 30)
        self.assertLess(feats['cycle_days'], 120)


class ArchetypeTests(unittest.TestCase):
    def test_compounder(self):
        self.assertEqual(
            deep.archetype(50, -10, 5, 20, 700, 200, 0, None, None, 0.02),
            'compounder')

    def test_bleeder(self):
        self.assertEqual(
            deep.archetype(-40, -70, 200, -25, 700, 200, 0, None, None,
                           0.02),
            'bleeder')

    def test_young(self):
        self.assertEqual(
            deep.archetype(None, None, None, None, 60, 8, 0, None, None,
                           None),
            'young')

    def test_one_spike(self):
        self.assertEqual(
            deep.archetype(-10, -75, 400, 5, 800, 300, 0, None, None,
                           0.02),
            'one_spike')

    def test_flatline(self):
        self.assertEqual(
            deep.archetype(2, -5, 30, 1, 800, 300, 0, None, None, 0.005),
            'flatline')

    def test_boom_bust(self):
        self.assertEqual(
            deep.archetype(5, -45, 100, 10, 800, 300, 3, 150, 60, 0.03),
            'boom_bust')


class PriceAtTests(unittest.TestCase):
    def test_exact_and_interpolated(self):
        s = series_from([10, 11, 12], step=10)
        dates = [d for d, _ in s]
        self.assertEqual(deep.price_at(dates, s, '2024-01-01'), 10)
        # 01-15 is past the 01-11 event -> last price at-or-before = 11
        self.assertEqual(deep.price_at(dates, s, '2024-01-15'), 11)

    def test_before_first_and_after_last(self):
        s = series_from([10, 11, 12], step=10)
        dates = [d for d, _ in s]
        self.assertIsNone(deep.price_at(dates, s, '2023-12-01'))
        self.assertEqual(deep.price_at(dates, s, '2025-01-01'), 12)


if __name__ == '__main__':
    unittest.main()
