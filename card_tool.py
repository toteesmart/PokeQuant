import sqlite3
from datetime import date, timedelta
from typing import List, Dict, Any, Optional

DB_NAME = 'pokemon_tcg.db'

def calculate_buy_offer(market_price: float) -> Dict[str, Any]:
    """Applies tiered buying percentage rules."""
    if market_price is None or market_price < 2.0:
        rate = 0.50  # Default bulk/sub-$2 rate
    elif 2.0 <= market_price <= 20.0:
        rate = 0.60
    elif 20.0 < market_price <= 50.0:
        rate = 0.70
    elif 50.0 < market_price <= 150.0:
        rate = 0.75
    else:  # 150+
        rate = 0.80
        
    cash_offer = round(market_price * rate, 2)
    return {
        "buy_rate_pct": int(rate * 100),
        "cash_offer": cash_offer
    }

def search_card_and_pricing(
    query: str, 
    set_name: Optional[str] = None, 
    card_number: Optional[str] = None,
    limit: int = 3
) -> List[Dict[str, Any]]:
    """
    Intermediary search tool for Gemini.
    Retrieves card details, current market price, and calculated buy offer.
    """
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    # Dynamic SQL builder with tokenized fuzzy search
    sql = """
        SELECT product_id, card_name, card_number, set_name
        FROM cards
        WHERE 1=1
    """
    params = []

    # Split the query by spaces so "Pikachu 276" checks both name and number columns
    for word in query.split():
        sql += " AND (card_name LIKE ? OR card_number LIKE ? OR set_name LIKE ?)"
        params.extend([f"%{word}%", f"%{word}%", f"%{word}%"])

    if set_name:
        sql += " AND set_name LIKE ?"
        params.append(f"%{set_name}%")
    if card_number:
        sql += " AND card_number LIKE ?"
        params.append(f"%{card_number}%")

    sql += f" ORDER BY product_id DESC LIMIT {limit}"
    cursor.execute(sql, params)
    matched_cards = cursor.fetchall()

    results = []

    for product_id, name, number, c_set in matched_cards:
        # Get the latest price per subtype (e.g., Normal, Holofoil, Reverse Holo)
        cursor.execute("""
            SELECT sub_type, market_price, date
            FROM price_history
            WHERE product_id = ?
            ORDER BY date DESC
        """, (product_id,))
        
        all_records = cursor.fetchall()
        if not all_records:
            continue

        # Group by subtype to get the most recent date and trend calculation
        subtypes = {}
        for sub_type, price, dt in all_records:
            if sub_type not in subtypes:
                subtypes[sub_type] = {
                    "latest_price": price,
                    "latest_date": dt,
                    "history_points": []
                }
            # Record historical snapshot for trend calculation
            subtypes[sub_type]["history_points"].append((dt, price))

        variants_data = []
        for sub_type, p_info in subtypes.items():
            market_price = p_info["latest_price"]
            buy_data = calculate_buy_offer(market_price)
            latest_date_str = p_info["latest_date"]
            
            # Parse the latest date for accurate window calculations
            try:
                latest_date_obj = date.fromisoformat(latest_date_str.split(" ")[0])
            except ValueError:
                latest_date_obj = date.today()
                
            history = p_info["history_points"]
            
            def get_trend(days_back):
                target_date = (latest_date_obj - timedelta(days=days_back)).isoformat()
                
                past_price = None
                for dt_str, pr in history:
                    # History is ordered newest to oldest. We want the first record <= the target date.
                    if dt_str.split(" ")[0] <= target_date:
                        past_price = pr
                        break
                        
                if past_price is None:
                    return "N/A" # Card didn't exist in the database that far back
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

        results.append({
            "product_id": product_id,
            "card_name": name,
            "card_number": number,
            "set": c_set,
            "pricing": variants_data
        })

    conn.close()
    return results