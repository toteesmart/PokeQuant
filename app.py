import streamlit as st
import urllib.parse
import math
import time
import pandas as pd
import re
import base64
import io
import os
import json
import sqlite3
from PIL import Image
from datetime import date, timedelta
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as curl_requests
except ImportError:
    curl_requests = None

from card_tool import (
    search_cards_paginated, 
    search_card_and_pricing,
    calculate_buy_offer, 
    add_inventory_item, 
    get_inventory, 
    update_inventory_bulk,
    update_inventory_item_full,
    delete_inventory_items_bulk,
    mark_inventory_sold,
    undo_inventory_sale,
    get_last_updated_date,
    get_vendor_settings,
    save_vendor_settings,
    DEFAULT_SETTINGS,
    DB_NAME,
    sync_with_cloud,
    get_pending_sync_count,
    get_turso_credentials,
    save_turso_credentials,
    turso_execute_sync,
    get_local_sync_time,
    get_remote_sync_time,
    save_local_sync_time,
    update_sticker_prices_bulk
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

if "vendor_settings" not in st.session_state:
    st.session_state.vendor_settings = get_vendor_settings()
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
if "import_stage" not in st.session_state:
    st.session_state.import_stage = 0
if "import_df" not in st.session_state:
    st.session_state.import_df = None
if "current_match_idx" not in st.session_state:
    st.session_state.current_match_idx = 0
if "matched_cards" not in st.session_state:
    st.session_state.matched_cards = []

def fetch_tcgplayer_data(url: str):
    if curl_requests is None:
        return None
    match = re.search(r'/product/(\d+)', url)
    if not match:
        return None
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
            if name_tag:
                name = name_tag.text.strip()
        if set_name == "Unknown Set":
            set_tag = soup.find('a', class_='product-details__set')
            if set_tag:
                set_name = set_tag.text.strip()
            
        labels = soup.find_all('span', class_='product-attributes__lbl')
        vals = soup.find_all('span', class_='product-attributes__value')
        for l, v in zip(labels, vals):
            if "Rarity" in l.text.strip():
                rarity = v.text.strip()
            if "Number" in l.text.strip():
                number = v.text.strip()
                
        return {"product_id": int(match.group(1)), "card_name": name, "set_name": set_name, "card_number": number, "rarity": rarity}
    except Exception:
        return None

def format_trend(val):
    if val == "N/A":
        return "N/A"
    if val.startswith("+"):
        return f":green[{val} (+)]"
    if val.startswith("-"):
        return f":red[{val} (-)]"
    return f":gray[{val} (=)]"

def calculate_sticker_price(market_price, rules):
    if market_price <= 0:
        return 0.0
    mode = rules.get("mode", "Custom Cutoff")
    min_price = float(rules.get("min_sticker_price", 1.0))
    cutoff = float(rules.get("cutoff_threshold", 0.30))
    
    if mode == "Exact Market":
        sticker = round(market_price, 2)
    elif mode == "Always Ceil ($1)":
        sticker = float(math.ceil(market_price))
    elif mode == "Standard Rounding":
        sticker = float(math.floor(market_price + 0.5))
    elif mode == "Custom Cutoff":
        decimal = round(market_price - math.floor(market_price), 2)
        sticker = float(math.floor(market_price)) if decimal <= cutoff else float(math.ceil(market_price))
    elif mode == "Ending in .99":
        sticker = float(math.floor(market_price)) + 0.99
    else:
        decimal = round(market_price - math.floor(market_price), 2)
        sticker = float(math.floor(market_price)) if decimal <= cutoff else float(math.ceil(market_price))
        
    return max(min_price, sticker)

def get_live_item_sticker(item, settings, market_price=None):
    if market_price is None:
        market_price = float(item.get('live_market', 0.0))
    if item.get('product_id', 0) > 0 and market_price > 0:
        cond = item.get('condition', 'Near Mint')
        ratio = settings["condition_ratios"].get(cond, 1.0)
        adj_mkt = market_price * ratio
        return calculate_sticker_price(adj_mkt, settings["sticker_rules"])
    return float(item.get('sticker_price', 0.0))

def format_delta_pill(delta_val):
    if delta_val > 0:
        return f":green[+${delta_val:.2f}]"
    elif delta_val < 0:
        return f":red[-${abs(delta_val):.2f}]"
    return ":gray[$0.00]"

def get_rarity_pill_style(rarity: str) -> str:
    r = str(rarity).lower()
    
    if any(k in r for k in ["illustration rare", "special illustration", "sir", "hyper rare", "secret", "mega hyper rare"]):
        return "background-color: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid #8b5cf6;"
        
    elif "double rare" in r:
        return "background-color: rgba(234, 179, 8, 0.15); color: #ca8a04; border: 1px solid #eab308;"
        
    elif "mega attack rare" in r:
        return "background-color: rgba(234, 88, 12, 0.15); color: #ea580c; border: 1px solid #ea580c;"
        
    elif any(k in r for k in ["ultra rare", "holo rare", "vmax", "vstar", "ex"]):
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
page = st.sidebar.radio("Navigation", ["Search & Buy", "My Cloud Inventory", "Vendor Settings"])

st.sidebar.divider()
st.sidebar.caption("**Local DB Status**")
st.sidebar.caption(f"Last Price Sync: {get_last_updated_date()}")

st.sidebar.divider()
st.sidebar.caption("**Cloud Synchronization**")

@st.fragment(run_every="30s")
def render_sync_module():
    pending_count = get_pending_sync_count()
    
    if pending_count > 0:
        st.sidebar.warning(f"Offline Mode ({pending_count} pending updates)")
    else:
        local_time = get_local_sync_time()
        remote_time = get_remote_sync_time()
        
        if remote_time > local_time:
            st.sidebar.error("**Remote Update Detected!**\n\nAnother device updated the cloud inventory.")
        else:
            st.sidebar.markdown(
                """
                <div style="text-align: center; background-color: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid #22c55e; border-radius: 6px; padding: 6px; font-size: 0.9em; font-weight: 600; margin-bottom: 12px;">
                    Cloud is synced
                </div>
                """, 
                unsafe_allow_html=True
            )

    if st.sidebar.button("Sync with Turso Cloud", use_container_width=True):
        with st.spinner("Pushing updates and downloading fresh inventory..."):
            success, msg = sync_with_cloud()
            if success:
                st.session_state["vendor_settings"] = get_vendor_settings() 
                time.sleep(1)
                st.rerun()
            else:
                st.sidebar.error(msg)
                
    if st.sidebar.button("Sync New Sticker Prices", use_container_width=True):
        with st.spinner("Recalculating live prices..."):
            all_inv_data = get_inventory()
            updates = []
            
            for item in all_inv_data:
                if not item.get('is_sold'):
                    new_price = get_live_item_sticker(item, st.session_state.vendor_settings)
                    current_price = float(item.get('sticker_price', 0.0))
                    
                    if new_price != current_price:
                        updates.append((new_price, item['id']))
            
            if updates:
                update_sticker_prices_bulk(updates)
                st.sidebar.success(f"Updated {len(updates)} prices!")
                time.sleep(1.5)
                st.rerun()
            else:
                st.sidebar.info("All prices match current live market.")

render_sync_module()

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
                            if card.get('image_base64'):
                                st.image(f"data:image/jpeg;base64,{card['image_base64']}", use_container_width=True)
                            else:
                                st.image(f"https://tcgplayer-cdn.tcgplayer.com/product/{int(card['product_id'])}_200w.jpg", use_container_width=True)

                        with data_col:
                            st.subheader(f"{card['card_name']} #{card['card_number']}")
                            st.caption(f"Set: {card['set']}")

                            for p in card["pricing"]:
                                col1, col2, col3 = st.columns(3)
                                col1.metric("Variant", p["variant"])
                                col2.metric("NM Market", f"${p['market_price']:.2f}", p["30d_trend"] if p["30d_trend"] != "N/A" else None)
                                col3.metric("NM Offer", f"${p['cash_offer']:.2f}")

                                st.caption(f"**Velocity:** 1d: {format_trend(p['1d_trend'])} | 3d: {format_trend(p['3d_trend'])} | 7d: {format_trend(p['7d_trend'])} | 30d: {format_trend(p['30d_trend'])}")
                                st.markdown(f"<div style='font-size: 0.8em; color: var(--text-color); opacity: 0.8; margin-top: -10px; margin-bottom: 10px;'><strong>90-Day Range:</strong> High: ${p['90d_high']:.2f} | Low: ${p['90d_low']:.2f}</div>", unsafe_allow_html=True)

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
                                        
                                        if st.button("Save to Inventory", type="primary", key=f"inv_save_{card['product_id']}_{p['variant']}"):
                                            with st.spinner("Logging to device..."):
                                                add_inventory_item(card['product_id'], card['card_name'], card['card_number'], card['set'], p['variant'], selected_cond_str.split(' (')[0], buy_price, sticker_price, date_bought, is_bulk)
                                            st.success("Item Logged")
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

elif page == "My Cloud Inventory":
    st.title("My Cloud Inventory")
    
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
                final_pid, final_name, final_num, final_set, final_b64 = 0, add_name, add_num, add_set, None
                
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
                        try:
                            conn = sqlite3.connect(DB_NAME)
                            conn.execute("INSERT OR REPLACE INTO cards (product_id, card_name, card_number, set_name, rarity) VALUES (?, ?, ?, ?, ?)", (final_pid, final_name, final_num, final_set, fetched["rarity"]))
                            conn.commit()
                            conn.close()
                        except Exception:
                            pass
                
                add_inventory_item(final_pid, final_name or "Unknown Item", final_num or "N/A", final_set or "N/A", add_var, add_cond, add_paid, add_stick, str(add_date), add_bulk, final_b64)
            st.success("Item Added to Device")
            time.sleep(1)
            st.rerun()

    with st.expander("Bulk Import (Excel Wizard)", expanded=False):
        if st.session_state.import_stage == 0:
            st.write("Upload your Excel file to search the database and verify each card before logging.")
            uploaded_file = st.file_uploader("Choose an Excel file", type=["xlsx", "xls"])
            if uploaded_file is not None:
                try:
                    import_df = pd.read_excel(uploaded_file, sheet_name="Totees Cards", header=1).dropna(subset=["Card Name"])
                    if st.checkbox("Skip cards that already have a 'Sold For' entry?", value=True) and "Sold For" in import_df.columns:
                        import_df = import_df[import_df["Sold For"].isna()]
                    st.info(f"Found {len(import_df)} active cards to verify.")
                    if st.button("Start Matching Process", type="primary"):
                        st.session_state.import_df = import_df.reset_index(drop=True)
                        st.session_state.import_stage, st.session_state.current_match_idx, st.session_state.matched_cards = 1, 0, []
                        st.rerun()
                except Exception as e:
                    st.error(f"Error reading file. Details: {e}")
                    
        elif st.session_state.import_stage == 1:
            df, idx = st.session_state.import_df, st.session_state.current_match_idx
            st.progress((idx) / len(df))
            st.write(f"### Verifying Card {idx + 1} of {len(df)}")
            
            row = df.iloc[idx]
            raw_name, excel_cond, excel_cost, excel_sticker = str(row["Card Name"]), str(row.get("Condition", "Unknown")), float(row.get("Cost", 0.0) if pd.notna(row.get("Cost")) else 0.0), float(row.get("Sticker Priced", 0.0) if pd.notna(row.get("Sticker Priced")) else 0.0)
            st.info(f"**From Excel:** {raw_name} | Condition: {excel_cond}")
            
            refined_query = st.text_input("Refine Search Query:", value=raw_name, key=f"refine_{idx}")
            matches = search_card_and_pricing(refined_query, limit=5, buy_tiers=st.session_state.vendor_settings["buy_tiers"])
            
            if not matches:
                st.warning("No matches found in database. Edit the query above or skip/import as legacy.")
                selected_match = "Legacy Import (No Database Link)"
            else:
                match_dict = {f"{m['card_name']} #{m['card_number']} [{m['set']}] - {p['variant']}": {"product_id": m["product_id"], "card_name": m["card_name"], "card_number": m["card_number"], "set_name": m["set"], "variant": p["variant"], "market_price": p["market_price"]} for m in matches for p in m["pricing"]}
                selected_match = st.selectbox("Select the correct match from the database:", list(match_dict.keys()) + ["Legacy Import (No Database Link)"], key=f"select_{idx}")
                
                if selected_match != "Legacy Import (No Database Link)":
                    sel_data = match_dict[selected_match]
                    col1, col2 = st.columns([1, 2])
                    with col1:
                        st.image(f"https://tcgplayer-cdn.tcgplayer.com/product/{int(sel_data['product_id'])}_200w.jpg", use_container_width=True)
                    with col2:
                        st.write(f"**Set:** {sel_data['set_name']}\n**Live NM Market Price:** ${sel_data['market_price']:.2f}")

            c_skip, c_next = st.columns(2)
            with c_skip:
                if st.button("Skip This Card", use_container_width=True):
                    st.session_state.current_match_idx += 1
                    if st.session_state.current_match_idx >= len(df):
                        st.session_state.import_stage = 2
                    st.rerun()
            with c_next:
                if st.button("Confirm Match & Next", type="primary", use_container_width=True):
                    st.session_state.matched_cards.append({
                        "product_id": 0 if selected_match == "Legacy Import (No Database Link)" else sel_data["product_id"],
                        "card_name": raw_name if selected_match == "Legacy Import (No Database Link)" else sel_data["card_name"],
                        "card_number": "N/A" if selected_match == "Legacy Import (No Database Link)" else sel_data["card_number"],
                        "set_name": "Legacy Excel Import" if selected_match == "Legacy Import (No Database Link)" else sel_data["set_name"],
                        "variant": "Normal" if selected_match == "Legacy Import (No Database Link)" else sel_data["variant"],
                        "condition": excel_cond,
                        "market_price": float(row.get("Market Price (NM)", 0.0) if pd.notna(row.get("Market Price (NM)")) else 0.0) if selected_match == "Legacy Import (No Database Link)" else sel_data["market_price"],
                        "purchase_price": excel_cost, "sticker_price": excel_sticker, "date_bought": str(date.today()), "is_bulk_deal": False
                    })
                    st.session_state.current_match_idx += 1
                    if st.session_state.current_match_idx >= len(df):
                        st.session_state.import_stage = 2
                    st.rerun()
                    
        elif st.session_state.import_stage == 2:
            st.success(f"Matched {len(st.session_state.matched_cards)} cards successfully")
            is_lot = st.checkbox("Did you buy these cards as a lot for a single flat price?")
            lot_total = st.number_input("Total Amount Paid for Lot ($)", min_value=0.0, step=1.0, value=100.0) if is_lot else 0.0
            
            c_can, c_fin = st.columns(2)
            with c_can:
                if st.button("Cancel Import", use_container_width=True):
                    st.session_state.import_stage, st.session_state.matched_cards = 0, []
                    st.rerun()
            with c_fin:
                if st.button("Import to Device", type="primary", use_container_width=True):
                    total_market = sum(c["market_price"] for c in st.session_state.matched_cards)
                    with st.spinner("Logging to device..."):
                        for c in st.session_state.matched_cards:
                            add_inventory_item(c["product_id"], c["card_name"], c["card_number"], c["set_name"], c["variant"], c["condition"], round((c["market_price"] / total_market) * lot_total, 2) if is_lot and total_market > 0 else c["purchase_price"], c["sticker_price"], c["date_bought"], True if is_lot and total_market > 0 else False)
                    st.session_state.import_stage, st.session_state.matched_cards = 0, []
                    st.success("Import complete")
                    time.sleep(1.5)
                    st.rerun()

    all_inv_data = get_inventory()
        
    active_inv = [x for x in all_inv_data if not x.get('is_sold')]
    sold_inv = [x for x in all_inv_data if x.get('is_sold')]

    inv_tab1, inv_tab2 = st.tabs(["Active Inventory", "Sales & Performance Analytics"])

    with inv_tab1:
        if not active_inv:
            st.info("Your active inventory is empty. Add cards from Search & Buy or mark some sold cards as active.")
        else:
            total_cost = sum(item["purchase_price"] for item in active_inv)
            total_live_revenue = sum(get_live_item_sticker(item, st.session_state.vendor_settings) for item in active_inv)
            total_live_profit = total_live_revenue - total_cost

            profit_1d = sum(get_live_item_sticker(item, st.session_state.vendor_settings, item.get('market_1d', item.get('live_market', 0.0))) for item in active_inv) - total_cost
            profit_3d = sum(get_live_item_sticker(item, st.session_state.vendor_settings, item.get('market_3d', item.get('live_market', 0.0))) for item in active_inv) - total_cost
            profit_7d = sum(get_live_item_sticker(item, st.session_state.vendor_settings, item.get('market_7d', item.get('live_market', 0.0))) for item in active_inv) - total_cost

            delta_1d, delta_3d, delta_7d = total_live_profit - profit_1d, total_live_profit - profit_3d, total_live_profit - profit_7d
            
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Active Assets", len(active_inv))
            c2.metric("Total Cost Basis", f"${total_cost:.2f}")
            c3.metric("Live Proj. Revenue", f"${total_live_revenue:.2f}")
            c4.metric("Live Proj. Gross Profit", f"${total_live_profit:.2f}", delta=f"{delta_1d:+.2f} (24h)" if delta_1d != 0 else None)

            with st.expander(f"**Profit Velocity Breakdown (Live Market Shifts)** &nbsp;&nbsp;|&nbsp;&nbsp; 1-Day: {format_delta_pill(delta_1d)} &nbsp;|&nbsp; 3-Day: {format_delta_pill(delta_3d)} &nbsp;|&nbsp; 1-Week: {format_delta_pill(delta_7d)}"):
                def build_breakdown(active_items, period_key):
                    changes = {}
                    for item in active_items:
                        live_mkt = float(item.get('live_market', 0.0))
                        past_mkt = float(item.get(period_key, live_mkt))
                        
                        live_s = get_live_item_sticker(item, st.session_state.vendor_settings)
                        past_s = get_live_item_sticker(item, st.session_state.vendor_settings, past_mkt)
                        diff = live_s - past_s
                        
                        if diff != 0:
                            pid = item.get('product_id', 0)
                            key = f"{item.get('card_name', 'Unknown')}|{item.get('card_number', 'N/A')}|{item.get('set_name', 'N/A')}|{item.get('condition', 'Near Mint')}|{item.get('variant', 'Normal')}|{pid}"
                            if key not in changes:
                                mkt_diff = live_mkt - past_mkt
                                changes[key] = {
                                    "product_id": pid, "card_name": item.get('card_name', 'Unknown'), "card_number": item.get('card_number', 'N/A'),
                                    "set_name": item.get('set_name', 'N/A'), "condition": item.get('condition', 'Near Mint'), "rarity": item.get('rarity', 'N/A'),
                                    "variant": item.get('variant', 'Normal'), "custom_image_data": item.get('custom_image_data', None), "Qty": 0,
                                    "old_mkt": past_mkt, "new_mkt": live_mkt, "mkt_diff": mkt_diff, "mkt_pct": ((mkt_diff) / past_mkt * 100) if past_mkt > 0 else 0.0,
                                    "old_sticker": past_s, "new_sticker": live_s, "unit_delta": diff, "total_impact": 0.0,
                                }
                            changes[key]["Qty"] += 1
                            changes[key]["total_impact"] += diff
                    
                    items_list = list(changes.values())
                    items_list.sort(key=lambda x: abs(x["total_impact"]), reverse=True)
                    return items_list

                vel_top_c1, vel_top_c2 = st.columns([2, 3])
                with vel_top_c1:
                    vel_view_mode = st.radio("Breakdown Layout", ["Mini Floating Cards", "Data Grid / Table"], horizontal=True, key="vel_layout_mode")

                def render_velocity_breakdown(items_list, mode, empty_msg):
                    if not items_list:
                        return st.info(empty_msg)
                    if mode == "Data Grid / Table":
                        table_rows = [{"Asset": f"{v['card_name']} #{v['card_number']} - {v['set_name']} ({v['condition']})", "Qty": v["Qty"], "Old Market ($)": f"${v['old_mkt']:.2f}", "New Market ($)": f"${v['new_mkt']:.2f}", "Market Shift": f"{v['mkt_pct']:+.1f}%", "Old Sticker ($)": f"${v['old_sticker']:.2f}", "New Sticker ($)": f"${v['new_sticker']:.2f}", "Total Impact ($)": f"+${v['total_impact']:.2f}" if v['total_impact'] > 0 else f"-${abs(v['total_impact']):.2f}", "Shift Reason": f"Market changed {v['mkt_pct']:+.1f}% (${v['old_mkt']:.2f} → ${v['new_mkt']:.2f})"} for v in items_list]
                        st.dataframe(pd.DataFrame(table_rows), use_container_width=True, hide_index=True)
                    else:
                        num_cols = 4
                        for row_idx in range(0, len(items_list), num_cols):
                            cols = st.columns(num_cols)
                            for col_idx, col in enumerate(cols):
                                item_idx = row_idx + col_idx
                                if item_idx < len(items_list):
                                    card_item = items_list[item_idx]
                                    with col:
                                        with st.container(border=True):
                                            img_b64 = card_item.get('custom_image_data')
                                            if pd.isna(img_b64) or not isinstance(img_b64, str):
                                                img_b64 = None
                                            
                                            if img_b64:
                                                st.image(f"data:image/jpeg;base64,{img_b64}", use_container_width=True)
                                            elif card_item['product_id'] > 0:
                                                st.image(f"https://tcgplayer-cdn.tcgplayer.com/product/{int(card_item['product_id'])}_200w.jpg", use_container_width=True)
                                            else:
                                                st.markdown("<div style='height: 140px; display: flex; align-items: center; justify-content: center; background: var(--secondary-background-color); border-radius: 6px; color: var(--text-color); font-size: 0.85em; font-weight: bold;'>Legacy Asset (No Image)</div>", unsafe_allow_html=True)

                                            st.markdown(f"""<div style="display: flex; justify-content: space-between; align-items: baseline; min-height: 40px; margin-top: 4px;"><div style="font-weight: 700; font-size: 0.95em; line-height: 1.2; color: var(--text-color);">{card_item['card_name']}</div><div style="font-weight: 600; font-size: 0.8em; color: var(--text-color); opacity: 0.7; margin-left: 4px; white-space: nowrap;">{"#" + card_item['card_number'] if card_item['card_number'] != "N/A" else ""}</div></div>""", unsafe_allow_html=True)
                                            st.markdown(f"""<div style="margin: 4px 0 8px 0; display: flex; gap: 4px; flex-wrap: wrap; align-items: center;"><span style="{get_rarity_pill_style(card_item['rarity'])} border-radius: 4px; font-size: 0.68em; font-weight: 700; padding: 1px 6px; text-transform: uppercase;">{card_item['rarity']}</span><span style="background-color: var(--secondary-background-color); color: var(--text-color); opacity: 0.85; border: 1px solid rgba(148, 163, 184, 0.3); border-radius: 4px; font-size: 0.68em; font-weight: 600; padding: 1px 6px;">{card_item['condition']}</span></div>""", unsafe_allow_html=True)
                                            
                                            impact_color, impact_sign = ("#10b981", "+") if card_item['total_impact'] > 0 else ("#ef4444", "-")
                                            mkt_pct_color = "#10b981" if card_item['mkt_diff'] > 0 else "#ef4444"
                                            
                                            st.markdown(f"""<div style="background-color: var(--secondary-background-color); border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 6px; padding: 6px 8px; font-size: 0.78em; color: var(--text-color); margin-bottom: 6px; line-height: 1.5;"><div style="display: flex; justify-content: space-between;"><span style="opacity: 0.8;">Sticker:</span> <strong>${card_item['old_sticker']:.2f} ➔ ${card_item['new_sticker']:.2f}</strong></div><div style="display: flex; justify-content: space-between;"><span style="opacity: 0.8;">Market:</span> <span>${card_item['old_mkt']:.2f} ➔ ${card_item['new_mkt']:.2f} (<strong style="color: {mkt_pct_color};">{card_item['mkt_pct']:+.1f}%</strong>)</span></div><div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 4px; margin-top: 4px;"><span style="opacity: 0.8;">Impact ({card_item['Qty']}x):</span> <strong style="color: {impact_color}; font-size: 1.05em;">{impact_sign}${abs(card_item['total_impact']):.2f}</strong></div></div>""", unsafe_allow_html=True)

                t1, t2, t3 = st.tabs(["1-Day Breakdown", "3-Day Breakdown", "1-Week Breakdown"])
                with t1:
                    render_velocity_breakdown(build_breakdown(active_inv, 'market_1d'), vel_view_mode, "No sticker price shifts in the last 24 hours.")
                with t2:
                    render_velocity_breakdown(build_breakdown(active_inv, 'market_3d'), vel_view_mode, "No sticker price shifts in the last 3 days.")
                with t3:
                    render_velocity_breakdown(build_breakdown(active_inv, 'market_7d'), vel_view_mode, "No sticker price shifts in the last week.")
            
            st.divider()

            top_ctrl1, top_ctrl2 = st.columns([1.5, 2.5])
            with top_ctrl1:
                view_mode = st.radio("View Layout", ["Floating Cards View", "Data Grid / Table"], horizontal=True)
            with top_ctrl2:
                inv_filter = st.text_input("Filter active inventory:", placeholder="Search by name, set, or card number...")

            filtered_inv = active_inv
            if inv_filter:
                q = inv_filter.lower().strip()
                filtered_inv = [x for x in active_inv if (q in str(x.get('card_name', '')).lower() or q in str(x.get('set_name', '')).lower() or q in str(x.get('card_number', '')).lower() or q in str(x.get('rarity', '')).lower())]

            if view_mode == "Floating Cards View":
                df_inv = pd.DataFrame(filtered_inv)
                if df_inv.empty:
                    st.warning("No cards match your filter.")
                else:
                    grouped_df = df_inv.groupby(['product_id', 'card_name', 'card_number', 'set_name', 'variant', 'condition', 'rarity'], as_index=False).agg(quantity=('id', 'count'), avg_paid=('purchase_price', 'mean'), sticker_price=('sticker_price', 'max'), last_bought=('date_bought', 'max'), custom_image_data=('custom_image_data', 'first'), live_market=('live_market', 'max'), ids=('id', list))
                    st.write(f"Showing **{len(grouped_df)}** unique card listings ({len(filtered_inv)} total assets)")

                    for row_idx in range(0, len(grouped_df), 4):
                        cols = st.columns(4)
                        for col_idx, col in enumerate(cols):
                            item_idx = row_idx + col_idx
                            if item_idx < len(grouped_df):
                                card = grouped_df.iloc[item_idx]
                                with col:
                                    with st.container(border=True):
                                        img_b64 = card.get('custom_image_data')
                                        if pd.isna(img_b64) or not isinstance(img_b64, str):
                                            img_b64 = None
                                        
                                        if img_b64:
                                            st.image(f"data:image/jpeg;base64,{img_b64}", use_container_width=True)
                                        elif card['product_id'] > 0:
                                            st.image(f"https://tcgplayer-cdn.tcgplayer.com/product/{int(card['product_id'])}_200w.jpg", use_container_width=True)
                                        else:
                                            st.markdown("<div style='height: 200px; display: flex; align-items: center; justify-content: center; background: var(--secondary-background-color); border-radius: 8px; color: var(--text-color); font-weight: bold;'>Legacy Asset (No Image)</div>", unsafe_allow_html=True)

                                        st.markdown(f"""<div style="display: flex; justify-content: space-between; align-items: baseline; min-height: 48px; margin-top: 6px;"><div style="font-weight: 700; font-size: 1.05em; line-height: 1.25; color: var(--text-color);">{card['card_name']}</div><div style="font-weight: 600; font-size: 0.85em; color: var(--text-color); opacity: 0.7; margin-left: 6px; white-space: nowrap;">{"#" + card['card_number'] if card['card_number'] != "N/A" else ""}</div></div>""", unsafe_allow_html=True)
                                        st.markdown(f"""<div style="margin: 6px 0 10px 0; display: flex; gap: 5px; flex-wrap: wrap; align-items: center;"><span style="{get_rarity_pill_style(card['rarity'])} border-radius: 6px; font-size: 0.72em; font-weight: 700; padding: 2px 8px; text-transform: uppercase;">{card['rarity']}</span><span style="background-color: var(--secondary-background-color); color: var(--text-color); opacity: 0.9; border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 6px; font-size: 0.72em; font-weight: 600; padding: 2px 8px;">{card['set_name']}</span></div>""", unsafe_allow_html=True)
                                        st.markdown(f"""<div style="font-size: 1.45em; font-weight: 800; color: var(--text-color); margin-bottom: 8px;">${card['sticker_price']:.2f}</div>""", unsafe_allow_html=True)

                                        st.markdown(f"""<div style="background-color: var(--secondary-background-color); border: 1px solid rgba(148, 163, 184, 0.4); border-radius: 8px; padding: 8px 10px; font-size: 0.82em; color: var(--text-color); margin-bottom: 12px; line-height: 1.6;"><div style="display: flex; justify-content: space-between;"><span style="opacity: 0.8;">Live Market:</span> <strong style="color: #3b82f6;">${card['live_market']:.2f}</strong></div><div style="display: flex; justify-content: space-between;"><span style="opacity: 0.8;">Paid Price:</span> <strong>${card['avg_paid']:.2f}</strong></div><div style="display: flex; justify-content: space-between;"><span style="opacity: 0.8;">Sticker Price:</span> <strong>${card['sticker_price']:.2f}</strong></div><div style="display: flex; justify-content: space-between; margin-bottom: 4px;"><span style="opacity: 0.8;">Proj. Profit:</span> <strong style="color: #10b981;">+${(card['sticker_price'] - card['avg_paid']):.2f}</strong></div><div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 4px;"><span style="opacity: 0.8;">Stock:</span> <span>{card['quantity']} ({card['condition']})</span></div></div>""", unsafe_allow_html=True)

                                        btn_c1, btn_c2, btn_c3 = st.columns([1.2, 1.2, 1])

                                        has_unsynced_local = any(int(i) < 0 for i in card['ids'])

                                        with btn_c1:
                                            if has_unsynced_local:
                                                st.info("Sync required before selling or editing this new asset.")
                                            else:
                                                with st.popover("Sold", use_container_width=True):
                                                    st.markdown("**Mark as Sold**")
                                                    st.caption(f"{card['card_name']} ({card['condition']})")
                                                    sell_qty = st.number_input("Quantity Sold", min_value=1, max_value=int(card['quantity']), value=1, key=f"sell_q_{item_idx}") if card['quantity'] > 1 else 1
                                                    
                                                    st.write(f"**Quick Sell at Sticker (${card['sticker_price']:.2f})**")
                                                    today_date, yest_date, two_days_date = date.today(), date.today() - timedelta(days=1), date.today() - timedelta(days=2)
                                                    
                                                    if st.button(f"Today ({today_date.strftime('%a, %b %d')})", type="primary", key=f"q_today_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(today_date))
                                                        st.success("Sale Recorded")
                                                        time.sleep(0.8)
                                                        st.rerun()
                                                    if st.button(f"Yesterday ({yest_date.strftime('%a, %b %d')})", key=f"q_yest_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(yest_date))
                                                        st.success("Sale Recorded")
                                                        time.sleep(0.8)
                                                        st.rerun()
                                                    if st.button(f"2 Days Ago ({two_days_date.strftime('%a, %b %d')})", key=f"q_2days_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(two_days_date))
                                                        st.success("Sale Recorded")
                                                        time.sleep(0.8)
                                                        st.rerun()
                                                    
                                                    st.divider()
                                                    older_date = st.date_input("Older Date", value=two_days_date - timedelta(days=1), max_value=two_days_date - timedelta(days=1), key=f"q_old_d_{item_idx}")
                                                    if st.button("Confirm Older Date", key=f"q_old_btn_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], card['sticker_price'], str(older_date))
                                                        st.success("Sale Recorded")
                                                        time.sleep(0.8)
                                                        st.rerun()
                                                        
                                                    st.divider()
                                                    st.write("**Custom Negotiated Deal**")
                                                    custom_deal = st.number_input("Deal Price ($)", min_value=0.0, value=float(card['sticker_price']), step=1.0, key=f"c_deal_{item_idx}")
                                                    deal_date = st.date_input("Date Sold", value=today_date, key=f"s_date_{item_idx}")
                                                    if st.button("Confirm Custom Deal", key=f"c_sell_btn_{item_idx}", use_container_width=True):
                                                        with st.spinner("Logging custom sale..."):
                                                            mark_inventory_sold(card['ids'][:int(sell_qty)], custom_deal, str(deal_date))
                                                        st.success("Sale Recorded")
                                                        time.sleep(0.8)
                                                        st.rerun()

                                        with btn_c2:
                                            if not has_unsynced_local:
                                                with st.popover("Edit", use_container_width=True):
                                                    st.markdown(f"**Edit Listing ({card['card_name']})**")
                                                    edit_img_up = st.file_uploader("Replace Image", type=["jpg", "jpeg", "png"], key=f"edit_img_{item_idx}")
                                                    tcg_url = st.text_input("TCGplayer URL (Auto-fill)", key=f"url_{item_idx}", placeholder="Paste URL here...")
                                                    new_name = st.text_input("Card Name", value=card['card_name'], key=f"ed_n_{item_idx}")
                                                    new_num = st.text_input("Card Number", value=card['card_number'], key=f"ed_num_{item_idx}")
                                                    new_set = st.text_input("Set Name", value=card['set_name'], key=f"ed_sname_{item_idx}")
                                                    new_var = st.text_input("Variant", value=card['variant'], key=f"ed_var_{item_idx}")
                                                    new_c = st.selectbox("Condition", ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"], index=["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"].index(card['condition']) if card['condition'] in ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged", "Unknown"] else 5, key=f"ed_c_{item_idx}")
                                                    new_paid = st.number_input("Paid ($)", value=float(card['avg_paid']), min_value=0.0, step=1.0, key=f"ed_p_{item_idx}")
                                                    new_stick = st.number_input("Sticker Price ($)", value=float(card['sticker_price']), min_value=0.0, step=1.0, key=f"ed_s_{item_idx}")
                                                    
                                                    try:
                                                        parsed_date = date.fromisoformat(str(card['last_bought']).split(" ")[0])
                                                    except (ValueError, AttributeError):
                                                        parsed_date = date.today()
                                                    new_date = st.date_input("Date Bought", value=parsed_date, key=f"ed_d_{item_idx}")
                                                    
                                                    if st.button("Save Changes", type="primary", key=f"save_btn_{item_idx}", use_container_width=True):
                                                        with st.spinner("Updating..."):
                                                            final_pid, final_name, final_num, final_set, final_b64 = int(card['product_id']), new_name, new_num, new_set, img_b64
                                                            
                                                            if edit_img_up is not None:
                                                                try:
                                                                    img_obj = Image.open(edit_img_up)
                                                                    img_obj.thumbnail((250, 350))
                                                                    buffered = io.BytesIO()
                                                                    img_obj.convert("RGB").save(buffered, format="JPEG", quality=85)
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
                                                                    try:
                                                                        conn = sqlite3.connect(DB_NAME)
                                                                        conn.execute("INSERT OR REPLACE INTO cards (product_id, card_name, card_number, set_name, rarity) VALUES (?, ?, ?, ?, ?)", (final_pid, final_name, final_num, final_set, fetched["rarity"]))
                                                                        conn.commit()
                                                                        conn.close()
                                                                    except Exception:
                                                                        pass
                                                            for target_id in card['ids']:
                                                                update_inventory_item_full(int(target_id), final_pid, final_name, final_num, final_set, new_var, new_c, new_paid, new_stick, str(new_date), final_b64)
                                                        st.success("Updated")
                                                        time.sleep(1)
                                                        st.rerun()

                                        with btn_c3:
                                            if st.button("Delete", key=f"del_card_{item_idx}", use_container_width=True, help="Delete active listing"):
                                                with st.spinner("Deleting..."):
                                                    delete_inventory_items_bulk(card['ids'])
                                                st.rerun()

            else:
                st.write("### Live Spreadsheet Editor")
                st.caption("Double-click any cell in the right-side columns to edit. Check the leftmost boxes to delete multiple rows.")
                
                df = pd.DataFrame(filtered_inv)
                df["is_bulk_deal"] = df["is_bulk_deal"].astype(bool)
                df["Profit ($)"] = df["sticker_price"] - df["purchase_price"]
                
                df = df[["id", "card_name", "card_number", "rarity", "set_name", "variant", "condition", "live_market", "market_date", "purchase_price", "sticker_price", "Profit ($)", "is_bulk_deal", "date_bought"]]
                df.columns = ["ID", "Card", "Card #", "Rarity", "Set", "Variant", "Condition", "Market ($)", "Market Date", "Paid ($)", "Sticker ($)", "Profit ($)", "Bulk Deal", "Date"]
                df.insert(0, "Delete", False)
                
                edited_df = st.data_editor(df, hide_index=True, use_container_width=True, disabled=["ID", "Card", "Card #", "Rarity", "Set", "Variant", "Market ($)", "Market Date", "Profit ($)"], key="inventory_editor")
                
                action_col, dl_col, del_col = st.columns([1, 1.25, 1])
                with action_col:
                    if st.button("Save Edits to Device", type="primary", use_container_width=True):
                        with st.spinner("Saving locally..."):
                            update_inventory_bulk(edited_df)
                        st.success("Edits saved! Remember to sync when online.")
                        time.sleep(1)
                        st.rerun()
                with dl_col:
                    st.download_button(label="Download CSV for Accounting", data=edited_df.drop(columns=["Delete"]).to_csv(index=False).encode('utf-8'), file_name=f"pokequant_active_inventory_{date.today()}.csv", mime="text/csv", use_container_width=True)
                with del_col:
                    checked_count = len(edited_df[edited_df["Delete"] == True])
                    if st.button(f"Delete Selected ({checked_count})", type="primary", use_container_width=True, disabled=(checked_count == 0)):
                        with st.spinner("Deleting..."):
                            delete_inventory_items_bulk(edited_df[edited_df["Delete"] == True]["ID"].tolist())
                        st.rerun()

    with inv_tab2:
        if not sold_inv:
            st.info("No sales recorded yet. Mark cards as 'Sold' from your Active Inventory to start generating performance graphs.")
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

            st.write("### Performance Growth & Revenue Timeline")
            sold_df = pd.DataFrame(sold_inv)
            sold_df['date_sold'] = pd.to_datetime(sold_df['date_sold'], errors='coerce')
            sold_df = sold_df.dropna(subset=['date_sold']).sort_values('date_sold')
            
            if not sold_df.empty:
                daily_perf = sold_df.groupby(sold_df['date_sold'].dt.date).agg(Daily_Revenue=('sold_price', 'sum'), Daily_Cost=('purchase_price', 'sum')).reset_index()
                daily_perf['Daily_Profit'] = daily_perf['Daily_Revenue'] - daily_perf['Daily_Cost']
                daily_perf['Cumulative_Profit'] = daily_perf['Daily_Profit'].cumsum()
                daily_perf.set_index('date_sold', inplace=True)
                st.caption("Cumulative Net Profit Over Time ($)")
                st.line_chart(daily_perf[['Cumulative_Profit']], color="#10B981")
                st.caption("Daily Revenue vs Daily Cost Basis ($)")
                st.bar_chart(daily_perf[['Daily_Revenue', 'Daily_Cost']])
            st.divider()

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

elif page == "Vendor Settings":
    st.title("Vendor Settings")
    st.caption("Customize your buy rates, condition deductions, and floor sticker rounding rules.")

    st.subheader("1. Cloud Sync Credentials")
    st.caption("Enter your Turso database credentials. These are securely saved in your local browser storage for offline access.")
    
    current_url, current_token = get_turso_credentials()
    
    new_url = st.text_input("Turso Database URL", value=current_url, placeholder="https://your-db-org.turso.io")
    new_token = st.text_input("Turso Auth Token", value=current_token, type="password")
    
    col_save, col_test = st.columns([1, 1])
    with col_save:
        if st.button("Save Credentials to Device", use_container_width=True):
            save_turso_credentials(new_url.strip(), new_token.strip())
            st.success("Credentials saved to local storage! You can now Sync.")
            
    with col_test:
        if st.button("Test Connection & Debug Raw Data", use_container_width=True):
            with st.spinner("Testing API Connection..."):
                try:
                    test_url = new_url.strip().replace("libsql://", "https://")
                    if test_url and not test_url.startswith("http"):
                        test_url = f"https://{test_url}"
                        
                    res = turso_execute_sync(
                        [{"sql": "SELECT COUNT(*) as total_items FROM inventory", "args": []}], 
                        override_url=test_url, 
                        override_token=new_token.strip()
                    )
                    item_count = res[0][0].get("total_items", 0) if res and res[0] else 0
                    st.success(f"Connection Successful! Found {item_count} items in remote database.")
                except Exception as e:
                    st.error(f"Execution failed. If this says 'no such table: inventory', your database is brand new and empty. {e}")

    st.divider()

    settings = st.session_state.get("vendor_settings", DEFAULT_SETTINGS)

    st.subheader("2. Table Sticker Pricing Rules")
    s_col1, s_col2, s_col3 = st.columns(3)
    
    s_mode_opts = ["Custom Cutoff", "Standard Rounding", "Always Ceil ($1)", "Exact Market", "Ending in .99"]
    s_mode_idx = s_mode_opts.index(settings["sticker_rules"].get("mode", "Custom Cutoff")) if settings["sticker_rules"].get("mode", "Custom Cutoff") in s_mode_opts else 0
    
    with s_col1:
        s_mode = st.selectbox("Rounding Method", s_mode_opts, index=s_mode_idx)
    with s_col2:
        s_cutoff = st.number_input("Floor/Ceil Cutoff Threshold", min_value=0.05, max_value=0.95, value=float(settings["sticker_rules"]["cutoff_threshold"]), step=0.05, help="Decimals at or below this value round down. Above this value round up. (Only applies to Custom Cutoff mode)")
    with s_col3:
        s_min = st.number_input("Minimum Sticker Price ($)", min_value=0.25, value=float(settings["sticker_rules"]["min_sticker_price"]), step=0.25)

    st.divider()

    st.subheader("3. Condition Multipliers (% of Near Mint)")
    c_cols = st.columns(4)
    c_lp = c_cols[0].slider("Lightly Played", 50, 100, int(settings["condition_ratios"].get("Lightly Played", 0.85) * 100))
    c_mp = c_cols[1].slider("Moderately Played", 30, 90, int(settings["condition_ratios"].get("Moderately Played", 0.70) * 100))
    c_hp = c_cols[2].slider("Heavily Played", 20, 80, int(settings["condition_ratios"].get("Heavily Played", 0.50) * 100))
    c_dmg = c_cols[3].slider("Damaged", 10, 60, int(settings["condition_ratios"].get("Damaged", 0.30) * 100))

    st.divider()

    st.subheader("4. Cash Offer Scaling Tiers")
    st.caption("Edit the market price brackets and corresponding cash offer percentages.")
    
    tier_df = pd.DataFrame(settings["buy_tiers"])
    edited_tiers = st.data_editor(
        tier_df,
        column_config={
            "min": st.column_config.NumberColumn("Min Market ($)", format="$%.2f"),
            "max": st.column_config.NumberColumn("Max Market ($)", format="$%.2f"),
            "rate": st.column_config.NumberColumn("Buy Offer (%)", min_value=10, max_value=100, step=1, format="%d%%"),
        },
        num_rows="dynamic",
        use_container_width=True
    )

    if st.button("Save Configuration", type="primary", use_container_width=True):
        new_settings = {
            "buy_tiers": edited_tiers.to_dict(orient="records"),
            "condition_ratios": {
                "Near Mint": 1.00,
                "Lightly Played": round(c_lp / 100.0, 2),
                "Moderately Played": round(c_mp / 100.0, 2),
                "Heavily Played": round(c_hp / 100.0, 2),
                "Damaged": round(c_dmg / 100.0, 2),
                "Unknown": 1.00
            },
            "sticker_rules": {
                "mode": s_mode,
                "cutoff_threshold": s_cutoff,
                "min_sticker_price": s_min
            }
        }
        with st.spinner("Saving configuration..."):
            save_vendor_settings(new_settings)
            st.session_state["vendor_settings"] = new_settings
        st.success("Configuration updated! (Remember to sync changes to the cloud when online)")
        time.sleep(1.5)
        st.rerun()