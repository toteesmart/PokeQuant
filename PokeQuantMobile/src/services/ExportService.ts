import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  useInventoryStore,
  type CompletedSale,
  type InventoryCard,
} from '../store/inventoryStore';

type CsvColumn<Row> = {
  header: string;
  value: (row: Row) => string | number | null | undefined;
};

// RFC 4180 quoting: wrap in quotes when the field contains a comma, quote,
// or newline; embedded quotes are doubled. Names like "Pikachu, Captain" and
// 'Cynthia's "Special" card' must survive an Excel/Sheets import.
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv<Row>(rows: Row[], columns: CsvColumn<Row>[]): string {
  const header = columns.map((c) => csvField(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => csvField(c.value(row))).join(',')
  );
  // BOM so Excel auto-detects UTF-8 (e.g. the "JP · " set marker).
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}

const INVENTORY_COLUMNS: CsvColumn<InventoryCard>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Number', value: (r) => r.number },
  { header: 'Set', value: (r) => r.set },
  { header: 'Condition', value: (r) => r.condition },
  { header: 'Variant', value: (r) => r.rarity ?? r.productType },
  { header: 'Qty', value: (r) => r.stock },
  { header: 'Amount Paid', value: (r) => r.amountPaid },
  { header: 'Sticker Price', value: (r) => r.stickerPrice },
  { header: 'Live Market', value: (r) => r.liveMarket },
  { header: 'Proj Profit', value: (r) => r.projProfit },
  { header: 'Product ID', value: (r) => r.productId },
  { header: 'Acquired', value: (r) => r.dateBought },
];

const SALES_COLUMNS: CsvColumn<CompletedSale>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Number', value: (r) => r.number },
  { header: 'Set', value: (r) => r.set },
  { header: 'Condition', value: (r) => r.condition },
  { header: 'Acquired Cost', value: (r) => r.acquiredCost },
  { header: 'Sold Price', value: (r) => r.soldPrice },
  { header: 'Date Sold', value: (r) => r.dateSold },
];

function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}

async function writeAndShare(fileName: string, csv: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  try {
    file.create({ intermediates: true, overwrite: true });
    file.write(csv);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: fileName,
        UTI: 'public.comma-separated-values-text',
      });
    } else {
      // Zero-dependency fallback for platforms without expo-sharing.
      await Share.share({ url: file.uri, title: fileName });
    }
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Best-effort cleanup of the cache copy.
    }
  }
}

export async function exportInventoryCsv(): Promise<void> {
  const rows = useInventoryStore.getState().activeInventory;
  const csv = toCsv(rows, INVENTORY_COLUMNS);
  await writeAndShare(`cardcache_inventory_${todayStamp()}.csv`, csv);
}

export async function exportSalesCsv(): Promise<void> {
  const rows = useInventoryStore.getState().completedSales;
  const csv = toCsv(rows, SALES_COLUMNS);
  await writeAndShare(`cardcache_sales_${todayStamp()}.csv`, csv);
}
