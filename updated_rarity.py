# Save as update_rarity.py and run: py update_rarity.py
import sqlite3
import glob
import csv

conn = sqlite3.connect('pokemon_tcg.db')
cursor = conn.cursor()

# 1. Add column if it doesn't exist
try:
    cursor.execute("ALTER TABLE cards ADD COLUMN rarity TEXT")
    print("Added 'rarity' column to table 'cards'.")
except sqlite3.OperationalError:
    print("'rarity' column already exists.")

# 2. Populate rarity from all CSV files in the folder
csv_files = glob.glob("*.csv")
print(f"Found {len(csv_files)} CSV files. Populating rarities...")

updates = []
seen = set()
for file in csv_files:
    with open(file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            product_id = row.get("productId")
            rarity = row.get("extRarity")
            if not product_id or not rarity:
                continue
            try:
                pid = int(float(product_id))
            except (ValueError, TypeError):
                continue
            if pid in seen:
                continue
            seen.add(pid)
            updates.append((rarity, pid))

if updates:
    cursor.executemany(
        "UPDATE cards SET rarity = ? WHERE product_id = ?",
        updates
    )

conn.commit()
conn.close()
print("Rarity database update complete!")
