import sqlite3
import shutil
import urllib.request
import base64
import io
from PIL import Image
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

def download_and_encode(product_id):
    url = f"https://tcgplayer-cdn.tcgplayer.com/product/{product_id}_200w.jpg"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            image_data = response.read()
            
            img = Image.open(io.BytesIO(image_data))
            if img.mode != 'RGB':
                img = img.convert('RGB')
            out_io = io.BytesIO()
            img.save(out_io, format='JPEG', quality=35, optimize=True)
            
            return product_id, base64.b64encode(out_io.getvalue()).decode('utf-8')
    except Exception:
        return product_id, None

def compress_database():
    source_db = 'pokemon_tcg.db'
    target_db = 'mobile_catalog.db'
    
    print("1. Creating mobile clone...")
    shutil.copyfile(source_db, target_db)
    
    conn = sqlite3.connect(target_db)
    cursor = conn.cursor()
    
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
    
    print("3. Caching Base64 images into the database (This will take a few minutes)...")
    try:
        cursor.execute("ALTER TABLE cards ADD COLUMN image_base64 TEXT")
    except sqlite3.OperationalError:
        pass

    cursor.execute("SELECT product_id FROM cards WHERE image_base64 IS NULL")
    missing = [r[0] for r in cursor.fetchall()]
    
    print(f"Downloading and compressing {len(missing)} thumbnails...")
    
    updated_count = 0
    with ThreadPoolExecutor(max_workers=15) as executor:
        results = executor.map(download_and_encode, missing)
        for pid, b64 in results:
            if b64:
                cursor.execute("UPDATE cards SET image_base64 = ? WHERE product_id = ?", (b64, pid))
            updated_count += 1
            if updated_count % 1000 == 0:
                conn.commit()
                print(f"Processed {updated_count}/{len(missing)} images...")
                
    conn.commit()
    print("4. Optimizing and vacuuming database file size...")
    cursor.execute("VACUUM")
    conn.close()
    print("Mobile Catalog Build Complete! The database is now fully optimized for offline PWA storage.")

if __name__ == "__main__":
    compress_database()