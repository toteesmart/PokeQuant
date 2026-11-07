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


if __name__ == '__main__':
    unittest.main()
