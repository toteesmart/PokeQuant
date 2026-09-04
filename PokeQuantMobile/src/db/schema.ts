import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Central Drizzle schema for the local Expo SQLite tenant database
 * (`pokequant.db`). This schema covers ONLY the cloud-synced tenant tables.
 *
 * The catalog database (`mobile_catalog.db`) is pre-built and read-only; it
 * is opened and queried through raw `expo-sqlite` APIs in `catalogDb.ts` and
 * must not be managed by Drizzle Kit or the migrator.
 */

export const inventory = sqliteTable(
  'inventory',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    productId: integer('product_id'),
    cardName: text('card_name'),
    cardNumber: text('card_number'),
    setName: text('set_name'),
    variant: text('variant'),
    condition: text('condition'),
    purchasePrice: real('purchase_price'),
    stickerPrice: real('sticker_price'),
    dateBought: text('date_bought'),
    isBulkDeal: integer('is_bulk_deal', { mode: 'boolean' }).default(sql`0`),
    isSold: integer('is_sold', { mode: 'boolean' }).default(sql`0`),
    soldPrice: real('sold_price').default(0),
    dateSold: text('date_sold').default(''),
    customImageData: text('custom_image_data'),
    isDeleted: integer('is_deleted', { mode: 'boolean' }).default(sql`0`),
    updatedAt: real('updated_at').notNull(),
  },
  (table) => [
    index('idx_inventory_user_sold_deleted').on(
      table.userId,
      table.isSold,
      table.isDeleted
    ),
    index('idx_inventory_user_updated').on(table.userId, table.updatedAt),
  ]
);

export const vendorSettings = sqliteTable('vendor_settings', {
  userId: text('user_id').primaryKey(),
  settingsJson: text('settings_json').notNull(),
  updatedAt: real('updated_at').default(0),
});

export const syncMetadata = sqliteTable('sync_metadata', {
  userId: text('user_id').primaryKey(),
  lastUpdated: real('last_updated').default(0),
});

export const tourState = sqliteTable('tour_state', {
  userId: text('user_id').primaryKey(),
  hasSeenTour: integer('has_seen_tour', { mode: 'boolean' })
    .notNull()
    .default(sql`0`),
});
