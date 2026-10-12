import AsyncStorage from '@react-native-async-storage/async-storage';
import { classifyDeal, type DealClassId } from './dealClassify';
import type { CardSignal } from '../../../db/catalogDb';

// Remembers each card's deal class between catalog refreshes so the app can
// flag real movement shifts — Stable→Free fall, Dormant→Stable grower, etc.
// One small map in AsyncStorage; no schema, no sync (device-local reads).

const STORAGE_KEY = 'deal_class_map_v1';

export type DealClassStamp = {
  cls: DealClassId;
  label: string;
  /** Was the price already under its stamped floor last refresh?
   *  Old maps lack the flag — treated as not-cracked, so the first
   *  real crack still fires once. */
  cracked?: boolean;
};
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
  /** 'move' is any class change; 'revival' = woke up off a quiet floor;
   *  'floor_crack' = broke under its stamped floor — class change OR
   *  a straight price-crack while the class held. */
  kind: 'move' | 'revival' | 'floor_crack';
};

const FALLING_CLASSES = new Set<DealClassId>([
  'FREE_FALL',
  'POST_SPIKE_BLEED',
  'HYPE_DECAY',
]);

function shiftKind(
  from: DealClassId,
  to: DealClassId
): DealShift<never>['kind'] {
  if (to === 'REVIVAL') return 'revival';
  if (from === 'BASE_FORMING' && FALLING_CLASSES.has(to))
    return 'floor_crack';
  return 'move';
}

/** Price materially under the stamped 90d floor — the crack the exit
 *  line warned about. 3% margin so a print sitting exactly on the
 *  level isn't flagged. */
function isCracked(signal: CardSignal | undefined): boolean {
  const price = signal?.price;
  const low = signal?.low90d;
  return (
    price != null &&
    low != null &&
    low > 0 &&
    price < low * 0.97
  );
}

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
    const cracked = isCracked(e.signal);
    const stamp: DealClassStamp = {
      cls: read.cls,
      label: read.label,
      cracked,
    };
    next[key] = stamp;
    const from = prev[key];
    if (!from) continue;
    const classChanged =
      from.cls !== read.cls &&
      from.cls !== 'LOW_DATA' &&
      read.cls !== 'LOW_DATA';
    if (classChanged) {
      // A fresh floor crack outranks the generic class move — "went
      // through its floor" is the event that matters, whatever the
      // label did alongside it.
      const justCracked = cracked && !from.cracked;
      shifts.push({
        card: e.card,
        from,
        to: stamp,
        color: read.color,
        kind: justCracked ? 'floor_crack' : shiftKind(from.cls, read.cls),
      });
    } else if (cracked && !from.cracked) {
      // Same class, but the price just went through its floor — the
      // exit trigger firing between refreshes. "X → under its floor"
      // is the honest description of what happened.
      shifts.push({
        card: e.card,
        from,
        to: { ...stamp, label: 'under its floor' },
        color: read.color,
        kind: 'floor_crack',
      });
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
