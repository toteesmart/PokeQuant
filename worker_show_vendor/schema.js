// Schema bootstrap: ensureSchema runs the full CREATE/ALTER/migration burst on
// first use inside an isolate (schemaPromise memoizes it). Every statement is
// idempotent; emitted SQL text and order are pinned by the characterization
// suite — do not reorder.

import {
  allRows,
  buildExecute,
  rowAt,
  tursoPipeline,
} from "./turso.js";

let schemaPromise = null;

// Test seam: drops the memoized burst so a test can drive a cold isolate
// without a fresh module registry.
export function resetSchemaCache() {
  schemaPromise = null;
}

function getIndexInfo(rows, indexName) {
  return rows.find((r) => r.name === indexName) || null;
}

async function ensureUniqueIndex(env) {
  const indexList = await tursoPipeline(env, [
    buildExecute(`PRAGMA index_list('public_show_inventory')`),
    { type: "close" },
  ]);
  const rows = allRows(indexList.results);
  const existing = getIndexInfo(rows, "ux_public_show_inventory");

  if (existing) {
    if (Number(existing.unique)) {
      return;
    }
    await tursoPipeline(env, [
      buildExecute(`DROP INDEX IF EXISTS ux_public_show_inventory`),
      { type: "close" },
    ]);
  }

  try {
    await tursoPipeline(env, [
      buildExecute(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_public_show_inventory
        ON public_show_inventory(show_id, vendor_id, condition, dedupe_key)
      `),
      { type: "close" },
    ]);
  } catch (idxErr) {
    console.error("Creating unique index on public_show_inventory failed:", idxErr.message);
    throw idxErr;
  }
}

async function tablePrimaryKeyColumnCount(env, tableName) {
  const data = await tursoPipeline(env, [
    buildExecute(`PRAGMA table_info('${tableName}')`),
    { type: "close" },
  ]);
  const rows = allRows(data.results);
  return rows.reduce((sum, row) => sum + (Number(row.pk) || 0), 0);
}

async function migrateVendorSubscriptionsIfNeeded(env) {
  try {
    const pkCount = await tablePrimaryKeyColumnCount(env, "vendor_subscriptions");
    if (pkCount > 1) return;

    await tursoPipeline(env, [
      buildExecute(`DROP TABLE IF EXISTS _vendor_subscriptions_old`),
      buildExecute(`ALTER TABLE vendor_subscriptions RENAME TO _vendor_subscriptions_old`),
      buildExecute(`
        CREATE TABLE vendor_subscriptions (
          user_id TEXT NOT NULL,
          entitlement_id TEXT NOT NULL,
          product_id TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, product_id)
        )
      `),
      buildExecute(`
        INSERT INTO vendor_subscriptions (user_id, entitlement_id, product_id, is_active, expires_at, updated_at)
        SELECT user_id, entitlement_id, COALESCE(product_id, '') AS product_id, is_active, expires_at, updated_at
        FROM _vendor_subscriptions_old
      `),
      buildExecute(`DROP TABLE _vendor_subscriptions_old`),
      { type: "close" },
    ]);
    console.log("Migrated vendor_subscriptions to composite primary key.");
  } catch (err) {
    console.warn("vendor_subscriptions migration check/failed:", err.message);
  }
}

export async function ensureSchema(env) {
  if (schemaPromise) {
    const ok = await schemaPromise;
    if (!ok) throw new Error("Schema not ready");
    return ok;
  }

  schemaPromise = (async () => {
    await tursoPipeline(env, [
      buildExecute(`
        CREATE TABLE IF NOT EXISTS shows (
          id TEXT PRIMARY KEY,
          vendor_id TEXT NOT NULL,
          name TEXT,
          start_date TEXT,
          location TEXT,
          is_active INTEGER NOT NULL DEFAULT 1
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS public_show_inventory (
          id TEXT PRIMARY KEY,
          show_id TEXT NOT NULL,
          vendor_id TEXT NOT NULL,
          product_id INTEGER,
          name TEXT,
          set_name TEXT,
          number TEXT,
          rarity TEXT,
          condition TEXT,
          sticker_price NUMERIC,
          quantity INTEGER,
          vendor_name TEXT,
          vendor_table TEXT,
          dedupe_key TEXT,
          updated_at INTEGER DEFAULT 0
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS vendors (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          name TEXT,
          table_default TEXT,
          created_at INTEGER
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS vendor_show_registrations (
          vendor_id TEXT NOT NULL,
          show_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          vendor_name TEXT,
          vendor_table TEXT,
          created_at INTEGER,
          PRIMARY KEY (vendor_id, show_id)
        )
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id)
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_public_show_inventory_show ON public_show_inventory(show_id)
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_public_show_inventory_vendor ON public_show_inventory(vendor_id)
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_public_show_inventory_lookup ON public_show_inventory(show_id, vendor_id, product_id, condition)
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `),
      buildExecute(`
        INSERT OR IGNORE INTO app_config (key, value) VALUES ('payments_live', '0')
      `),
      buildExecute(`
        INSERT OR IGNORE INTO app_config (key, value) VALUES ('founder_seat_limit', '50')
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS founder_counter (
          id TEXT PRIMARY KEY,
          claimed INTEGER NOT NULL DEFAULT 0
        )
      `),
      buildExecute(`
        INSERT OR IGNORE INTO founder_counter (id, claimed) VALUES ('founder', 0)
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS vendor_subscriptions (
          user_id TEXT NOT NULL,
          entitlement_id TEXT NOT NULL,
          product_id TEXT NOT NULL DEFAULT '',
          is_active INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, product_id)
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS teams (
          owner_user_id TEXT PRIMARY KEY,
          product_id TEXT,
          seats_total INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          invite_code TEXT UNIQUE,
          name TEXT,
          updated_at INTEGER,
          created_at INTEGER
        )
      `),
      buildExecute(`
        CREATE TABLE IF NOT EXISTS team_members (
          team_id TEXT NOT NULL,
          member_user_id TEXT NOT NULL,
          created_at INTEGER,
          PRIMARY KEY (team_id, member_user_id)
        )
      `),
      buildExecute(`
        CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members(member_user_id)
      `),
      { type: "close" },
    ]);

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE vendors ADD COLUMN is_founder INTEGER NOT NULL DEFAULT 0`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding is_founder to vendors failed:", err.message);
      }
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE vendors ADD COLUMN founder_seat_number INTEGER`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding founder_seat_number to vendors failed:", err.message);
      }
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE teams ADD COLUMN name TEXT`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding name to teams failed:", err.message);
      }
    }

    // Show-organizer feature columns. Each ALTER is idempotent via the
    // duplicate-column check, same as the migrations above.
    const organizerAlterStatements = [
      "ALTER TABLE vendors ADD COLUMN is_organizer INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE shows ADD COLUMN table_count INTEGER",
      "ALTER TABLE shows ADD COLUMN pay_instructions TEXT",
      "ALTER TABLE vendor_show_registrations ADD COLUMN table_number TEXT",
      "ALTER TABLE vendor_show_registrations ADD COLUMN total_due REAL DEFAULT 0",
      "ALTER TABLE vendor_show_registrations ADD COLUMN paid_amount REAL DEFAULT 0",
      "ALTER TABLE vendor_show_registrations ADD COLUMN manual_name TEXT",
      "ALTER TABLE vendor_show_registrations ADD COLUMN manual_phone TEXT",
    ];
    for (const stmt of organizerAlterStatements) {
      try {
        await tursoPipeline(env, [buildExecute(stmt), { type: "close" }]);
      } catch (err) {
        if (!String(err.message).toLowerCase().includes("duplicate column")) {
          console.warn(`Organizer migration failed (${stmt}):`, err.message);
        }
      }
    }

    // Grandfather existing vendors into the first 50 founder seats once. Both
    // probes ride one pipeline so they read the same snapshot.
    try {
      const probes = await tursoPipeline(env, [
        buildExecute(`SELECT claimed FROM founder_counter WHERE id = 'founder'`),
        buildExecute(`SELECT COUNT(*) AS c FROM vendors`),
        { type: "close" },
      ]);
      const counter = rowAt(probes.results, 0);
      const vendorCount = rowAt(probes.results, 1);

      if (counter && Number(counter.claimed) === 0 && vendorCount && Number(vendorCount.c) > 0) {
        await tursoPipeline(env, [
          buildExecute(`
            WITH ranked AS (
              SELECT
                id,
                ROW_NUMBER() OVER (ORDER BY COALESCE(created_at, 0) ASC, id ASC) AS n
              FROM vendors
            )
            UPDATE vendors
            SET
              is_founder = 1,
              founder_seat_number = ranked.n
            FROM ranked
            WHERE vendors.id = ranked.id AND ranked.n <= 50
          `),
          { type: "close" },
        ]);

        await tursoPipeline(env, [
          buildExecute(`
            DELETE FROM founder_counter WHERE id = 'founder'
          `),
          buildExecute(`
            INSERT INTO founder_counter (id, claimed)
            SELECT 'founder', COUNT(*) FROM vendors WHERE is_founder = 1
          `),
          { type: "close" },
        ]);
      }
    } catch (err) {
      console.warn("Grandfathering existing vendors failed:", err.message);
    }

    // Repair founder_counter drift and backfill any unclaimed vendors. A seat
    // is claimed once and stays claimed (churn does not refill), so we count
    // by founder_seat_number rather than the current is_founder flag.
    try {
      const drift = await tursoPipeline(env, [
        buildExecute(`SELECT claimed FROM founder_counter WHERE id = 'founder'`),
        buildExecute(`SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NOT NULL`),
        buildExecute(`SELECT COUNT(*) AS c FROM vendors WHERE founder_seat_number IS NULL`),
        buildExecute(`SELECT value FROM app_config WHERE key = ?`, ["founder_seat_limit"]),
        { type: "close" },
      ]);
      const counter = rowAt(drift.results, 0);
      const claimedCount = rowAt(drift.results, 1);
      const unclaimedCount = rowAt(drift.results, 2);
      const limitRow = rowAt(drift.results, 3);

      const counterClaimed = counter ? Number(counter.claimed) : 0;
      const limit = limitRow && limitRow.value ? Number(limitRow.value) : 50;
      const currentClaimed = claimedCount ? Number(claimedCount.c) : 0;
      const currentUnclaimed = unclaimedCount ? Number(unclaimedCount.c) : 0;

      const needsRecompute = counterClaimed !== currentClaimed;
      const canBackfill = currentUnclaimed > 0 && currentClaimed < limit;

      if (needsRecompute || canBackfill) {
        if (canBackfill) {
          const seatsToBackfill = Math.min(limit - currentClaimed, currentUnclaimed);
          await tursoPipeline(env, [
            buildExecute(
              `
                WITH ranked AS (
                  SELECT
                    id,
                    ROW_NUMBER() OVER (ORDER BY COALESCE(created_at, 0) ASC, id ASC) AS n
                  FROM vendors
                  WHERE founder_seat_number IS NULL
                ),
                max_seat AS (
                  SELECT COALESCE(MAX(founder_seat_number), 0) AS m FROM vendors
                )
                UPDATE vendors
                SET
                  is_founder = 1,
                  founder_seat_number = max_seat.m + ranked.n
                FROM ranked, max_seat
                WHERE vendors.id = ranked.id AND ranked.n <= ?
              `,
              [seatsToBackfill]
            ),
            { type: "close" },
          ]);
        }

        await tursoPipeline(env, [
          buildExecute(`DELETE FROM founder_counter WHERE id = 'founder'`),
          buildExecute(`INSERT INTO founder_counter (id, claimed) SELECT 'founder', COUNT(*) FROM vendors WHERE founder_seat_number IS NOT NULL`),
          { type: "close" },
        ]);
      }
    } catch (err) {
      console.warn("Repairing founder_counter failed:", err.message);
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE public_show_inventory ADD COLUMN updated_at INTEGER DEFAULT 0`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding updated_at to public_show_inventory failed:", err.message);
      }
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`ALTER TABLE public_show_inventory ADD COLUMN dedupe_key TEXT`),
        { type: "close" },
      ]);
    } catch (err) {
      if (!String(err.message).toLowerCase().includes("duplicate column")) {
        console.warn("Adding dedupe_key to public_show_inventory failed:", err.message);
      }
    }

    // Backfill identity keys: rows with a real TCGplayer id key off it; rows
    // without one key off name|set|number so unrelated "product_id = 0" cards
    // stop collapsing into a single listing. Empty/NULL keys fall back to
    // rowid so they cannot slip past the unique index.
    try {
      await tursoPipeline(env, [
        buildExecute(`
          UPDATE public_show_inventory
          SET dedupe_key = CASE
            WHEN product_id > 0 THEN 'p:' || product_id
            WHEN COALESCE(name, '') = '' AND COALESCE(set_name, '') = '' AND COALESCE(number, '') = '' THEN 'row:' || rowid
            ELSE 'n:' || LOWER(COALESCE(name, '')) || '|' || LOWER(COALESCE(set_name, '')) || '|' || LOWER(COALESCE(number, ''))
          END
          WHERE dedupe_key IS NULL OR dedupe_key = ''
        `),
        { type: "close" },
      ]);
    } catch (err) {
      console.warn("Backfilling dedupe_key failed:", err.message);
    }

    try {
      await tursoPipeline(env, [
        buildExecute(`
          DELETE FROM public_show_inventory
          WHERE rowid NOT IN (
            SELECT MAX(rowid) FROM public_show_inventory
            GROUP BY show_id, vendor_id, condition, COALESCE(NULLIF(dedupe_key, ''), 'row:' || rowid)
          )
        `),
        { type: "close" },
      ]);
    } catch (err) {
      console.warn("Deduplicating public_show_inventory failed:", err.message);
    }

    await migrateVendorSubscriptionsIfNeeded(env);

    await ensureUniqueIndex(env);

    return true;
  })();

  try {
    return await schemaPromise;
  } catch (err) {
    console.error("Schema ensure failed:", err.message);
    schemaPromise = null;
    throw err;
  }
}
