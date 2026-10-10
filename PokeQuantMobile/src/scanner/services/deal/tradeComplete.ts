import { getDatabase } from '../../../db/database';
import { useAuthStore } from '../../../store/authStore';
import { useInventoryStore } from '../../../store/inventoryStore';
import { recordTradeLog, type TradeLeg } from './tradeLogDb';
import type { TradeEntry, TradeVerdict } from './tradeEval';

// Completes a trade as real bookkeeping:
//   outgoing → marked sold at its share of everything received, so the
//              realized P&L reflects the trade's true value
//   incoming → added to active inventory with a carry-over cost basis
//              (what the surrendered cards cost you, ± cash) — the
//              like-kind exchange rule; if a card's original cost was
//              never recorded, its face at trade time stands in
//   both     → one trade_log row for the analytics "Traded" badge
//
// Basis pool = Σ(surrendered basis) + your cash − their cash, floored
// at 0. It's allocated across incoming cards pro-rata by face, so a
// N-for-1 trade rolls the full bundle cost into the one card you get.

export type CompleteTradeResult = {
  ok: boolean;
  message: string;
};

export async function completeTrade(
  yours: TradeEntry[],
  theirs: TradeEntry[],
  verdict: TradeVerdict,
  yourCash: number,
  theirCash: number
): Promise<CompleteTradeResult> {
  const store = useInventoryStore.getState();
  const db = getDatabase();
  const userId = useAuthStore.getState().userId ?? '';

  const yourFace = verdict.yourSide.total;
  const given = yourFace + yourCash;
  const received = verdict.theirCredit + theirCash;
  if (given <= 0 && received <= 0) {
    return { ok: false, message: 'Nothing to trade yet' };
  }

  // ---- Outgoing: sell each inventory card at its share of the pot ----
  // A card's proceeds = its face fraction of the bundle × everything
  // received. Cash you gave is an expense, not part of the cards' sale.
  const givenLegs: TradeLeg[] = [];
  let surrenderedBasis = 0;
  for (const e of yours) {
    const cardFace = e.price * e.qty;
    const basis =
      e.paidPrice != null && e.paidPrice > 0 ? e.paidPrice : cardFace;
    surrenderedBasis += basis;
    givenLegs.push({
      inventoryId: e.inventoryId,
      name: e.name,
      qty: e.qty,
      face: cardFace,
      basis,
    });
  }

  for (const e of yours) {
    if (!e.inventoryId) continue; // can't sell a card we don't hold
    const proceeds = given > 0 ? (e.price / given) * received : 0;
    await store.sellInventoryCard(e.inventoryId, Math.max(0, proceeds));
  }

  // ---- Incoming: carry-over basis allocated by face share ----
  const theirFace = verdict.theirSide.total;
  const basisPool = Math.max(0, surrenderedBasis + yourCash - theirCash);
  const receivedLegs: TradeLeg[] = [];
  const inputs: Parameters<typeof store.addScannedCards>[0] = [];

  for (const e of theirs) {
    const entryFace = e.price * e.qty;
    const basisShare =
      theirFace > 0 ? (entryFace / theirFace) * basisPool : 0;
    receivedLegs.push({
      name: e.name,
      qty: e.qty,
      face: entryFace,
      basis: basisShare,
    });
    // One inventory row per physical card — qty expands into copies.
    for (let i = 0; i < e.qty; i++) {
      inputs.push({
        name: e.name,
        number: e.number,
        set: e.set,
        productType: e.subType ?? undefined,
        condition: 'NM',
        liveMarket: e.price,
        amountPaid: e.qty > 0 ? basisShare / e.qty : 0,
        productId: e.productId,
        imageUrl: e.imageUrl,
      });
    }
  }
  if (inputs.length > 0) {
    await store.addScannedCards(inputs);
  }

  // ---- Ledger ----
  // Reason — cash shows up inside the give/get sides so pure-cash deals
  // read naturally ("gave $8.00 cash → got Lunatone").
  const gotParts = receivedLegs.map((l) => l.name);
  if (theirCash > 0) gotParts.push(`$${Math.round(theirCash)} cash`);
  const gaveParts = givenLegs.map((l) => l.name);
  if (yourCash > 0) gaveParts.push(`$${Math.round(yourCash)} cash`);
  const got = gotParts.join(' + ') || 'nothing';
  const gave = gaveParts.join(' + ') || 'nothing';
  const verdictLabel =
    verdict.verdict === 'win'
      ? 'WIN'
      : verdict.verdict === 'lose'
        ? 'RISKY'
        : 'NEUTRAL';
  // Rate label only makes sense when cards were actually discounted —
  // a pure-cash sale never touched the convention.
  const rateNote =
    receivedLegs.length > 0 && verdict.ratePct < 100
      ? ` @ ${verdict.ratePct}%`
      : '';
  const reason = `${verdictLabel} · gave ${gave} → got ${got}${rateNote}`;

  if (db) {
    await recordTradeLog(db, {
      userId,
      given: givenLegs,
      received: receivedLegs,
      yourCash,
      theirCash,
      ratePct: verdict.ratePct,
      verdict: verdict.verdict,
      tradeDelta: verdict.smartDelta,
      reason: reason.slice(0, 200),
    });
  }

  return {
    ok: true,
    message:
      verdict.verdict === 'lose'
        ? 'Trade logged as risky'
        : verdict.verdict === 'win'
          ? 'Trade logged as a win'
          : 'Trade logged',
  };
}
