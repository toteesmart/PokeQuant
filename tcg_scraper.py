import requests
import sqlite3
import time
from datetime import date, timedelta
import os
import subprocess
import json
import shutil

# --- Configuration ---
DB_NAME = 'pokemon_tcg.db'
START_DATE = date(2024, 2, 8) # Archive genesis date
USER_AGENT = 'PokemonPriceTracker/1.0'

def setup_database(cursor):
    # Normalized structure: Stores static card info once
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cards (
            product_id INTEGER PRIMARY KEY,
            card_name TEXT,
            card_number TEXT,
            set_name TEXT
        )
    ''')
    # Time-series structure: Stores price changes 
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            product_id INTEGER,
            sub_type TEXT,
            date TEXT,
            market_price REAL,
            PRIMARY KEY (product_id, sub_type, date)
        )
    ''')
    # View to format the output exactly as requested
    cursor.execute('''
        CREATE VIEW IF NOT EXISTS latest_prices AS
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
    ''')

def get_card_number(extended_data):
    if not extended_data:
        return "N/A"
    for item in extended_data:
        if item.get("name") == "Number":
            return item.get("value")
    return "N/A"

def update_card_catalog(cursor, conn):
    print("Fetching sets & cards from live API...")
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT})
    
    # Fetch all Pokemon Groups/Sets (Category 3)
    res = session.get("https://tcgcsv.com/tcgplayer/3/groups")
    if res.status_code != 200:
        return
        
    groups = res.json().get('results', [])
    for group in groups:
        group_id = group['groupId']
        set_name = group['name']
        
        # Fetch products for the specific group
        p_res = session.get(f"https://tcgcsv.com/tcgplayer/3/{group_id}/products")
        if p_res.status_code != 200:
            continue # Skip 404 empty content errors
            
        products = p_res.json().get('results', [])
        for p in products:
            product_id = p['productId']
            card_name = p['name']
            card_num = get_card_number(p.get('extendedData', []))
            
            cursor.execute('''
                INSERT OR IGNORE INTO cards (product_id, card_name, card_number, set_name)
                VALUES (?, ?, ?, ?)
            ''', (product_id, card_name, card_num, set_name))
            
        conn.commit()
        time.sleep(0.2) # Polite scraping delay

def process_archive(target_date, cursor, conn):
    date_str = target_date.strftime('%Y-%m-%d')
    print(f"Processing archive for {date_str}...")
    
    archive_url = f"https://tcgcsv.com/archive/tcgplayer/prices-{date_str}.ppmd.7z"
    archive_file = f"prices-{date_str}.ppmd.7z"
    extract_dir = f"extract_{date_str}"
    
    # 1. Download Archive
    r = requests.get(archive_url, stream=True, headers={'User-Agent': USER_AGENT})
    if r.status_code == 404:
        print(f"  -> No archive ready yet for {date_str}. Skipping.")
        return
        
    with open(archive_file, 'wb') as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)
            
    # 2. Extract Archive via 7z
    try:
        subprocess.run(['7z', 'x', archive_file, f'-o{extract_dir}', '-y'], 
                       check=True, stdout=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        print("  -> Extraction failed. Ensure 7-Zip is installed and in PATH.")
        os.remove(archive_file)
        return

    # 3. Process Category 3 (Pokemon) JSON files
    pokemon_dir = os.path.join(extract_dir, date_str, "3")
    if os.path.exists(pokemon_dir):
        for group_id in os.listdir(pokemon_dir):
            prices_file = os.path.join(pokemon_dir, group_id, "prices")
            if not os.path.exists(prices_file): 
                continue
            
            with open(prices_file, 'r') as f:
                price_data = json.load(f).get('results', [])
                    
                for price_obj in price_data:
                    product_id = price_obj.get('productId')
                    sub_type = price_obj.get('subTypeName', 'Normal')
                    market_price = price_obj.get('marketPrice')
                    
                    if market_price is None:
                        continue
                        
                    # OPTIMIZATION: Compare with most recent stored price
                    cursor.execute('''
                        SELECT market_price FROM price_history 
                        WHERE product_id = ? AND sub_type = ? 
                        ORDER BY date DESC LIMIT 1
                    ''', (product_id, sub_type))
                    
                    row = cursor.fetchone()
                    
                    # Log a new row only if the price has changed
                    if row is None or row[0] != market_price:
                        cursor.execute('''
                            INSERT OR IGNORE INTO price_history 
                            (product_id, sub_type, date, market_price)
                            VALUES (?, ?, ?, ?)
                        ''', (product_id, sub_type, date_str, market_price))
        
        conn.commit()

    # 4. Cleanup temp files
    os.remove(archive_file)
    shutil.rmtree(extract_dir, ignore_errors=True)

def main():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    setup_database(cursor)
    
    # Uncomment the next line to periodically refresh the catalog for new sets
    # update_card_catalog(cursor, conn)
    
    # Check latest date processed in DB
    cursor.execute('SELECT MAX(date) FROM price_history')
    last_date_row = cursor.fetchone()
    
    if last_date_row and last_date_row[0]:
        last_db_date = date.fromisoformat(last_date_row[0])
        current_date = last_db_date + timedelta(days=1)
    else:
        # Full historical backfill required
        update_card_catalog(cursor, conn) 
        current_date = START_DATE
        
    today = date.today()
    
    # Process all missing dates up to today
    while current_date <= today:
        process_archive(current_date, cursor, conn)
        current_date += timedelta(days=1)
        
    conn.close()

if __name__ == "__main__":
    main()