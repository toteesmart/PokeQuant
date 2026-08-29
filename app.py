import streamlit as st
import urllib.parse
import math
import time
import pandas as pd
import re
import base64
import io
import os
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
    get_last_updated_date,
    get_vendor_settings,
    save_vendor_settings,
    DEFAULT_SETTINGS
)

st.set_page_config(page_title="PokeQuant", layout="wide")

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

if "vendor_settings" not in st.session_state: st.session_state.vendor_settings = get_vendor_settings()
if "cart" not in st.session_state: st.session_state.cart = []
if "current_page" not in st.session_state: st.session_state.current_page = 1
if "last_query" not in st.session_state: st.session_state.last_query = ""
if "last_rarity" not in st.session_state: st.session_state.last_rarity = "All"
if "last_max_price" not in st.session_state: st.session_state.last_max_price = 0.0
if "last_product_type" not in st.session_state: st.session_state.last_product_type = "All"
if "last_sort" not in st.session_state: st.session_state.last_sort = "Newest"
if "import_stage" not in st.session_state: st.session_state.import_stage = 0
if "import_df" not in st.session_state: st.session_state.import_df = None
if "current_match_idx" not in st.session_state: st.session_state.current_match_idx = 0
if "matched_cards" not in st.session_state: st.session_state.matched_cards = []

def fetch_tcgplayer_data(url: str):
    match = re.search(r'/product/(\d+)', url)
    if not match: return None
    try:
        res = curl_requests.get(url, impersonate="chrome", timeout=10)
        soup = BeautifulSoup(res.text, 'html.parser')
        name, set_name, rarity, number = "Unknown Name", "Unknown Set", "N/A", "N/A"
        
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
            
        labels = soup.find_all('span', class_='product-attributes__lbl')
        vals = soup.find_all('span', class_='product-attributes__value')
        for l, v in zip(labels, vals):
            if "Rarity" in l.text.strip(): rarity = v.text.strip()
            if "Number" in l.text.strip(): number = v.text.strip()
                
        return {"product_id": int(match.group(1)), "card_name": name, "set_name": set_name, "card_number": number, "rarity": rarity}
    except Exception: return None

def format_trend(val):
    if val == "N/A": return "N/A"
    if val.startswith("+"): return f":green[{val} ↗]"
    if val.startswith("-"): return f":red[{val} ↘]"
    return f":gray[{val} =]"

def calculate_sticker_price(market_price, rules):
    if market_price <= 0: return 0.0
    mode = rules.get("mode", "Custom Cutoff")
    min_price = float(rules.get("min_sticker_price", 1.0))
    cutoff = float(rules.get("cutoff_threshold", 0.30))
    
    if mode == "Exact Market": sticker = round(market_price, 2)
    elif mode == "Always Ceil ($1)": sticker = float(math.ceil(market_price))
    elif mode == "Custom Cutoff":
        decimal = market_price % 1
        sticker = float(math.floor(market_price)) if decimal <= cutoff else float(math.ceil(market_price))
    elif mode == "Ending in .99": sticker = math.floor(market_price) + 0.99
    else: sticker = round(market_price, 2)
    return max(min_price, sticker)

def get_live_item_sticker(item, settings, market_price=None):
    if market_price is None: market_price = float(item.get('live_market', 0.0))
    if item.get('product_id', 0) > 0 and market_price > 0:
        cond = item.get('condition', 'Near Mint')
        ratio = settings["condition_ratios"].get(cond, 1.0)
        adj_mkt = market_price * ratio
        return calculate_sticker_price(adj_mkt, settings["sticker_rules"])
    return float(item.get('sticker_price', 0.0))

def format_delta_pill(delta_val):
    if delta_val > 0: return f":green[+${delta_val:.2f}]"
    elif delta_val < 0: return f":red[-${abs(delta_val):.2f}]"
    return ":gray[$0.00]"

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
page = st.sidebar.radio("Navigation", ["Search & Buy", "Mobile Scanner", "My Cloud Inventory", "Vendor Settings"])

st.sidebar.divider()
st.sidebar.caption("**Local DB Status**")
st.sidebar.caption(f"Last Sync: {get_last_updated_date()}")

if page == "Search & Buy":
    st.title("PokeQuant")
    st.write("Live offline pricing and offer calculator.")

    query = st.text_input("Search for a card:", placeholder="e.g. Pikachu 276, Mega Latias 100, Ninjask 137")

    with st.expander("Advanced Filters & Sorting", expanded=False):
        f_col1, f_col2 = st.columns(2)
        with f_col1:
            selected_rarity = st.selectbox("Rarity", ["All", "Common", "Uncommon", "Rare", "Holo Rare", "Double Rare", "Ultra Rare", "Illustration Rare", "Special Illustration Rare", "Mega Attack Rare", "Mega Hyper Rare", "Shiny Rare", "Hyper Rare", "Secret Rare", "Promo"])
            selected_product = st.selectbox("Product Type", ["All", "Cards Only", "Sealed Only"])
        with f_col2:
            selected_sort = st.selectbox("Sort By", ["Newest", "Price: High to Low", "Price: Low to High", "Oldest"])
            selected_max_price = st.number_input("Max Market Price ($)", min_value=0.0, value=0.0, step=1.0, help="Leave at 0.0 for no limit")

    if (query != st.session_state.last_query or selected_rarity != st.session_state.last_rarity or selected_max_price != st.session_state.last_max_price or selected_product != st.session_state.last_product_type or selected_sort != st.session_state.last_sort):
        st.session_state.current_page = 1
        st.session_state.last_query = query
        st.session_state.last_rarity = selected_rarity
        st.session_state.last_max_price = selected_max_price
        st.session_state.last_product_type = selected_product
        st.session_state.last_sort = selected_sort

    if query or selected_rarity != "All" or selected_max_price > 0 or selected_product != "All" or selected_sort != "Newest":
        with st.spinner("Searching database..."):
            results, total_pages, total_count = search_cards_paginated(
                query=query, rarity=selected_rarity, max_price=selected_max_price, product_type=selected_product, sort_by=selected_sort, page=st.session_state.current_page, page_size=20, buy_tiers=st.session_state.vendor_settings["buy_tiers"]
            )

            if not results:
                st.warning("No matches found in the local database.")
            else:
                st.write(f"**Found {total_count} matching items** (Page {st.session_state.current_page} of {total_pages})")
                
                for card in results:
                    with st.container():
                        img_col, data_col = st.columns([1, 2.5])

                        with img_col:
                            # Render locally cached base64 image if available, else fallback to live TCGPlayer CDN
                            if card.get('image_base64'):
                                st.image(f"data:image/jpeg;base64,{card['image_base64']}", width="stretch")
                            else:
                                st.image(f"https://tcgplayer-cdn.tcgplayer.com/product/{int(card['product_id'])}_200w.jpg", width="stretch")

                        with data_col:
                            st.subheader(f"{card['card_name']} #{card['card_number']}")
                            st.caption(f"Set: {card['set']}")

                            for p in card["pricing"]:
                                col1, col2, col3 = st.columns(3)
                                col1.metric("Variant", p["variant"])
                                col2.metric("NM Market", f"${p['market_price']:.2f}", p["30d_trend"] if p["30d_trend"] != "N/A" else None)
                                col3.metric("NM Offer", f"${p['cash_offer']:.2f}")

                                st.caption(f"**Velocity:** 1d: {format_trend(p['1d_trend'])} | 3d: {format_trend(p['3d_trend'])} | 7d: {format_trend(p['7d_trend'])} | 30d: {format_trend(p['30d_trend'])}")

                                cond_col, btn_col, inv_col = st.columns([1.5, 1, 1])
                                
                                cond_options_dict = st.session_state.vendor_settings["condition_ratios"]
                                cond_display = {f"{k} ({int(v*100)}%)": v for k, v in cond_options_dict.items() if k != "Unknown"}
                                
                                with cond_col:
                                    selected_cond_str = st.selectbox("Condition", options=list(cond_display.keys()), key=f"cond_{card['product_id']}_{p['variant']}", label_visibility="collapsed")
                                    
                                ratio = cond_display[selected_cond_str]
                                adj_market = p["market_price"] * ratio
                                new_offer = calculate_buy_offer(adj_market, st.session_state.vendor_settings["buy_tiers"])

                                with btn_col:
                                    if st.button("Add to Lot", key=f"add_{card['product_id']}_{p['variant']}", use_container_width=True):
                                        st.session_state.cart.append({
                                            "product_id": card["product_id"], "name": card["card_name"], "number": card["card_number"], "set": card["set"],
                                            "variant": f"{p['variant']} - {selected_cond_str.split(' (')[0]}", "market_price": adj_market, "buy_percentage": f"{new_offer['buy_rate_pct']}%", "cash_offer": new_offer["cash_offer"]
                                        })
                                        st.rerun()

                                with inv_col:
                                    with st.popover("Log Item", use_container_width=True):
                                        st.markdown(f"**Log {card['card_name']}**")
                                        buy_price = st.number_input("Amount Paid ($)", value=float(new_offer["cash_offer"]), min_value=0.0, step=1.0, key=f"inv_buy_{card['product_id']}_{p['variant']}")
                                        s_price = calculate_sticker_price(adj_market, st.session_state.vendor_settings["sticker_rules"])
                                        sticker_price = st.number_input("Sticker Price ($)", value=s_price, min_value=0.0, step=1.0, key=f"inv_stick_{card['product_id']}_{p['variant']}")
                                        date_bought = st.date_input("Date Bought", value=date.today(), key=f"inv_date_{card['product_id']}_{p['variant']}")
                                        is_bulk = st.checkbox("Part of Bulk Deal?", key=f"inv_bulk_{card['product_id']}_{p['variant']}")
                                        
                                        if st.button("Save to Cloud Inventory", type="primary", key=f"inv_save_{card['product_id']}_{p['variant']}"):
                                            with st.spinner("Pushing to Turso..."):
                                                add_inventory_item(card['product_id'], card['card_name'], card['card_number'], card['set'], p['variant'], selected_cond_str.split(' (')[0], buy_price, sticker_price, date_bought, is_bulk)
                                            st.success("Item Logged!")
                                            time.sleep(1)
                                            st.rerun()

                        with st.expander("View Last Sold on eBay"):
                            st.caption("Cloud servers are blocked by eBay's bot detection. Tap below to view completed sales securely on your device.")
                            encoded_query = urllib.parse.quote(f"{card['card_name']} {card['card_number']} {card['set']} pokemon")
                            st.link_button("Open eBay Sold Comps", f"https://www.ebay.com/sch/i.html?_nkw={encoded_query}&LH_Sold=1&LH_Complete=1&_sop=13", type="primary")

                        st.divider()
                
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

        m1, m2, m3 = st.columns(3)
        m1.metric("Total Market", f"${total_market:.2f}")
        m2.metric("Total Cash Offer", f"${total_offer:.2f}")
        m3.metric("Effective Lot Rate", f"{round((total_offer / total_market * 100), 1) if total_market > 0 else 0.0}%")

        if st.button("Clear Lot", type="secondary", use_container_width=True):
            st.session_state.cart = []
            st.rerun()

elif page == "Mobile Scanner":
    st.title("Mobile Deal Scanner")
    st.caption("Snap a picture of a card to instantly pull its market value, calculated cash offer, and price velocity.")
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        try:
            api_key = st.secrets.get("GEMINI_API_KEY")
        except Exception:
            pass

    if not api_key:
        st.warning("Please configure your GEMINI_API_KEY in Streamlit Secrets or Environment Variables to enable the AI Scanner.")
    else:
        img_file_buffer = st.camera_input("Take a picture of the card")
        
        if img_file_buffer is not None:
            with st.spinner("Analyzing card with Gemini Vision..."):
                try:
                    from google import genai
                    from google.genai import types
                    import json
                    
                    client = genai.Client(api_key=api_key)
                    image = Image.open(img_file_buffer)
                    
                    prompt = """Analyze this Pokemon card. 
Extract the primary card name, the set name (if identifiable from the symbol, art, or copyright), and the card number (e.g. 025/165).
Return ONLY a valid JSON object with the keys: "card_name", "set_name", "card_number". 
If you cannot identify a field, return "Unknown". Do not wrap in markdown or backticks."""
                    
                    response = client.models.generate_content(
                        model='gemini-3.6-flash',
                        contents=[prompt, image],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.1
                        )
                    )
                    
                    clean_text = response.text.replace("```json", "").replace("