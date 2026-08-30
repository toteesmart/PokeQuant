# Save as update_rarity.py and run: py update_rarity.py
import sqlite3
import glob
import pandas as pd

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

for file in csv_files:
    df = pd.read_csv(file)
    if 'productId' in df.columns and 'extRarity' in df.columns:
        subset = df[['productId', 'extRarity']].dropna().drop_duplicates(subset=['productId'])
        cursor.executemany(
            "UPDATE cards SET rarity = ? WHERE product_id = ?",
            [(row['extRarity'], int(row['productId'])) for _, row in subset.iterrows()]
        )

conn.commit()
conn.close()
print("Rarity database update complete!")