// Trade-sheet entry ops — both side pickers (your inventory search is
// local+instant; theirs is a 250ms-debounced catalog hit), the
// many-vs-one add guard, and the qty/remove entry mutations.
import { useEffect, useMemo, useState } from 'react';
import { openCatalogDatabase, searchCatalogCards } from '../db/catalogDb';
import { getCatalogImageUri } from '../services/CatalogImageService';
import { displayCardName } from '../scanner/services/catalog/catalogMatcher';
import {
  nextTradeEntryKey,
  tradeVariantsFor,
  type TradePick,
} from '../scanner/services/deal/tradeEntry';
import type { TradeEntry } from '../scanner/services/deal/tradeEval';
import type { InventoryCard } from '../store/inventoryStore';

export function useTradeEntryOps({
  yours,
  theirs,
  onChangeYours,
  onChangeTheirs,
  inventory,
}: {
  yours: TradeEntry[];
  theirs: TradeEntry[];
  onChangeYours: (entries: TradeEntry[]) => void;
  onChangeTheirs: (entries: TradeEntry[]) => void;
  inventory: InventoryCard[];
}) {
  const [yourQuery, setYourQuery] = useState('');
  const [theirQuery, setTheirQuery] = useState('');
  const [theirResults, setTheirResults] = useState<TradePick[]>([]);
  const [searching, setSearching] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  // The engine reads N-vs-1 — many cards on one side against a single card
  // on the other. Adding to a side is blocked only if it would make BOTH
  // sides multi-card (fairness can't attribute across multi-vs-multi).
  const canAddTo = (side: TradeEntry[], other: TradeEntry[]) =>
    !(side.length >= 1 && other.length >= 2);

  const tryAdd = (
    side: TradeEntry[],
    other: TradeEntry[],
    apply: (e: TradeEntry[]) => void,
    entry: TradeEntry
  ) => {
    if (!canAddTo(side, other)) {
      setLimitMsg(
        'Trade eval is many-vs-one — one side stays a single card'
      );
      return;
    }
    setLimitMsg(null);
    apply([...side, entry]);
  };

  // Your side searches the live inventory store — local, instant. The
  // horizontal carousel underneath keeps the binder browsable without
  // needing to type at all.
  const yourResults = useMemo(() => {
    const q = yourQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return inventory
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.set ?? '').toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [inventory, yourQuery]);

  // Their side searches the shipped catalog — debounced SQLite hits.
  useEffect(() => {
    const q = theirQuery.trim();
    if (q.length < 2) {
      setTheirResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const db = await openCatalogDatabase();
        const res = await searchCatalogCards(
          db,
          { query: q, rarity: 'All', sortBy: 'Name A-Z' },
          8
        );
        setTheirResults(
          res.cards.map((c) => ({
            productId: c.productId,
            name: c.name,
            number: c.number ?? '',
            set: c.set ?? '',
            marketPrice: c.liveMarket ?? 0,
            imageUrl: c.imageUrl || getCatalogImageUri(c.productId),
          }))
        );
      } catch {
        setTheirResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [theirQuery]);

  const addYours = async (invId: string) => {
    const c = inventory.find((i) => i.id === invId);
    if (!c) return;
    setYourQuery('');
    const variants =
      c.productId != null
        ? await tradeVariantsFor(c.productId, c.productType)
        : [];
    tryAdd(yours, theirs, onChangeYours, {
      key: nextTradeEntryKey(),
      inventoryId: c.id,
      paidPrice: c.amountPaid,
      productId: c.productId ?? null,
      subType: c.productType ?? null,
      name: c.name,
      number: c.number,
      set: c.set,
      imageUrl: c.imageUrl,
      qty: 1,
      price: c.liveMarket ?? 0,
      signal: variants.find((v) => v.subType === c.productType)?.signal,
      variants: variants.length > 0 ? variants : undefined,
    });
  };

  const addTheirs = async (r: TradePick) => {
    setTheirQuery('');
    setTheirResults([]);
    const variants = await tradeVariantsFor(r.productId);
    const top = variants[0];
    tryAdd(theirs, yours, onChangeTheirs, {
      key: nextTradeEntryKey(),
      productId: r.productId,
      subType: top?.subType ?? 'Normal',
      name: displayCardName(r.name),
      number: r.number,
      set: r.set,
      imageUrl: r.imageUrl,
      qty: 1,
      price: top?.signal?.price ?? r.marketPrice,
      signal: top?.signal,
      variants: variants.length > 0 ? variants : undefined,
    });
  };

  const bumpQty =
    (entries: TradeEntry[], apply: (e: TradeEntry[]) => void) =>
    (key: string, delta: number) =>
      apply(
        entries.map((e) =>
          e.key === key ? { ...e, qty: Math.max(1, e.qty + delta) } : e
        )
      );

  const removeEntry =
    (entries: TradeEntry[], apply: (e: TradeEntry[]) => void) =>
    (key: string) =>
      apply(entries.filter((e) => e.key !== key));

  return {
    yourQuery,
    setYourQuery,
    yourResults,
    theirQuery,
    setTheirQuery,
    theirResults,
    searching,
    limitMsg,
    addYours,
    addTheirs,
    bumpQty,
    removeEntry,
  };
}
