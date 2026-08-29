import streamlit as st
import urllib.parse
import math
import time
import pandas as pd
from datetime import date
from card_tool import (
    search_cards_paginated, 
    calculate_buy_offer, 
    add_inventory_item, 
    get_inventory, 
    update_inventory_bulk,
    delete_inventory_item
)

st.set_page_config(page_title="PokeQuant", layout="wide")

# --- Session State Initialization ---
if "cart" not in st.session_state:
    st.session_state.cart = []
if "current_page" not in st.session_state:
    st.session_state.current_page = 1
if "last_query" not in st.session_state:
    st.session_state.last_query = ""
if "last_rarity" not in st.session_state:
    st.session_state.last_rarity = "All"
if "last_max_price" not in st.session_state:
    st.session_state.last_max_price = 0.0
if "last_product_type" not in st.session_state:
    st.session_state.last_product_type = "All"
if "last_sort" not in st.session_state:
    st.session_state.last_sort = "Newest"

def format_trend(val):
    if val == "N/A":
        return "N/A"
    if val.startswith("+"):
        return f":green[{val} ↗]"
    if val.startswith("-"):
        return f":red[{val} ↘]"
    return f":gray[{val} =]"

def calculate_sticker_price(market_price):
    decimal = market_price % 1
    if decimal <= 0.30:
        sticker = float(math.floor(market_price))
    else:
        sticker = float(math.ceil(market_price))
    return max(1.0, sticker) 

# --- Navigation Setup ---
page = st.sidebar.radio("Navigation", ["Search & Buy", "My Cloud Inventory"])

if page == "Search & Buy":
    st.title("PokeQuant")
    st.write("Live offline pricing and offer calculator.")

    # --- Search & Filters ---
    query = st.text_input("Search for a card:", placeholder="e.g. Pikachu 276, Mega Latias 100, Ninjask 137")

    with st.expander("Advanced Filters & Sorting", expanded=False):
        f_col1, f_col2 = st.columns(2)
        with f_col1:
            rarity_options = [
                "All", "Common", "Uncommon", "Rare", "Holo Rare", "Double Rare", 
                "Ultra Rare", "Illustration Rare", "Special Illustration Rare", 
                "Mega Attack Rare", "Mega Hyper Rare", "Hyper Rare", "Secret Rare", "Promo"
            ]
            selected_rarity = st.selectbox("Rarity", rarity_options)
            selected_product = st.selectbox("Product Type", ["All", "Cards Only", "Sealed Only"])
        with f_col2:
            selected_sort = st.selectbox("Sort By", ["Newest", "Price: High to Low", "Price: Low to High", "Oldest"])
            selected_max_price = st.number_input("Max Market Price ($)", min_value=0.0, value=0.0, step=1.0, help="Leave at 0.0 for no limit")

    if (query != st.session_state.last_query or 
        selected_rarity != st.session_state.last_rarity or 
        selected_max_price != st.session_state.last_max_price or
        selected_product != st.session_state.last_product_type or
        selected_sort != st.session_state.last_sort):
        
        st.session_state.current_page = 1
        st.session_state.last_query = query
        st.session_state.last_rarity = selected_rarity
        st.session_state.last_max_price = selected_max_price
        st.session_state.last_product_type = selected_product
        st.session_state.last_sort = selected_sort

    # --- Database Query ---
    if query or selected_rarity != "All" or selected_max_price > 0 or selected_product != "All" or selected_sort != "Newest":
        with st.spinner("Searching database..."):
            results, total_pages, total_count = search_cards_paginated(
                query=query, 
                rarity=selected_rarity, 
                max_price=selected_max_price,
                product_type=selected_product,
                sort_by=selected_sort,
                page=st.session_state.current_page,
                page_size=20
            )

            if not results:
                st.warning("No matches found in the local database.")
            else:
                st.write(f"**Found {total_count} matching items** (Page {st.session_state.current_page} of {total_pages})")
                
                for card in results:
                    with st.container():
                        img_col, data_col = st.columns([1, 2.5])

                        with img_col:
                            image_url = f"https://tcgplayer-cdn.tcgplayer.com/product/{card['product_id']}_200w.jpg"
                            st.image(image_url, width='stretch')

                        with data_col:
                            st.subheader(f"{card['card_name']} #{card['card_number']}")
                            st.caption(f"Set: {card['set']}")

                            for p in card["pricing"]:
                                col1, col2, col3 = st.columns(3)
                                col1.metric("Variant", p["variant"])
                                col2.metric("NM Market", f"${p['market_price']:.2f}", p["30d_trend"] if p["30d_trend"] != "N/A" else None)
                                col3.metric("NM Offer", f"${p['cash_offer']:.2f}")

                                st.caption(f"**Trends:** 7d: {format_trend(p['7d_trend'])} | 30d: {format_trend(p['30d_trend'])} | 90d: {format_trend(p['90d_trend'])}")

                                cond_col, btn_col, inv_col = st.columns([1.5, 1, 1])
                                
                                cond_options = {
                                    "Near Mint (100%)": 1.0, "Lightly Played (85%)": 0.85, 
                                    "Moderately Played (70%)": 0.70, "Heavily Played (50%)": 0.50, "Damaged (30%)": 0.30
                                }
                                
                                with cond_col:
                                    selected_cond = st.selectbox("Condition", options=list(cond_options.keys()), key=f"cond_{card['product_id']}_{p['variant']}", label_visibility="collapsed")
                                    
                                ratio = cond_options[selected_cond]
                                adj_market = p["market_price"] * ratio
                                new_offer = calculate_buy_offer(adj_market)

                                with btn_col:
                                    if st.button("Add to Lot", key=f"add_{card['product_id']}_{p['variant']}", use_container_width=True):
                                        st.session_state.cart.append({
                                            "product_id": card["product_id"],
                                            "name": card["card_name"],
                                            "number": card["card_number"],
                                            "set": card["set"],
                                            "variant": f"{p['variant']} - {selected_cond.split(' (')[0]}",
                                            "market_price": adj_market,
                                            "buy_percentage": f"{new_offer['buy_rate_pct']}%",
                                            "cash_offer": new_offer["cash_offer"]
                                        })
                                        st.rerun()

                                with inv_col:
                                    with st.popover("📦 Log Item", use_container_width=True):
                                        st.markdown(f"**Log {card['card_name']}**")
                                        buy_price = st.number_input("Amount Paid ($)", value=float(new_offer["cash_offer"]), min_value=0.0, step=1.0, key=f"inv_buy_{card['product_id']}_{p['variant']}")
                                        
                                        s_price = calculate_sticker_price(adj_market)
                                        sticker_price = st.number_input("Sticker Price ($)", value=s_price, min_value=0.0, step=1.0, key=f"inv_stick_{card['product_id']}_{p['variant']}")
                                        
                                        date_bought = st.date_input("Date Bought", value=date.today(), key=f"inv_date_{card['product_id']}_{p['variant']}")
                                        is_bulk = st.checkbox("Part of Bulk Deal?", key=f"inv_bulk_{card['product_id']}_{p['variant']}")
                                        
                                        if st.button("Save to Cloud Inventory", type="primary", key=f"inv_save_{card['product_id']}_{p['variant']}"):
                                            with st.spinner("Pushing to Turso..."):
                                                parsed_cond = selected_cond.split(' (')[0]
                                                add_inventory_item(
                                                    card['product_id'], card['card_name'], card['card_number'], card['set'], 
                                                    p['variant'], parsed_cond, buy_price, sticker_price, date_bought, is_bulk
                                                )
                                            st.success("Item Logged!")
                                            time.sleep(1)
                                            st.rerun()

                        with st.expander("View Last Sold on eBay"):
                            st.caption("Cloud servers are blocked by eBay's bot detection. Tap below to view completed sales securely on your device.")
                            query_str = f"{card['card_name']} {card['card_number']} {card['set']} pokemon"
                            encoded_query = urllib.parse.quote(query_str)
                            ebay_url = f"https://www.ebay.com/sch/i.html?_nkw={encoded_query}&LH_Sold=1&LH_Complete=1&_sop=13"
                            st.link_button("Open eBay Sold Comps", ebay_url, type="primary")

                        st.divider()
                
                # --- Pagination Controls ---
                col_prev, col_info, col_next = st.columns([1, 2, 1])
                with col_prev:
                    if st.button("◀ Previous", use_container_width=True) and st.session_state.current_page > 1:
                        st.session_state.current_page -= 1
                        st.rerun()
                with col_info:
                    st.markdown(f"<p style='text-align: center; margin-top: 10px;'>Page {st.session_state.current_page} of {total_pages}</p>", unsafe_allow_html=True)
                with col_next:
                    if st.button("Next ▶", use_container_width=True) and st.session_state.current_page < total_pages:
                        st.session_state.current_page += 1
                        st.rerun()

    st.divider()

    # --- Lot Deal Summary ---
    if st.session_state.cart:
        st.header("Current Lot Deal")
        total_market = sum(item["market_price"] for item in st.session_state.cart)
        total_offer = sum(item["cash_offer"] for item in st.session_state.cart)
        
        for idx, item in enumerate(st.session_state.cart):
            c1, c2, c3, c4 = st.columns([3, 2, 2, 1])
            c1.write(f"**{item['name']}** #{item['number']} ({item['variant']})")
            c2.write(f"Mkt: ${item['market_price']:.2f}")
            c3.write(f"Offer: **${item['cash_offer']:.2f}**")
            if c4.button("✕", key=f"remove_{idx}"):
                st.session_state.cart.pop(idx)
                st.rerun()

        effective_rate = round((total_offer / total_market * 100), 1) if total_market > 0 else 0.0

        m1, m2, m3 = st.columns(3)
        m1.metric("Total Market", f"${total_market:.2f}")
        m2.metric("Total Cash Offer", f"${total_offer:.2f}")
        m3.metric("Effective Lot Rate", f"{effective_rate}%")

        if st.button("Clear Lot", type="secondary", use_container_width=True):
            st.session_state.cart = []
            st.rerun()

elif page == "My Cloud Inventory":
    st.title("My Cloud Inventory")
    
    with st.spinner("Syncing with Turso..."):
        inv_data = get_inventory()
        
    if not inv_data:
        st.info("Your inventory is currently empty. Add cards from the Search page!")
    else:
        # --- Inventory Stats ---
        total_cost = sum(item["purchase_price"] for item in inv_data)
        total_sticker = sum(item["sticker_price"] for item in inv_data)
        total_profit = total_sticker - total_cost
        
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Total Items", len(inv_data))
        c2.metric("Total Cost", f"${total_cost:.2f}")
        c3.metric("Projected Revenue", f"${total_sticker:.2f}")
        c4.metric("Proj. Gross Profit", f"${total_profit:.2f}")
        
        st.divider()
        
        # --- Live Data Grid (Spreadsheet Editor) ---
        st.write("### Live Spreadsheet Editor")
        st.caption("Double-click any cell in the right-side columns to edit. Check the bulk box if it was a lot deal.")
        
        df = pd.DataFrame(inv_data)
        # Convert SQLite 1/0 back to Boolean for the checkbox grid UI
        df["is_bulk_deal"] = df["is_bulk_deal"].astype(bool)
        
        df = df[["id", "card_name", "set_name", "variant", "condition", "purchase_price", "sticker_price", "is_bulk_deal", "date_bought"]]
        df.columns = ["ID", "Card", "Set", "Variant", "Condition", "Paid ($)", "Sticker ($)", "Bulk Deal", "Date"]
        
        edited_df = st.data_editor(
            df, 
            hide_index=True, 
            use_container_width=True,
            disabled=["ID", "Card", "Set", "Variant"], # Lock core card identities
            key="inventory_editor"
        )
        
        action_col, dl_col = st.columns([1, 4])
        with action_col:
            if st.button("Save Edits to Cloud", type="primary", use_container_width=True):
                with st.spinner("Pushing updates to Turso..."):
                    update_inventory_bulk(edited_df)
                st.success("Cloud synced successfully!")
                time.sleep(1)
                st.rerun()
                
        with dl_col:
            csv = edited_df.to_csv(index=False).encode('utf-8')
            st.download_button(
                label="📥 Download CSV for Accounting",
                data=csv,
                file_name=f"pokequant_inventory_{date.today()}.csv",
                mime="text/csv"
            )
            
        st.divider()
        st.write("### Remove an Item")
        del_col1, del_col2 = st.columns([1, 4])
        with del_col1:
            del_id = st.number_input("Item ID to permanently remove", min_value=0, step=1)
            if st.button("Delete Row", type="primary", use_container_width=True):
                with st.spinner("Deleting from cloud..."):
                    delete_inventory_item(del_id)
                st.rerun()