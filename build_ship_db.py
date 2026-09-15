"""Build the shipping mobile_catalog.db from the full-history pokemon_tcg.db.

Same milestone price-history flattening as build_mobile_db.py, minus the
Base64 thumbnail step — the shipped catalog (and the mobile app's
pokequant_catalog.db) carry no image_base64 column; images resolve via the
CDN or the offline image packs.

Usage:
    py build_ship_db.py            # writes mobile_catalog.db
    py build_ship_db.py --upload   # also push to R2 via wrangler
"""

import argparse
import os
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path

SOURCE_DB = "pokemon_tcg.db"
TARGET_DB = "mobile_catalog.db"
R2_BUCKET = "pokequant-db"
R2_KEY = "mobile_catalog.db"


def compress_database() -> None:
    print("1. Creating mobile clone...")
    shutil.copyfile(SOURCE_DB, TARGET_DB)

    conn = sqlite3.connect(TARGET_DB)
    cursor = conn.cursor()

    cursor.execute("PRAGMA journal_mode = OFF")
    cursor.execute("PRAGMA synchronous = OFF")
    cursor.execute("PRAGMA cache_size = -100000")

    # The shipping format has no image_base64 column.
    try:
        cursor.execute("ALTER TABLE cards DROP COLUMN image_base64")
    except sqlite3.OperationalError:
        pass

    print("2. Flattening price history & calculating 90-Day High/Low...")
    cursor.execute("SELECT rowid, product_id, sub_type, market_price, date FROM price_history ORDER BY product_id, sub_type, date DESC")
    rows = cursor.fetchall()

    keep_rowids = set()
    current_group = None
    group_records = []

    def process_group(records):
        if not records:
            return

        try:
            latest_dt = datetime.fromisoformat(records[0][4].split(" ")[0].split("T")[0])
        except Exception:
            return

        target_days = [1, 3, 7, 30, 90]
        milestones = set()

        keep_rowids.add(records[0][0])
        window_90_prices = []

        for r in records:
            rowid, pid, stype, price, dt_str = r
            try:
                dt = datetime.fromisoformat(dt_str.split(" ")[0].split("T")[0])
            except Exception:
                continue

            days_diff = (latest_dt - dt).days

            if days_diff <= 90:
                window_90_prices.append(r)

            for t in target_days:
                if days_diff >= t and t not in milestones:
                    keep_rowids.add(rowid)
                    milestones.add(t)
                    break

        if window_90_prices:
            max_row = max(window_90_prices, key=lambda x: x[3])
            min_row = min(window_90_prices, key=lambda x: x[3])
            keep_rowids.add(max_row[0])
            keep_rowids.add(min_row[0])

    for row in rows:
        group_key = (row[1], row[2])
        if group_key != current_group:
            process_group(group_records)
            current_group = group_key
            group_records = []
        group_records.append(row)
    process_group(group_records)

    print(f"Keeping {len(keep_rowids)} essential tactical records out of {len(rows)}...")

    print("Writing tactical row IDs to staging index...")
    cursor.execute("CREATE TABLE keep_ids (rowid INTEGER PRIMARY KEY)")
    cursor.executemany("INSERT INTO keep_ids (rowid) VALUES (?)", [(rid,) for rid in keep_rowids])
    conn.commit()

    print("Rebuilding lightweight price_history table...")
    cursor.execute("DROP VIEW IF EXISTS latest_prices")
    cursor.execute("DROP INDEX IF EXISTS idx_price_history_lookup")

    cursor.execute("""
        CREATE TABLE price_history_temp (
            product_id INTEGER,
            sub_type TEXT,
            date TEXT,
            market_price REAL,
            PRIMARY KEY (product_id, sub_type, date)
        )
    """)

    cursor.execute("""
        INSERT INTO price_history_temp
        SELECT p.product_id, p.sub_type, p.date, p.market_price
        FROM price_history p
        JOIN keep_ids k ON p.rowid = k.rowid
    """)

    cursor.execute("DROP TABLE price_history")
    cursor.execute("DROP TABLE keep_ids")
    cursor.execute("ALTER TABLE price_history_temp RENAME TO price_history")

    print("Restoring database views and indexes...")
    cursor.execute("""
        CREATE VIEW latest_prices AS
        SELECT
            c.card_name AS "Card",
            c.card_number AS "Card Number",
            c.set_name AS "Set",
            p.sub_type AS "Variant",
            p.market_price AS "Market Price"
        FROM cards c
        JOIN price_history p ON c.product_id = p.product_id
        WHERE p.date = (
            SELECT MAX(date) FROM price_history
            WHERE product_id = p.product_id AND sub_type = p.sub_type
        )
    """)
    cursor.execute("CREATE INDEX idx_price_history_lookup ON price_history(product_id, date DESC)")
    conn.commit()

    print("3. Optimizing and vacuuming database file size...")
    cursor.execute("VACUUM")
    conn.close()
    size_mb = Path(TARGET_DB).stat().st_size / 1e6
    print(f"Ship catalog build complete: {TARGET_DB} ({size_mb:.0f} MB)")


def upload() -> None:
    # wrangler is OAuth-authenticated locally; --remote hits the real bucket.
    subprocess.run(
        [
            "wrangler", "r2", "object", "put",
            f"{R2_BUCKET}/{R2_KEY}",
            "--file", TARGET_DB,
            "--content-type", "application/octet-stream",
            "--cache-control", "max-age=0, no-cache, no-store, must-revalidate",
            "--remote",
        ],
        check=True,
        # Windows: wrangler is an npm .cmd shim that needs cmd.exe's lookup.
        shell=(os.name == "nt"),
    )
    print(f"Uploaded {TARGET_DB} to r2://{R2_BUCKET}/{R2_KEY}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    compress_database()
    if args.upload:
        upload()
