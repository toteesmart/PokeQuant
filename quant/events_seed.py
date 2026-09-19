"""Curated market events that set release dates can't express.

Each row: (date, scope, ref, label)
  scope 'global' — affects the whole market (rotations, Worlds)
  scope 'set'    — ref is a set_code/set_name fragment
  scope 'card'   — ref is a product_id or name fragment

Dates are ISO. Entries are inserted with INSERT OR REPLACE so editing this
file and re-running ingest is the whole maintenance loop.
"""

EVENTS = [
    # Annual Standard rotation — competitive staples reprice hard around it.
    ('2024-04-05', 'global', 'rotation-2024', '2024 Standard rotation (D/E/F marks out)'),
    ('2025-04-11', 'global', 'rotation-2025', '2025 Standard rotation (F mark out)'),
    ('2026-04-03', 'global', 'rotation-2026', '2026 Standard rotation (G mark out, est.)'),
    ('2027-04-02', 'global', 'rotation-2027', '2027 Standard rotation (est.)'),

    # Pokémon World Championships — metagame spikes for playable chase cards.
    ('2023-08-11', 'global', 'worlds-2023', 'World Championships 2023 (Yokohama)'),
    ('2024-08-16', 'global', 'worlds-2024', 'World Championships 2024 (Honolulu)'),
    ('2025-08-15', 'global', 'worlds-2025', 'World Championships 2025 (Anaheim)'),
    ('2026-08-14', 'global', 'worlds-2026', 'World Championships 2026 (est.)'),

    # Known mass-reprint / special-printing waves that cratered affected cards.
    ('2025-01-17', 'set', 'Prismatic Evolutions', 'Prismatic Evolutions release wave — SV-era reprint pressure'),
    ('2025-05-30', 'set', 'Prismatic Evolutions', 'Prismatic Evolutions restock wave'),
    ('2024-01-26', 'set', 'Paldean Fates', 'Paldean Fates release — SV-era shiny reprint pressure'),

    # Holiday season demand pattern (historically strongest liquidity window).
    ('2024-11-29', 'global', 'holiday-2024', 'Holiday 2024 demand window'),
    ('2025-11-28', 'global', 'holiday-2025', 'Holiday 2025 demand window'),
    ('2026-11-27', 'global', 'holiday-2026', 'Holiday 2026 demand window'),
]
