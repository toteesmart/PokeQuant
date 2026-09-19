"""Read-only access layer for the card-price research database.

The master DB (pokemon_tcg.db, or the downloaded research.db artifact) holds:
    cards(product_id, card_name, card_number, set_name[, rarity])
    price_history(product_id, sub_type, date, market_price)

price_history is SPARSE — a row exists only when market_price changed, so the
last row date for a card doubles as its last-liquid-update timestamp.

The research artifact (quant/data/research.db) adds meta tables built by
quant/ingest.py:
    set_events(category, group_id, set_code, set_name, published_on)
    events(date, scope, ref, label)
    research_meta(key, value)
"""
import os
import re
import sqlite3
import unicodedata

JP_SET_PREFIX = 'JP · '

_CARD_NAME_RE = re.compile(r'[^a-z0-9/ ]+')


def normalize_name(name: str) -> str:
    """Lowercase, strip punctuation (keep '/' for number tokens), collapse space."""
    text = unicodedata.normalize('NFKD', name or '').lower()
    text = _CARD_NAME_RE.sub(' ', text)
    return ' '.join(text.split())


def normalize_number(number: str) -> str:
    """'090/080' == '90/80': strip leading zeros on each side of the slash."""
    if not number:
        return ''
    parts = number.strip().split('/')
    out = []
    for p in parts:
        p = p.strip()
        stripped = p.lstrip('0')
        out.append(stripped if stripped else '0')
    return '/'.join(out)


def open_master(path: str) -> sqlite3.Connection:
    """Open a catalog/research DB read-only."""
    uri = 'file:{}?mode=ro'.format(path.replace('\\', '/'))
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def default_db_path(cli_path: str = None) -> str:
    """Resolution order: explicit arg/env -> research artifact -> repo master."""
    if cli_path:
        return cli_path
    env = os.environ.get('QUANT_DB')
    if env:
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    research = os.path.join(here, 'data', 'research.db')
    if os.path.exists(research):
        return research
    return os.path.join(here, '..', 'pokemon_tcg.db')


def has_table(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def resolve_card(con, name, number=None, set_hint=None, jp=None):
    """Rank candidate cards for a fuzzy name/number query.

    Returns list of dicts: product_id, card_name, card_number, set_name, rarity,
    score. Exact normalized-name matches rank above substring matches; a
    matching card_number (zero-insensitive) boosts strongly.
    """
    needle = normalize_name(name)
    if not needle and not number:
        return []

    has_rarity = 'rarity' in {r[1] for r in con.execute('PRAGMA table_info(cards)')}
    cols = 'product_id, card_name, card_number, set_name' + (', rarity' if has_rarity else '')

    sql = f'SELECT {cols} FROM cards'
    params = []
    clauses = []
    if needle:
        clauses.append('(lower(card_name) LIKE ? OR lower(card_name) LIKE ?)')
        params += [f'%{needle}%', f'%{needle.replace(" ", "%")}%']
    if number:
        clauses.append('card_number LIKE ?')
        params.append(f'%{number.strip()}%')
    if set_hint:
        clauses.append('lower(set_name) LIKE ?')
        params.append(f'%{set_hint.strip().lower()}%')
    if jp is True:
        clauses.append("set_name LIKE 'JP · %'")
    elif jp is False:
        clauses.append("set_name NOT LIKE 'JP · %'")
    if clauses:
        sql += ' WHERE ' + ' AND '.join(f'({c})' for c in clauses)
    sql += ' LIMIT 5000'

    norm_num = normalize_number(number) if number else ''
    results = []
    for row in con.execute(sql, params):
        cname = row['card_name'] or ''
        cn_norm = normalize_name(cname)
        score = 0.0
        if needle:
            if cn_norm == needle:
                score += 100.0
            elif cn_norm.startswith(needle):
                score += 60.0
            elif needle in cn_norm:
                score += 40.0
            else:
                continue  # no name agreement at all
        if norm_num:
            row_num = normalize_number(row['card_number'] or '')
            if row_num == norm_num:
                score += 80.0
            elif norm_num in cn_norm:
                score += 50.0
            elif needle and norm_num not in row_num:
                # name matched but number did not — still a candidate, penalized
                score -= 10.0
        if set_hint and set_hint.strip().lower() in (row['set_name'] or '').lower():
            score += 15.0
        results.append({
            'product_id': row['product_id'],
            'card_name': cname,
            'card_number': row['card_number'],
            'set_name': row['set_name'],
            'rarity': row['rarity'] if has_rarity else None,
            'score': score,
        })

    results.sort(key=lambda r: (-r['score'], r['card_name']))
    return results[:25]


def get_subtypes(con, product_id: int):
    """[(sub_type, n_rows, first_date, last_date)] for a product."""
    return [
        (r[0], r[1], r[2], r[3])
        for r in con.execute(
            'SELECT sub_type, COUNT(*), MIN(date), MAX(date) '
            'FROM price_history WHERE product_id=? GROUP BY sub_type',
            (product_id,),
        )
    ]


def get_series(con, product_id: int, sub_type: str):
    """Sparse event series [(date, price)] ASC; null/zero prices dropped."""
    return [
        (r[0], r[1])
        for r in con.execute(
            'SELECT date, market_price FROM price_history '
            'WHERE product_id=? AND sub_type=? AND market_price > 0 ORDER BY date',
            (product_id, sub_type),
        )
    ]


def get_set_peers(con, set_name: str, exclude_product_id: int = None):
    """product_ids sharing set_name (the set-beta universe)."""
    rows = con.execute(
        'SELECT product_id FROM cards WHERE set_name=?', (set_name,)
    ).fetchall()
    return [r[0] for r in rows if r[0] != exclude_product_id]


def get_peer_series(con, product_ids, sub_type: str):
    """{product_id: [(date, price)]} for many peers of one sub_type."""
    if not product_ids:
        return {}
    out = {}
    # Chunk the IN clause — SQLite's default variable limit is 999.
    for i in range(0, len(product_ids), 900):
        chunk = product_ids[i:i + 900]
        marks = ','.join('?' * len(chunk))
        for pid, d, p in con.execute(
            'SELECT product_id, date, market_price FROM price_history '
            f'WHERE product_id IN ({marks}) AND sub_type=? AND market_price > 0 '
            'ORDER BY product_id, date',
            (*chunk, sub_type),
        ):
            out.setdefault(pid, []).append((d, p))
    return out


def get_set_events(con):
    """{set_name: {set_code, published_on, category, group_id}}"""
    if not has_table(con, 'set_events'):
        return {}
    return {
        r['set_name']: {
            'set_code': r['set_code'],
            'published_on': r['published_on'],
            'category': r['category'],
            'group_id': r['group_id'],
        }
        for r in con.execute('SELECT * FROM set_events')
    }


def get_events(con, after=None, before=None):
    """Curated events rows in [after, before] (ISO date strings)."""
    if not has_table(con, 'events'):
        return []
    sql = 'SELECT date, scope, ref, label FROM events WHERE 1=1'
    params = []
    if after:
        sql += ' AND date >= ?'
        params.append(after)
    if before:
        sql += ' AND date <= ?'
        params.append(before)
    sql += ' ORDER BY date'
    return [dict(r) for r in con.execute(sql, params)]


def db_max_date(con) -> str:
    row = con.execute('SELECT MAX(date) FROM price_history').fetchone()
    return row[0] if row else None


def research_meta(con) -> dict:
    if not has_table(con, 'research_meta'):
        return {}
    return {r['key']: r['value'] for r in con.execute('SELECT key, value FROM research_meta')}
