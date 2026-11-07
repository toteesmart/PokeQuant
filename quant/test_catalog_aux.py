"""Pins for quant.catalog_aux: canon_price must equal the frozen correlated
oracle (from mobile/__tests__/canonPrice.test.ts) and catalog_meta must
report the code-card sentinel.

Run: py -m unittest quant.test_catalog_aux   (from the repo root)
"""
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from quant import catalog_aux

FIXTURES = {
    101: [('Normal', '2026-01-01', 3), ('Normal', '2026-01-10', 4),
          ('Holofoil', '2026-02-01', 9), ('Reverse Holofoil', '2026-03-01', 2)],
    102: [('Holofoil', '2026-01-05', 6), ('Holofoil', '2026-01-09', 7),
          ('Reverse Holofoil', '2026-02-01', 1)],
    103: [('Reverse Holofoil', '2026-01-01', 5), ('1st Edition', '2026-01-02', 12),
          ('Unlimited', '2026-01-03', 0), ('Unlimited Holofoil', '2026-01-04', -1)],
    104: [('Reverse Holofoil', '2026-01-01', -2), ('Unlimited', '2026-01-05', 0)],
    105: [('1st Ed', '2026-01-01', 20), ('First Edition', '2026-01-03', 30),
          ('1st Edition', '2026-01-02', 25), ('Reverse Holofoil', '2026-01-09', 40)],
    106: [('Holo', '2026-01-05', 8), ('Holofoil', '2026-01-02', 11),
          ('Reverse Holofoil', '2026-01-07', 1)],
    107: [('Rev Holo', '2026-01-01', 2), ('Reverse Holofoil', '2026-01-06', 9),
          ('Unlimited', '2026-01-01', 3)],
    108: [('Regular', '2026-01-01', 1.5), ('Uncommon', '2026-01-03', 1.75),
          ('Holofoil', '2026-01-09', 10)],
    109: [('Reverse-Holo', '2026-01-04', 7), ('Reverse Holofoil', '2026-01-01', 5),
          ('Unlimited', '2026-01-01', 8)],
    110: [],
    111: [('Normal', '2026-01-01', None), ('Holofoil', '2026-01-01', 5)],
    112: [(None, '2026-01-09', 99), ('Holofoil', '2026-01-01', 2)],
    113: [('Normal', '2026-01-01', 5), ('Regular', '2026-01-05', 6)],
    114: [(None, '2026-01-01', 50), (None, '2026-01-03', 60)],
}

EXPECTED_PRICE = {
    101: 4, 102: 7, 103: 5, 104: -2, 105: 30, 106: 8, 107: 3, 108: 1.75,
    109: 7, 110: 0, 111: 0, 112: 2, 113: 6, 114: 0,
}


def oracle_expr(pid_col='c.product_id'):
    """The old per-row correlated live-price expression, frozen."""
    canon = catalog_aux.canon_sub_type
    is_normal = f"{canon('p.sub_type')} = 'normal'"
    is_holo = f"{canon('p.sub_type')} = 'holofoil'"
    is_other = f"NOT ({is_normal} OR {is_holo})"
    price = 'CAST(p.market_price AS REAL)'
    return f"""
    COALESCE((
      SELECT {price}
      FROM (
        SELECT {canon('sub_type')} AS canon, MAX(date) AS max_date
        FROM price_history
        WHERE product_id = {pid_col}
        GROUP BY canon
      ) grouped
      JOIN price_history p
        ON p.product_id = {pid_col}
        AND {canon('p.sub_type')} = grouped.canon
        AND p.date = grouped.max_date
      ORDER BY
        CASE WHEN {is_normal} THEN 0 WHEN {is_holo} THEN 1 ELSE 2 END,
        CASE WHEN {is_other} AND {price} > 0 THEN 0 ELSE 1 END,
        CASE WHEN {is_other} THEN {price} END,
        p.date DESC
      LIMIT 1
    ), 0)
    """


def make_db(path):
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE cards (product_id INTEGER PRIMARY KEY, card_name TEXT);
        CREATE TABLE price_history (product_id INTEGER, sub_type TEXT, date TEXT,
            market_price REAL, PRIMARY KEY (product_id, sub_type, date));
    """)
    for pid, rows in FIXTURES.items():
        con.execute("INSERT INTO cards VALUES (?, ?)", (pid, f"Card {pid}"))
        con.executemany("INSERT INTO price_history VALUES (?, ?, ?, ?)",
                        [(pid, s, d, p) for s, d, p in rows])
    con.commit()
    con.close()


class CatalogAuxTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix='.db')
        os.close(fd)
        self.addCleanup(lambda: os.path.exists(self.path) and os.remove(self.path))
        make_db(self.path)

    def run_sql(self, sql, commit=False):
        con = sqlite3.connect(self.path)
        try:
            rows = con.execute(sql).fetchall()
            if commit:
                con.commit()
            return rows
        finally:
            con.close()

    def tables(self):
        return {r[0] for r in self.run_sql("SELECT name FROM sqlite_master WHERE type='table'")}

    def test_canon_price_matches_expected_and_oracle(self):
        catalog_aux.stamp(self.path)
        joined = self.run_sql(
            "SELECT c.product_id, COALESCE(cp.price, 0) FROM cards c "
            "LEFT JOIN canon_price cp ON cp.product_id = c.product_id ORDER BY c.product_id")
        self.assertEqual(dict(joined), EXPECTED_PRICE)
        oracle = self.run_sql(
            f"SELECT c.product_id, ({oracle_expr()}) FROM cards c ORDER BY c.product_id")
        self.assertEqual(joined, oracle)

    def test_missing_and_null_rows(self):
        catalog_aux.stamp(self.path)
        rows = dict(self.run_sql("SELECT product_id, price FROM canon_price"))
        self.assertNotIn(110, rows)
        self.assertNotIn(114, rows)
        self.assertIn(111, rows)
        self.assertIsNone(rows[111])

    def test_meta_sentinel_and_build_id(self):
        self.run_sql("INSERT INTO cards VALUES (999, 'Code Card - Foo')", commit=True)
        catalog_aux.stamp(self.path)
        meta = dict(self.run_sql("SELECT key, value FROM catalog_meta"))
        self.assertEqual(meta['code_cards_purged'], '0')
        self.run_sql("DELETE FROM cards WHERE product_id = 999", commit=True)
        catalog_aux.stamp(self.path)
        meta = dict(self.run_sql("SELECT key, value FROM catalog_meta"))
        self.assertEqual(meta['code_cards_purged'], '1')
        self.assertRegex(meta['build_id'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        self.assertEqual(set(meta), {'code_cards_purged', 'build_id'})

    def test_restamp_replaces(self):
        catalog_aux.stamp(self.path)
        catalog_aux.stamp(self.path)
        self.assertEqual(len(self.run_sql("SELECT * FROM canon_price")), 12)

    def test_failed_stamp_leaves_no_aux_tables(self):
        catalog_aux.stamp(self.path)
        self.assertTrue(set(catalog_aux.AUX_TABLES) <= self.tables())
        bad_sql = "CREATE TABLE canon_price(a);\nSELECT * FROM nope;"
        with mock.patch.object(catalog_aux, 'build_canon_price_sql', return_value=bad_sql):
            with self.assertRaises(sqlite3.Error):
                catalog_aux.stamp(self.path)
        self.assertFalse(set(catalog_aux.AUX_TABLES) & self.tables())

    def test_drop(self):
        catalog_aux.stamp(self.path)
        catalog_aux.drop(self.path)
        self.assertFalse(set(catalog_aux.AUX_TABLES) & self.tables())


if __name__ == '__main__':
    unittest.main()
