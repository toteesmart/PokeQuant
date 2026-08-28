import sqlite3

# Connect to your existing database
conn = sqlite3.connect('pokemon_tcg.db')
cursor = conn.cursor()

print("Applying indexes for faster search...")

# Execute the SQL commands
cursor.execute("CREATE INDEX IF NOT EXISTS idx_cards_search ON cards(card_name, set_name, card_number);")
cursor.execute("CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(product_id, date DESC);")

# Commit changes and close
conn.commit()
conn.close()

print("Indexes applied successfully!")