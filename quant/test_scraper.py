"""tcg_scraper: catalog rarity, batched writes, price-pass retry, archive path."""
import os
import sqlite3
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tcg_scraper  # noqa: E402


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload

    def iter_content(self, chunk_size=8192):
        yield b'<html>403 notice</html>'


class FakeSession:
    """Serves canned responses keyed by URL; a list value is consumed in order."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(url)
        r = self.routes.get(url)
        if isinstance(r, list):
            r = r.pop(0) if len(r) > 1 else r[0]
        if r is None:
            return FakeResponse(404)
        if isinstance(r, Exception):
            raise r
        return r


def groups_url(cat):
    return f"https://tcgcsv.com/tcgplayer/{cat}/groups"


def products_url(cat, gid):
    return f"https://tcgcsv.com/tcgplayer/{cat}/{gid}/products"


def prices_url(cat, gid):
    return f"https://tcgcsv.com/tcgplayer/{cat}/{gid}/prices"


def product(pid, name, number=None, rarity=None):
    ext = []
    if number is not None:
        ext.append({'name': 'Number', 'value': number})
    if rarity is not None:
        ext.append({'name': 'Rarity', 'value': rarity})
    return {'productId': pid, 'name': name, 'extendedData': ext}


class ScraperTestBase(unittest.TestCase):
    def setUp(self):
        tcg_scraper._code_product_ids.clear()
        self.conn = sqlite3.connect(':memory:')
        self.cur = self.conn.cursor()
        tcg_scraper.setup_database(self.cur)
        self.addCleanup(self.conn.close)
        self.addCleanup(tcg_scraper._code_product_ids.clear)
        p = mock.patch.object(tcg_scraper.time, 'sleep', lambda s: None)
        p.start()
        self.addCleanup(p.stop)

    def use_session(self, session):
        for name, val in (('_get_session', lambda: session),
                          ('_reset_session', lambda: session)):
            p = mock.patch.object(tcg_scraper, name, val)
            p.start()
            self.addCleanup(p.stop)
        return session

    def catalog(self, routes, categories=(3,)):
        self.use_session(FakeSession(routes))
        tcg_scraper.update_card_catalog(self.cur, self.conn, categories)

    def cards(self):
        return self.cur.execute(
            'SELECT product_id, card_name, card_number, set_name, rarity '
            'FROM cards ORDER BY 1').fetchall()


class CatalogRarityTests(ScraperTestBase):
    def routes(self, products, cat=3, gname='Base Set'):
        return {
            groups_url(cat): FakeResponse(200, {'results': [
                {'groupId': 1, 'name': gname}]}),
            products_url(cat, 1): FakeResponse(200, {'results': products}),
        }

    def test_get_rarity(self):
        self.assertEqual(tcg_scraper.get_rarity(
            [{'name': 'Rarity', 'value': 'Rare'}]), 'Rare')
        self.assertIsNone(tcg_scraper.get_rarity(
            [{'name': 'Rarity', 'value': ''}]))
        self.assertIsNone(tcg_scraper.get_rarity([{'name': 'Number', 'value': '1'}]))
        self.assertIsNone(tcg_scraper.get_rarity(None))

    def test_new_card_gets_rarity(self):
        self.catalog(self.routes([product(10, 'Pikachu', '025', 'Common')]))
        self.assertEqual(self.cards(), [(10, 'Pikachu', '025', 'Base Set', 'Common')])

    def test_existing_null_filled_and_non_null_kept(self):
        self.cur.executemany(
            'INSERT INTO cards VALUES (?,?,?,?,?)',
            [(10, 'Old', '1', 'Old Set', None), (11, 'Old2', '2', 'Old Set', 'Rare')])
        self.catalog(self.routes([
            product(10, 'New', '9', 'Common'), product(11, 'New2', '9', 'Uncommon')]))
        self.assertEqual(self.cards(), [
            (10, 'Old', '1', 'Old Set', 'Common'),
            (11, 'Old2', '2', 'Old Set', 'Rare')])

    def test_product_without_rarity_is_null(self):
        self.catalog(self.routes([product(10, 'Pikachu', '025')]))
        self.assertIsNone(self.cards()[0][4])

    def test_code_card_skipped(self):
        self.catalog(self.routes([
            product(10, 'Code Card - Booster', None, 'Common'),
            product(11, 'Pikachu', '025', 'Common')]))
        self.assertEqual([c[0] for c in self.cards()], [11])

    def test_jp_prefix_kept(self):
        self.catalog(self.routes([product(10, 'Pikachu', '025', 'C')],
                                 cat=85, gname='Scarlet'), categories=(85,))
        self.assertEqual(self.cards()[0][3], 'JP · Scarlet')

    def test_schema_fresh_and_legacy(self):
        cols = [r[1] for r in self.cur.execute('PRAGMA table_info(cards)')]
        self.assertEqual(cols, ['product_id', 'card_name', 'card_number',
                                'set_name', 'rarity'])
        legacy = sqlite3.connect(':memory:')
        lc = legacy.cursor()
        lc.execute('CREATE TABLE cards (product_id INTEGER PRIMARY KEY, '
                   'card_name TEXT, card_number TEXT, set_name TEXT)')
        tcg_scraper.setup_database(lc)
        cols = [r[1] for r in lc.execute('PRAGMA table_info(cards)')]
        self.assertEqual(len(cols), 5)
        self.assertIn('rarity', cols)
        legacy.close()


def oracle_live_group(cursor, results, date_str, code_ids):
    """Frozen copy of the pre-batch per-row loop (item 315 oracle)."""
    inserted = 0
    for price_obj in results:
        product_id = price_obj.get('productId')
        if product_id in code_ids:
            continue
        sub_type = price_obj.get('subTypeName', 'Normal')
        market_price = price_obj.get('marketPrice')

        if market_price is None:
            continue

        cursor.execute('''
            SELECT market_price FROM price_history
            WHERE product_id = ? AND sub_type = ?
            ORDER BY date DESC LIMIT 1
        ''', (product_id, sub_type))
        row = cursor.fetchone()
        if row is None or row[0] != market_price:
            cursor.execute('''
                INSERT OR IGNORE INTO price_history
                (product_id, sub_type, date, market_price)
                VALUES (?, ?, ?, ?)
            ''', (product_id, sub_type, date_str, market_price))
            inserted += 1
    return inserted


def dump(cursor):
    return cursor.execute('SELECT * FROM price_history ORDER BY 1,2,3').fetchall()


class LivePriceOracleTests(ScraperTestBase):
    def run_new(self, groups, day):
        routes = {groups_url(3): FakeResponse(200, {'results': [
            {'groupId': gid, 'name': 'g'} for gid in groups]})}
        for gid, results in groups.items():
            routes[prices_url(3, gid)] = FakeResponse(200, {'results': results})
        self.use_session(FakeSession(routes))
        tcg_scraper.process_live_prices(day, self.cur, self.conn, (3,))

    def compare(self, seed_rows, days):
        """days: list of (date, {gid: results}); run oracle and new on twin DBs."""
        import datetime
        twin = sqlite3.connect(':memory:')
        tc = twin.cursor()
        tcg_scraper.setup_database(tc)
        for c in (self.cur, tc):
            c.executemany('INSERT INTO price_history VALUES (?,?,?,?)', seed_rows)
        code_ids = set(tcg_scraper._code_product_ids)
        for day, groups in days:
            self.run_new(groups, datetime.date.fromisoformat(day))
            for results in groups.values():
                oracle_live_group(tc, results, day, code_ids)
            twin.commit()
            self.assertEqual(dump(self.cur), dump(tc), f"mismatch on {day}")
        twin.close()

    def test_duplicates_in_group(self):
        r = lambda pid, st, mp: {'productId': pid, 'subTypeName': st, 'marketPrice': mp}
        self.compare([], [('2026-11-01', {1: [r(1, 'Normal', 5.0), r(1, 'Normal', 6.0),
                                             r(1, 'Normal', 5.0)]}),
                          ('2026-11-02', {1: [r(1, 'Normal', 5.0), r(1, 'Normal', 5.0)]}),
                          ('2026-11-03', {1: [r(1, 'Normal', 7.0), r(1, 'Normal', 5.0)]})])

    def test_null_stored_latest_price(self):
        r = lambda pid, st, mp: {'productId': pid, 'subTypeName': st, 'marketPrice': mp}
        self.compare([(1, 'Normal', '2026-10-01', None), (2, 'Holo', '2026-10-01', 3.0)],
                     [('2026-11-01', {1: [r(1, 'Normal', 4.0), r(2, 'Holo', 3.0)]})])

    def test_same_day_rerun(self):
        r = lambda pid, st, mp: {'productId': pid, 'subTypeName': st, 'marketPrice': mp}
        g = {1: [r(1, 'Normal', 4.0), r(2, 'Holo', 8.5)]}
        self.compare([], [('2026-11-01', g), ('2026-11-01', g),
                          ('2026-11-01', {1: [r(1, 'Normal', 9.0)]})])

    def test_int_vs_float(self):
        r = lambda pid, st, mp: {'productId': pid, 'subTypeName': st, 'marketPrice': mp}
        self.compare([(1, 'Normal', '2026-10-01', 5.0)],
                     [('2026-11-01', {1: [r(1, 'Normal', 5), r(2, 'Normal', 5)]}),
                      ('2026-11-02', {1: [r(2, 'Normal', 5.0)]})])

    def test_null_sub_type(self):
        r = lambda pid, st, mp: {'productId': pid, 'subTypeName': st, 'marketPrice': mp}
        no_key = {'productId': 3, 'marketPrice': 2.0}
        self.compare([], [('2026-11-01', {1: [r(1, None, 5.0), r(1, None, 5.0), no_key]}),
                          ('2026-11-02', {1: [r(1, None, 5.0), no_key]})])

    def test_code_card_ids_and_none_price(self):
        tcg_scraper._code_product_ids.update({2})
        r = lambda pid, st, mp: {'productId': pid, 'subTypeName': st, 'marketPrice': mp}
        self.compare([], [('2026-11-01', {1: [r(1, 'Normal', 5.0), r(2, 'Normal', 9.0),
                                             r(3, 'Normal', None)]})])

    def test_seeded_random(self):
        import random
        rng = random.Random(315)
        subs = ['Normal', 'Holofoil', None, 'Reverse Holofoil']
        prices = [None, 1, 1.0, 2.5, 3, 3.0, 7.25]
        r = lambda: {'productId': rng.randint(1, 12),
                     **({} if rng.random() < 0.05 else {'subTypeName': rng.choice(subs)}),
                     'marketPrice': rng.choice(prices)}
        tcg_scraper._code_product_ids.update({4, 9})
        seed = [(rng.randint(1, 12), rng.choice(['Normal', 'Holofoil']),
                 f'2026-10-0{d}', rng.choice(prices[1:] + [None]))
                for d in range(1, 4) for _ in range(6)]
        seed = list({(a, b, c): (a, b, c, d) for a, b, c, d in seed}.values())
        days = [(f'2026-11-0{d}', {g: [r() for _ in range(rng.randint(0, 15))]
                                   for g in (1, 2, 3)})
                for d in (1, 1, 2, 3, 3)]
        self.compare(seed, days)


if __name__ == '__main__':
    unittest.main()
