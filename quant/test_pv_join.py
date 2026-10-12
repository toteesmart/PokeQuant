"""Unit tests for quant.pv_join — the second-source agreement layer.

These pin the quarantine semantics: a PV series tracking a different
level (the JP-counted-as-EN miss) or a decorrelated curve must be
flagged, never blended.

Run: py -m unittest quant.test_pv_join   (from PokeQuant-main/)
"""
import unittest
from datetime import date, timedelta

from quant import pv_join


def series(prices, start='2025-01-01'):
    """{iso_date: price} for the shared overlap."""
    base = date.fromisoformat(start)
    return {
        (base + timedelta(days=i)).isoformat(): p
        for i, p in enumerate(prices)
    }


def same_shape(n=90, seed_amp=1.0):
    """A wavy-but-identical daily curve — level 10±2."""
    out = []
    for i in range(n):
        out.append(10.0 + seed_amp * (1.0 if i % 7 < 4 else -1.0)
                   + i * 0.02)
    return out


class ScorePairTests(unittest.TestCase):
    def test_identical_series_ok(self):
        ours = series(same_shape())
        pv = dict(ours)
        level, overlap, corr, agreement, flag = pv_join.score_pair(ours, pv)
        self.assertEqual(flag, 'ok')
        self.assertAlmostEqual(level, 1.0, places=2)
        self.assertGreaterEqual(agreement, pv_join.AGREEMENT_PASS)

    def test_level_mismatch_flagged(self):
        # PV tracks a 3x level — the EN-priced-as-JP signature.
        ours = series(same_shape())
        pv = series([p * 3.0 for p in same_shape()])
        level, _, _, agreement, flag = pv_join.score_pair(ours, pv)
        self.assertEqual(flag, 'level_mismatch')
        self.assertLess(agreement, pv_join.AGREEMENT_PASS)

    def test_shape_divergent_flagged(self):
        # Same level band, but PV moves opposite — decorrelated curve.
        ours = series(same_shape())
        pv = series(list(reversed(same_shape())))
        level, _, corr, agreement, flag = pv_join.score_pair(ours, pv)
        self.assertEqual(flag, 'shape_divergent')
        self.assertLess(corr, pv_join.CORR_MIN)
        self.assertLess(agreement, pv_join.AGREEMENT_PASS)

    def test_thin_overlap(self):
        ours = series(same_shape(30))
        pv = series(same_shape(30))
        _, overlap, _, agreement, flag = pv_join.score_pair(ours, pv)
        self.assertEqual(flag, 'thin_overlap')
        self.assertIsNone(agreement)
        self.assertLess(overlap, pv_join.OVERLAP_MIN)

    def test_mild_level_off_still_ok(self):
        # 20% level offset inside the band — same printing, noisier feed.
        ours = series(same_shape())
        pv = series([p * 1.2 for p in same_shape()])
        _, _, _, agreement, flag = pv_join.score_pair(ours, pv)
        self.assertEqual(flag, 'ok')
        self.assertGreaterEqual(agreement, pv_join.AGREEMENT_PASS)


if __name__ == '__main__':
    unittest.main()
