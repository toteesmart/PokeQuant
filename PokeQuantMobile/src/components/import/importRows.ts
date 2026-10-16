// Bulk-import row layer — pure spreadsheet parsing + catalog matching.
// No React, no stores: every function here is unit-testable in isolation.

import * as XLSX from '@stackline/xlsx';
import type { SQLiteDatabase } from 'expo-sqlite';
import { searchCatalogCardsByNames, type CatalogCard } from '../../db/catalogDb';
import { scoreCatalogMatch, type MatchableRow } from '../../utils/scoreCatalogMatch';
import { normalizeSearch } from '../../utils/search';
import { logError } from '../../utils/log';

export function parseNumber(value: string, fallback: number): number {
  const n = Number.parseFloat(value.trim());
  return Number.isNaN(n) ? fallback : n;
}

type RawImportRow = {
  name: string;
  set: string;
  number: string;
  condition: string;
  costBasis: string;
  stickerPrice: string;
  variant: string;
};

export type VerificationRow = {
  id: string;
  name: string;
  set: string;
  number: string;
  condition: string;
  costBasis: string;
  stickerPrice: string;
  variant: string;
  productId: number | null;
  matchedCard: CatalogCard | null;
  isResolving: boolean;
};

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

const HEADER_ALIASES: Record<keyof RawImportRow, string[]> = {
  name: ['card name', 'card_name', 'cardname', 'name', 'title', 'product name', 'product_name'],
  set: ['set', 'set name', 'set_name', 'setname', 'expansion'],
  number: ['number', 'card number', 'card_number', 'cardnumber', '#', 'no'],
  condition: ['condition', 'cond', 'grade'],
  costBasis: [
    'cost basis',
    'cost',
    'cost_basis',
    'purchase price',
    'purchase_price',
    'amount paid',
    'amount_paid',
    'cash offer',
    'cash_offer',
    'offer',
  ],
  stickerPrice: [
    'sticker price',
    'sticker',
    'sticker_price',
    'stickerprice',
    'price',
    'projected sticker',
  ],
  variant: ['variant', 'rarity', 'product type', 'product_type', 'subtype'],
};

function detectHeaderMap(headers: string[]): Record<keyof RawImportRow, number> {
  const map: Partial<Record<keyof RawImportRow, number>> = {};
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    if (!raw) continue;
    const normalized = raw.toLowerCase().trim();
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[key as keyof RawImportRow] !== undefined) continue;
      if (aliases.includes(normalized)) {
        map[key as keyof RawImportRow] = i;
        break;
      }
    }
  }
  return {
    name: map.name ?? -1,
    set: map.set ?? -1,
    number: map.number ?? -1,
    condition: map.condition ?? -1,
    costBasis: map.costBasis ?? -1,
    stickerPrice: map.stickerPrice ?? -1,
    variant: map.variant ?? -1,
  };
}

export function parseSpreadsheetRows(base64: string): RawImportRow[] {
  const workbook = XLSX.read(base64, { type: 'base64' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
  }) as string[][];

  if (data.length < 2) return [];

  const headers = data[0].map((h) => String(h ?? '').trim());
  const headerMap = detectHeaderMap(headers);

  const get = (row: string[], index: number): string =>
    index >= 0 && index < row.length ? String(row[index] ?? '').trim() : '';

  const rows: RawImportRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every((cell) => !String(cell ?? '').trim())) continue;

    const condition = get(row, headerMap.condition).toUpperCase() || 'NM';
    const safeCondition = CONDITIONS.includes(condition) ? condition : 'NM';

    rows.push({
      name: get(row, headerMap.name),
      set: get(row, headerMap.set),
      number: get(row, headerMap.number),
      condition: safeCondition,
      costBasis: get(row, headerMap.costBasis),
      stickerPrice: get(row, headerMap.stickerPrice),
      variant: get(row, headerMap.variant) || 'Normal',
    });
  }

  return rows;
}

export async function resolveCatalogMatches(
  catalogDb: SQLiteDatabase,
  rows: MatchableRow[],
): Promise<Map<string, CatalogCard | null>> {
  const results = new Map<string, CatalogCard | null>();
  if (rows.length === 0) return results;

  try {
    const names = rows.map((r) => r.name);
    const candidates = await searchCatalogCardsByNames(catalogDb, names);
    const byName: Record<string, CatalogCard[]> = {};
    for (const card of candidates) {
      const key = normalizeSearch(card.name);
      if (!byName[key]) byName[key] = [];
      byName[key].push(card);
    }

    for (const row of rows) {
      const normalizedQuery = normalizeSearch(row.name);
      if (!normalizedQuery) {
        results.set(row.id, null);
        continue;
      }

      const candidateBuckets = new Set<CatalogCard>();
      for (const [key, cards] of Object.entries(byName)) {
        if (key.includes(normalizedQuery) || normalizedQuery.includes(key)) {
          for (const card of cards) candidateBuckets.add(card);
        }
      }

      let best: CatalogCard | null = null;
      let bestScore = -1;

      for (const card of candidateBuckets) {
        const score = scoreCatalogMatch(row, card);
        if (score > bestScore) {
          bestScore = score;
          best = card;
        }
      }

      // If no bucket matched, fall back to scanning all candidates.
      if (!best) {
        for (const card of candidates) {
          const score = scoreCatalogMatch(row, card);
          if (score > bestScore) {
            bestScore = score;
            best = card;
          }
        }
      }

      results.set(row.id, bestScore >= 10 ? best : null);
    }
  } catch (err) {
    logError('Catalog batch lookup failed:', err);
    for (const row of rows) {
      results.set(row.id, null);
    }
  }

  return results;
}
