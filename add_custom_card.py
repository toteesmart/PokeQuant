import sqlite3
from datetime import date

conn = sqlite3.connect('pokemon_tcg.db')
cursor = conn.cursor()

# Use a very high custom Product ID so it never clashes with TCGplayer's real IDs
custom_id = 9990001 

# 1. Inject the card info into the catalog
cursor.execute('''
    INSERT OR REPLACE INTO cards (product_id, card_name, card_number, set_name, rarity)
    VALUES (?, ?, ?, ?, ?)
''', (custom_id, 'Mudkip - 005 (EU POP Tournament)', '005', 'Custom Promos', 'Promo'))

# 2. Inject a manual market price
today = date.today().isoformat()
cursor.execute('''
    INSERT OR REPLACE INTO price_history (product_id, sub_type, date, market_price)
    VALUES (?, ?, ?, ?)
''', (custom_id, 'Normal', today, 1500.00)) # Change 1500.00 to your desired market price

conn.commit()
conn.close()
print("Custom card added successfully!")