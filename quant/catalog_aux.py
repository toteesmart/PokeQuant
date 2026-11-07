"""Stamp aux tables (canon_price, catalog_meta) into the shipped catalog.

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

AUX_TABLES = ('canon_price', 'catalog_meta')


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
