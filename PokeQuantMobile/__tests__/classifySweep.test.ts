import { classifyDeal, ownerNote, offerBand } from '../src/scanner/services/deal/dealClassify';
import type { SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import type { CardSignal } from '../src/db/catalogDb';
import { mkFeatures, mkSignal } from './helpers/builders';
import { collectProblems, renderSurfaces } from './helpers/stack';

// Synthetic sweep — every plausible (stance × trend × shape) combo gets
// classified, then flagged when the read contradicts its own inputs.
// Not a correctness proof — a nonsense detector. Each flag class here
// corresponds to a misread family the real cards surfaced one at a time.

const sig = (over: Partial<CardSignal> = {}): CardSignal => mkSignal(over);

const feat = (over: Partial<SeriesFeatures> = {}): SeriesFeatures => mkFeatures(over);

// Floor-state variants — the interaction space where the misreads lived.
const floorStates: Record<string, (r30: number, dsh: number, price: number) => SeriesFeatures> = {
  none: (r30, dsh) => feat({ ret30d: r30, daysSinceAth: dsh }),
  parkedStrong: (r30, dsh, price) =>
    feat({
      ret30d: r30,
      daysSinceAth: dsh,
      atShelf: true,
      atFloor: true,
      floorPrice: price * 0.92,
      floorTests: 5,
      medianBouncePct: 28,
      medianBounceDays: 20,
    }),
  parkedWeak: (r30, dsh, price) =>
    feat({
      ret30d: r30,
      daysSinceAth: dsh,
      atShelf: true,
      floorPrice: price * 0.92,
      floorTests: 6,
      medianBouncePct: 12, // tested, never defended (yamper)
      medianBounceDays: 2,
    }),
  midAir: (r30, dsh, price) =>
    feat({
      ret30d: r30,
      daysSinceAth: dsh,
      atShelf: false,
      atFloor: false,
      floorPrice: price * 0.35, // real shelf, far below (petilil)
      floorTests: 5,
      medianBouncePct: 30,
    }),
  failedPark: (r30, dsh, price) =>
    feat({
      ret30d: r30,
      daysSinceAth: dsh,
      atShelf: true,
      atFloor: true,
      failedBounce: true, // bounced once, died back on it (toucannon)
      floorPrice: price * 0.97,
      floorTests: 7,
      medianBouncePct: 18,
      medianBounceDays: 6,
    }),
  // A proven cycler parked at the buy end — RANGE_PLAY should claim
  // these regardless of the stamped leg: position over speed.
  cycler: (r30, dsh, price) =>
    feat({
      ret30d: r30,
      daysSinceAth: dsh,
      lastPrice: price,
      atFloor: true,
      floorPrice: price * 0.92,
      floorTests: 4,
      cycleDays: 90,
      medianBouncePct: 30,
      sellIntoPrice: price * 1.1,
    }),
};

const stances = ['falling', 'depressed', 'neutral', 'elevated', 'elevated_rising'];
const trends = ['appreciating', 'flat', 'depreciating'];
const dds = [-5, -30, -70];
const r30s = [10, -2, -15];
const r90s = [25, -5, -35];
const cagrs = [60, 0, -45];
const pctiles = [15, 60];
const dshs = [10, 120, 400];
const spans = [90, 600];

// Week-leg shapes — r7 is NOT a fraction of r30. Real cards diverge:
// golduck was +34.6% on the month with a −20% week (a giveback inside
// a run), and a recovering card is +week inside a red month. Coupling
// r7 to r30 made that whole family invisible to the sweep.
const r7Shapes: Record<string, (r30: number) => number> = {
  tracks: (r30) => r30 / 3, // week loosely tracks the month
  knife: () => -20, // week crashes regardless of the month leg
  bounce: () => 10, // week green regardless of the month leg
};

type Flag = { rule: string; desc: string };

const GOOD_CLASSES = new Set(['REVIVAL', 'DIP_BUY', 'STABLE_GROWER', 'AT_PEAK', 'STABLE_FLAT']);
const BAD_CLASSES = new Set([
  'FREE_FALL',
  'HYPE_DECAY',
  'POST_SPIKE_BLEED',
  'DECLINER',
  // DEAD_STABLE excluded — "no growth left" isn't a crash claim; a
  // green month on a spent card is a bounce, not a restart (emcees).
]);

function flagRead(
  ruleCtx: string,
  s: CardSignal,
  fs: SeriesFeatures,
  variant: string,
  flags: Flag[],
) {
  const read = classifyDeal(s, variant === 'none' ? undefined : fs);
  // The gate resolves legs features-first — every leg bar below must
  // read the same resolved values, not the stamps, or a floorStates
  // builder that ever sets ret* would false-flag a correct read
  // (variant 'none' ships no features — stamped legs ARE resolved).
  const r7 = (variant === 'none' ? null : fs.ret7d) ?? s.ret7d ?? 0;
  const r30 = (variant === 'none' ? null : fs.ret30d) ?? s.ret30d ?? 0;
  const parked =
    fs.atShelf ||
    fs.atFloor ||
    (fs.floorPrice != null && (fs.lastPrice ?? 0) <= fs.floorPrice * 1.25);
  const bleeding =
    r7 <= -7 ||
    r30 <= -10 ||
    ((s.spanDays == null || s.spanDays >= 120) && (s.ret90d ?? 0) <= -15 && r30 <= -3);

  // 1. A knife getting a buyer's green read. DIP_BUY's exemption is
  // now its brake band — the gate falls through at this rule's own
  // knife bar (r30 ≤ −20 / r7 ≤ −15), so a DIP_BUY landing here is a
  // brake regression like any other green read, not a dip doing its
  // job.
  if ((r30 <= -20 || r7 <= -15) && GOOD_CLASSES.has(read.cls)) {
    flags.push({
      rule: 'knife-gets-green-read',
      desc: `${ruleCtx} → ${read.cls} on r30=${r30}`,
    });
  }
  // 2. A green month still called a crash story
  if (r30 >= 10 && BAD_CLASSES.has(read.cls)) {
    flags.push({
      rule: 'green-month-gets-crash',
      desc: `${ruleCtx} → ${read.cls} on r30=${r30}`,
    });
  }
  // 3. Parked-on-floor suppression must hold in every surface — but
  // only once the month has steadied. A −15% month sitting on a floor
  // is still sliding (toucannon), not basing.
  if (
    parked &&
    variant !== 'none' &&
    r30 > -12 &&
    (read.cls === 'HYPE_DECAY' || read.cls === 'POST_SPIKE_BLEED')
  ) {
    flags.push({
      rule: 'parked-floor-still-slide',
      desc: `${ruleCtx} variant=${variant} → ${read.cls}`,
    });
  }
  // 4. "Basing" while actively bleeding out
  if (read.cls === 'BASE_FORMING' && read.variant === 'resting' && bleeding) {
    flags.push({
      rule: 'basing-while-bleeding',
      desc: `${ruleCtx} → BASE_FORMING resting on stillBleeding`,
    });
  }
  // 5. Band sanity — dollars on a $100 base: never an insult open,
  // never inverted, never more than 10% over rate.
  const band = offerBand(read, 100);
  if (!(band.open >= 70 && band.open <= band.max && band.max <= 110)) {
    flags.push({
      rule: 'band-insane',
      desc: `${ruleCtx} → ${read.cls} band ${band.open}-${band.max}`,
    });
  }
  // 6. Owner note must not claim a floor the price isn't at (petilil).
  // The context floor is the variant's own shelf — a note claiming to
  // be parked while price is 30%+ above that level is lying.
  const note = ownerNote(read, variant === 'none' ? undefined : fs, {
    price: 10,
    floor: fs.floorPrice,
    vsCost: -30,
    daysHeld: 60,
  });
  const floorClaim =
    /parked on|knifed back to|floor's held|floor that's held|holding its floor|been tested/i.test(
      note,
    );
  const distantFloor = fs.floorPrice != null ? 10 > fs.floorPrice * 1.3 : true;
  // 'none' has no series floor to contradict — generic class language
  // ("holding its floor") isn't a proximity lie.
  if (variant !== 'none' && floorClaim && distantFloor && !(fs.atShelf || fs.atFloor)) {
    flags.push({
      rule: 'note-claims-distant-floor',
      desc: `${ruleCtx} → ${read.cls}: "${note.slice(0, 60)}"`,
    });
  }
}

// Direction family — what the surfaces prescribe. The series pass may
// refine the class on evidence the stamp lacks, but it may never point
// the opposite way: add↔dump crossings are user-visible contradictions
// (badge says buy, sheet says dump — leafeon was this class of bug).
type Fam = 'add' | 'keep' | 'dump';
function familyOf(read: { cls: string; variant?: string }): Fam {
  switch (read.cls) {
    case 'REVIVAL':
    case 'DIP_BUY':
    case 'STABLE_GROWER':
      return 'add';
    case 'RANGE_PLAY':
      return read.variant === 'exit' ? 'dump' : read.variant === 'entry' ? 'add' : 'keep';
    case 'BASE_FORMING':
      return read.variant === 'testing' ? 'keep' : 'add';
    case 'FREE_FALL':
    case 'HYPE_DECAY':
    case 'POST_SPIKE_BLEED':
    case 'DECLINER':
      return 'dump';
    default:
      return 'keep';
  }
}

/** Mirror the series evidence onto the stamp fields — the hydrated
 *  steady-state production runs in: card_deep stamps carry what the
 *  deep pass found, so the scalar path sees the same floors/cycles
 *  the series does. Only feature-only flags (failedBounce, fresh
 *  returns, atFloor) stay invisible to the badge — that's the
 *  sanctioned refinement gap. */
function hydratedSig(s: CardSignal, fs: SeriesFeatures): CardSignal {
  return sig({
    ...s,
    shelfPrice: fs.floorPrice ?? s.shelfPrice,
    shelfTests: fs.floorTests > 0 ? fs.floorTests : s.shelfTests,
    cycleDays: fs.cycleDays ?? s.cycleDays,
    medianBouncePct: fs.medianBouncePct ?? s.medianBouncePct,
    targetPrice: fs.targetPrice ?? fs.sellIntoPrice ?? s.targetPrice,
    // The stamped ledger covers full history — it carries at least
    // what the window found, never less (item 59's union).
    analogBounceN: Math.max(fs.floorBounces, s.analogBounceN ?? 0),
    low90d: fs.floorPrice ?? s.low90d,
    // The stamped 90d high is the scalar's recent-high zone — the same
    // window evidence the series' athPrice reads.
    high90d: fs.athPrice ?? s.high90d,
  });
}

describe('classification sweep — nonsense detector', () => {
  const flags: Flag[] = [];
  const counts: Record<string, number> = {};
  const flips: { ctx: string; from: string; to: string }[] = [];
  const refinements: Record<string, number> = {};
  let total = 0;

  for (const stance of stances)
    for (const trend of trends)
      for (const dd of dds)
        for (const r30 of r30s)
          for (const r90 of r90s)
            for (const cagr of cagrs)
              for (const pctile of pctiles)
                for (const dsh of dshs)
                  for (const span of spans)
                    for (const [r7Shape, mkR7] of Object.entries(r7Shapes))
                      for (const [variant, mk] of Object.entries(floorStates)) {
                        const s = sig({
                          stance,
                          trend,
                          drawdown: dd,
                          ret30d: r30,
                          ret7d: mkR7(r30),
                          ret90d: r90,
                          cagr,
                          pctile1y: pctile,
                          daysSinceHigh: dsh,
                          spanDays: span,
                          firstDate: span <= 200 ? '2026-06-01' : '2025-01-01',
                          price: 10,
                        });
                        const fs = mk(r30, dsh, 10);
                        flagRead(
                          `${stance}/${trend}/dd${dd}/r30:${r30}/r7:${r7Shape}/r90:${r90}/cagr:${cagr}/p${pctile}/dsh${dsh}/sp${span}`,
                          s,
                          fs,
                          variant,
                          flags,
                        );
                        const read = classifyDeal(s, variant === 'none' ? undefined : fs);
                        counts[read.cls] = (counts[read.cls] ?? 0) + 1;
                        total++;

                        // Hydrated coherence — with the stamps mirroring
                        // the series evidence, the badge path and the
                        // sheet path may never point opposite ways.
                        const hyd = hydratedSig(s, fs);
                        const badgeRead = classifyDeal(hyd);
                        const sheetRead = classifyDeal(hyd, fs);
                        const bf = familyOf(badgeRead);
                        const sf = familyOf(sheetRead);
                        if ((bf === 'add' && sf === 'dump') || (bf === 'dump' && sf === 'add')) {
                          flips.push({
                            ctx: `${stance}/${trend}/dd${dd}/r30:${r30}/r7:${r7Shape}/cagr:${cagr}/dsh${dsh}@${variant}`,
                            from: `${badgeRead.cls}(${bf})`,
                            to: `${sheetRead.cls}(${sf})`,
                          });
                        } else if (badgeRead.cls !== sheetRead.cls) {
                          const k = `${badgeRead.cls}→${sheetRead.cls}`;
                          refinements[k] = (refinements[k] ?? 0) + 1;
                        }
                      }

  test(`sweep ran (${total} combos) and no hard crashes`, () => {
    expect(total).toBeGreaterThan(5000);
  });

  test('class distribution is sane', () => {
    console.log('distribution:', counts);
    expect(Object.keys(counts).length).toBeGreaterThan(6);
  });

  test('nonsense flags', () => {
    const byRule: Record<string, Flag[]> = {};
    for (const f of flags) (byRule[f.rule] = byRule[f.rule] ?? []).push(f);
    for (const [rule, list] of Object.entries(byRule)) {
      console.log(`\n${rule} (${list.length}):`);
      for (const f of list.slice(0, 15)) console.log('  ', f.desc);
      if (list.length > 15) console.log(`   … +${list.length - 15} more`);
    }
    if (flags.length === 0) console.log('\nno flags — grid is clean');
    expect(true).toBe(true); // informational — flags reviewed by a human
  });

  test('hydrated paths never flip direction', () => {
    const sameFamily = Object.entries(refinements)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    console.log(
      `\nrefinements (same family, different class): ${Object.values(refinements).reduce((x, n) => x + n, 0)}`,
    );
    for (const [k, n] of sameFamily) console.log(`  ${k}: ${n}`);
    console.log(`\ndirection flips (hard fail): ${flips.length}`);
    for (const f of flips.slice(0, 20)) {
      console.log(`  ${f.ctx} badge=${f.from} sheet=${f.to}`);
    }
    expect(flips).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Evidence mismatch — the stamp and the window measure the same      */
/* card and DISAGREE. card_deep counts floor tests on full history;   */
/* buildSeriesFeatures re-counts on the downsampled shipped window    */
/* and can only under-resolve (golduck: stamp 3 tests at $1.14,       */
/* window found 1 at the same $1.14). The two paths must still tell   */
/* one story. Focused grid — the full cross-product is covered above. */
/* ------------------------------------------------------------------ */
describe('evidence mismatch — stamp and window disagree', () => {
  const mStances = ['falling', 'neutral', 'elevated_rising'];
  const mTrends = ['appreciating', 'depreciating', 'flat'];
  const mDds = [-30, -70];
  const mR30s = [10, -15];
  const mFloors = ['parkedStrong', 'midAir', 'failedPark', 'cycler'] as const;
  // [stamp shelfTests, window floorTests] — the count pairs real
  // cards showed, plus an agree-control.
  const mCountPairs: [number, number][] = [
    [3, 1], // golduck — stamp 3, window 1, same shelf
    [1, 5],
    [5, 2],
    [4, 4],
  ];
  const mDshs = [10, 400];
  const mPctiles = [15, 60];

  const mFlips: { ctx: string; from: string; to: string }[] = [];
  const mRefine: Record<string, number> = {};
  const mObjective: { ctx: string; p: string }[] = [];
  const mSoft: Record<string, number> = {};
  let mTotal = 0;

  for (const stance of mStances)
    for (const trend of mTrends)
      for (const dd of mDds)
        for (const r30 of mR30s)
          for (const [r7Shape, mkR7] of Object.entries(r7Shapes))
            for (const variant of mFloors)
              for (const [shelfT, floorT] of mCountPairs)
                for (const dsh of mDshs)
                  for (const pctile of mPctiles) {
                    mTotal++;
                    const s = sig({
                      stance,
                      trend,
                      drawdown: dd,
                      ret30d: r30,
                      ret7d: mkR7(r30),
                      ret90d: r30 * 1.5,
                      cagr: trend === 'appreciating' ? 40 : trend === 'depreciating' ? -40 : 0,
                      pctile1y: pctile,
                      daysSinceHigh: dsh,
                      spanDays: 600,
                      price: 10,
                    });
                    const fs = floorStates[variant](r30, dsh, 10);
                    // Same shelf level, different test counts — the
                    // union rule must reconcile them.
                    const floor = fs.floorPrice ?? 8;
                    const hyd = hydratedSig(s, fs);
                    const mis = sig({
                      ...hyd,
                      shelfPrice: floor,
                      shelfTests: shelfT,
                    });
                    const misFs = feat({
                      ...fs,
                      floorPrice: floor,
                      floorTests: floorT,
                    });
                    const ctx = `${stance}/${trend}/dd${dd}/r30:${r30}/r7:${r7Shape}/p${pctile}/dsh${dsh}@${variant}[st${shelfT}×ft${floorT}]`;
                    const b = classifyDeal(mis);
                    const sh = classifyDeal(mis, misFs);
                    const bf = familyOf(b);
                    const sf = familyOf(sh);
                    if ((bf === 'add' && sf === 'dump') || (bf === 'dump' && sf === 'add')) {
                      mFlips.push({
                        ctx,
                        from: `${b.cls}(${bf})`,
                        to: `${sh.cls}(${sf})`,
                      });
                    } else if (b.cls !== sh.cls) {
                      const k = `${b.cls}→${sh.cls}`;
                      mRefine[k] = (mRefine[k] ?? 0) + 1;
                    }

                    // Full stack — every surface under the mismatched
                    // evidence. Objective problems gate; soft findings
                    // report.
                    const stack = renderSurfaces(mis, misFs, {
                      price: 10,
                      floor,
                      vsCost: -30,
                      daysHeld: 60,
                    });
                    for (const p of collectProblems(stack)) {
                      const objective = /claim:|direction flip|floor mismatch|insane band/.test(p);
                      if (objective) mObjective.push({ ctx, p });
                      else {
                        const k = p.replace(/"[^"]*"/g, '"…"');
                        mSoft[k] = (mSoft[k] ?? 0) + 1;
                      }
                    }
                  }

  test(`mismatch sweep ran (${mTotal} combos)`, () => {
    expect(mTotal).toBeGreaterThan(1000);
  });

  test('no direction flips on mismatched evidence', () => {
    const top = Object.entries(mRefine)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    console.log(
      `\nrefinements under mismatched counts: ${Object.values(mRefine).reduce((x, n) => x + n, 0)}`,
    );
    for (const [k, n] of top) console.log(`  ${k}: ${n}`);
    console.log(`\ndirection flips (hard fail): ${mFlips.length}`);
    for (const f of mFlips.slice(0, 20)) console.log(`  ${f.ctx} badge=${f.from} sheet=${f.to}`);
    expect(mFlips).toEqual([]);
  });

  test('no objective contract violations on mismatched evidence', () => {
    const soft = Object.entries(mSoft)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    console.log(`\nsoft contract findings (report only): ${Object.keys(mSoft).length}`);
    for (const [k, n] of soft) console.log(`  ${k}: ${n}`);
    console.log(`\nobjective contract violations (hard fail): ${mObjective.length}`);
    for (const f of mObjective.slice(0, 20)) console.log(`  ${f.ctx}\n    ${f.p}`);
    expect(mObjective).toEqual([]);
  });
});
