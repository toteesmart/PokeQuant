import { classifyDeal } from '../src/scanner/services/deal/dealClassify';
import type { CardSignal } from '../src/db/catalogDb';
import { mkFeatures, mkSignal } from './helpers/builders';

// Phase 5 — threshold pins. Every gate in classifyDeal has a numeric
// edge; each pin walks one field to just inside and just outside it
// and asserts the class changes on schedule. A silent threshold drift
// (≤ → <, 15 → 20) flips a pin, not a user's card.

const sig = (over: Partial<CardSignal> = {}): CardSignal =>
  mkSignal({ firstDate: '2024-03-01', ...over });

const cls = (over: Partial<CardSignal>) => classifyDeal(sig(over)).cls;

describe('RANGE_PLAY — the cycler proof bar', () => {
  const base: Partial<CardSignal> = {
    stance: 'neutral',
    trend: 'flat',
    ret30d: -5,
    drawdown: -20,
    pctile1y: 40,
    price: 10.1,
    shelfPrice: 10,
    shelfTests: 3,
    cycleDays: 60,
    medianBouncePct: 20,
    targetPrice: 12,
    high90d: 12.6,
    daysSinceHigh: 400,
  };

  test('3 tests prove the range; 2 keep the shape unconfirmed', () => {
    expect(cls({ ...base, shelfTests: 3 })).toBe('RANGE_PLAY');
    // 2 tests → possibleRange: suppressed out of dump classes, but
    // not a proven cycler either.
    expect(cls({ ...base, shelfTests: 2 })).not.toBe('RANGE_PLAY');
    expect(cls({ ...base, shelfTests: 2 })).not.toBe('FREE_FALL');
    expect(cls({ ...base, shelfTests: 2 })).not.toBe('DECLINER');
  });

  test('cycle window is [21,180] days inclusive', () => {
    expect(cls({ ...base, cycleDays: 21 })).toBe('RANGE_PLAY');
    expect(cls({ ...base, cycleDays: 180 })).toBe('RANGE_PLAY');
    // Sub-21d stamp: micro-chop — the range can't be proven, but the
    // core evidence still suppresses the dump reads (zekrom shape).
    expect(cls({ ...base, cycleDays: 20 })).not.toBe('RANGE_PLAY');
    expect(cls({ ...base, cycleDays: 20 })).not.toBe('POST_SPIKE_BLEED');
    // >180d is glacial: no proof AND no suppression — a knife still
    // cuts through (price held mid-air, off the shelf — a knife ON
    // the shelf is a floor test regardless of cycle evidence).
    const glacial = cls({
      ...base,
      cycleDays: 181,
      ret30d: -15,
      ret7d: -9,
      drawdown: -50,
      trend: 'depreciating',
      pctile1y: 15,
      stance: 'falling',
      price: 13,
    });
    expect(glacial).toBe('FREE_FALL');
  });

  test('median bounce must reach 15% for the proven class', () => {
    expect(cls({ ...base, medianBouncePct: 15 })).toBe('RANGE_PLAY');
    // Under the bar the range is unproven — but bounce is a
    // resolution-sensitive median (like cycle), so a thin stamped
    // read still suppresses the dump family rather than knife.
    expect(cls({ ...base, medianBouncePct: 14.9 })).not.toBe('RANGE_PLAY');
    const weak = cls({
      ...base,
      medianBouncePct: 14.9,
      ret30d: -15,
      ret7d: -9,
      drawdown: -50,
      trend: 'depreciating',
      stance: 'falling',
      pctile1y: 15,
    });
    expect(weak).not.toBe('FREE_FALL');
    expect(weak).not.toBe('DECLINER');
  });

  test('the rhythm leg — an observed held bounce, or a trend that does not contradict it', () => {
    // Item 59 — spiritomb's defect: tests+cycle+bouncePct resolve the
    // metronome and the amplitude, but "bounces on a rhythm" claims a
    // bounce was OBSERVED to hold. The stamped analog ledger is the
    // scalar path's count; a 0-of-N ledger under a depreciating stamp
    // makes the rhythm a fiction.
    const dep = { ...base, trend: 'depreciating' as const, cagr: -84 };
    expect(cls({ ...dep, analogBounceN: 0 })).not.toBe('RANGE_PLAY');
    expect(cls({ ...dep, analogBounceN: 1 })).toBe('RANGE_PLAY');
    // A non-contradictory trend keeps stamp-only reads honest where a
    // catalog predates the ledger column (null = pre-ledger row).
    expect(cls({ ...base, analogBounceN: 0 })).toBe('RANGE_PLAY');
    expect(cls({ ...base, analogBounceN: null })).toBe('RANGE_PLAY');
    // The stamp's own verdict is the vocabulary the gate reads — an
    // appreciating stamp on a −84 cagr doesn't contradict the range.
    expect(cls({ ...dep, trend: 'appreciating', analogBounceN: 0 })).toBe('RANGE_PLAY');
  });

  test('ceiling must reach 60% of the recent-regime high', () => {
    // high90d 20 → bound 12: target 12 reaches, 11.9 doesn't.
    const hi = { ...base, high90d: 20, drawdown: -50 };
    expect(cls({ ...hi, targetPrice: 12 })).toBe('RANGE_PLAY');
    expect(cls({ ...hi, targetPrice: 11.9 })).not.toBe('RANGE_PLAY');
  });

  test('the price must live inside the range', () => {
    // Floor 10: 9.7 is parked (≥0.97×), 9.69 is through the floor.
    expect(cls({ ...base, price: 9.7 })).toBe('RANGE_PLAY');
    expect(cls({ ...base, price: 9.69 })).not.toBe('RANGE_PLAY');
    // Ceiling 12: 13.7 is still inside (~1.15×), 13.81 broke out.
    // (12*1.15 lands a hair under 13.8 in IEEE — pin below the exact
    // float boundary so the pin tests the semantic edge.)
    expect(cls({ ...base, price: 13.7, stance: 'neutral' })).toBe('RANGE_PLAY');
    expect(cls({ ...base, price: 13.81, stance: 'neutral' })).not.toBe('RANGE_PLAY');
  });
});

describe('POST_SPIKE_BLEED — the peak-age window', () => {
  const bleed: Partial<CardSignal> = {
    stance: 'falling',
    trend: 'depreciating',
    ret30d: -8,
    drawdown: -30,
    pctile1y: 35,
  };

  test('days-since-high inside [14,365]', () => {
    expect(cls({ ...bleed, daysSinceHigh: 14 })).toBe('POST_SPIKE_BLEED');
    expect(cls({ ...bleed, daysSinceHigh: 365 })).toBe('POST_SPIKE_BLEED');
    expect(cls({ ...bleed, daysSinceHigh: 13 })).not.toBe('POST_SPIKE_BLEED');
    expect(cls({ ...bleed, daysSinceHigh: 366 })).not.toBe('POST_SPIKE_BLEED');
  });

  test('drawdown must be at least -25%', () => {
    expect(cls({ ...bleed, daysSinceHigh: 60, drawdown: -25 })).toBe('POST_SPIKE_BLEED');
    expect(cls({ ...bleed, daysSinceHigh: 60, drawdown: -24.9 })).not.toBe('POST_SPIKE_BLEED');
  });

  test('a -3% leg is enough; -2.9% on both is not sliding', () => {
    expect(cls({ ...bleed, daysSinceHigh: 60, ret30d: -3 })).toBe('POST_SPIKE_BLEED');
    expect(cls({ ...bleed, daysSinceHigh: 60, ret30d: -2.9, ret7d: -2.9 })).not.toBe(
      'POST_SPIKE_BLEED',
    );
    expect(cls({ ...bleed, daysSinceHigh: 60, ret30d: -2.9, ret7d: -3 })).toBe('POST_SPIKE_BLEED');
  });
});

describe('knife gates — speed and structure', () => {
  const knife: Partial<CardSignal> = {
    stance: 'falling',
    trend: 'depreciating',
    drawdown: -50,
    pctile1y: 10,
    daysSinceHigh: 400,
  };

  test('month knife at -10%, week knife at -7%', () => {
    expect(cls({ ...knife, ret30d: -10, ret7d: 0 })).toBe('FREE_FALL');
    expect(cls({ ...knife, ret30d: -9.9, ret7d: 0 })).not.toBe('FREE_FALL');
    expect(cls({ ...knife, ret30d: 0, ret7d: -7 })).toBe('FREE_FALL');
    expect(cls({ ...knife, ret30d: 0, ret7d: -6.9 })).not.toBe('FREE_FALL');
  });

  test('a week knife on a green-month appreciating card is a giveback', () => {
    // The golduck veto: r30>0 + appreciating → no FREE_FALL even at
    // knife speed. r30=0 doesn't count as green.
    expect(cls({ ...knife, trend: 'appreciating', ret30d: 5, ret7d: -20 })).not.toBe('FREE_FALL');
    expect(cls({ ...knife, trend: 'appreciating', ret30d: 0, ret7d: -20 })).toBe('FREE_FALL');
    expect(cls({ ...knife, trend: 'flat', ret30d: 5, ret7d: -20 })).toBe('FREE_FALL');
  });

  test('a knife landing on a defended floor tests it — fresh low ≠ floor', () => {
    // Defense means a REAL shelf in proximity — a stamped deep shelf
    // under the price. Sitting on the 90d low proves nothing: a
    // falling card's price IS its recent low (petilil's $19.87 knife
    // read "testing" off the low while its real shelf sat at $10.13).
    const onFloor = {
      ...knife,
      ret30d: -15,
      ret7d: -8,
      price: 5,
      low90d: 5.0,
      shelfPrice: 5.0,
      shelfTests: 6,
    };
    expect(cls({ ...onFloor, cagr: -14.9 })).toBe('BASE_FORMING');
    // A spent card on a real shelf is still a floor test — the shelf
    // holds or it doesn't, and "whether it holds is the decision" is
    // honest regardless of the lifetime grade (the inventory's spent
    // knives on tested shelves were silently dumping into dead).
    expect(cls({ ...onFloor, cagr: -15.1 })).toBe('BASE_FORMING');
    // No real floor under the knife → the knife read stands. A fresh
    // 90d low alone can't call it a floor test.
    const noShelf = { ...onFloor, shelfPrice: null, shelfTests: null };
    expect(cls({ ...noShelf, cagr: -14.9 })).toBe('FREE_FALL');
    expect(cls({ ...noShelf, cagr: -15.1 })).toBe('FREE_FALL');
  });
});

describe('REVIVAL — the quiet-card momentum bar', () => {
  const quiet: Partial<CardSignal> = {
    stance: 'neutral',
    trend: 'flat',
    cagr: -5,
    pctile1y: 25,
    drawdown: -35,
    daysSinceHigh: 200,
  };

  test('needs r7 ≥5 or r30 ≥10 to be moving', () => {
    expect(cls({ ...quiet, ret7d: 5, ret30d: 8, ma20_60: 1 })).toBe('REVIVAL');
    expect(cls({ ...quiet, ret7d: 4.9, ret30d: 9.9, ma20_60: 1 })).not.toBe('REVIVAL');
    expect(cls({ ...quiet, ret7d: 0, ret30d: 10, ma20_60: 1 })).toBe('REVIVAL');
  });

  test('a red week kills the revival', () => {
    expect(cls({ ...quiet, ret7d: -3, ret30d: 12 })).not.toBe('REVIVAL');
    expect(cls({ ...quiet, ret7d: -2.9, ret30d: 12 })).toBe('REVIVAL');
  });

  test('needs confirmation — a strong month confirms itself at ≥12', () => {
    expect(cls({ ...quiet, ret7d: 2, ret30d: 12, slope30d: -1, ma20_60: -1 })).toBe('REVIVAL');
    expect(cls({ ...quiet, ret7d: 2, ret30d: 11.9, slope30d: -1, ma20_60: -1 })).not.toBe(
      'REVIVAL',
    );
  });

  test('high-range compounders are dips getting bought, not revivals', () => {
    const rich = {
      ...quiet,
      ret30d: 14,
      ma20_60: 1,
      drawdown: -10,
      daysSinceHigh: 30,
    };
    expect(cls({ ...rich, pctile1y: 60, cagr: 11 })).not.toBe('REVIVAL');
    expect(cls({ ...rich, pctile1y: 59.9, cagr: 11 })).toBe('REVIVAL');
    expect(cls({ ...rich, pctile1y: 60, cagr: 10 })).toBe('REVIVAL');
  });
});

describe('BASE_FORMING·resting — quiet drawdown on a floor', () => {
  // dsh 400 + dd -22 keeps POST_SPIKE_BLEED out of the picture so the
  // resting read is what actually answers.
  const restingBase: Partial<CardSignal> = {
    stance: 'neutral',
    trend: 'flat',
    cagr: -5,
    drawdown: -22,
    pctile1y: 20,
    daysSinceHigh: 400,
    price: 5,
    low90d: 5.0,
  };

  test('drawdown must be at least -20%', () => {
    expect(cls({ ...restingBase, ret30d: 2, drawdown: -20 })).toBe('BASE_FORMING');
    expect(cls({ ...restingBase, ret30d: 2, drawdown: -19.9 })).not.toBe('BASE_FORMING');
  });

  test('a green month past +10 with confirmation is a revival instead', () => {
    // |r30| ≤12 admits the resting read, but a confirmed ≥10 month is
    // a revival first — the resting band is reachable r30 ∈ [-12, 10).
    expect(cls({ ...restingBase, ret30d: 10, ma20_60: -1 })).toBe('BASE_FORMING');
    expect(cls({ ...restingBase, ret30d: 10, ma20_60: 1 })).toBe('REVIVAL');
  });

  test('month must be steadied — r30 past -10 is a knife on the floor', () => {
    // r30 ≤-10 is knife speed — and a knife parked on a defended
    // floor is "testing the floor" (BASE_FORMING·testing), not
    // resting. Resting owns the steadied band only. The floor must
    // be real — restingBase's low90d alone doesn't defend anything.
    const onShelf = { ...restingBase, shelfPrice: 5.0, shelfTests: 4 };
    const resting = classifyDeal(sig({ ...onShelf, ret30d: -9, trend: 'flat' }));
    expect(resting.cls).toBe('BASE_FORMING');
    expect(resting.variant).toBe('resting');
    const testing = classifyDeal(sig({ ...onShelf, ret30d: -10.1, trend: 'depreciating' }));
    expect(testing.cls).toBe('BASE_FORMING');
    expect(testing.variant).toBe('testing');
  });
});

describe('depressed stance — the pctile ≤40 fork', () => {
  // dd -60 keeps drawdown context real; dsh 400 keeps POST_SPIKE_BLEED
  // from swallowing the cheap-card reads before the depressed branch.
  const cheap: Partial<CardSignal> = {
    stance: 'depressed',
    trend: 'flat',
    cagr: -5,
    drawdown: -60,
    daysSinceHigh: 400,
  };

  test('pctile 40 splits the branch', () => {
    // Cheap + flat + alive → DORMANT inside the branch; just above the
    // pctile bar the stamp can't call it cheap → generic flat read.
    expect(cls({ ...cheap, pctile1y: 40 })).toBe('DORMANT');
    expect(cls({ ...cheap, pctile1y: 40.1 })).toBe('STABLE_FLAT');
  });

  test('inside the branch: bleeding→DECLINER, spent→DEAD, else DORMANT', () => {
    // The r90-clause bleed (r30 -5, no knife speed) keeps FREE_FALL
    // out — a knife-fast leg would outrank the cheap branch entirely.
    expect(
      cls({
        ...cheap,
        pctile1y: 20,
        trend: 'depreciating',
        ret30d: -5,
        ret90d: -16,
        spanDays: 600,
      }),
    ).toBe('DECLINER');
    // dd -19 keeps BASE_FORMING·resting out so the depressed branch
    // itself decides between spent (DEAD_STABLE) and alive (DORMANT).
    expect(cls({ ...cheap, pctile1y: 20, cagr: -20, drawdown: -19 })).toBe('DEAD_STABLE');
    expect(cls({ ...cheap, pctile1y: 20, cagr: -5, drawdown: -19 })).toBe('DORMANT');
    // An appreciating stamp can't be "spent" — falls to the grower.
    expect(
      cls({ ...cheap, pctile1y: 20, cagr: -20, drawdown: -19, trend: 'appreciating', ret7d: 0 }),
    ).toBe('STABLE_GROWER');
  });
});

describe('cooling grower + appreciating catch-all', () => {
  test('cooling grower needs (cagr≥25 ∧ pctile≥50) or (cagr≥10 ∧ pctile≥60)', () => {
    const shape = {
      stance: 'neutral' as const,
      trend: 'flat' as const,
      ret90d: -5,
      ret30d: -2,
      drawdown: -15,
      daysSinceHigh: 90,
    };
    expect(cls({ ...shape, cagr: 25, pctile1y: 50 })).toBe('STABLE_GROWER');
    expect(cls({ ...shape, cagr: 24.9, pctile1y: 50 })).not.toBe('STABLE_GROWER');
    expect(cls({ ...shape, cagr: 25, pctile1y: 49.9 })).not.toBe('STABLE_GROWER');
    expect(cls({ ...shape, cagr: 10, pctile1y: 60 })).toBe('STABLE_GROWER');
    expect(cls({ ...shape, cagr: 9.9, pctile1y: 60 })).not.toBe('STABLE_GROWER');
    expect(cls({ ...shape, cagr: 10, pctile1y: 59.9 })).not.toBe('STABLE_GROWER');
    // The quarter must be flat-or-red; a green quarter isn't cooling.
    expect(cls({ ...shape, cagr: 25, pctile1y: 50, ret90d: 0.1 })).not.toBe('STABLE_GROWER');
    // The month can't be down hard — r30 > -10 required.
    expect(cls({ ...shape, cagr: 25, pctile1y: 50, ret30d: -9.9 })).toBe('STABLE_GROWER');
    expect(cls({ ...shape, cagr: 25, pctile1y: 50, ret30d: -10 })).not.toBe('STABLE_GROWER');
  });

  test('appreciating catch-all dies on a -7% week', () => {
    // cagr 5 / pctile 45 misses the cooling-grower gate so the
    // catch-all's own week-knife veto is what decides.
    const up = {
      stance: 'neutral' as const,
      trend: 'appreciating' as const,
      cagr: 5,
      pctile1y: 45,
      drawdown: -5,
      ret30d: 2,
    };
    expect(cls({ ...up, ret7d: -6.9 })).toBe('STABLE_GROWER');
    expect(cls({ ...up, ret7d: -7 })).not.toBe('STABLE_GROWER');
  });
});

describe('DECLINER / DEAD_STABLE / STABLE_FLAT tail gates', () => {
  test('depreciating + still bleeding → DECLINER at exactly the bleeding bar', () => {
    // The bleed is charged on the r90 clause (r90≤-15 ∧ r30≤-3) —
    // keeping r30 above knife speed (-10) so FREE_FALL can't take it,
    // and dsh 400 sits past the bleed window so PSB can't either.
    const leak = {
      stance: 'neutral' as const,
      trend: 'depreciating' as const,
      cagr: -20,
      drawdown: -40,
      pctile1y: 30,
      daysSinceHigh: 400,
      ret7d: 0,
      ret90d: -16,
      spanDays: 600,
    };
    // r30 -3 is the clause's bar; -2.9 doesn't bleed.
    expect(cls({ ...leak, ret30d: -3 })).toBe('DECLINER');
    expect(cls({ ...leak, ret30d: -2.9 })).not.toBe('DECLINER');
    // And the r90 leg itself: -15 bleeds, -14.9 doesn't.
    expect(cls({ ...leak, ret30d: -5, ret90d: -15 })).toBe('DECLINER');
    expect(cls({ ...leak, ret30d: -5, ret90d: -14.9 })).not.toBe('DECLINER');
  });

  test('falling stamp + flat-or-red legs → DECLINER; a green leg stops it', () => {
    const stamped = {
      stance: 'falling' as const,
      trend: 'flat' as const,
      cagr: -5,
      drawdown: -15,
      pctile1y: 45,
      daysSinceHigh: 60,
    };
    expect(cls({ ...stamped, ret30d: 0, ret7d: 0 })).toBe('DECLINER');
    expect(cls({ ...stamped, ret30d: 0.1, ret7d: 0 })).not.toBe('DECLINER');
    expect(cls({ ...stamped, ret30d: 0, ret7d: 0.1 })).not.toBe('DECLINER');
  });

  test('cagr ≤-15 + non-appreciating → DEAD_STABLE; else STABLE_FLAT', () => {
    const flat = {
      stance: 'neutral' as const,
      trend: 'flat' as const,
      drawdown: -5,
      pctile1y: 55,
      daysSinceHigh: 30,
    };
    expect(cls({ ...flat, cagr: -15 })).toBe('DEAD_STABLE');
    expect(cls({ ...flat, cagr: -14.9 })).toBe('STABLE_FLAT');
    expect(cls({ ...flat, cagr: -15, trend: 'appreciating', ret7d: 0 })).toBe('STABLE_GROWER');
  });

  test("a card still bleeding can't be DEAD_STABLE or STABLE_FLAT", () => {
    // The inventory dead-bucket leak: "Flat now — long-term it's
    // spent" was printing on cards down 20–44% in the month. Flat
    // now has to be earned — a bleeding tail card is a drifter.
    const flat = {
      stance: 'neutral' as const,
      trend: 'flat' as const,
      drawdown: -5,
      pctile1y: 55,
      daysSinceHigh: 30,
    };
    expect(cls({ ...flat, cagr: -15, ret30d: -12 })).toBe('DECLINER');
    expect(cls({ ...flat, cagr: -5, ret30d: -12 })).toBe('DECLINER');
    // The r90 clause too — a flat card sitting inside a real red
    // quarter is still a drifter, not a flat band.
    expect(cls({ ...flat, cagr: -15, ret30d: -5, ret90d: -16, spanDays: 600 })).toBe('DECLINER');
  });

  test('a suppressed possible-cycler bleeding on its floor tests, never dies', () => {
    // The possRANGE→dead leak: the cyc<21 micro-chop stamp suppresses
    // the dump reads, then the spent cagr used to land DEAD_STABLE —
    // "flat now, spent" on a −18% month. The suppression's honest
    // landing is the floor test (watch); only a feeble-bounce floor
    // demotes it back to the bleed read.
    const suppressed = {
      stance: 'neutral' as const,
      trend: 'depreciating' as const,
      cagr: -60,
      drawdown: -50,
      pctile1y: 20,
      daysSinceHigh: 300,
      spanDays: 600,
      ret7d: 0,
      ret30d: -5,
      ret90d: -18,
      price: 3.0,
      shelfPrice: 2.95,
      shelfTests: 12,
      cycleDays: 8,
      medianBouncePct: 19,
      high90d: 4.0,
    };
    const read = classifyDeal(sig(suppressed));
    expect(read.cls).toBe('BASE_FORMING');
    expect(read.variant).toBe('testing');
    // Same shape with a feeble-bounce floor: the spent card's pops
    // aren't worth holding for — the drifter read wins.
    expect(cls({ ...suppressed, medianBouncePct: 13 })).toBe('DECLINER');
  });
});

describe('stillBleeding r90 clause — the young-window exemption', () => {
  const bleedShape: Partial<CardSignal> = {
    stance: 'neutral',
    trend: 'depreciating',
    cagr: -20,
    drawdown: -40,
    pctile1y: 30,
    // dsh 400 sits past the bleed window so the DECLINER gate below
    // is what answers, not POST_SPIKE_BLEED.
    daysSinceHigh: 400,
    ret7d: 0,
    ret30d: -5,
    ret90d: -16,
  };

  test('the r90 clause needs a 120d+ history to testify', () => {
    expect(cls({ ...bleedShape, spanDays: 120 })).toBe('DECLINER');
    // Under 120d the r90 window IS the launch crash — no bleed charge.
    expect(cls({ ...bleedShape, spanDays: 119 })).not.toBe('DECLINER');
  });
});

describe('stamped floor parking — shelf proximity band', () => {
  const parked: Partial<CardSignal> = {
    stance: 'neutral',
    trend: 'flat',
    cagr: -5,
    drawdown: -30,
    daysSinceHigh: 150,
    ret30d: 2,
    shelfPrice: 10,
    shelfTests: 2,
  };

  test('price inside [0.97×, 1.15×] of the shelf counts as sitting', () => {
    // The resting read claims "holding a floor" — parked ON it. The
    // band matches the series' own tightness (~×1.15): wider reach is
    // a directional claim, not a parked one (item 54's split).
    expect(cls({ ...parked, price: 9.7 })).toBe('BASE_FORMING');
    expect(cls({ ...parked, price: 9.69 })).not.toBe('BASE_FORMING');
    expect(cls({ ...parked, price: 11.5 })).toBe('BASE_FORMING');
    expect(cls({ ...parked, price: 11.6 })).not.toBe('BASE_FORMING');
  });

  test('the knife read still uses the wider ×1.25 reach band', () => {
    // Directional, not parked: a knife falling toward a held shelf
    // inside reach tests it — "falling toward a low" stays honest at
    // ×1.20 where "sitting on a low" would lie (item 54's split).
    const knifeOnShelf = {
      ...parked,
      stance: 'falling' as const,
      trend: 'depreciating' as const,
      cagr: -14.9,
      ret30d: -15,
      ret7d: -8,
      drawdown: -50,
      pctile1y: 10,
      daysSinceHigh: 400,
      low90d: 4.5,
      shelfPrice: 5,
      shelfTests: 6,
    };
    expect(cls({ ...knifeOnShelf, price: 6 })).toBe('BASE_FORMING'); // ×1.20 — in reach
    expect(cls({ ...knifeOnShelf, price: 6.5 })).toBe('FREE_FALL'); // ×1.30 — out of reach
  });

  test('a stamped shelf counts at any test depth — existence, not proof', () => {
    // The deep stamp resolves the shelf; tests measure bounce quality,
    // not whether the level exists. One stamped test still parks.
    expect(cls({ ...parked, price: 10, shelfTests: 1 })).toBe('BASE_FORMING');
    // But a card with no stamped shelf at all still isn't parked.
    expect(cls({ ...parked, price: 10, shelfPrice: null, shelfTests: null })).not.toBe(
      'BASE_FORMING',
    );
  });
});

describe('isYoung — the launch window', () => {
  const youngKnife: Partial<CardSignal> = {
    stance: 'neutral',
    trend: 'depreciating',
    ret30d: -20,
    drawdown: -60,
    pctile1y: 10,
  };

  test('firstDate after the collection floor AND ≤200d span', () => {
    expect(cls({ ...youngKnife, firstDate: '2025-06-01', spanDays: 200 })).toBe('HYPE_DECAY');
    expect(cls({ ...youngKnife, firstDate: '2025-06-01', spanDays: 201 })).not.toBe('HYPE_DECAY');
    // A card printed before collection started can't be "young".
    expect(cls({ ...youngKnife, firstDate: '2024-03-01', spanDays: 100 })).not.toBe('HYPE_DECAY');
  });

  test('needs a real drawdown and a red leg', () => {
    const young = { firstDate: '2025-06-01', spanDays: 100 };
    expect(cls({ ...youngKnife, ...young, drawdown: -15 })).toBe('HYPE_DECAY');
    expect(cls({ ...youngKnife, ...young, drawdown: -14.9 })).not.toBe('HYPE_DECAY');
    expect(cls({ ...youngKnife, ...young, ret30d: 0, ret7d: 0 })).not.toBe('HYPE_DECAY');
  });
});

describe('DIP_BUY — the leg-speed brake', () => {
  // A dip inside an intact uptrend is only a dip inside the brake
  // band — at the knife doctrine's own extreme-speed bar the leg IS
  // the crash and the falling block's phase logic takes it.
  const dip: Partial<CardSignal> = {
    stance: 'falling',
    trend: 'appreciating',
    cagr: 40,
    ret90d: 15,
    ret30d: -8,
    ret7d: -3,
    drawdown: -15,
    pctile1y: 70,
    daysSinceHigh: 30,
    price: 10,
  };

  test('week knife at -15% brakes the dip; -14.9% stays a dip', () => {
    expect(cls({ ...dip, ret7d: -15 })).toBe('FREE_FALL');
    expect(cls({ ...dip, ret7d: -14.9 })).toBe('DIP_BUY');
  });

  test('month knife at -20% brakes the dip; -19.9% stays a dip', () => {
    expect(cls({ ...dip, ret30d: -20 })).toBe('FREE_FALL');
    expect(cls({ ...dip, ret30d: -19.9 })).toBe('DIP_BUY');
  });

  test('the brake reads the resolved leg — series r7 overrides the stamp', () => {
    // Stamp says calm (−3% week) but the window saw the −20% crash —
    // features win over stamps (invariant: fresher legs beat stamps).
    expect(classifyDeal(sig(dip), mkFeatures({ ret7d: -20, ret30d: -8 })).cls).toBe('FREE_FALL');
    // And the reverse: a stamped knife the window watched recover —
    // the recovered leg IS the fresher read, so the dip stands.
    expect(
      classifyDeal(sig({ ...dip, ret7d: -20 }), mkFeatures({ ret7d: -3, ret30d: -8 })).cls,
    ).toBe('DIP_BUY');
  });
});

describe('AT_PEAK — the peak-state split', () => {
  const peak: Partial<CardSignal> = {
    stance: 'elevated_rising',
    pctile1y: 95,
    drawdown: -2,
    daysSinceHigh: 2,
  };

  test('r7 < -3 starts the fade; r30 < 0 makes it a top', () => {
    expect(classifyDeal(sig({ ...peak, ret7d: -3, ret30d: 0 })).peakState).toBe('intact');
    expect(classifyDeal(sig({ ...peak, ret7d: -3.1, ret30d: 0 })).peakState).toBe('fading');
    expect(classifyDeal(sig({ ...peak, ret7d: -3.1, ret30d: -0.1 })).peakState).toBe('topping');
  });

  test('a knife-speed leg is topping whatever the partner leg prints', () => {
    // −25% week on a still-green month: "cooling" was the speed-blind
    // read — the roll-over already happened.
    expect(classifyDeal(sig({ ...peak, ret7d: -25, ret30d: 6 })).peakState).toBe('topping');
    expect(classifyDeal(sig({ ...peak, ret7d: -14.9, ret30d: 6 })).peakState).toBe('fading');
    // The month bar too — a −20% month with a flat week can't be
    // "still intact".
    expect(classifyDeal(sig({ ...peak, ret7d: -1, ret30d: -20 })).peakState).toBe('topping');
    expect(classifyDeal(sig({ ...peak, ret7d: -1, ret30d: -19.9 })).peakState).toBe('intact');
  });
});

describe('LOW_DATA — the gate before everything', () => {
  test('UNRATED or missing action or missing price → LOW_DATA', () => {
    expect(cls({ action: 'UNRATED' })).toBe('LOW_DATA');
    expect(cls({ action: null })).toBe('LOW_DATA');
    expect(cls({ price: null })).toBe('LOW_DATA');
    expect(cls({ action: 'NEUTRAL', price: 10 })).not.toBe('LOW_DATA');
  });
});
