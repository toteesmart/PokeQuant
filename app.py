import streamlit as st
import urllib.parse
from card_tool import search_card_and_pricing, calculate_buy_offer

# Mobile-friendly page configuration
st.set_page_config(page_title="PokeQuant", layout="centered")

def format_trend(val):
    """Helper to colorize markdown trend values"""
    if val == "N/A":
        return "N/A"
    if val.startswith("+"):
        return f":green[{val} ↗]"
    if val.startswith("-"):
        return f":red[{val} ↘]"
    return f":gray[{val} =]"

# Initialize session state for lot/cart tracking
if "cart" not in st.session_state:
    st.session_state.cart = []

st.title("PokeQuant Mobile")
st.write("Live offline pricing and offer calculator.")

# --- Lot Deal Summary (Cart) ---
if st.session_state.cart:
    with st.expander(f"Current Lot Deal ({len(st.session_state.cart)} cards)", expanded=True):
        total_market = 0.0
        total_offer = 0.0

        for idx, item in enumerate(st.session_state.cart):
            c1, c2, c3, c4 = st.columns([3, 2, 2, 1])
            c1.write(f"**{item['name']}** #{item['number']}\n_{item['variant']}_")
            c2.write(f"Market: ${item['market_price']:.2f}")
            c3.write(f"Offer ({item['buy_percentage']}): **${item['cash_offer']:.2f}**")
            if c4.button("X", key=f"remove_{idx}"):
                st.session_state.cart.pop(idx)
                st.rerun()

            total_market += item["market_price"]
            total_offer += item["cash_offer"]

        st.divider()
        effective_rate = round((total_offer / total_market * 100), 1) if total_market > 0 else 0.0

        m1, m2, m3 = st.columns(3)
        m1.metric("Total Market", f"${total_market:.2f}")
        m2.metric("Total Cash Offer", f"${total_offer:.2f}")
        m3.metric("Effective Lot Rate", f"{effective_rate}%")

        if st.button("Clear Lot"):
            st.session_state.cart = []
            st.rerun()

# --- Card Search ---
query = st.text_input("Search for a card:", placeholder="e.g. Pikachu 276, Mega Latias 100, Ninjask 137")

if query:
    with st.spinner("Searching database..."):
        results = search_card_and_pricing(query, limit=20)

        if not results:
            st.warning("No matches found in the local database.")
        else:
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
                            # Display NM Baseline
                            col1, col2, col3 = st.columns(3)
                            col1.metric("Variant", p["variant"])
                            col2.metric("NM Market", f"${p['market_price']:.2f}", p["30d_trend"] if p["30d_trend"] != "N/A" else None)
                            col3.metric("NM Offer", f"${p['cash_offer']:.2f}")

                            # Print granular trends right beneath the primary metrics
                            st.caption(f"**Trends:** 7d: {format_trend(p['7d_trend'])} | 30d: {format_trend(p['30d_trend'])} | 90d: {format_trend(p['90d_trend'])}")

                            # Condition Selector & Add to Lot
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

                    # --- eBay Native App Integration ---
                    with st.expander("View Last Sold on eBay"):
                        st.caption("Cloud servers are blocked by eBay's bot detection. Tap below to view completed sales securely on your device.")
                        
                        # Generate the exact hidden URL parameters
                        query_str = f"{card['card_name']} {card['card_number']} {card['set']} pokemon"
                        encoded_query = urllib.parse.quote(query_str)
                        ebay_url = f"https://www.ebay.com/sch/i.html?_nkw={encoded_query}&LH_Sold=1&LH_Complete=1&_sop=13"
                        
                        st.link_button("Open eBay Sold Comps", ebay_url, type="primary")

                    st.divider()