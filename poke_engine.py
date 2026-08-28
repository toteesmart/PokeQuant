import os
import sys
import time
import random
from google import genai
from google.genai import types
from card_tool import search_card_and_pricing

# 1. Ensure API key is set in the environment[cite: 2]
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY environment variable not found.")
    print("In Command Prompt (cmd), set it using:")
    print("set GEMINI_API_KEY=your_api_key_here\n")
    print("In PowerShell, set it using:")
    print('$env:GEMINI_API_KEY="your_api_key_here"')
    sys.exit(1)

client = genai.Client(api_key=api_key)

# 2. Configure the chat with the tool and system instructions[cite: 2]
config = types.GenerateContentConfig(
    tools=[search_card_and_pricing],
    system_instruction=(
        "You are a card store purchasing assistant. Always look up cards using the "
        "search_card_and_pricing tool before answering pricing questions. Present the "
        "market price, cash offer, and 30-day trend concisely."
    ),
    temperature=0.2,
    thinking_config=types.ThinkingConfig(
        thinking_level=types.ThinkingLevel.MEDIUM
    )
)

# 3. Create the interactive chat session[cite: 2]
try:
    chat = client.chats.create(
        model='gemini-3.7-flash',
        config=config
    )
except AttributeError:
    print("Failed to initialize chat. Ensure google-genai library is fully updated.")
    sys.exit(1)

print("==================================================")
print(" PokeQuant Pricing Engine Launched (Optimized)!")
print(" Type 'exit' or 'quit' to shut down.")
print("==================================================")

# 4. Run the interactive input loop[cite: 2]
while True:
    try:
        user_input = input("\nLookup Card: ")
        if user_input.lower() in ['exit', 'quit']:
            print("Shutting down engine...")
            break
            
        if not user_input.strip():
            continue
            
        print("Thinking & searching database...")
        
        # --- Exponential Backoff with Jitter & Fallback ---[cite: 2]
        max_retries = 4
        base_delay = 2.0 
        success = False
        
        for attempt in range(max_retries):
            try:
                response = chat.send_message(user_input)
                print("\n--- Result ---")
                print(response.text)
                print("--------------")
                success = True
                break 
                
            except Exception as e:
                error_msg = str(e)
                if "503" in error_msg or "UNAVAILABLE" in error_msg:
                    if attempt < max_retries - 1:
                        # Add random jitter (0 to 2 seconds) to stagger retry timing[cite: 2]
                        jitter = random.uniform(0, 2.0)
                        sleep_time = (base_delay * (2 ** attempt)) + jitter
                        print(f"  [Server busy / 503. Staggering retry in {sleep_time:.2f}s...]")
                        time.sleep(sleep_time)
                    else:
                        print("\n[!] 3.7 Flash persistently overloaded. Shifting to fallback model (gemini-3.6-flash)...")
                else:
                    print(f"\nAPI Error: {e}")
                    break
        
        # If primary model exhausted retries, attempt fallback to gemini-3.6-flash[cite: 2]
        if not success:
            try:
                # Create a specific config for 3.6 that removes the 3.7 thinking block
                fallback_config = types.GenerateContentConfig(
                    tools=[search_card_and_pricing],
                    system_instruction=(
                        "You are a card store purchasing assistant. Always look up cards using the "
                        "search_card_and_pricing tool before answering pricing questions. Present the "
                        "market price, cash offer, and 30-day trend concisely."
                    ),
                    temperature=0.2
                )
                
                # Initialize a temporary chat session to comply with SDK automatic function calling rules
                fallback_chat = client.chats.create(
                    model='gemini-3.6-flash',
                    config=fallback_config
                )
                fallback_response = fallback_chat.send_message(user_input)
                
                print("\n--- Result (via Fallback Engine: 3.6 Flash) ---")
                print(fallback_response.text)
                print("-----------------------------------------------")
            except Exception as fallback_err:
                print(f"\nFallback Error: All fallback routes are currently saturated. Please try again shortly. ({fallback_err})")
                    
    except KeyboardInterrupt:
        print("\nShutting down engine...")
        break