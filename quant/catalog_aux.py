"""Stamp aux tables (canon_price, catalog_meta, cards_norm, cards_fts) into the shipped catalog.

canon_price is a 1:1 transcription of buildCanonPriceSql() in
mobile/src/db/catalogSearch.ts (react-native-v2), minus TEMP, so the app
reads it instead of rebuilding it per handle. It is computed from the ship
DB's own price_history. catalog_meta holds the code-card-purge sentinel and
the build id.

Run: py -m quant.catalog_aux --db PATH
"""
import argparse
import sqlite3
from datetime import datetime, timezone

AUX_TABLES = ('canon_price', 'catalog_meta', 'cards_norm', 'cards_fts')


def norm_sub_type(column):
    return (
        f"TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER({column}), "
        f"'-', ' '), '.', ' '), '''', ' '), '/', ' '), '  ', ' '), '  ', ' '))"
    )


def canon_sub_type(column):
    return (
        "TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(' ' || "
        f"{norm_sub_type(column)} || ' ', ' 1st ed ', ' 1st edition '), "
        "' first edition ', ' 1st edition '), ' holo ', ' holofoil '), "
        "' rev ', ' reverse '), ' regular ', ' normal '), "
        "' common ', ' normal '), ' uncommon ', ' normal '))"
    )


def search_form(column):
    """S(col): catalogSearch.ts normalizeColumn (the 4th arg is U+2019).
    SQLite LOWER is ASCII-only, so this must run in SQLite, not Python."""
    return (
        f"LOWER(REPLACE(REPLACE(REPLACE(REPLACE({column}, '''', ''), "
        "'’', ''), '-', ''), '.', ''))"
    )


def match_form(column):
    """M(col): eventCatalogDb.ts normalizeCatalogColumn."""
    return f"TRIM(REPLACE(REPLACE({search_form(column)}, '  ', ' '), '  ', ' '))"


def build_cards_norm_sql():
    return f"""
    CREATE TABLE cards_norm (product_id INTEGER PRIMARY KEY, name_s TEXT, number_s TEXT, set_s TEXT, name_m TEXT);
    INSERT INTO cards_norm SELECT product_id, {search_form('card_name')}, {search_form('card_number')}, {search_form('set_name')}, {match_form('card_name')} FROM cards;
    CREATE INDEX idx_cards_norm_name_s ON cards_norm(name_s);
    CREATE INDEX idx_cards_norm_name_m ON cards_norm(name_m);
  """


def build_cards_fts_sql():
    """Substring index over cards_norm's search forms (item 325).

    trigram + case_sensitive 1 over the already-normalized columns makes a
    quoted MATCH phrase an exact substring test, i.e. the same rows as the
    app's per-token `LIKE '%tok%'` for tokens of 3+ codepoints (shorter
    tokens produce no trigrams and stay on LIKE). case_sensitive 0 would
    Unicode-fold ('Étoile' ~ 'étoile') where SQLite LIKE only folds ASCII.
    Contentless + columnsize=0: the app reads only rowid (= product_id).
    First statement creates the table; stamp_cards_fts sets hashsize after it.
    """
    return """
    CREATE VIRTUAL TABLE cards_fts USING fts5(name_s, number_s, set_s, content='', columnsize=0, tokenize='trigram case_sensitive 1');
    INSERT INTO cards_fts(rowid, name_s, number_s, set_s) SELECT product_id, name_s, number_s, set_s FROM cards_norm;
  """


# Big enough to hold the whole build in memory: one segment, no merge churn,
# so no free pages are left in the (not re-vacuumed) shipped file. An
# 'optimize' instead leaves ~4 MB of freelist; a threshold, not an allocation.
FTS_HASHSIZE = 256 * 1024 * 1024


def build_canon_price_sql():
    is_normal = "canon = 'normal'"
    is_holo = "canon = 'holofoil'"
    is_other = f"NOT ({is_normal} OR {is_holo})"
    return f"""
    CREATE TABLE canon_price(product_id INTEGER PRIMARY KEY, price REAL);
    WITH latest AS (
      SELECT product_id, sub_type, MAX(date) AS max_date
      FROM price_history
      GROUP BY product_id, sub_type
    ),
    candidates AS (
      SELECT p.product_id, p.date, CAST(p.market_price AS REAL) AS price, {canon_sub_type('p.sub_type')} AS canon
      FROM latest l
      JOIN price_history p
        ON p.product_id = l.product_id AND p.sub_type = l.sub_type AND p.date = l.max_date
    ),
    bucketed AS (
      SELECT product_id, date, price, canon,
        MAX(date) OVER (PARTITION BY product_id, canon) AS canon_max_date
      FROM candidates
    ),
    ranked AS (
      SELECT product_id, price,
        ROW_NUMBER() OVER (
          PARTITION BY product_id
          ORDER BY
            CASE WHEN {is_normal} THEN 0 WHEN {is_holo} THEN 1 ELSE 2 END,
            CASE WHEN {is_other} AND price > 0 THEN 0 ELSE 1 END,
            CASE WHEN {is_other} THEN price END,
            date DESC
        ) AS rn
      FROM bucketed
      WHERE date = canon_max_date
    )
    INSERT INTO canon_price(product_id, price)
    SELECT product_id, price FROM ranked WHERE rn = 1;
  """


def drop(db_path):
    con = sqlite3.connect(db_path)
    try:
        for table in AUX_TABLES:
            con.execute(f"DROP TABLE IF EXISTS {table}")
        con.commit()
    finally:
        con.close()


def stamp_cards_fts(con):
    """cards_fts is acceleration only: if this SQLite lacks FTS5/trigram,
    skip it (the app keeps LIKE) instead of failing the other aux tables."""
    con.execute("SAVEPOINT cards_fts")
    try:
        create, *fill = [s for s in build_cards_fts_sql().split(";\n") if s.strip()]
        con.execute(create)
        try:
            con.execute("INSERT INTO cards_fts(cards_fts, rank) VALUES('hashsize', ?)",
                        (FTS_HASHSIZE,))
        except sqlite3.Error:
            pass  # pre-hashsize SQLite: a few more segments, same rows
        for stmt in fill:
            con.execute(stmt)
    except sqlite3.Error as e:
        con.execute("ROLLBACK TO cards_fts")
        print(f"cards_fts skipped: {e}")
    con.execute("RELEASE cards_fts")


def stamp(db_path):
    drop(db_path)
    con = sqlite3.connect(db_path, isolation_level=None)
    try:
        con.execute("BEGIN")
        try:
            # executescript would COMMIT first; run statements individually.
            for stmt in build_canon_price_sql().split(";\n"):
                if stmt.strip():
                    con.execute(stmt)
            con.execute("CREATE TABLE catalog_meta(key TEXT PRIMARY KEY, value TEXT)")
            (code_cards,) = con.execute(
                "SELECT COUNT(*) FROM cards WHERE card_name LIKE 'Code Card%'"
            ).fetchone()
            con.execute(
                "INSERT INTO catalog_meta(key, value) VALUES ('code_cards_purged', ?)",
                ('1' if code_cards == 0 else '0',),
            )
            con.execute(
                "INSERT INTO catalog_meta(key, value) VALUES ('build_id', ?)",
                (datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),),
            )
            for stmt in build_cards_norm_sql().split(";\n"):
                if stmt.strip():
                    con.execute(stmt)
            stamp_cards_fts(con)
            con.execute("COMMIT")
        except BaseException:
            con.execute("ROLLBACK")
            raise
    finally:
        con.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--db', required=True)
    stamp(ap.parse_args().db)


if __name__ == '__main__':
    main()
