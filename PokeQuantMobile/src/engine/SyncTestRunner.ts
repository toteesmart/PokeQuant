import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { pushLocalChanges, pullRemoteChanges } from '../api/cloudSync';
import { initDb } from '../db/database';
import { setLastSync } from '../db/syncDb';

const TEST_COLUMNS = [
  'id',
  'user_id',
  'product_id',
  'card_name',
  'card_number',
  'set_name',
  'variant',
  'condition',
  'purchase_price',
  'sticker_price',
  'date_bought',
  'is_bulk_deal',
  'is_sold',
  'sold_price',
  'date_sold',
  'custom_image_data',
  'is_deleted',
  'updated_at',
] as const;

const INSERT_SQL = `INSERT OR REPLACE INTO inventory (${TEST_COLUMNS.join(
  ', '
)}) VALUES (${TEST_COLUMNS.map(() => '?').join(', ')})`;

const DEFAULT_USER_ID = 'headless-test-user';

export class SyncTestRunner {
  static async run(userId: string = DEFAULT_USER_ID): Promise<void> {
    console.log('[SyncTestRunner] Starting headless sync lifecycle');
    console.log(`[SyncTestRunner] User: ${userId}`);

    let db: SQLiteDatabase | null = null;

    try {
      const result = await initDb();
      db = result.db;
      console.log(`[SyncTestRunner] Database initialized: ${result.message}`);

      const id = Crypto.randomUUID().replace(/-/g, '');
      const now = Date.now();

      const mock = {
        id,
        user_id: userId,
        product_id: 12345,
        card_name: 'Pikachu',
        card_number: '25',
        set_name: 'Base Set',
        variant: 'Holo',
        condition: 'nm',
        purchase_price: 5.0,
        sticker_price: 10.0,
        date_bought: new Date().toISOString(),
        is_bulk_deal: 0,
        is_sold: 0,
        sold_price: 0.0,
        date_sold: '',
        custom_image_data: '',
        is_deleted: 0,
        updated_at: now,
      };

      const values = TEST_COLUMNS.map((col) => (mock as any)[col]);
      console.log(`[SyncTestRunner] Inserting mock inventory item ${id} @ ${now}`);
      await db.runAsync(INSERT_SQL, ...values);
      console.log('[SyncTestRunner] Mock inventory inserted locally');

      console.log('[SyncTestRunner] Pushing local changes...');
      const pushed = await pushLocalChanges(db, userId);
      console.log(`[SyncTestRunner] Pushed ${pushed} local row(s)`);

      // Drop the local high-water mark just before the mock timestamp so the
      // following pull can demonstrate a real round-trip through the remote.
      await setLastSync(db, userId, now - 1);
      console.log('[SyncTestRunner] last_sync reset for round-trip verification');

      console.log('[SyncTestRunner] Pulling remote changes...');
      const pulled = await pullRemoteChanges(db, userId);
      console.log(`[SyncTestRunner] Pulled ${pulled} remote row(s)`);

      const localRow = await db.getFirstAsync<any>(
        'SELECT * FROM inventory WHERE id = ?',
        id
      );
      console.log(
        '[SyncTestRunner] Local row after round-trip:',
        JSON.stringify(localRow, null, 2)
      );

      console.log('[SyncTestRunner] Headless sync lifecycle complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[SyncTestRunner] Sync lifecycle failed:', message);
      throw err;
    } finally {
      if (db) {
        console.log('[SyncTestRunner] Database handle released');
      }
    }
  }
}
