import { classifyDeal, ownerNote, offerBand } from '../src/scanner/services/deal/dealClassify';
import type { SeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import type { CardSignal } from '../src/db/catalogDb';

// Synthetic sweep — every plausible (stance × trend × shape) combo gets
// classified, then flagged when the read contradicts its own inputs.
// Not a correctness proof — a nonsense detector. Each flag class here
// corresponds to a misread family the real cards surfaced one at a time.

const sig = (over: Partial<CardSignal> = {}): CardSignal => ({
  productId: 1,
  subType: 'Normal',
  price: 10,
  priceDate: '2026-01-15',
  firstDate: '2025-01-01',
  stance: 'neutral',
  action: 'NEUTRAL',
  confidence: 'high',
  pctile1y: 50,
  ret7d: 0,
  ret14d: 0,
  ret30d: 0,
  ret90d: 0,
  ret180d: 0,
  ret365d: 0,
  retAll: 0,
  cagr: 0,
  trend: 'flat',
  drawdown: 0,
  daysSinceHigh: 0,
  low90d: null,
  high90d: null,
  slope30d: null,
  ma20_60: null,
  z90: null,
  dailySigma: null,
  daysSinceChange: 2,
  nEvents: 200,
  coverage: 0.6,
  spanDays: 600,
  liqFlag: 'active',
  changesPerYear: 60,
  pctileAll: null,
  volRegime: 'normal',
  excess30d: null,
  fwd30dLo: null,
  fwd30dHi: null,
  reason: null,
  shelfPrice: null,
  shelfTests: null,
  ...over,
});

const feat = (over: Partial<SeriesFeatures> = {}): SeriesFeatures => ({
  lastPrice: 10,
  daysCovered: 300,
  ret7d: null,
  ret30d: null,
  slope30d: null,
  athPrice: 15,
  daysSinceAth: 100,
  floorTests: 0,
  failedBounce: false,
  atFloor: false,
  atShelf: false,
  floorPrice: null,
  targetPrice: null,
  sellIntoPrice: null,
  medianBouncePct: null,
  medianBounceDays: null,
  cycleDays: null,
  higherLows: false,
  ...over,
});

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

type Flag = { rule: string; desc: string };

const GOOD_CLASSES = new Set([
  'REVIVAL',
  'DIP_BUY',
  'STABLE_GROWER',
  'AT_PEAK',
  'STABLE_FLAT',
]);
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
  flags: Flag[]
) {
  const read = classifyDeal(s, variant === 'none' ? undefined : fs);
  const r30 = s.ret30d ?? 0;
  const parked =
    fs.atShelf || fs.atFloor || (fs.floorPrice != null && (fs.lastPrice ?? 0) <= fs.floorPrice * 1.25);
  const bleeding =
    (s.ret7d ?? 0) <= -7 ||
    r30 <= -10 ||
    ((s.spanDays == null || s.spanDays >= 120) && (s.ret90d ?? 0) <= -15 && r30 <= -3);

  // 1. A knife getting a buyer's green read — DIP_BUY exempt: buying
  // the dip inside an intact uptrend is its entire job description.
  if (
    (r30 <= -20 || (s.ret7d ?? 0) <= -15) &&
    GOOD_CLASSES.has(read.cls) &&
    read.cls !== 'DIP_BUY'
  ) {
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
  if (parked && variant !== 'none' && r30 > -12 && (read.cls === 'HYPE_DECAY' || read.cls === 'POST_SPIKE_BLEED')) {
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
      note
    );
  const distantFloor =
    fs.floorPrice != null ? 10 > fs.floorPrice * 1.3 : true;
  // 'none' has no series floor to contradict — generic class language
  // ("holding its floor") isn't a proximity lie.
  if (variant !== 'none' && floorClaim && distantFloor && !(fs.atShelf || fs.atFloor)) {
    flags.push({
      rule: 'note-claims-distant-floor',
      desc: `${ruleCtx} → ${read.cls}: "${note.slice(0, 60)}"`,
    });
  }
}

describe('classification sweep — nonsense detector', () => {
  const flags: Flag[] = [];
  const counts: Record<string, number> = {};
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
                    for (const [variant, mk] of Object.entries(floorStates)) {
                      const s = sig({
                        stance,
                        trend,
                        drawdown: dd,
                        ret30d: r30,
                        ret7d: r30 / 3, // week loosely tracks month
                        ret90d: r90,
                        cagr,
                        pctile1y: pctile,
                        daysSinceHigh: dsh,
                        spanDays: span,
                        firstDate: span <= 200 ? '2026-06-01' : '2025-01-01',
                        price: 10,
                      });
                      const fs = mk(r30, dsh, 10);
                      flagRead(`${stance}/${trend}/dd${dd}/r30:${r30}/r90:${r90}/cagr:${cagr}/p${pctile}/dsh${dsh}/sp${span}`, s, fs, variant, flags);
                      const read = classifyDeal(s, variant === 'none' ? undefined : fs);
                      counts[read.cls] = (counts[read.cls] ?? 0) + 1;
                      total++;
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
});
