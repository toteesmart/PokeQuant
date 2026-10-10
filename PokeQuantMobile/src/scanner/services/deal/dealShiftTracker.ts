import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyDeal, type DealClassId } from './dealClassify';
import type { CardSignal } from '../../../db/catalogDb';

// Remembers each card's deal class between catalog refreshes so the app can
// flag real movement shifts — Stable→Free fall, Dormant→Stable grower, etc.
// One small map in AsyncStorage; no schema, no sync (device-local reads).

const STORAGE_KEY = 'deal_class_map_v1';

export type DealClassStamp = { cls: DealClassId; label: string };
export type DealClassMap = Record<string, DealClassStamp>;

export function classKey(
  productId: number | null | undefined,
  subType?: string
): string {
  return `${productId ?? 0}|${subType ?? ''}`;
}

export async function loadDealClassMap(): Promise<DealClassMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DealClassMap) : {};
  } catch {
    return {};
  }
}

export type DealShift<TCard> = {
  card: TCard;
  from: DealClassStamp;
  to: DealClassStamp;
  color: string;
};

/** Classify each card and diff against the remembered map. Returns the
 *  shifts plus the next map to persist. LOW_DATA transitions don't count —
 *  gaining/losing data isn't a movement shift. */
export function diffDealClasses<TCard>(
  prev: DealClassMap,
  entries: { card: TCard; productId: number | null | undefined; subType?: string; signal?: CardSignal }[]
): { shifts: DealShift<TCard>[]; next: DealClassMap } {
  const shifts: DealShift<TCard>[] = [];
  const next: DealClassMap = {};
  for (const e of entries) {
    const key = classKey(e.productId, e.subType);
    const read = classifyDeal(e.signal);
    const stamp: DealClassStamp = { cls: read.cls, label: read.label };
    next[key] = stamp;
    const from = prev[key];
    if (
      from &&
      from.cls !== read.cls &&
      from.cls !== 'LOW_DATA' &&
      read.cls !== 'LOW_DATA'
    ) {
      shifts.push({ card: e.card, from, to: stamp, color: read.color });
    }
  }
  return { shifts, next };
}

export async function saveDealClassMap(map: DealClassMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // best-effort persistence only
  }
}
