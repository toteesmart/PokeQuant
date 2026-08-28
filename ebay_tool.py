from curl_cffi import requests
from bs4 import BeautifulSoup
import urllib.parse
import os

def get_ebay_last_sold(card_name, card_number, set_name):
    # Construct a highly specific query to filter out junk listings[cite: 14]
    query = f"{card_name} {card_number} {set_name} pokemon"
    encoded_query = urllib.parse.quote(query)
    
    # eBay URL with hidden sold, completed, and recent sort parameters[cite: 14]
    url = f"https://www.ebay.com/sch/i.html?_nkw={encoded_query}&LH_Sold=1&LH_Complete=1&_sop=13"
    
    # Pull the secure cookie from your terminal environment
    ebay_cookie = os.environ.get("EBAY_COOKIE", "")
    
    headers = {
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': ebay_cookie
    }
    
    try:
        # Use curl_cffi to impersonate Chrome and pass the auth cookie[cite: 14]
        response = requests.get(url, impersonate="chrome", headers=headers, timeout=10)
        
        # Failsafe: Check if the cookie expired and eBay redirected to login
        if "signin.ebay.com" in response.url:
            print("Cookie expired or invalid. Redirected to login.")
            return []
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Isolate the individual listing containers[cite: 14]
        listings = soup.find_all('div', class_='s-item__info')
        
        sold_items = []
        
        # Start at index 1 to skip eBay's invisible "Shop on eBay" dummy header element[cite: 14]
        for item in listings[1:]: 
            title_el = item.find('div', class_='s-item__title')
            price_el = item.find('span', class_='s-item__price')
            
            # The date is usually stored with a POSITIVE class indicating a successful sale[cite: 14]
            date_el = item.find('div', class_='s-item__title--tag') 
            
            if title_el and price_el:
                title = title_el.get_text(strip=True)
                price = price_el.get_text(strip=True)
                date = date_el.get_text(strip=True).replace("Sold ", "") if date_el else "Recent"
                
                # Skip multi-variation listings (e.g., "$5.00 to $20.00") which skew data[cite: 14]
                if " to " in price.lower():
                    continue
                    
                sold_items.append({
                    "title": title,
                    "price": price,
                    "date": date
                })
                
                if len(sold_items) == 5:
                    break
                    
        return sold_items

    except Exception as e:
        print(f"Scraper error: {e}")
        return []