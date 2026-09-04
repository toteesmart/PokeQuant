-- === SCHEMA FOR mobile_catalog.db === --
CREATE VIEW latest_prices AS
        SELECT
            c.card_name AS "Card",
            c.card_number AS "Card Number",
            c.set_name AS "Set",
            p.sub_type AS "Variant",
            p.market_price AS "Market Price"
        FROM cards c
        JOIN price_history p ON c.product_id = p.product_id
        WHERE p.date = (
            SELECT MAX(date) FROM price_history
            WHERE product_id = p.product_id AND sub_type = p.sub_type
        );

CREATE TABLE cards (
            product_id INTEGER PRIMARY KEY,
            card_name TEXT,
            card_number TEXT,
            set_name TEXT
        , rarity TEXT);

CREATE TABLE "price_history" (
            product_id INTEGER,
            sub_type TEXT,
            date TEXT,
            market_price REAL,
            PRIMARY KEY (product_id, sub_type, date)
        );

CREATE INDEX idx_cards_search ON cards(card_name, set_name, card_number);

CREATE INDEX idx_price_history_lookup ON price_history(product_id, date DESC);

-- === SCHEMA FOR pokemon_tcg.db === --
CREATE VIEW latest_prices AS
        SELECT 
            c.card_name AS "Card",
            c.card_number AS "Card Number",
            c.set_name AS "Set",
            p.sub_type AS "Variant",
            p.market_price AS "Market Price"
        FROM cards c
        JOIN price_history p ON c.product_id = p.product_id
        WHERE p.date = (
            SELECT MAX(date) FROM price_history 
            WHERE product_id = p.product_id AND sub_type = p.sub_type
        );

CREATE TABLE cards (
            product_id INTEGER PRIMARY KEY,
            card_name TEXT,
            card_number TEXT,
            set_name TEXT
        , rarity TEXT);

CREATE TABLE price_history (
            product_id INTEGER,
            sub_type TEXT,
            date TEXT,
            market_price REAL,
            PRIMARY KEY (product_id, sub_type, date)
        );

CREATE INDEX idx_cards_search ON cards(card_name, set_name, card_number);

CREATE INDEX idx_price_history_lookup ON price_history(product_id, date DESC);

