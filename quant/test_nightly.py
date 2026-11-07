"""Pins for quant.nightly (item 320): the shared price_history pass lands
the same tables as the standalone snapshot -> deep -> ship CLIs, and deep
stays non-fatal inside it.

Run: py -m unittest quant.test_nightly   (from the repo root)
"""
import contextlib
import io
import math
import os
import random
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest import mock

from quant import deep, nightly, snapshot

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CODE_ID = 999
ART_TABLES = ('signals_snapshot', 'card_deep', 'pattern_stats', 'market_stats')
SHIP_TABLES = ('card_signals', 'price_series', 'card_deep', 'pattern_stats',
               'market_stats')


def build_source(path):
    """Series shapes that matter to the filters: swings long enough for
    the pattern study, zero prices (snapshot sees them, deep and
    ship don't), a series under deep's 4-event floor, a single-event
    series (ship packs none), and a code card."""
    rng = random.Random(320)
    today = date.today()
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE cards (product_id INTEGER PRIMARY KEY, '
                'card_name TEXT, card_number TEXT, set_name TEXT, rarity TEXT)')
    con.execute('CREATE TABLE price_history (product_id INTEGER, '
                'sub_type TEXT, date TEXT, market_price REAL, '
                'PRIMARY KEY (product_id, sub_type, date))')
    rows = []
    for pid in range(1, 41):
        con.execute('INSERT INTO cards VALUES (?,?,?,?,?)',
                    (pid, f'Card {pid}', str(pid), 'Set A' if pid % 2 else 'Set B',
                     'Rare'))
        for sub in ('Normal', 'Holofoil'):
            base = 2 + pid % 7
            for k in range(0, 700, 3 + pid % 4):
                d = (today - timedelta(days=700 - k)).isoformat()
                p = base * (1 + 0.5 * math.sin(k / (20 + pid))) \
                    * (1 + 0.05 * rng.random())
                rows.append((pid, sub, d, round(p, 2)))
    con.execute('INSERT INTO cards VALUES (?,?,?,?,?)',
                (CODE_ID, 'Code Card - X', '0', 'Set A', None))
    for k in range(0, 300, 5):
        rows.append((CODE_ID, 'Normal',
                     (today - timedelta(days=300 - k)).isoformat(), 1.0 + k))
    # zero / NULL rows inside live series, a short series, a 1-event series
    rows += [(1, 'Normal', (today - timedelta(days=1)).isoformat(), 0.0),
             (3, 'Holofoil', today.isoformat(), 0.0),
             (50, 'Normal', (today - timedelta(days=9)).isoformat(), 3.0),
             (50, 'Normal', (today - timedelta(days=5)).isoformat(), 3.5),
             (50, 'Normal', today.isoformat(), 0.0),
             (51, 'Normal', today.isoformat(), 4.0),
             (52, 'Normal', today.isoformat(), 0.0)]
    con.executemany('INSERT OR IGNORE INTO price_history VALUES (?,?,?,?)',
                    rows)
    con.commit()
    con.close()


def build_target(path):
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE price_series (product_id INTEGER, '
                'sub_type TEXT, series TEXT, computed_at TEXT)')
    con.execute("INSERT INTO price_series VALUES (7,'Normal','[]','old')")
    con.commit()
    con.close()


def dump(path, table):
    con = sqlite3.connect(path)
    try:
        return sorted(con.execute(f'SELECT * FROM {table}').fetchall(),
                      key=repr)
    finally:
        con.close()


def run_cli(*args):
    r = subprocess.run([sys.executable, '-m', *args], cwd=ROOT,
                       capture_output=True, text=True,
                       env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    if r.returncode:
        raise AssertionError(r.stderr)


class NightlyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.art = os.path.join(self.tmp.name, 'art.db')
        self.tgt = os.path.join(self.tmp.name, 'tgt.db')
        build_source(self.art)
        build_target(self.tgt)

    def run_nightly(self, **kw):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(io.StringIO()):
            nightly.run(self.art, self.tgt,
                        out=os.path.join(self.tmp.name, 'n.csv'), **kw)
        return out.getvalue()

    def test_matches_the_standalone_clis(self):
        old_art = os.path.join(self.tmp.name, 'old_art.db')
        old_tgt = os.path.join(self.tmp.name, 'old_tgt.db')
        shutil.copy(self.art, old_art)
        shutil.copy(self.tgt, old_tgt)
        run_cli('quant.snapshot', '--db', old_art,
                '--out', os.path.join(self.tmp.name, 'o.csv'))
        run_cli('quant.deep', '--db', old_art, '--master', old_art,
                '--per-card', '--pattern')
        run_cli('quant.ship', '--db', old_tgt, '--src', old_art,
                '--no-vacuum')
        self.run_nightly(pattern=True)
        for t in ART_TABLES:
            self.assertEqual(dump(old_art, t), dump(self.art, t), t)
        for t in SHIP_TABLES:
            self.assertEqual(dump(old_tgt, t), dump(self.tgt, t), t)
        with open(os.path.join(self.tmp.name, 'o.csv'), encoding='utf-8') as a, \
                open(os.path.join(self.tmp.name, 'n.csv'), encoding='utf-8') as b:
            self.assertEqual(a.read(), b.read())
        # the filters the fixture exercises actually bit
        ids = {r[0] for r in dump(self.tgt, 'price_series')}
        self.assertNotIn(CODE_ID, ids)
        self.assertNotIn(51, ids)
        self.assertNotIn(52, ids)
        snap_ids = {(r[0], r[1]) for r in dump(self.art, 'signals_snapshot')}
        self.assertIn((52, 'Normal'), snap_ids)
        deep_ids = {(r[0], r[1]) for r in dump(self.art, 'card_deep')}
        self.assertNotIn((50, 'Normal'), deep_ids)
        self.assertIn((1, 'Normal'), deep_ids)
        self.assertGreater(len(dump(self.art, 'pattern_stats')), 0)

    def seed_previous_deep(self):
        self.run_nightly(pattern=True)
        con = sqlite3.connect(self.art)
        con.execute("UPDATE card_deep SET computed_at = 'prev'")
        con.execute("UPDATE pattern_stats SET computed_at = 'prev'")
        con.commit()
        con.close()

    def test_per_card_failure_is_non_fatal_and_skips_pattern(self):
        self.seed_previous_deep()
        with mock.patch.object(deep.PerCardPass, 'add',
                               side_effect=ValueError('boom')):
            out = self.run_nightly(pattern=True)
        self.assertIn('deep --per-card failed (non-fatal)', out)
        self.assertEqual({r[15] for r in dump(self.art, 'card_deep')},
                         {'prev'})
        self.assertEqual({r[6] for r in dump(self.art, 'pattern_stats')},
                         {'prev'})
        # ship still landed, copying SRC's previous deep stamps
        self.assertGreater(len(dump(self.tgt, 'card_signals')), 0)
        self.assertGreater(len(dump(self.tgt, 'price_series')), 1)
        self.assertEqual({r[15] for r in dump(self.tgt, 'card_deep')},
                         {'prev'})

    def test_pattern_failure_keeps_card_deep(self):
        self.seed_previous_deep()
        with mock.patch.object(deep.PatternPass, 'write',
                               side_effect=ValueError('boom')):
            out = self.run_nightly(pattern=True)
        self.assertIn('deep --pattern failed (non-fatal)', out)
        self.assertEqual({r[15] for r in dump(self.art, 'card_deep')},
                         {date.today().isoformat()})
        self.assertEqual({r[6] for r in dump(self.art, 'pattern_stats')},
                         {'prev'})

    def test_snapshot_failure_raises_and_keeps_the_target(self):
        with mock.patch.object(snapshot.SnapshotPass, 'write',
                               side_effect=ValueError('boom')):
            with self.assertRaises(ValueError):
                self.run_nightly()
        self.assertEqual(dump(self.tgt, 'price_series'),
                         [(7, 'Normal', '[]', 'old')])
        con = sqlite3.connect(self.tgt)
        names = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        con.close()
        self.assertNotIn('card_signals', names)


if __name__ == '__main__':
    unittest.main()
