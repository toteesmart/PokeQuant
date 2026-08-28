import os
from card_tool import search_card_and_pricing

print("==================================================")
print(" Offline PokeQuant Batch Terminal (Zero API) ")
print(" Type multiple cards separated by commas.")
print(" Type 'file:filename.txt' to process a text file.")
print(" Type 'exit' or 'quit' to shut down.")
print("==================================================")

while True:
    try:
        user_input = input("\nSearch Cards (comma-separated): ")
        if user_input.lower() in ['exit', 'quit']:
            print("Shutting down...")
            break
        if not user_input.strip():
            continue

        # Handle file input (e.g., file:my_cards.txt)
        queries = []
        if user_input.lower().startswith("file:"):
            filename = user_input[5:].strip()
            if not os.path.exists(filename):
                print(f"  -> Error: File '{filename}' not found.")
                continue
            with open(filename, 'r', encoding='utf-8') as f:
                queries = [line.strip() for line in f if line.strip()]
            print(f"Loaded {len(queries)} cards from {filename}...")
        else:
            # Handle comma-separated input
            queries = [q.strip() for q in user_input.split(',')]

        total_market = 0.0
        total_offer = 0.0
        cards_found = 0

        for query in queries:
            results = search_card_and_pricing(query, limit=1) # Limit to best match for batching
            
            print(f"\n--- Searching: '{query}' ---")
            if not results:
                print("  -> No matches found in the local database.")
                continue
                
            for card in results:
                print(f"[{card['set']}] {card['card_name']} #{card['card_number']}")
                
                # Default to the lowest price variant to be safe on blind bulk buys
                safest_variant = min(card['pricing'], key=lambda x: x['market_price'])
                
                for p in card['pricing']:
                    indicator = " (USED FOR TOTAL)" if p == safest_variant else ""
                    print(f"  -> {p['variant']}: Market ${p['market_price']:.2f} | Offer ({p['buy_percentage']}): ${p['cash_offer']:.2f}{indicator}")
                    print(f"     Trends: 7d: {p['7d_trend']} | 30d: {p['30d_trend']} | 90d: {p['90d_trend']}")
                
                total_market += safest_variant['market_price']
                total_offer += safest_variant['cash_offer']
                cards_found += 1

        if cards_found > 1:
            print("\n==================================================")
            print(f" BATCH SUMMARY ({cards_found} cards found) ")
            print(f" Total Market Value: ${total_market:.2f}")
            print(f" Total Cash Offer:   ${total_offer:.2f}")
            print("==================================================")
                
    except KeyboardInterrupt:
        print("\nShutting down...")
        break