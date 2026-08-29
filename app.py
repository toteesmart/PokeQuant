import streamlit as st
import urllib.parse
import math
import time
import pandas as pd
import re
import base64
import io
from PIL import Image
from datetime import date, timedelta
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

from card_tool import (
    search_cards_paginated, 
    search_card_and_pricing,
    calculate_buy_offer, 
    add_inventory_item, 
    get_inventory, 
    update_inventory_bulk,
    update_inventory_item_single,
    update_inventory_item_full,
    delete_inventory_item,
    delete_inventory_items_bulk,
    mark_inventory_sold,
    undo_inventory_sale,
    get_last_updated_date
)

st.set_page_config(page_title="PokeQuant", layout="wide")

# --- CUSTOM CSS FOR SLIM SIDEBAR & ACTION BUTTONS ---
st.markdown(
    """
    <style>
    [data-testid="stSidebar"] {
        min-width: 220px !important;
        max-width: 220px !important;
    }
    div[data-testid="stMetricValue"] {
        font-size: 1.6rem !important;
    }
    </style>
    """,
    unsafe_allow_html=True
)

# --- Web Scraper for Missing Cards ---
def fetch_tcgplayer_data(url: str):
    match = re.search(r'/product/(\d+)', url)
    if not match:
        return None
    product_id = int(match.group(1))
    
    try:
        res = curl_requests.get(url, impersonate="chrome", timeout=10)
        soup = BeautifulSoup(res.text, 'html.parser')
        
        name = "Unknown Name"
        set_name = "Unknown Set"
        
        title_tag = soup.find('title')
        if title_tag:
            title_text = title_tag.text.replace(" | TCGplayer", "").strip()
            if " - " in title_text:
                parts = title_text.split(" - ")
                if len(parts) >= 2:
                    name = parts[0].strip()
                    set_name = " - ".join(parts[1:]).strip() 
        
        if name == "Unknown Name":
            name_tag = soup.find('h1', class_='product-details__name')
            if name_tag: name = name_tag.text.strip()
        if set_name == "Unknown Set":
            set_tag = soup.find('a', class_='product-details__set')
            if set_tag: set_name = set_tag.text.strip()
        
        rarity = "N/A"
        number = "N/A"
        
        labels = soup.find_all('span', class_='product-attributes__lbl')
        vals = soup.find_all('span', class_='product-attributes__value')
        
        for l, v in zip(labels, vals):
            lbl_txt = l.text.strip()
            if "Rarity" in lbl_txt:
                rarity = v.text.strip()
            if "Number" in lbl_txt:
                number = v.text.strip()
                
        return {
            "product_id": product_id,
            "card_name": name,
            "set_name": set_name,
            "card_number": number,
            "rarity": rarity
        }
    except Exception:
        return None

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

# Wizard States
if "import_stage" not in st.session_state:
    st.session_state.import_stage = 0
if "import_df" not in st.session_state:
    st.session_state.import_df = None
if "current_match_idx" not in st.session_state:
    st.session_state.current_match_idx = 0
if "matched_cards" not in st.session_state:
    st.session_state.matched_cards = []

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

def get_rarity_pill_style(rarity: str) -> str:
    r = str(rarity).lower()
    if any(k in r for k in ["illustration rare", "special illustration", "sir", "hyper rare", "secret", "mega hyper rare"]):
        return "background-color: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid #8b5cf6;"
    elif any(k in r for k in ["ultra rare", "double rare", "holo rare", "vmax", "vstar", "ex", "mega attack rare"]):
        return "background-color: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid #f59e0b;"
    elif any(k in r for k in ["shiny", "radiant", "amazing"]):
        return "background-color: rgba(236, 72, 153, 0.15); color: #db2777; border: 1px solid #ec4899;"
    elif "promo" in r:
        return "background-color: rgba(100, 116, 139, 0.15); color: #64748b; border: 1px solid #64748b;"
    elif "uncommon" in r:
        return "background-color: rgba(34, 197, 94, 0.15); color: #16a34a; border: 1px solid #22c55e;"
    elif "rare" in r:
        return "background-color: rgba(59, 130, 246, 0.15); color: #2563eb; border: 1px solid #3b82f6;"
    return "background-color: rgba(148, 163, 184, 0.1); color: var(--text-color); border: 1px solid rgba(148, 163, 184, 0.4);"

# --- Navigation Setup ---
page = st.sidebar.radio("Navigation", ["Search & Buy", "My Cloud Inventory"])

st.sidebar.divider()
last_update = get_last_updated_date()
st.sidebar.caption("**Local DB Status**")
st.sidebar.caption(f"Last Sync: {last_update}")

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
                "Mega Attack Rare", "Mega Hyper Rare", "Shiny Rare", "Hyper Rare", "Secret Rare", "Promo"
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
                                    with st.popover("Log Item", use_container_width=True):
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
                                                    product_id=card['product_id'], card_name=card['card_name'], card_number=card['card_number'], set_name=card['set'], 
                                                    variant=p['variant'], condition=parsed_cond, purchase_price=buy_price, sticker_price=sticker_price, date_bought=date_bought, is_bulk=is_bulk
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
                    if st.button("Previous", use_container_width=True) and st.session_state.current_page > 1:
                        st.session_state.current_page -= 1
                        st.rerun()
                with col_info:
                    st.markdown(f"<p style='text-align: center; margin-top: 10px;'>Page {st.session_state.current_page} of {total_pages}</p>", unsafe_allow_html=True)
                with col_next:
                    if st.button("Next", use_container_width=True) and st.session_state.current_page < total_pages:
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
            if c4.button("Remove", key=f"remove_{idx}"):
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
    
    # --- MANUAL ASSET ADDITION ---
    with st.expander("Add Asset (Manual Entry)", expanded=False):
        st.caption("Manually log a card or custom item directly into your active inventory.")
        
        tcg_url_add = st.text_input("TCGplayer URL (Auto-fill)", key="add_url", placeholder="Paste URL here to auto-fill name, set, and image...")
        
        add_c1, add_c2 = st.columns(2)
        with add_c1:
            add_name = st.text_input("Card or Item Name", key="add_n")
            add_set = st.text_input("Set Name", key="add_s")
            add_var = st.text_input("Variant", value="Normal", key="add_v")
            add_cond = st.selectbox("Condition", ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"], key="add_c")
        with add_c2:
            add_num = st.text_input("Card Number", key="add_num")
            uploaded_add_img = st.file_uploader("Upload Custom Image", type=["jpg", "jpeg", "png"], key="add_img", help="Use for custom items or foreign cards.")
            add_paid = st.number_input("Paid ($)", min_value=0.0, step=1.0, key="add_p")
            add_stick = st.number_input("Sticker Price ($)", min_value=0.0, step=1.0, key="add_stick")
            
        add_c3, add_c4 = st.columns(2)
        with add_c3:
            add_date = st.date_input("Date Bought", value=date.today(), key="add_d")
        with add_c4:
            st.write("")
            add_bulk = st.checkbox("Part of Bulk Deal?", key="add_bulk")
            
        if st.button("Add to Inventory", type="primary", use_container_width=True, key="btn_add_manual"):
            with st.spinner("Adding..."):
                final_pid = 0
                final_name = add_name
                final_num = add_num
                final_set = add_set
                final_b64 = None
                
                if uploaded_add_img is not None:
                    try:
                        image = Image.open(uploaded_add_img)
                        image.thumbnail((250, 350))
                        buffered = io.BytesIO()
                        image.convert("RGB").save(buffered, format="JPEG", quality=85)
                        final_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
                    except Exception as e:
                        st.error(f"Image compression failed: {e}")
                        
                if tcg_url_add:
                    pid_match = re.search(r'/product/(\d+)', tcg_url_add)
                    if pid_match:
                        final_pid = int(pid_match.group(1))
                        
                    fetched = fetch_tcgplayer_data(tcg_url_add)
                    if fetched:
                        if fetched["card_name"] != "Unknown Name" and not add_name:
                            final_name = fetched["card_name"]
                        if fetched["set_name"] != "Unknown Set" and not add_set:
                            final_set = fetched["set_name"]
                        if fetched["card_number"] != "N/A" and not add_num:
                            final_num = fetched["card_number"]
                        
                        import sqlite3
                        try:
                            conn = sqlite3.connect('pokemon_tcg.db')
                            conn.execute(
                                "INSERT OR REPLACE INTO cards (product_id, card_name, card_number, set_name, rarity) VALUES (?, ?, ?, ?, ?)",
                                (final_pid, final_name, final_num, final_set, fetched["rarity"])
                            )
                            conn.commit()
                            conn.close()
                        except Exception as e:
                            print(f"Error caching card: {e}")
                
                if not final_name: final_name = "Unknown Item"
                if not final_set: final_set = "N/A"
                if not final_num: final_num = "N/A"
                
                add_inventory_item(
                    product_id=final_pid, 
                    card_name=final_name, 
                    card_number=final_num, 
                    set_name=final_set, 
                    variant=add_var, 
                    condition=add_cond, 
                    purchase_price=add_paid, 
                    sticker_price=add_stick, 
                    date_bought=str(add_date), 
                    is_bulk=add_bulk,
                    custom_image_data=final_b64
                )
            st.success("Item Added!")
            time.sleep(1)
            st.rerun()

    # --- INTERACTIVE IMPORT WIZARD ---
    with st.expander("Bulk Import (Excel Wizard)", expanded=False):
        
        if st.session_state.import_stage == 0:
            st.write("Upload your Excel file to search the database and verify each card before logging.")
            uploaded_file = st.file_uploader("Choose an Excel file", type=["xlsx", "xls"])
            
            if uploaded_file is not None:
                try:
                    import_df = pd.read_excel(uploaded_file, sheet_name="Totees Cards", header=1)
                    import_df = import_df.dropna(subset=["Card Name"])
                    
                    skip_sold = st.checkbox("Skip cards that already have a 'Sold For' entry?", value=True)
                    if skip_sold and "Sold For" in import_df.columns:
                        import_df = import_df[import_df["Sold For"].isna()]
                    
                    st.info(f"Found {len(import_df)} active cards to verify.")
                    if st.button("Start Matching Process", type="primary"):
                        st.session_state.import_df = import_df.reset_index(drop=True)
                        st.session_state.import_stage = 1
                        st.session_state.current_match_idx = 0
                        st.session_state.matched_cards = []
                        st.rerun()
                except Exception as e:
                    st.error(f"Error reading file. Details: {e}")
                    
        elif st.session_state.import_stage == 1:
            df = st.session_state.import_df
            idx = st.session_state.current_match_idx
            
            st.progress((idx) / len(df))
            st.write(f"### Verifying Card {idx + 1} of {len(df)}")
            
            row = df.iloc[idx]
            raw_name = str(row["Card Name"])
            excel_cond = str(row.get("Condition", "Unknown"))
            excel_cost = float(row.get("Cost", 0.0) if pd.notna(row.get("Cost")) else 0.0)
            excel_sticker = float(row.get("Sticker Priced", 0.0) if pd.notna(row.get("Sticker Priced")) else 0.0)
            
            st.info(f"**From Excel:** {raw_name} | Condition: {excel_cond}")
            
            refined_query = st.text_input(
                "Refine Search Query (remove condition abbreviations like 'mp', 'holo', etc.):", 
                value=raw_name, 
                key=f"refine_{idx}"
            )
            
            matches = search_card_and_pricing(refined_query, limit=5)
            
            if not matches:
                st.warning("No matches found in database. Edit the query above or skip/import as legacy.")
                selected_match = "Legacy Import (No Database Link)"
            else:
                match_dict = {}
                for m in matches:
                    for p in m["pricing"]:
                        key = f"{m['card_name']} #{m['card_number']} [{m['set']}] - {p['variant']}"
                        match_dict[key] = {
                            "product_id": m["product_id"],
                            "card_name": m["card_name"],
                            "card_number": m["card_number"],
                            "set_name": m["set"],
                            "variant": p["variant"],
                            "market_price": p["market_price"]
                        }
                
                options = list(match_dict.keys()) + ["Legacy Import (No Database Link)"]
                selected_match = st.selectbox("Select the correct match from the database:", options, key=f"select_{idx}")
                
                if selected_match != "Legacy Import (No Database Link)":
                    sel_data = match_dict[selected_match]
                    col1, col2 = st.columns([1, 2])
                    with col1:
                        st.image(f"https://tcgplayer-cdn.tcgplayer.com/product/{sel_data['product_id']}_200w.jpg", width=180)
                    with col2:
                        st.write(f"**Set:** {sel_data['set_name']}")
                        st.write(f"**Live NM Market Price:** ${sel_data['market_price']:.2f}")

            c_skip, c_next = st.columns(2)
            with c_skip:
                if st.button("Skip This Card", use_container_width=True):
                    st.session_state.current_match_idx += 1
                    if st.session_state.current_match_idx >= len(df):
                        st.session_state.import_stage = 2
                    st.rerun()
            with c_next:
                if st.button("Confirm Match & Next", type="primary", use_container_width=True):
                    if selected_match == "Legacy Import (No Database Link)":
                        fallback_market = float(row.get("Market Price (NM)", 0.0) if pd.notna(row.get("Market Price (NM)")) else 0.0)
                        st.session_state.matched_cards.append({
                            "product_id": 0, "card_name": raw_name, "card_number": "N/A", "set_name": "Legacy Excel Import",
                            "variant": "Normal", "condition": excel_cond, "market_price": fallback_market,
                            "purchase_price": excel_cost, "sticker_price": excel_sticker, "date_bought": str(date.today()), "is_bulk_deal": False
                        })
                    else:
                        st.session_state.matched_cards.append({
                            "product_id": sel_data["product_id"], "card_name": sel_data["card_name"], "card_number": sel_data["card_number"], 
                            "set_name": sel_data["set_name"], "variant": sel_data["variant"], "condition": excel_cond, 
                            "market_price": sel_data["market_price"], "purchase_price": excel_cost, "sticker_price": excel_sticker, 
                            "date_bought": str(date.today()), "is_bulk_deal": False
                        })
                    
                    st.session_state.current_match_idx += 1
                    if st.session_state.current_match_idx >= len(df):
                        st.session_state.import_stage = 2
                    st.rerun()
                    
        elif st.session_state.import_stage == 2:
            st.success(f"Matched {len(st.session_state.matched_cards)} cards successfully!")
            
            st.write("### Lot Deal Proportional Cost")
            is_lot = st.checkbox("Did you buy these cards as a lot for a single flat price?")
            lot_total = 0.0
            if is_lot:
                lot_total = st.number_input("Total Amount Paid for Lot ($)", min_value=0.0, step=1.0, value=100.0)
                st.caption("The app will distribute this cost across the verified live market prices.")
            
            c_can, c_fin = st.columns(2)
            with c_can:
                if st.button("Cancel Import", use_container_width=True):
                    st.session_state.import_stage = 0
                    st.session_state.matched_cards = []
                    st.rerun()
            with c_fin:
                if st.button("Push to Cloud Inventory", type="primary", use_container_width=True):
                    total_market = sum(c["market_price"] for c in st.session_state.matched_cards)
                    
                    with st.spinner("Pushing to Turso..."):
                        for c in st.session_state.matched_cards:
                            if is_lot and total_market > 0:
                                final_cost = round((c["market_price"] / total_market) * lot_total, 2)
                                final_bulk = True
                            else:
                                final_cost = c["purchase_price"]
                                final_bulk = False
                                
                            add_inventory_item(
                                product_id=c["product_id"], card_name=c["card_name"], card_number=c["card_number"],
                                set_name=c["set_name"], variant=c["variant"], condition=c["condition"],
                                purchase_price=final_cost, sticker_price=c["sticker_price"],
                                date_bought=c["date_bought"], is_bulk=final_bulk
                            )
                    
                    st.session_state.import_stage = 0
                    st.session_state.matched_cards = []
                    st.success("Import complete!")
                    time.sleep(1.5)
                    st.rerun()

    with st.spinner("Syncing with Turso & updating live market prices..."):
        all_inv_data = get_inventory()
        
    active_inv = [x for x in all_inv_data if not x.get('is_sold')]
    sold_inv = [x for x in all_inv_data if x.get('is_sold')]

    # --- TOP LEVEL INVENTORY TABS ---
    inv_tab1, inv_tab2 = st.tabs(["Active Inventory", "Sales & Performance Analytics"])

    with inv_tab1:
        if not active_inv:
            st.info("Your active inventory is empty. Add cards from Search & Buy or mark some sold cards as active!")
        else:
            # Active Inventory Stats
            total_cost = sum(item["purchase_price"] for item in active_inv)
            total_sticker = sum(item["sticker_price"] for item in active_inv)
            total_profit = total_sticker - total_cost
            
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Active Assets", len(active_inv))
            c2.metric("Total Cost Basis", f"${total_cost:.2f}")
            c3.metric("Projected Revenue", f"${total_sticker:.2f}")
            c4.metric("Proj. Gross Profit", f"${total_profit:.2f}")
            
            st.divider()

            # View Mode Toggle & Filtering
            top_ctrl1, top_ctrl2 = st.columns([1.5, 2.5])
            with top_ctrl1:
                view_mode = st.radio("View Layout", ["Floating Cards View", "Data Grid / Table"], horizontal=True)
            with top_ctrl2:
                inv_filter = st.text_input("Filter active inventory:", placeholder="Search by name, set, or card number...")

            filtered_inv = active_inv
            if inv_filter:
                q = inv_filter.lower().strip()
                filtered_inv = [
                    x for x in active_inv if (
                        q in str(x.get('card_name', '')).lower() or 
                        q in str(x.get('set_name', '')).lower() or 
                        q in str(x.get('card_number', '')).lower() or
                        q in str(x.get('rarity', '')).lower()
                    )
                ]

            # --- VIEW 1: FLOATING CARDS VIEW ---
            if view_mode == "Floating Cards View":
                df_inv = pd.DataFrame(filtered_inv)
                
                if df_inv.empty:
                    st.warning("No cards match your filter.")
                else:
                    grouped_df = df_inv.groupby(
                        ['product_id', 'card_name', 'card_number', 'set_name', 'variant', 'condition', 'rarity'],
                        as_index=False
                    ).agg(
                        quantity=('id', 'count'),
                        avg_paid=('purchase_price', 'mean'),
                        sticker_price=('sticker_price', 'max'),
                        last_bought=('date_bought', 'max'),
                        custom_image_data=('custom_image_data', 'first'),
                        live_market=('live_market', 'max'),
                        ids=('id', list)
                    )

                    st.write(f"Showing **{len(grouped_df)}** unique card listings ({len(filtered_inv)} total assets)")

                    num_cols = 4
                    for row_idx in range(0, len(grouped_df), num_cols):
                        cols = st.columns(num_cols)
                        for col_idx, col in enumerate(cols):
                            item_idx = row_idx + col_idx
                            if item_idx < len(grouped_df):
                                card = grouped_df.iloc[item_idx]
                                
                                with col:
                                    with st.container(border=True):
                                        # 1. Image Rendering Logic
                                        img_b64 = card.get('custom_image_data')
                                        if pd.isna(img_b64): img_b64 = None

                                        if img_b64:
                                            st.image(f"data:image/jpeg;base64,{img_b64}", use_container_width=True)
                                        elif card['product_id'] > 0:
                                            img_url = f"https://tcgplayer-cdn.tcgplayer.com/product/{card['product_id']}_200w.jpg"
                                            st.image(img_url, use_container_width=True)
                                        else:
                                            st.markdown(
                                                "<div style='height: 200px; display: flex; align-items: center; justify-content: center; background: var(--secondary-background-color); border-radius: 8px; color: var(--text-color); font-weight: bold;'>Legacy Asset (No Image)</div>", 
                                                unsafe_allow_html=True
                                            )

                                        # 2. Card Header
                                        card_num_str = f"#{card['card_number']}" if card['card_number'] != "N/A" else ""
                                        st.markdown(
                                            f"""
                                            <div style="display: flex; justify-content: space-between; align-items: baseline; min-height: 48px; margin-top: 6px;">
                                                <div style="font-weight: 700; font-size: 1.05em; line-height: 1.25; color: var(--text-color);">{card['card_name']}</div>
                                                <div style="font-weight: 600; font-size: 0.85em; color: var(--text-color); opacity: 0.7; margin-left: 6px; white-space: nowrap;">{card_num_str}</div>
                                            </div>
                                            """, 
                                            unsafe_allow_html=True
                                        )

                                        # 3. Badges
                                        pill_style = get_rarity_pill_style(card['rarity'])
                                        st.markdown(
                                            f"""
                                            <div style="margin: 6px 0 10px 0; display: flex; gap: 5px; flex-wrap: wrap; align-items: center;">
                                                <span style="{pill_style} border-radius: 6px; font-size: 0.72em; font-weight: 700; padding: 2px 8px; text-transform: uppercase; letter-spacing: 0.02em;">
                                                    {card['rarity']}
                                                </span>
                                                <span style="background-color: var(--secondary-background-color); color: var(--text-color); opacity: 0.9; border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 6px; font-size: 0.72em; font-weight: 600; padding: 2px 8px;">
                                                    {card['set_name']}
                                                </span>
                                            </div>
                                            """, 
                                            unsafe_allow_html=True
                                        )

                                        # 4. Big Table Sticker Price
                                        st.markdown(
                                            f"""
                                            <div style="font-size: 1.45em; font-weight: 800; color: var(--text-color); margin-bottom: 8px;">
                                                ${card['sticker_price']:.2f}
                                            </div>
                                            """,
                                            unsafe_allow_html=True
                                        )

                                        # 5. Inventory Financials / Caption Space
                                        proj_profit = card['sticker_price'] - card['avg_paid']
                                        st.markdown(
                                            f"""
                                            <div style="background-color: var(--secondary-background-color); border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 8px; padding: 8px 10px; font-size: 0.82em; color: var(--text-color); margin-bottom: 12px; line-height: 1.6;">
                                                <div style="display: flex; justify-content: space-between;">
                                                    <span style="opacity: 0.8;">Live Market:</span> <strong style="color: #3b82f6;">${card['live_market']:.2f}</strong>
                                                </div>
                                                <div style="display: flex; justify-content: space-between;">
                                                    <span style="opacity: 0.8;">Paid Price:</span> <strong>${card['avg_paid']:.2f}</strong>
                                                </div>
                                                <div style="display: flex; justify-content: space-between;">
                                                    <span style="opacity: 0.8;">Sticker Price:</span> <strong>${card['sticker_price']:.2f}</strong>
                                                </div>
                                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                                    <span style="opacity: 0.8;">Proj. Profit:</span> <strong style="color: #10b981;">+${proj_profit:.2f}</strong>
                                                </div>
                                                <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 4px;">
                                                    <span style="opacity: 0.8;">Stock:</span> <span>{card['quantity']} ({card['condition']})</span>
                                                </div>
                                            </div>
                                            """,
                                            unsafe_allow_html=True
                                        )

                                        # 6. Action Row: [Sold (Popover)] [Edit (Popover)] [Delete]
                                        btn_c1, btn_c2, btn_c3 = st.columns([1.2, 1.2, 1])
                                        
                                        with btn_c1:
                                            with st.popover("Sold", use_container_width=True):
                                                st.markdown("**Mark as Sold**")
                                                st.caption(f"{card['card_name']} ({card['condition']})")
                                                
                                                sell_qty = 1
                                                if card['quantity'] > 1:
                                                    sell_qty = st.number_input(
                                                        "Quantity Sold", 
                                                        min_value=1, 
                                                        max_value=int(card['quantity']), 
                                                        value=1, 
                                                        key=f"sell_q_{item_idx}"
                                                    )
                                                
                                                # --- Quick Sell at Sticker ---
                                                st.write(f"**Quick Sell at Sticker (${card['sticker_price']:.2f})**")
                                                
                                                today_date = date.today()
                                                yest_date = today_date - timedelta(days=1)
                                                two_days_date = today_date - timedelta(days=2)
                                                
                                                if st.button(f"Today ({today_date.strftime('%a, %b %d')})", type="primary", key=f"q_today_{item_idx}", use_container_width=True):
                                                    with st.spinner("Logging sale..."):
                                                        mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(today_date))
                                                    st.success("Sale Recorded!")
                                                    time.sleep(0.8)
                                                    st.rerun()
                                                    
                                                if st.button(f"Yesterday ({yest_date.strftime('%a, %b %d')})", key=f"q_yest_{item_idx}", use_container_width=True):
                                                    with st.spinner("Logging sale..."):
                                                        mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(yest_date))
                                                    st.success("Sale Recorded!")
                                                    time.sleep(0.8)
                                                    st.rerun()
                                                    
                                                if st.button(f"2 Days Ago ({two_days_date.strftime('%a, %b %d')})", key=f"q_2days_{item_idx}", use_container_width=True):
                                                    with st.spinner("Logging sale..."):
                                                        mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(two_days_date))
                                                    st.success("Sale Recorded!")
                                                    time.sleep(0.8)
                                                    st.rerun()
                                                
                                                # Horizontal Older Date Selection
                                                od_col1, od_col2 = st.columns([1.5, 1], vertical_alignment="bottom")
                                                with od_col1:
                                                    older_date = st.date_input("Older Date", value=two_days_date - timedelta(days=1), max_value=two_days_date - timedelta(days=1), key=f"q_old_d_{item_idx}")
                                                with od_col2:
                                                    if st.button("Confirm", key=f"q_old_btn_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(older_date))
                                                        st.success("Sale Recorded!")
                                                        time.sleep(0.8)
                                                        st.rerun()
                                                    
                                                st.divider()
                                                
                                                # --- Horizontal Custom Deal Price ---
                                                st.write("**Custom Negotiated Deal**")
                                                cd_col1, cd_col2, cd_col3 = st.columns([1.2, 1.2, 1], vertical_alignment="bottom")
                                                
                                                with cd_col1:
                                                    custom_deal = st.number_input(
                                                        "Deal Price ($)", 
                                                        min_value=0.0, 
                                                        value=float(card['sticker_price']), 
                                                        step=1.0, 
                                                        key=f"c_deal_{item_idx}"
                                                    )
                                                with cd_col2:
                                                    deal_date = st.date_input("Date Sold", value=today_date, key=f"s_date_{item_idx}")
                                                with cd_col3:
                                                    if st.button("Confirm", key=f"c_sell_btn_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging custom sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], custom_deal, str(deal_date))
                                                        st.success("Sale Recorded!")
                                                        time.sleep(0.8)
                                                        st.rerun()

                                        with btn_c2:
                                            with st.popover("Edit", use_container_width=True):
                                                st.markdown(f"**Edit Listing ({card['card_name']})**")
                                                
                                                uploaded_img = st.file_uploader("Upload Custom Image", type=["jpg", "jpeg", "png"], key=f"up_{item_idx}", help="Overwrites TCGplayer image.")
                                                tcg_url = st.text_input("TCGplayer URL (Auto-fill)", key=f"url_{item_idx}", placeholder="Paste URL here...")
                                                
                                                new_name = st.text_input("Card Name", value=card['card_name'], key=f"ed_n_{item_idx}")
                                                new_num = st.text_input("Card Number", value=card['card_number'], key=f"ed_num_{item_idx}")
                                                new_set = st.text_input("Set Name", value=card['set_name'], key=f"ed_sname_{item_idx}")
                                                new_var = st.text_input("Variant", value=card['variant'], key=f"ed_var_{item_idx}")
                                                
                                                new_c = st.selectbox(
                                                    "Condition", 
                                                    ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"],
                                                    index=["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"].index(card['condition']) if card['condition'] in ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"] else 5,
                                                    key=f"ed_c_{item_idx}"
                                                )
                                                new_paid = st.number_input("Paid ($)", value=float(card['avg_paid']), min_value=0.0, step=1.0, key=f"ed_p_{item_idx}")
                                                new_stick = st.number_input("Sticker Price ($)", value=float(card['sticker_price']), min_value=0.0, step=1.0, key=f"ed_s_{item_idx}")
                                                
                                                try:
                                                    parsed_date = date.fromisoformat(str(card['last_bought']).split(" ")[0])
                                                except (ValueError, AttributeError):
                                                    parsed_date = date.today()
                                                new_date = st.date_input("Date Bought", value=parsed_date, key=f"ed_d_{item_idx}")
                                                
                                                if st.button("Save Changes", type="primary", key=f"save_btn_{item_idx}", use_container_width=True):
                                                    with st.spinner("Updating..."):
                                                        final_pid = int(card['product_id'])
                                                        final_name = new_name
                                                        final_num = new_num
                                                        final_set = new_set
                                                        final_b64 = img_b64
                                                        
                                                        if uploaded_img is not None:
                                                            try:
                                                                image = Image.open(uploaded_img)
                                                                image.thumbnail((250, 350))
                                                                buffered = io.BytesIO()
                                                                image.convert("RGB").save(buffered, format="JPEG", quality=85)
                                                                final_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
                                                            except Exception as e:
                                                                st.error(f"Image compression failed: {e}")
                                                        
                                                        if tcg_url:
                                                            pid_match = re.search(r'/product/(\d+)', tcg_url)
                                                            if pid_match:
                                                                final_pid = int(pid_match.group(1))
                                                                
                                                            fetched = fetch_tcgplayer_data(tcg_url)
                                                            if fetched:
                                                                if fetched["card_name"] != "Unknown Name" and new_name == card['card_name']:
                                                                    final_name = fetched["card_name"]
                                                                if fetched["set_name"] != "Unknown Set" and new_set == card['set_name']:
                                                                    final_set = fetched["set_name"]
                                                                if fetched["card_number"] != "N/A" and new_num == card['card_number']:
                                                                    final_num = fetched["card_number"]
                                                                
                                                                import sqlite3
                                                                try:
                                                                    conn = sqlite3.connect('pokemon_tcg.db')
                                                                    conn.execute(
                                                                        "INSERT OR REPLACE INTO cards (product_id, card_name, card_number, set_name, rarity) VALUES (?, ?, ?, ?, ?)",
                                                                        (final_pid, final_name, final_num, final_set, fetched["rarity"])
                                                                    )
                                                                    conn.commit()
                                                                    conn.close()
                                                                except Exception as e:
                                                                    print(f"Error caching card: {e}")
                                                        
                                                        for target_id in card['ids']:
                                                            update_inventory_item_full(
                                                                int(target_id), final_pid, final_name, final_num, final_set, new_var, new_c, new_paid, new_stick, str(new_date), final_b64
                                                            )
                                                    st.success("Updated!")
                                                    time.sleep(1)
                                                    st.rerun()

                                        with btn_c3:
                                            if st.button("Delete", key=f"del_card_{item_idx}", use_container_width=True, help="Delete active listing"):
                                                with st.spinner("Deleting..."):
                                                    delete_inventory_items_bulk(card['ids'])
                                                st.rerun()

            # --- VIEW 2: LIVE SPREADSHEET TABLE ---
            else:
                st.write("### Live Spreadsheet Editor")
                st.caption("Double-click any cell in the right-side columns to edit. Check the leftmost boxes to delete multiple rows.")
                
                df = pd.DataFrame(filtered_inv)
                df["is_bulk_deal"] = df["is_bulk_deal"].astype(bool)
                df["Profit ($)"] = df["sticker_price"] - df["purchase_price"]
                
                df = df[["id", "card_name", "card_number", "rarity", "set_name", "variant", "condition", "live_market", "market_date", "purchase_price", "sticker_price", "Profit ($)", "is_bulk_deal", "date_bought"]]
                df.columns = ["ID", "Card", "Card #", "Rarity", "Set", "Variant", "Condition", "Market ($)", "Market Date", "Paid ($)", "Sticker ($)", "Profit ($)", "Bulk Deal", "Date"]
                
                df.insert(0, "Delete", False)
                
                edited_df = st.data_editor(
                    df, 
                    hide_index=True, 
                    use_container_width=True,
                    disabled=["ID", "Card", "Card #", "Rarity", "Set", "Variant", "Market ($)", "Market Date", "Profit ($)"], 
                    key="inventory_editor"
                )
                
                action_col, dl_col, del_col = st.columns([1, 1.25, 1])
                
                with action_col:
                    if st.button("Save Edits to Cloud", type="primary", use_container_width=True):
                        with st.spinner("Pushing updates to Turso..."):
                            update_inventory_bulk(edited_df)
                        st.success("Cloud synced successfully!")
                        time.sleep(1)
                        st.rerun()
                        
                with dl_col:
                    csv_df = edited_df.drop(columns=["Delete"])
                    csv = csv_df.to_csv(index=False).encode('utf-8')
                    st.download_button(
                        label="Download CSV for Accounting",
                        data=csv,
                        file_name=f"pokequant_active_inventory_{date.today()}.csv",
                        mime="text/csv",
                        use_container_width=True
                    )
                    
                with del_col:
                    checked_count = len(edited_df[edited_df["Delete"] == True])
                    if st.button(f"Delete Selected ({checked_count})", type="primary", use_container_width=True, disabled=(checked_count == 0)):
                        with st.spinner("Deleting from cloud..."):
                            ids_to_del = edited_df[edited_df["Delete"] == True]["ID"].tolist()
                            delete_inventory_items_bulk(ids_to_del)
                        st.rerun()

    # --- TAB 2: VENDILOT-STYLE PERFORMANCE ANALYTICS ---
    with inv_tab2:
        if not sold_inv:
            st.info("No sales recorded yet! Mark cards as 'Sold' from your Active Inventory to start generating performance graphs.")
        else:
            total_realized_rev = sum(item["sold_price"] for item in sold_inv)
            total_cost_basis = sum(item["purchase_price"] for item in sold_inv)
            total_realized_profit = total_realized_rev - total_cost_basis
            avg_margin_pct = (total_realized_profit / total_realized_rev * 100) if total_realized_rev > 0 else 0.0

            m1, m2, m3, m4 = st.columns(4)
            m1.metric("Total Revenue", f"${total_realized_rev:.2f}")
            m2.metric("Realized Profit", f"${total_realized_profit:.2f}")
            m3.metric("Profit Margin", f"{avg_margin_pct:.1f}%")
            m4.metric("Cards Sold", len(sold_inv))

            st.divider()

            # --- PERFORMANCE TIMELINE GRAPH ---
            st.write("### Performance Growth & Revenue Timeline")
            
            sold_df = pd.DataFrame(sold_inv)
            sold_df['date_sold'] = pd.to_datetime(sold_df['date_sold'], errors='coerce')
            sold_df = sold_df.dropna(subset=['date_sold']).sort_values('date_sold')
            
            if not sold_df.empty:
                # Daily aggregated performance
                daily_perf = sold_df.groupby(sold_df['date_sold'].dt.date).agg(
                    Daily_Revenue=('sold_price', 'sum'),
                    Daily_Cost=('purchase_price', 'sum')
                ).reset_index()
                
                daily_perf['Daily_Profit'] = daily_perf['Daily_Revenue'] - daily_perf['Daily_Cost']
                daily_perf['Cumulative_Profit'] = daily_perf['Daily_Profit'].cumsum()
                daily_perf.set_index('date_sold', inplace=True)

                st.caption("Cumulative Net Profit Over Time ($)")
                st.line_chart(daily_perf[['Cumulative_Profit']], color="#10B981")

                st.caption("Daily Revenue vs Daily Cost Basis ($)")
                st.bar_chart(daily_perf[['Daily_Revenue', 'Daily_Cost']])

            st.divider()

            # --- DETAILED SALES HISTORY LOG ---
            st.write("### Completed Sales Log")
            st.caption("Review individual transactions or undo accidental sales.")

            for s_item in sold_inv:
                s_profit = s_item['sold_price'] - s_item['purchase_price']
                s_pct = (s_profit / s_item['purchase_price'] * 100) if s_item['purchase_price'] > 0 else 0.0
                
                sc1, sc2, sc3, sc4, sc5 = st.columns([3, 1.5, 1.5, 1.5, 1])
                with sc1:
                    st.write(f"**{s_item['card_name']}** (#{s_item['card_number']}) - {s_item['condition']}")
                    st.caption(f"Sold on: {s_item['date_sold']}")
                with sc2:
                    st.write(f"Paid: **${s_item['purchase_price']:.2f}**")
                with sc3:
                    st.write(f"Sold: **${s_item['sold_price']:.2f}**")
                with sc4:
                    st.write(f"Profit: :green[**+${s_profit:.2f}** ({s_pct:+.1f}%)]")
                with sc5:
                    if st.button("Undo", key=f"undo_{s_item['id']}", use_container_width=True, help="Move card back to Active Inventory"):
                        with st.spinner("Reverting sale..."):
                            undo_inventory_sale(s_item['id'])
                        st.rerun()
                st.divider()
