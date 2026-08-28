import streamlit as st
import urllib.parse
from card_tool import search_card_and_pricing, calculate_buy_offer

# Set layout to 'wide' to enable the dynamic side-by-side desktop view
st.set_page_config(page_title="PokeQuant", layout="wide")

# Initialize session state for lot/cart tracking
if "cart" not in st.session_state:
    st.session_state.cart = []

has_cart = len(st.session_state.cart) > 0

# Inject CSS using the :has() selector to target the exact column holding our hidden anchor
if has_cart:
    st.markdown("""
        <style>
        /* 1. Nuke Streamlit's clipping and transform boxes that break fixed/sticky positioning */
        .main, 
        .block-container, 
        [data-testid="stVerticalBlock"], 
        [data-testid="stHorizontalBlock"] {
            overflow: visible !important;
            contain: none !important;
            transform: none !important;
        }

        /* Desktop Mode: Smooth sticky sliding */
        @media (min-width: 769px) {
            [data-testid="column"]:has(#cart-target) {
                position: -webkit-sticky !important;
                position: sticky !important;
                top: 4rem !important;
                align-self: flex-start !important;
                z-index: 1000 !important;
                
                background-color: #0e1117 !important;
                padding: 1rem !important;
                border-radius: 10px !important;
                border: 1px solid #333 !important;
                box-shadow: -5px 5px 15px rgba(0,0,0,0.5) !important;
            }
        }
        
        /* Mobile Mode: Break out completely and fix to the bottom viewport */
        @media (max-width: 768px) {
            [data-testid="column"]:has(#cart-target) {
                position: fixed !important;
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
                width: 100% !important;
                z-index: 9999 !important;
                background-color: #0e1117 !important; 
                padding: 0.5rem 1rem 1.5rem 1rem !important;
                border-top: 2px solid #333 !important;
                border-radius: 20px 20px 0 0 !important;
                box-shadow: 0px -10px 20px rgba(0,0,0,0.7) !important;
                max-height: 65vh !important;
                overflow-y: auto !important;
            }
            
            [data-testid="column"]:has(#cart-target)::before {
                content: '';
                display: block;
                width: 40px;
                height: 5px;
                background: #555;
                border-radius: 3px;
                margin: 5px auto 15px auto;
            }
            
            .block-container {
                padding-bottom: 120px !important; 
            }
        }
        
        ::-webkit-scrollbar {
            display: none;
        }
        </style>
    """, unsafe_allow_html=True)
else:
    st.markdown("""
        <style>
        ::-webkit-scrollbar {
            display: none;
        }
        </style>
    """, unsafe_allow_html=True)

def format_trend(val):
    if val == "N/A":
        return "N/A"
    if val.startswith("+"):
        return f":green[{val} ↗]"
    if val.startswith("-"):
        return f":red[{val} ↘]"
    return f":gray[{val} =]"

# --- Dynamic Layout Structure ---
if has_cart:
    # 60% Search / 40% Cart layout
    search_col, cart_col = st.columns([1.5, 1], gap="large")
else:
    # Snap search back to the center by surrounding it with empty spacer columns
    spacer_left, search_col, spacer_right = st.columns([1, 2, 1])
    cart_col = None

with search_col:
    st.title("PokeQuant")
    st.write("Live offline pricing and offer calculator.")

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

if has_cart and cart_col is not None:
    with cart_col:
        # Drop the invisible HTML anchor so the CSS knows exactly which column to target
        st.html("<div id='cart-target'></div>")
        
        total_market = sum(item["market_price"] for item in st.session_state.cart)
        total_offer = sum(item["cash_offer"] for item in st.session_state.cart)
        num_items = len(st.session_state.cart)
        
        with st.expander(f"🛒 {num_items} Items | Offer: ${total_offer:.2f} (Mkt: ${total_market:.2f})", expanded=True):
            for idx, item in enumerate(st.session_state.cart):
                st.markdown(f"**{item['name']}** #{item['number']}  \n*{item['variant']}*")
                
                c1, c2, c3 = st.columns([2, 2, 1])
                c1.write(f"Mkt: ${item['market_price']:.2f}")
                c2.write(f"Off: **${item['cash_offer']:.2f}**")
                
                if c3.button("X", key=f"remove_{idx}"):
                    st.session_state.cart.pop(idx)
                    st.rerun()
                st.divider()

            effective_rate = round((total_offer / total_market * 100), 1) if total_market > 0 else 0.0

            m1, m2 = st.columns(2)
            m1.metric("Total Market", f"${total_market:.2f}")
            m2.metric("Total Offer", f"${total_offer:.2f}")
            st.metric("Effective Lot Rate", f"{effective_rate}%")

            if st.button("Clear Lot", type="secondary", use_container_width=True):
                st.session_state.cart = []
                st.rerun()