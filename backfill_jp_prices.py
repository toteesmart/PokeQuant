"""One-time Japanese (tcgcsv category 85) price-history backfill.

`tcg_scraper.main()` only fills forward from MAX(date), which would leave new
JP rows with a flat single-day price and no 7d/30d deltas. This helper replays
the daily price archives at the mobile catalog's milestone offsets (T-1, T-3,
T-7, T-30, T-90), filtered to category 85, so JP rows ship with real anchors.

Run AFTER the normal fill-forward so milestone dates land behind MAX(date);
INSERT OR IGNORE + the change-detection in process_archive keep it idempotent.

Usage:
    py backfill_jp_prices.py                 # milestone offsets from today
    py backfill_jp_prices.py 2026-08-16 ...  # explicit dates
"""

import sqlite3
import sys
from datetime import date, timedelta

import tcg_scraper

MILESTONE_OFFSETS = (1, 3, 7, 30, 90)


def main() -> None:
    if len(sys.argv) > 1:
        targets = [date.fromisoformat(arg) for arg in sys.argv[1:]]
    else:
        today = date.today()
        targets = [today - timedelta(days=offset) for offset in MILESTONE_OFFSETS]

    conn = sqlite3.connect(tcg_scraper.DB_NAME)
    cursor = conn.cursor()
    tcg_scraper.setup_database(cursor)

    for target in targets:
        tcg_scraper.process_archive(target, cursor, conn, categories=(85,))

    conn.close()


if __name__ == "__main__":
    main()
