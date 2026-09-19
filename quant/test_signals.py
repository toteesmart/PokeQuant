"""Unit tests for quant.signals — synthetic series with known answers.

Run: py -m unittest quant.test_signals   (from PokeQuant-main/)
"""
import unittest
from datetime import date, timedelta

from quant import signals


def series_from(daily_prices, start='2026-01-01', step=1):
    """[(date, price)] — every `step` days, mimicking sparse event rows."""
    base = date.fromisoformat(start)
    return [
        ((base + timedelta(days=i * step)).isoformat(), p)
        for i, p in enumerate(daily_prices)
    ]


class DailyGridTests(unittest.TestCase):
    def test_sparse_fill_and_gap_meta(self):
        s = [('2026-01-01', 10.0), ('2026-01-11', 12.0)]
        grid, meta = signals.daily_grid(s)
        self.assertEqual(len(grid), 11)
        self.assertEqual(grid[0], ('2026-01-01', 10.0))
        self.assertEqual(grid[5], ('2026-01-06', 10.0))  # filled forward
        self.assertEqual(grid[-1], ('2026-01-11', 12.0))
        self.assertEqual(meta['max_gap_days'], 10)
        self.assertEqual(meta['n_events'], 2)
        self.assertAlmostEqual(meta['coverage'], 2 / 11)

    def test_empty(self):
        grid, meta = signals.daily_grid([])
        self.assertEqual(grid, [])
        self.assertEqual(meta['n_events'], 0)


class ZScoreTests(unittest.TestCase):
    def test_flat_series_zero_z(self):
        s = series_from([10.0] * 40)
        out = signals.zscore(s, window_days=90)
        self.assertEqual(out['z'], 0.0)

    def test_spike_at_end_positive_z(self):
        s = series_from([10.0] * 39 + [20.0])
        out = signals.zscore(s, window_days=90)
        self.assertGreater(out['z'], 3.0)

    def test_thin_series(self):
        s = series_from([10.0, 11.0])
        self.assertIsNone(signals.zscore(s)['z'])


class PercentileTests(unittest.TestCase):
    def test_monotonic_rise_top_pctile(self):
        s = series_from([float(i) for i in range(1, 61)])
        out = signals.percentile_rank(s, window_days=365)
        self.assertAlmostEqual(out['pctile'], 100.0, places=1)

    def test_monotonic_fall_bottom_pctile(self):
        s = series_from([float(100 - i) for i in range(60)])
        out = signals.percentile_rank(s, window_days=365)
        self.assertLessEqual(out['pctile'], 2.0)


class MomentumTests(unittest.TestCase):
    def test_rising(self):
        s = series_from([10.0 + i * 0.1 for i in range(100)])
        m = signals.momentum(s)
        self.assertGreater(m['ret_7d'], 0)
        self.assertGreater(m['ret_30d'], 0)
        self.assertEqual(m['days_since_high'], 0)
        self.assertAlmostEqual(m['drawdown_from_high'], 0.0, places=5)
        self.assertGreater(m['ma20_minus_ma60'], 0)
        self.assertGreater(m['slope_30d'], 0)

    def test_drawdown(self):
        s = series_from([10.0] * 50 + [5.0] * 10)
        m = signals.momentum(s)
        self.assertAlmostEqual(m['drawdown_from_high'], -50.0, places=1)
        # The drop is >7d old so ret_7d is flat; ret_30d still straddles it.
        self.assertLess(m['ret_30d'], 0)

    def test_thin(self):
        m = signals.momentum(series_from([10.0, 11.0]))
        self.assertIsNone(m['ret_7d'])


class VolTests(unittest.TestCase):
    def test_stable_low_regime(self):
        # Perfectly flat -> sigma 0 -> 'low' vs nonzero long run won't trigger;
        # mixed: first half volatile, second flat -> recent sigma < long run.
        s = series_from(
            [10.0 * (1.05 if i % 2 else 1.0) for i in range(60)]
            + [10.5] * 60
        )
        v = signals.realized_vol(s, window_days=60)
        self.assertEqual(v['regime'], 'low')

    def test_spike_regime_high(self):
        s = series_from([10.0] * 100 + [9.0, 11.5, 8.5, 12.0, 9.0])
        v = signals.realized_vol(s, window_days=10)
        self.assertEqual(v['regime'], 'high')


class LiquidityTests(unittest.TestCase):
    def test_stale(self):
        old = (date.today() - timedelta(days=90)).isoformat()
        s = [(old, 10.0)]
        liq = signals.liquidity(s)
        self.assertEqual(liq['flag'], 'stale')
        self.assertGreaterEqual(liq['days_since_change'], 90)

    def test_active(self):
        s = series_from([10.0 + i for i in range(20)], start='2026-08-01')
        liq = signals.liquidity(s, as_of=date(2026, 8, 21))
        self.assertEqual(liq['flag'], 'active')
        self.assertEqual(liq['days_since_change'], 1)


class SetBetaTests(unittest.TestCase):
    def test_outperformance(self):
        # 91 points: step up at index 61 so grid[-31] is still the old price.
        card = series_from([10.0] * 61 + [12.0] * 30)  # +20% last 30d
        peers = {
            1: series_from([10.0] * 61 + [10.5] * 30),  # +5%
            2: series_from([20.0] * 61 + [21.0] * 30),  # +5%
            3: series_from([5.0] * 61 + [5.25] * 30),   # +5%
        }
        out = signals.set_beta(card, peers, days=30)
        self.assertAlmostEqual(out['set_median'], 5.0, places=1)
        self.assertAlmostEqual(out['excess_return'], 15.0, places=1)
        self.assertEqual(out['n_peers'], 3)


class ConfidenceTests(unittest.TestCase):
    def test_bands(self):
        self.assertEqual(signals.confidence(5, 0.05), 'low')
        self.assertEqual(signals.confidence(50, 0.4), 'medium')
        self.assertEqual(signals.confidence(200, 0.8), 'high')
        self.assertEqual(signals.confidence(200, 0.8, 'high'), 'medium')


if __name__ == '__main__':
    unittest.main()
