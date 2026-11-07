"""Replay cutoff: the artifact's MAX(date) bounds the nightly delta replay."""
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta

from quant import replay_deltas


def _day(n):
    return (date.today() - timedelta(days=n)).isoformat()


class ReplaySinceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.deltas = os.path.join(self.tmp.name, 'deltas')
        os.makedirs(self.deltas)
        for n in range(0, 41):
            with open(os.path.join(self.deltas, f'{_day(n)}.json'), 'w') as f:
                json.dump({'price_updates': [{
                    'product_id': 1, 'sub_type': 'Normal',
                    'date': _day(n), 'market_price': 1.0}]}, f)
        self.db = os.path.join(self.tmp.name, 'art.db')

    def _make_db(self, max_day=None):
        con = sqlite3.connect(self.db)
        con.execute('CREATE TABLE cards (product_id INTEGER PRIMARY KEY, '
                    'card_name TEXT, card_number TEXT, set_name TEXT)')
        con.execute('CREATE TABLE price_history (product_id INTEGER, '
                    'sub_type TEXT, date TEXT, market_price REAL, '
                    'PRIMARY KEY (product_id, sub_type, date))')
        if max_day is not None:
            con.execute("INSERT INTO price_history VALUES (1,'Normal',?,1.0)",
                        (_day(max_day),))
        con.commit()
        con.close()

    def _replayed_dates(self, since):
        before = set()
        con = sqlite3.connect(self.db)
        before = {r[0] for r in con.execute('SELECT date FROM price_history')}
        con.close()
        replay_deltas.replay(self.db, days=30, local_dir=self.deltas,
                             since=since)
        con = sqlite3.connect(self.db)
        after = {r[0] for r in con.execute('SELECT date FROM price_history')}
        con.close()
        return after - before

    def test_max_date_five_days_ago(self):
        self._make_db(max_day=5)
        got = self._replayed_dates(_day(5))
        self.assertEqual(got, {_day(n) for n in range(0, 5)})

    def test_old_max_date_hits_30_day_cap(self):
        self._make_db(max_day=60)
        got = self._replayed_dates(_day(60))
        self.assertEqual(got, {_day(n) for n in range(0, 31)})

    def test_empty_price_history_uses_30_day_window(self):
        self._make_db()
        got = self._replayed_dates(None)
        self.assertEqual(got, {_day(n) for n in range(0, 31)})


if __name__ == '__main__':
    unittest.main()
