import sqlite3
import shutil
import urllib.request
import base64
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

def download_and_encode(product_id):
    url = f"https://tcgplayer-cdn.tcgplayer.com/product/{product_id}_200w.jpg"
    try:
        # TCGplayer sometimes blocks default python user-agents, so spoof a standard browser
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            image_data = response.read()
            return product_id, base64.b64encode(image_data).decode('utf-8')
    except Exception:
        return product_id, None

def compress_database():
    source_db = 'pokemon_tcg.db'
    target_db = 'mobile_catalog.db'
    
    print("1. Creating mobile clone...")
    shutil.copyfile(source_db, target_db)
    
    conn = sqlite3.connect(target_db)
    cursor = conn.cursor()
    
    print("2. Flattening price history (this strips millions of useless old dates)...")
    cursor.execute("SELECT rowid, product_id, sub_type, date FROM price_history ORDER BY product_id, sub_type, date DESC")
    rows = cursor.fetchall()
    
    keep_rowids = set()
    current_group = None
    group_dates = []
    
    for rowid, pid, stype, dt_str in rows:
        group_key = (pid, stype)
        if group_key != current_group:
            current_group = group_key
            group_dates = []
            
        try:
            dt = datetime.fromisoformat(dt_str.split(" ")[0].split("T")[0])
        except Exception:
            continue
            
        if not group_dates:
            # Always keep the latest price
            keep_rowids.add(rowid)
            group_dates.append({'dt': dt, 'milestones': set()})
        else:
            latest_dt = group_dates[0]['dt']
            days_diff = (latest_dt - dt).days
            
            # We want to capture the price closest to roughly 1, 3, 7, 30, and 90 days ago
            target_days = [1, 3, 7, 30, 90]
            
            for t in target_days:
                # If this row hits the target milestone and we haven't locked it in yet
                if days_diff >= t and t not in group_dates[0]['milestones']:
                    keep_rowids.add(rowid)
                    group_dates[0]['milestones'].add(t)
                    break

    print(f"Keeping {len(keep_rowids)} essential price records out of {len(rows)}...")
    cursor.execute("CREATE TABLE price_history_temp AS SELECT * FROM price_history WHERE rowid = 0")
    
    keep_list = list(keep_rowids)
    chunk_size = 50000
    for i in range(0, len(keep_list), chunk_size):
        chunk = keep_list[i:i+chunk_size]
        placeholders = ",".join(["?"] * len(chunk))
        cursor.execute(f"INSERT INTO price_history_temp SELECT * FROM price_history WHERE rowid IN ({placeholders})", chunk)
        
    cursor.execute("DROP TABLE price_history")
    cursor.execute("ALTER TABLE price_history_temp RENAME TO price_history")
    
    print("3. Caching Base64 images into the database (This will take a few minutes)...")
    try:
        cursor.execute("ALTER TABLE cards ADD COLUMN image_base64 TEXT")
    except sqlite3.OperationalError:
        pass # Column already exists

    cursor.execute("SELECT product_id FROM cards WHERE image_base64 IS NULL")
    missing = [r[0] for r in cursor.fetchall()]
    
    print(f"Downloading and compressing {len(missing)} thumbnails...")
    
    updated_count = 0
    with ThreadPoolExecutor(max_workers=20) as executor:
        results = executor.map(download_and_encode, missing)
        for pid, b64 in results:
            if b64:
                cursor.execute("UPDATE cards SET image_base64 = ? WHERE product_id = ?", (b64, pid))
            updated_count += 1
            if updated_count % 500 == 0:
                conn.commit()
                print(f"Processed {updated_count}/{len(missing)} images...")
                
    conn.commit()
    print("4. Optimizing and vacuuming database file size...")
    cursor.execute("VACUUM")
    conn.close()
    print("✅ Mobile Catalog Build Complete! You can now deploy 'mobile_catalog.db' with stlite.")

if __name__ == "__main__":
    compress_database()