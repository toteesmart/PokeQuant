"""Pins for quant.ship (item 317) and the nightly delta's existing_ids staging.

Run: py -m unittest quant.test_ship   (from the repo root)
"""
import contextlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from quant import deep, ship

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SNAPSHOT_SQL = '''CREATE TABLE signals_snapshot (
    product_id INTEGER, sub_type TEXT, price REAL, price_date TEXT,
    first_date TEXT,
    n_events INTEGER, coverage REAL, span_days INTEGER,
    z90 REAL, pctile_1y REAL,
    ret_7d REAL, ret_30d REAL, ret_90d REAL, ret_180d REAL,
    ret_365d REAL, ret_all REAL, cagr REAL, trend TEXT,
    drawdown REAL, days_since_high INTEGER,
    low_90d REAL, high_90d REAL, slope_30d REAL, ma20_60 REAL,
    daily_sigma REAL, vol_regime TEXT,
    liq_flag TEXT, days_since_change INTEGER,
    stance TEXT, confidence TEXT, action TEXT, excess_30d REAL,
    computed_at TEXT)'''

# card_deep as written before the shape columns landed (16 columns).
STALE_SCHEMA = '''
CREATE TABLE card_deep (
    product_id INTEGER NOT NULL, sub_type TEXT NOT NULL,
    shelf_price REAL, shelf_tests INTEGER,
    bounce_pct_med REAL, bounce_days_med REAL,
    cycle_days REAL, cycle_amp REAL, target_price REAL,
    archetype TEXT, set_pctile_30d REAL,
    analog_n INTEGER, analog_bounce_n INTEGER,
    pv_flag TEXT, source_agreement REAL, computed_at TEXT NOT NULL,
    PRIMARY KEY (product_id, sub_type));
CREATE TABLE pattern_stats (
    pattern TEXT NOT NULL, window_days INTEGER NOT NULL,
    n_cases INTEGER, hold_rate REAL,
    bounce_med_pct REAL, bounce_med_days REAL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (pattern, window_days));
CREATE TABLE market_stats (
    key TEXT PRIMARY KEY, value REAL, computed_at TEXT NOT NULL);
'''

CODE_ID = 999


def build_source(path, stale_deep=False):
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE cards (product_id INTEGER PRIMARY KEY, '
                'card_name TEXT, card_number TEXT, set_name TEXT)')
    con.execute("INSERT INTO cards VALUES (1,'A','1','S'),(2,'B','2','S'),"
                f"({CODE_ID},'Code Card - X','3','S')")
    con.execute('CREATE TABLE price_history (product_id INTEGER, '
                'sub_type TEXT, date TEXT, market_price REAL)')
    for pid in (1, 2, CODE_ID):
        for d, p in (('2026-10-01', 5.0), ('2026-10-20', 6.5)):
            con.execute('INSERT INTO price_history VALUES (?,?,?,?)',
                        (pid, 'Normal', d, p))
    con.execute(SNAPSHOT_SQL)
    for pid in (1, 2, CODE_ID):
        con.execute(
            f'INSERT INTO signals_snapshot VALUES ({",".join("?" * 33)})',
            (pid, 'Normal', 6.5, '2026-10-20', '2026-10-01', 2, 0.5, 19,
             0.3, 55.0, 1.0, 12.0, 8.0, 7.0, 6.0, 5.0, 9.0, 'appreciating',
             -4.0, 10, 5.0, 7.0, 0.1, 0.2, 0.02, 'calm', 'ok', 3,
             'neutral', 'high', 'hold', 1.5, '2026-10-20'))
    con.executescript(STALE_SCHEMA if stale_deep else deep.SCHEMA)
    n_cols = 16 if stale_deep else 18
    for pid in (1, 2, CODE_ID):
        vals = [pid, 'Normal', 6.0, 3, 10.0, 12.0, 30.0, 4.0, 7.0, 'range',
                44.0, 20, 15, 'agree', 0.9, '2026-10-20', 1, 0][:n_cols]
        con.execute(f'INSERT INTO card_deep VALUES ({",".join("?" * n_cols)})',
                    vals)
    con.execute("INSERT INTO pattern_stats VALUES "
                "('double_bottom', 30, 40, 0.6, 8.0, 14.0, '2026-10-20')")
    con.execute("INSERT INTO market_stats VALUES "
                "('breadth', 0.55, '2026-10-20')")
    con.commit()
    con.close()


def frozen_positional(src_path, target_path):
    """The pre-317 positional copy for the three deep tables (frozen)."""
    src = sqlite3.connect(src_path)
    w = sqlite3.connect(target_path)
    w.execute('''CREATE TABLE card_deep (
        product_id INTEGER, sub_type TEXT,
        shelf_price REAL, shelf_tests INTEGER,
        bounce_pct_med REAL, bounce_days_med REAL,
        cycle_days REAL, cycle_amp REAL, target_price REAL,
        archetype TEXT, set_pctile REAL,
        analog_n INTEGER, analog_bounce_n INTEGER,
        pv_flag TEXT, pv_agreement REAL, computed_at TEXT,
        failed_bounce INTEGER, higher_lows INTEGER,
        PRIMARY KEY (product_id, sub_type))''')
    w.execute('''CREATE TABLE pattern_stats (
        pattern TEXT, window_days INTEGER, n_cases INTEGER,
        hold_rate REAL, bounce_med_pct REAL, bounce_med_days REAL,
        computed_at TEXT)''')
    w.execute('CREATE TABLE market_stats (stat TEXT, value REAL, '
              'computed_at TEXT)')
    w.executemany(
        f'INSERT INTO card_deep VALUES ({",".join("?" * 18)})',
        (tuple(r) + (None,) * (18 - len(r))
         for r in src.execute('SELECT * FROM card_deep')
         if r[0] != CODE_ID))
    w.executemany(f'INSERT INTO pattern_stats VALUES ({",".join("?" * 7)})',
                  src.execute('SELECT * FROM pattern_stats'))
    w.executemany(f'INSERT INTO market_stats VALUES ({",".join("?" * 3)})',
                  src.execute('SELECT * FROM market_stats'))
    w.commit()
    out = {t: sorted(w.execute(f'SELECT * FROM {t}').fetchall())
           for t in ('card_deep', 'pattern_stats', 'market_stats')}
    w.close()
    src.close()
    return out


class ShipDeepTablesTests(unittest.TestCase):
    def check(self, stale):
        with tempfile.TemporaryDirectory() as d:
            src, tgt, ref = (os.path.join(d, n) for n in
                             ('src.db', 'tgt.db', 'ref.db'))
            build_source(src, stale_deep=stale)
            with contextlib.redirect_stdout(io.StringIO()):
                ship.stamp(tgt, src, vacuum=False)
            expected = frozen_positional(src, ref)
            con = sqlite3.connect(tgt)
            for t, rows in expected.items():
                self.assertEqual(
                    sorted(con.execute(f'SELECT * FROM {t}').fetchall()),
                    rows, t)
            n_sig = con.execute('SELECT COUNT(*) FROM card_signals').fetchone()
            self.assertEqual(n_sig[0], 2)
            shape = con.execute(
                'SELECT failed_bounce, higher_lows FROM card_deep '
                'WHERE product_id = 1').fetchone()
            con.close()
            self.assertEqual(shape, (None, None) if stale else (1, 0))

    def test_current_shape_card_deep(self):
        self.check(stale=False)

    def test_stale_16_column_card_deep(self):
        self.check(stale=True)


class StampMissingSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = os.path.join(self.tmp.name, 'src.db')
        con = sqlite3.connect(self.src)
        con.execute('CREATE TABLE cards (product_id INTEGER)')
        con.commit()
        con.close()

    def tearDown(self):
        self.tmp.cleanup()

    def test_stamp_raises_runtime_error(self):
        with self.assertRaises(RuntimeError) as cm:
            ship.stamp(os.path.join(self.tmp.name, 't.db'), self.src)
        self.assertIn('signals_snapshot missing', str(cm.exception))

    def test_cli_exits_1_with_message(self):
        r = subprocess.run(
            [sys.executable, '-m', 'quant.ship', '--db',
             os.path.join(self.tmp.name, 't.db'), '--src', self.src],
            cwd=ROOT, capture_output=True, text=True,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        self.assertEqual(r.returncode, 1)
        self.assertIn('signals_snapshot missing in source', r.stderr)


class RunPipelineNewCardsTests(unittest.TestCase):
    def test_new_cards_lists_only_the_scraped_card(self):
        sys.path.insert(0, ROOT)
        import daily_delta_pipeline as ddp
        prev = os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            os.chdir(d)
            try:
                con = sqlite3.connect(ddp.DB_NAME)
                con.execute('CREATE TABLE cards (product_id INTEGER PRIMARY '
                            'KEY, card_name TEXT, card_number TEXT, '
                            'set_name TEXT, rarity TEXT)')
                con.execute("INSERT INTO cards VALUES (1,'Old','1','S','C')")
                con.commit()
                con.close()

                def fake_scrape():
                    c = sqlite3.connect(ddp.DB_NAME)
                    c.execute("INSERT INTO cards VALUES "
                              "(2,'New','2','S','R')")
                    c.commit()
                    c.close()

                with mock.patch.object(ddp.tcg_scraper, 'main', fake_scrape), \
                        mock.patch.object(ddp, 'stamp_quant_signals',
                                          lambda _d: None), \
                        mock.patch.object(ddp, 'R2_ACCOUNT_ID', ''), \
                        mock.patch.object(ddp, 'R2_ACCESS_KEY_ID', ''), \
                        mock.patch.object(ddp, 'R2_SECRET_ACCESS_KEY', ''), \
                        contextlib.redirect_stdout(io.StringIO()):
                    ddp.run_pipeline()
                with open(ddp.DELTA_OUTPUT, encoding='utf-8') as f:
                    delta = json.load(f)
            finally:
                os.chdir(prev)
        self.assertEqual([c['product_id'] for c in delta['new_cards']], [2])


if __name__ == '__main__':
    unittest.main()
