import sqlite3
from datetime import date, timedelta
from typing import List, Dict, Any, Tuple
import streamlit as st
import libsql_client

DB_NAME = 'pokemon_tcg.db'

# --- CLOUD INVENTORY DATABASE (Turso) ---
def get_turso_client():
    url = st.secrets["TURSO_DATABASE_URL"]
    token = st.secrets["TURSO_AUTH_TOKEN"]
    return libsql_client.create_client_sync(url=url, auth_token=token)

def setup_inventory():
    try:
        client = get_turso_client()
        client.execute('''
            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER,
                card_name TEXT,
                card_number TEXT,
                set_name TEXT,
                variant TEXT,
                condition TEXT,
                purchase_price REAL,
                sticker_price REAL,
                date_bought TEXT,
                is_bulk_deal INTEGER
            )
        ''')
        client.close()
    except Exception as e:
        print(f"Cloud DB Init skipped (ensure secrets.toml is configured): {e}")

setup_inventory()

def add_inventory_item(product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, date_bought, is_bulk):
    client = get_turso_client()
    bulk_int = 1 if is_bulk else 0
    client.execute('''
        INSERT INTO inventory (product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, date_bought, is_bulk_deal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', [product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, str(date_bought), bulk_int])
    client.close()

def get_inventory():
    try:
        client = get_turso_client()
        result = client.execute('SELECT * FROM inventory ORDER BY id DESC')
        
        inventory_list = []
        for row in result.rows:
            item = {col: val for col, val in zip(result.columns, row)}
            
            # Force type normalization to prevent libsql bytes vs int crashes
            try:
                item['product_id'] = int(item.get('product_id', 0))
            except (ValueError, TypeError):
                item['product_id'] = 0
                
            inventory_list.append(item)
            
        client.close()

        # Cross-reference local SQLite database to enrich items with card rarity
        if inventory_list:
            product_ids = list({item['product_id'] for item in inventory_list if item['product_id'] > 0})
            if product_ids:
                conn = sqlite3.connect(DB_NAME)
                cursor = conn.cursor()
                placeholders = ",".join(["?"] * len(product_ids))
                cursor.execute(f"SELECT product_id, rarity FROM cards WHERE product_id IN ({placeholders})", product_ids)
                rarity_map = dict(cursor.fetchall())
                conn.close()
                for item in inventory_list:
                    item['rarity'] = rarity_map.get(item['product_id'], 'Promo' if 'Promo' in str(item.get('set_name', '')) else 'N/A')
            else:
                for item in inventory_list:
                    item['rarity'] = 'N/A'

        return inventory_list
    except Exception as e:
        st.error(f"Failed to connect to Cloud Inventory. Check internet connection. Error: {e}")
        return []

def update_inventory_item_single(item_id: int, condition: str, purchase_price: float, sticker_price: float, date_bought: str):
    client = get_turso_client()
    client.execute('''
        UPDATE inventory 
        SET condition = ?, purchase_price = ?, sticker_price = ?, date_bought = ?
        WHERE id = ?
    ''', [condition, purchase_price, sticker_price, str(date_bought), item_id])
    client.close()

def update_inventory_item_full(item_id: int, product_id: int, card_name: str, card_number: str, set_name: str, variant: str, condition: str, purchase_price: float, sticker_price: float, date_bought: str):
    client = get_turso_client()
    client.execute('''
        UPDATE inventory 
        SET product_id = ?, card_name = ?, card_number = ?, set_name = ?, variant = ?, condition = ?, purchase_price = ?, sticker_price = ?, date_bought = ?
        WHERE id = ?
    ''', [product_id, card_name, card_number, set_name, variant, condition, purchase_price, sticker_price, str(date_bought), item_id])
    client.close()

def update_inventory_bulk(edited_df):
    client = get_turso_client()
    for _, row in edited_df.iterrows():
        bulk_int = 1 if row["Bulk Deal"] else 0
        client.execute('''
            UPDATE inventory 
            SET condition = ?, purchase_price = ?, sticker_price = ?, is_bulk_deal = ?, date_bought = ?
            WHERE id = ?
        ''', [
            row["Condition"], 
            float(row["Paid ($)"]), 
            float(row["Sticker ($)"]), 
            bulk_int, 
            str(row["Date"]), 
            int(row["ID"])
        ])
    client.close()

def delete_inventory_item(item_id: int):
    client = get_turso_client()
    client.execute('DELETE FROM inventory WHERE id = ?', [item_id])
    client.close()

def delete_inventory_items_bulk(item_ids: List[int]):
    if not item_ids:
        return
    client = get_turso_client()
    placeholders = ",".join(["?"] * len(item_ids))
    client.execute(f'DELETE FROM inventory WHERE id IN ({placeholders})', item_ids)
    client.close()


# --- LOCAL OFFLINE PRICING LOGIC ---
def calculate_buy_offer(market_price: float) -> Dict[str, Any]:
    if market_price is None or market_price < 2.0:
        rate = 0.50
    elif 2.0 <= market_price <= 20.0:
        rate = 0.60
    elif 20.0 < market_price <= 50.0:
        rate = 0.70
    elif 50.0 < market_price <= 150.0:
        rate = 0.75
    else:  
        rate = 0.80
        
    cash_offer = round(market_price * rate, 2)
    return {
        "buy_rate_pct": int(rate * 100),
        "cash_offer": cash_offer
    }

def search_cards_paginated(
    query: str = "", 
    rarity: str = "All", 
    max_price: float = 0.0,
    product_type: str = "All",
    sort_by: str = "Newest",
    page: int = 1,
    page_size: int = 20
) -> Tuple[List[Dict[str, Any]], int, int]:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    sql_from = "FROM cards c WHERE 1=1"
    params = []

    if query:
        for word in query.split():
            clean_word = word.replace("'", "").replace("-", "").replace(".", "")
            sql_from += """ AND (
                REPLACE(REPLACE(REPLACE(c.card_name, '''', ''), '-', ''), '.', '') LIKE ? 
                OR REPLACE(c.card_number, '-', '') LIKE ? 
                OR REPLACE(REPLACE(REPLACE(c.set_name, '''', ''), '-', ''), '.', '') LIKE ?
            )"""
            params.extend([f"%{clean_word}%", f"%{clean_word}%", f"%{clean_word}%"])

    if rarity and rarity != "All":
        sql_from += " AND c.rarity = ?"
        params.append(rarity)

    if product_type == "Cards Only":
        sql_from += " AND c.card_number != 'N/A'"
    elif product_type == "Sealed Only":
        sql_from += " AND c.card_number = 'N/A'"

    if max_price > 0:
        sql_from += """ AND EXISTS (
            SELECT 1 FROM price_history p1 
            WHERE p1.product_id = c.product_id 
            AND p1.market_price <= ? 
            AND p1.date = (
                SELECT MAX(p2.date) 
                FROM price_history p2 
                WHERE p2.product_id = p1.product_id AND p2.sub_type = p1.sub_type
            )
        )"""
        params.append(max_price)

    cursor.execute(f"SELECT COUNT(*) {sql_from}", params)
    total_cards = cursor.fetchone()[0]
    total_pages = max(1, (total_cards + page_size - 1) // page_size)

    if sort_by == "Oldest":
        order_clause = "ORDER BY c.product_id ASC"
    elif sort_by == "Price: High to Low":
        order_clause = """ORDER BY (
            SELECT MAX(p.market_price) 
            FROM price_history p 
            WHERE p.product_id = c.product_id 
            AND p.date = (SELECT MAX(date) FROM price_history WHERE product_id = c.product_id)
        ) DESC NULLS LAST"""
    elif sort_by == "Price: Low to High":
        order_clause = """ORDER BY (
            SELECT MIN(p.market_price) 
            FROM price_history p 
            WHERE p.product_id = c.product_id 
            AND p.date = (SELECT MAX(date) FROM price_history WHERE product_id = c.product_id)
        ) ASC NULLS LAST"""
    else:  
        order_clause = "ORDER BY c.product_id DESC"

    offset = (page - 1) * page_size
    query_sql = f"SELECT c.product_id, c.card_name, c.card_number, c.set_name {sql_from} {order_clause} LIMIT ? OFFSET ?"
    cursor.execute(query_sql, params + [page_size, offset])
    matched_cards = cursor.fetchall()

    results = []

    for product_id, name, number, c_set in matched_cards:
        cursor.execute("""
            SELECT sub_type, market_price, date
            FROM price_history
            WHERE product_id = ?
            ORDER BY date DESC
        """, (product_id,))
        
        all_records = cursor.fetchall()
        if not all_records:
            continue

        subtypes = {}
        for sub_type, price, dt in all_records:
            if sub_type not in subtypes:
                subtypes[sub_type] = {
                    "latest_price": price,
                    "latest_date": dt,
                    "history_points": []
                }
            subtypes[sub_type]["history_points"].append((dt, price))

        variants_data = []
        for sub_type, p_info in subtypes.items():
            market_price = p_info["latest_price"]
            
            if max_price > 0 and market_price > max_price:
                continue
                
            buy_data = calculate_buy_offer(market_price)
            latest_date_str = p_info["latest_date"]
            
            try:
                latest_date_obj = date.fromisoformat(latest_date_str.split(" ")[0])
            except ValueError:
                latest_date_obj = date.today()
                
            history = p_info["history_points"]
            
            def get_trend(days_back):
                target_date = (latest_date_obj - timedelta(days=days_back)).isoformat()
                past_price = None
                for dt_str, pr in history:
                    if dt_str.split(" ")[0] <= target_date:
                        past_price = pr
                        break
                if past_price is None:
                    return "N/A"
                if past_price == 0:
                    return "0.0%"
                change = ((market_price - past_price) / past_price) * 100
                return f"{change:+.2f}%"

            variants_data.append({
                "variant": sub_type,
                "market_price": market_price,
                "buy_percentage": f"{buy_data['buy_rate_pct']}%",
                "cash_offer": buy_data["cash_offer"],
                "7d_trend": get_trend(7),
                "30d_trend": get_trend(30),
                "90d_trend": get_trend(90),
                "last_updated": latest_date_str
            })
            
        if variants_data:
            results.append({
                "product_id": product_id,
                "card_name": name,
                "card_number": number,
                "set": c_set,
                "pricing": variants_data
            })

    conn.close()
    return results, total_pages, total_cards

def search_card_and_pricing(query: str, limit: int = 1) -> List[Dict[str, Any]]:
    results, _, _ = search_cards_paginated(query=query, page_size=limit)
    return results