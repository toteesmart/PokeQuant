import requests
import sqlite3
import time

# tcgcsv categories: 3 = Pokemon (English), 85 = Pokemon (Japanese).
# JP products carry English names and the same extendedData Rarity field, so
# the same patch path works for both categories.
CATEGORIES = (3, 85)

conn = sqlite3.connect('pokemon_tcg.db')
cursor = conn.cursor()

print("Fetching sets & cards from live API to update rarities...")
session = requests.Session()
session.headers.update({'User-Agent': 'PokemonPriceTracker/1.0'})

total_updated = 0

for category in CATEGORIES:
    res = session.get(f"https://tcgcsv.com/tcgplayer/{category}/groups")
    if res.status_code != 200:
        continue
    groups = res.json().get('results', [])

    for group in groups:
        group_id = group['groupId']
        set_name = group['name']

        p_res = session.get(f"https://tcgcsv.com/tcgplayer/{category}/{group_id}/products")
        if p_res.status_code != 200:
            continue

        products = p_res.json().get('results', [])
        updates = []

        for p in products:
            product_id = p.get('productId')
            rarity = None

            # Find Rarity in the extendedData array
            for item in p.get('extendedData', []):
                if item.get('name') == 'Rarity':
                    rarity = item.get('value')
                    break

            if rarity:
                updates.append((rarity, product_id))

        if updates:
            cursor.executemany(
                "UPDATE cards SET rarity = ? WHERE product_id = ?",
                updates
            )
            conn.commit()
            total_updated += len(updates)
            print(f"[cat {category}] Updated {len(updates)} cards in {set_name}")

        time.sleep(0.2) # Polite scraping delay

conn.close()
print(f"\nSuccess! Added rarity data to {total_updated} cards.")
