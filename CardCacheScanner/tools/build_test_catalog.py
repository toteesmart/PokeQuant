import sqlite3
import json
import argparse
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1].parents[0] / "pokemon_tcg.db"
OUT_DIR = Path(__file__).resolve().parents[1] / "assets"


def main():
    parser = argparse.ArgumentParser(description="Build a small test catalog for CardCacheScanner.")
    parser.add_argument(
        "--sets",
        nargs="+",
        default=["Journey Together"],
        help="Set names to include.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Maximum cards per set.",
    )
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    placeholders = ",".join("?" for _ in args.sets)
    cur.execute(
        f"""
        SELECT product_id, card_name, card_number, set_name, rarity
        FROM cards
        WHERE set_name IN ({placeholders})
          AND card_number != 'N/A'
        ORDER BY product_id
        LIMIT ?
        """,
        (*args.sets, args.limit),
    )
    rows = cur.fetchall()

    catalog = []
    for row in rows:
        product_id = row["product_id"]

        # Get latest market price for each sub_type
        cur.execute(
            """
            SELECT p.sub_type, p.market_price, p.date
            FROM price_history p
            INNER JOIN (
                SELECT sub_type, MAX(date) AS max_date
                FROM price_history
                WHERE product_id = ?
                GROUP BY sub_type
            ) latest ON p.product_id = ? AND p.sub_type = latest.sub_type AND p.date = latest.max_date
            """,
            (product_id, product_id),
        )
        price_rows = cur.fetchall()

        variants = [
            {
                "subType": pr["sub_type"],
                "marketPrice": pr["market_price"],
                "date": pr["date"],
            }
            for pr in price_rows
        ]

        catalog.append({
            "productId": product_id,
            "name": row["card_name"],
            "number": row["card_number"],
            "set": row["set_name"],
            "rarity": row["rarity"],
            "imageUrl": f"https://tcgplayer-cdn.tcgplayer.com/product/{product_id}_400w.jpg",
            "variants": variants,
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUT_DIR / "test_catalog.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)

    print(f"Wrote {len(catalog)} cards to {out_file}")


if __name__ == "__main__":
    main()
