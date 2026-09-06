import type { NativeEventSubscription } from 'react-native';
import { Directory, File, Paths, type DownloadProgress } from 'expo-file-system';
import { deleteAsync } from 'expo-file-system/legacy';
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
    if (!dir.exists) return;
    const listing = dir.list();
    for (const item of listing) {
      if (item instanceof Directory) {
        await deleteDirectoryRecursively(item);
      }
      await deleteAsync(item.uri, { idempotent: true });
    }
  } catch {
    // Best-effort cleanup.
  }
}

async function deleteStaleEventFiles(): Promise<void> {
  const stale = [
    eventDbFile,
    eventDbSidecarFile('-wal'),
    eventDbSidecarFile('-shm'),
    eventZipFile,
  ];

  for (const file of stale) {
    try {
      if (file.exists) {
        await deleteAsync(file.uri, { idempotent: true });
      }
    } catch (err) {
      console.warn(`Failed to delete stale event file ${file.uri}:`, err);
    }
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

function insertInventoryRows(db: SQLiteDatabase, rows: unknown[]): void {
  if (rows.length === 0) return;

  // Stay well under the default SQLite 999 host-parameter limit.
  const chunkSize = 100;
  const columns = 11;
  const header = `INSERT OR REPLACE INTO show_inventory (
    id, product_id, name, set_name, number, rarity, condition, sticker_price, quantity, vendor_name, vendor_table
  ) VALUES `;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders: string[] = [];
    const args: (string | number)[] = [];

    for (const row of chunk) {
      const r = row as Record<string, unknown>;
      placeholders.push(`(${Array(columns).fill('?').join(', ')})`);
      args.push(
        String(r.id ?? ''),
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

export async function ensureEventCatalogDownloaded(
  showId: string,
  force = false
): Promise<EventCatalogDownloadStatus> {
  sqliteDir.create({ intermediates: true, idempotent: true });
  eventCacheDir.create({ intermediates: true, idempotent: true });

  const progress = useProgressStore.getState();

  if (!force && eventDbFile.exists) {
    openEventCatalogDatabase();
    progress.setEventDownloaded();
    return { ready: true, downloaded: false };
  }

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
    const rows = (await eventJsonFile.json()) as unknown[];
    if (!Array.isArray(rows)) {
      throw new Error('Event catalog JSON is not an array');
    }

    const db = openEventCatalogDatabase();
    db.withTransactionSync(() => {
      db.execSync('DELETE FROM show_inventory');
      insertInventoryRows(db, rows);
    });

    progress.setEventDownloaded();

    // Clean up the transient zip and JSON now that the DB is hydrated.
    try {
      if (eventZipFile.exists) {
        await deleteAsync(eventZipFile.uri, { idempotent: true });
      }
      if (eventJsonFile.exists) {
        await deleteAsync(eventJsonFile.uri, { idempotent: true });
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
    throw err;
  } finally {
    progress.setIsEventExtracting(false);
  }
}
