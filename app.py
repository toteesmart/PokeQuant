import streamlit as st
import urllib.parse
from card_tool import search_cards_paginated, calculate_buy_offer

st.set_page_config(page_title="PokeQuant", layout="centered")

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

def format_trend(val):
    if val == "N/A":
        return "N/A"
    if val.startswith("+"):
        return f":green[{val} ↗]"
    if val.startswith("-"):
        return f":red[{val} ↘]"
    return f":gray[{val} =]"

st.title("PokeQuant")
st.write("Live offline pricing and offer calculator.")

# --- Search & Filters ---
query = st.text_input("Search for a card:", placeholder="e.g. Pikachu 276, Mega Latias 100, Ninjask 137")

with st.expander("Advanced Filters", expanded=False):
    f_col1, f_col2, f_col3 = st.columns(3)
    with f_col1:
        rarity_options = [
            "All", "Common", "Uncommon", "Rare", "Holo Rare", "Double Rare", 
            "Ultra Rare", "Illustration Rare", "Special Illustration Rare", 
            "Mega Attack Rare", "Mega Hyper Rare", "Hyper Rare", "Secret Rare", "Promo"
        ]
        selected_rarity = st.selectbox("Rarity", rarity_options)
    with f_col2:
        selected_product = st.selectbox("Product Type", ["All", "Cards Only", "Sealed Only"])
    with f_col3:
        selected_max_price = st.number_input("Max Market Price ($)", min_value=0.0, value=0.0, step=1.0, help="Leave at 0.0 for no limit")

# Automatically jump back to Page 1 if the user changes any search criteria
if (query != st.session_state.last_query or 
    selected_rarity != st.session_state.last_rarity or 
    selected_max_price != st.session_state.last_max_price or
    selected_product != st.session_state.last_product_type):
    
    st.session_state.current_page = 1
    st.session_state.last_query = query
    st.session_state.last_rarity = selected_rarity
    st.session_state.last_max_price = selected_max_price
    st.session_state.last_product_type = selected_product

# --- Database Query ---
if query or selected_rarity != "All" or selected_max_price > 0 or selected_product != "All":
    with st.spinner("Searching database..."):
        results, total_pages, total_count = search_cards_paginated(
            query=query, 
            rarity=selected_rarity, 
            max_price=selected_max_price,
            product_type=selected_product,
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

                            cond_col, btn_col = st.columns([2, 1])
                            with cond_col:
                                cond_options = {
                                    "Near Mint (100%)": 1.0,
                                    "Lightly Played (85%)": 0.85,
                                    "Moderately Played (70%)": 0.70,
                                    "Heavily Played (50%)": 0.50,
                                    "Damaged (30%)": 0.30
                                }
                                selected_cond = st.selectbox(
                                    "Condition",
                                    options=list(cond_options.keys()),
                                    key=f"cond_{card['product_id']}_{p['variant']}",
                                    label_visibility="collapsed"
                                )
                            with btn_col:
                                if st.button("Add to Lot", key=f"add_{card['product_id']}_{p['variant']}"):
                                    ratio = cond_options[selected_cond]
                                    adj_market = p["market_price"] * ratio
                                    new_offer = calculate_buy_offer(adj_market)

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