import type { NativeEventSubscription } from 'react-native';
import { Directory, File, Paths, type DownloadProgress } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { unzip, subscribe } from 'react-native-zip-archive';
import { getEventCatalogUrl } from '../constants/api';
import { useProgressStore } from '../store/progressStore';
import {
  closeEventCatalogDatabase,
  openEventCatalogDatabase,
} from '../db/eventCatalogDb';

const EVENT_DB_NAME = 'event_catalog.db';
const EVENT_ZIP_NAME = 'event_catalog.zip';

const sqliteDir = new Directory(Paths.document, 'SQLite');
const eventDbFile = new File(sqliteDir, EVENT_DB_NAME);
const eventCacheDir = new Directory(Paths.cache, 'event_catalogs');
const eventZipFile = new File(eventCacheDir, EVENT_ZIP_NAME);
const eventExtractedDir = new Directory(eventCacheDir, 'extracted');

function eventDbSidecarFile(suffix: string): File {
  return new File(sqliteDir, `${EVENT_DB_NAME}${suffix}`);
}

async function deleteDirectoryRecursively(dir: Directory): Promise<void> {
  try {
    if (dir.exists) {
      dir.delete();
    }
  } catch {
    // Best-effort cleanup.
  }
}

async function deleteStaleEventFiles(): Promise<void> {
  try {
    if (eventZipFile.exists) {
      eventZipFile.delete();
    }
  } catch (err) {
    console.warn(`Failed to delete stale event file ${eventZipFile.uri}:`, err);
  }

  await deleteDirectoryRecursively(eventExtractedDir);
}

function findJsonFiles(dir: Directory): File[] {
  if (!dir.exists) return [];
  const found: File[] = [];
  const listing = dir.list();
  for (const item of listing) {
    if (item instanceof File && item.name.toLowerCase().endsWith('.json')) {
      found.push(item);
    } else if (item instanceof Directory) {
      found.push(...findJsonFiles(item));
    }
  }
  return found;
}

type EventInventoryJsonRow = Record<string, unknown>;

function insertInventoryRows(db: SQLiteDatabase, showId: string, rows: EventInventoryJsonRow[]): void {
  if (rows.length === 0) return;

  // Keep the bound-parameter count below the default SQLite 999 host-parameter
  // limit (12 columns * 80 rows = 960 parameters) and wrap in a transaction.
  const chunkSize = 80;
  const columns = 12;
  const header = `INSERT OR REPLACE INTO show_inventory (
    id, show_id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table
  ) VALUES `;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders: string[] = [];
    const args: (string | number)[] = [];

    for (const r of chunk) {
      placeholders.push(`(${Array(columns).fill('?').join(', ')})`);
      args.push(
        String(r.id ?? ''),
        showId,
        Number(r.product_id) || 0,
        String(r.name ?? ''),
        String(r.set_name ?? ''),
        String(r.number ?? ''),
        String(r.rarity ?? ''),
        String(r.condition ?? ''),
        Number(r.sticker_price) || 0,
        Number(r.quantity) || 0,
        String(r.vendor_name ?? ''),
        String(r.vendor_table ?? '')
      );
    }

    db.runSync(`${header} ${placeholders.join(', ')}`, ...args);
  }
}

export type EventCatalogDownloadStatus = {
  ready: boolean;
  downloaded: boolean;
};

let eventCatalogDownloadPromise: Promise<EventCatalogDownloadStatus> | null = null;
let eventCatalogDownloadShowId: string | null = null;

function trackEventCatalogDownload(
  showId: string,
  run: () => Promise<EventCatalogDownloadStatus>
): Promise<EventCatalogDownloadStatus> {
  const tracked = run().finally(() => {
    if (eventCatalogDownloadPromise === tracked) {
      eventCatalogDownloadPromise = null;
      eventCatalogDownloadShowId = null;
    }
  });
  eventCatalogDownloadPromise = tracked;
  eventCatalogDownloadShowId = showId;
  return tracked;
}

export async function ensureEventCatalogDownloaded(
  showId: string,
  force = false
): Promise<EventCatalogDownloadStatus> {
  sqliteDir.create({ intermediates: true, idempotent: true });
  eventCacheDir.create({ intermediates: true, idempotent: true });

  // Join an in-flight download for the same show so concurrent mounts/refresh
  // calls do not race over the same file.
  if (eventCatalogDownloadPromise && eventCatalogDownloadShowId === showId) {
    try {
      return await eventCatalogDownloadPromise;
    } catch {
      // fall through and start our own attempt
    }
  }

  // Wait for a different show's in-flight download to finish before touching
  // the shared event_catalog.db file.
  if (eventCatalogDownloadPromise) {
    try {
      await eventCatalogDownloadPromise;
    } catch {
      // ignore; we'll start our own attempt below
    }
  }

  const progress = useProgressStore.getState();

  if (!force && eventDbFile.exists) {
    const db = openEventCatalogDatabase();
    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM show_inventory WHERE show_id = ?',
      showId
    );
    if ((row?.count ?? 0) > 0) {
      progress.setEventDownloaded();
      return { ready: true, downloaded: false };
    }
  }

  return trackEventCatalogDownload(showId, async () => {
    try {
      closeEventCatalogDatabase();
      await deleteStaleEventFiles();

      progress.startEventDownload();
      progress.setIsEventExtracting(true);

      const cacheBustUrl = `${getEventCatalogUrl(showId)}?v=${Date.now()}`;

      await File.downloadFileAsync(cacheBustUrl, eventZipFile, {
        idempotent: true,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
        signal: AbortSignal.timeout(60_000),
        onProgress: (data: DownloadProgress) => {
          const pct =
            data.totalBytes > 0 ? data.bytesWritten / data.totalBytes : 0;
          progress.setEventDownloadProgress(pct);
        },
      });

      progress.setEventDownloadExtracting(0);

      // Ensure the extraction destination exists and is clean.
      eventExtractedDir.create({ intermediates: true, idempotent: true });

      let progressSub: NativeEventSubscription | null = null;
      try {
        progressSub = subscribe(({ progress: unzipProgress }) => {
          progress.setEventDownloadExtracting(unzipProgress);
        });

        await unzip(eventZipFile.uri, eventExtractedDir.uri);
      } finally {
        progressSub?.remove();
      }

      const jsonFiles = findJsonFiles(eventExtractedDir);
      if (jsonFiles.length === 0) {
        const listing = eventExtractedDir.exists ? eventExtractedDir.list().map((i) => i.uri).join(', ') : 'dir missing';
        throw new Error(`Event catalog JSON missing after extraction. Found: [${listing}]`);
      }

      const eventJsonFile = jsonFiles[0];
      const rows = (await eventJsonFile.json()) as EventInventoryJsonRow[];
      if (!Array.isArray(rows)) {
        throw new Error('Event catalog JSON is not an array');
      }

      const db = openEventCatalogDatabase();
      db.withTransactionSync(() => {
        db.runSync('DELETE FROM show_inventory WHERE show_id = ?', showId);
        insertInventoryRows(db, showId, rows);
      });

      progress.setEventDownloaded();

      // Clean up the transient zip and JSON now that the DB is hydrated.
      try {
        if (eventZipFile.exists) {
          eventZipFile.delete();
        }
        if (eventJsonFile.exists) {
          eventJsonFile.delete();
        }
      } catch {
        // Best-effort cleanup.
      }

      // Close the handle so the search screen can open a fresh one after
      // the download completes.
      closeEventCatalogDatabase();

      return { ready: true, downloaded: true };
    } catch (err) {
      console.error('Event catalog download failed:', err);
      progress.fail('event');
      throw err;
    } finally {
      progress.setIsEventExtracting(false);
    }
  });
}
