import os
import json
import sqlite3
from datetime import date
import boto3
from botocore.config import Config

import tcg_scraper

DB_NAME = "pokemon_tcg.db"
DELTA_OUTPUT = "latest_delta.json"

# Cloudflare R2 Credentials (Loaded from GitHub Secrets)
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "pokequant-db")

def run_pipeline():
    print("--- Step 1: Initializing Database & Snapshotting Catalog ---")
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Ensure tables exist so clean GitHub Action runners don't crash on missing schemas
    tcg_scraper.setup_database(cursor)
    conn.commit()
    
    # Record existing card IDs before the scraper runs
    cursor.execute("SELECT product_id FROM cards")
    existing_cards = {row[0] for row in cursor.fetchall()}
    conn.close()

    print("--- Step 2: Running TCG Scraper ---")
    # This automatically downloads and ingests today's prices from TCGCSV
    tcg_scraper.main()

    print("--- Step 3: Generating JSON Delta ---")
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    today_str = date.today().isoformat()
    
    # Identify newly added cards from the scrape using a temp table join
    # (faster than loading the entire cards table into memory or building a huge NOT IN list)
    cursor.execute("CREATE TEMP TABLE existing_ids (product_id INTEGER PRIMARY KEY)")
    cursor.executemany("INSERT INTO existing_ids (product_id) VALUES (?)", [(pid,) for pid in existing_cards])

    cursor.execute("""
        SELECT c.product_id, c.card_name, c.card_number, c.set_name, c.rarity
        FROM cards c
        LEFT JOIN existing_ids e ON c.product_id = e.product_id
        WHERE e.product_id IS NULL
    """)
    new_cards = []
    for row in cursor.fetchall():
        new_cards.append({
            "product_id": int(row[0]),
            "card_name": str(row[1]),
            "card_number": str(row[2]),
            "set_name": str(row[3]),
            "rarity": str(row[4]) if len(row) > 4 and row[4] else "N/A"
        })
    cursor.execute("DROP TABLE IF EXISTS existing_ids")

    # Pull today's specific price updates
    cursor.execute("""
        SELECT product_id, sub_type, market_price, date 
        FROM price_history 
        WHERE date = ?
    """, (today_str,))
    
    price_updates = []
    for row in cursor.fetchall():
        price_updates.append({
            "product_id": int(row[0]),
            "sub_type": str(row[1]),
            "market_price": float(row[2]),
            "date": str(row[3])
        })
    conn.close()

    delta_payload = {
        "delta_date": today_str,
        "new_cards": new_cards,
        "price_updates": price_updates
    }

    with open(DELTA_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(delta_payload, f, indent=2)

    print(f"Delta generated: {len(new_cards)} new cards and {len(price_updates)} price shifts for {today_str}.")

    print("--- Step 4: Uploading to Cloudflare R2 ---")
    if not (R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY):
        print("Skipping upload: Cloudflare R2 credentials not set in environment.")
        return

    # Create the Boto3 S3 client configured for Cloudflare R2
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto"
    )

    print("--- Step 4a: Building Mobile Catalog DB ---")
    import build_mobile_db
    build_mobile_db.compress_database()

    print("--- Step 4b: Uploading Delta JSON ---")
    # Push the lightweight delta patch to the /deltas/ directory on R2
    s3.upload_file(
        Filename=DELTA_OUTPUT,
        Bucket=R2_BUCKET_NAME,
        Key="deltas/latest_delta.json",
        ExtraArgs={"ContentType": "application/json", "CacheControl": "no-cache, no-store, must-revalidate"}
    )
    print("latest_delta.json uploaded.")

    print("--- Step 4c: Uploading Mobile Catalog DB ---")
    # Push the full compressed SQLite database to the bucket root
    s3.upload_file(
        Filename="mobile_catalog.db",
        Bucket=R2_BUCKET_NAME,
        Key="mobile_catalog.db",
        ExtraArgs={
            "ContentType": "application/vnd.sqlite3",
            "CacheControl": "max-age=0, no-cache, no-store, must-revalidate"
        }
    )
    print("mobile_catalog.db uploaded.")

    print("--- Step 4d: Uploading Catalog Images Archive ---")
    # Push the high-resolution offline image archive for the mobile client
    s3.upload_file(
        Filename="catalog_images.zip",
        Bucket=R2_BUCKET_NAME,
        Key="catalog_images.zip",
        ExtraArgs={
            "ContentType": "application/zip",
            "CacheControl": "max-age=0, no-cache, no-store, must-revalidate"
        }
    )
    print("catalog_images.zip uploaded.")
    print("Upload complete! Mobile clients can now pull this update.")

if __name__ == "__main__":
    run_pipeline()