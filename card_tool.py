import sqlite3
from datetime import date, timedelta
from typing import List, Dict, Any, Tuple

DB_NAME = 'pokemon_tcg.db'

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
    page: int = 1,
    page_size: int = 20
) -> Tuple[List[Dict[str, Any]], int, int]:
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    sql_from = "FROM cards c WHERE 1=1"
    params = []

    if query:
        for word in query.split():
            sql_from += " AND (c.card_name LIKE ? OR c.card_number LIKE ? OR c.set_name LIKE ?)"
            params.extend([f"%{word}%", f"%{word}%", f"%{word}%"])

    if rarity and rarity != "All":
        sql_from += " AND c.rarity = ?"
        params.append(rarity)

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

    offset = (page - 1) * page_size
    query_sql = f"SELECT c.product_id, c.card_name, c.card_number, c.set_name {sql_from} ORDER BY c.product_id DESC LIMIT ? OFFSET ?"
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