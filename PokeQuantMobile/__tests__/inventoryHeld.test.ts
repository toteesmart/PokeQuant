// Inventory audit — the bug class this fixture exists to pin:
//
//   "rotate out dropped 33% → 20% while dead money printed 13%"
//
// Two leaks produced that panel:
//  1. `price ≤ low90d × 1.05` counted as floor evidence — a falling
//     card's price IS its recent low, so every post-spike knife at a
//     same-week low print waved through to watch (fresh-low tautology;
//     zero of them were established shelves).
//  2. possibleRange-suppressed bleeders fell past every dump gate into
//     an unguarded `cagr ≤ -15` tail — DEAD_STABLE printed "Flat now,
//     spent" on cards down 20–44% in the month. The entire dead bucket
//     was live knives; nothing in it was flat.
//
// The invariants below pin the SEMANTICS, not the numbers — counts
// drift with the market, lies don't get to come back.
import {
  classifyDeal,
  onRealFloor,
  rotationBucket,
} from '../src/scanner/services/deal/dealClassify';
import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import { hydrateSeries, hydrateSignal } from './helpers/hydrate';

/* eslint-disable @typescript-eslint/no-require-imports -- node builtins via CJS require; node:sqlite has no type declarations in this setup */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */

declare const __dirname: string;

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'inventoryHeld.json'), 'utf8'),
) as { rows: { name: string; pid: number; variant: string; live: number }[] };

const CANDIDATES = [
  path.join(process.env.TEMP ?? '', 'mobile_catalog.db'),
  path.join(process.env.HOME ?? '', 'Downloads', 'mobile_catalog.db'),
  path.join(process.env.HOME ?? '', 'Downloads', 'pokequant_catalog.db'),
];
const DB = CANDIDATES.find((p) => fs.existsSync(p));
const haveDb = DB != null;

const describeDb = haveDb ? describe : describe.skip;

describeDb('held inventory — the panel that caught the dead-bucket leak', () => {
  test('dead money is flat; watches hold real floors; rotate earns it', () => {
    const db = new DatabaseSync(DB, { readOnly: true });
    const sigStmt = db.prepare(
      `SELECT cs.*, d.shelf_price AS d_shelf_price,
              d.shelf_tests AS d_shelf_tests,
              d.cycle_days AS d_cycle_days,
              d.bounce_pct_med AS d_bounce_pct_med,
              d.target_price AS d_target_price
       FROM card_signals cs
       LEFT JOIN card_deep d
         ON d.product_id = cs.product_id AND d.sub_type = cs.sub_type
       WHERE cs.product_id = ? AND cs.sub_type = ?
       LIMIT 1`,
    );
    const firstStmt = db.prepare(
      `SELECT cs.*, d.shelf_price AS d_shelf_price,
              d.shelf_tests AS d_shelf_tests,
              d.cycle_days AS d_cycle_days,
              d.bounce_pct_med AS d_bounce_pct_med,
              d.target_price AS d_target_price
       FROM card_signals cs
       LEFT JOIN card_deep d
         ON d.product_id = cs.product_id AND d.sub_type = cs.sub_type
       WHERE cs.product_id = ?
       ORDER BY cs.sub_type = 'Normal' DESC, cs.sub_type
       LIMIT 1`,
    );

    const seriesStmt = db.prepare(
      `SELECT series FROM price_series WHERE product_id = ? AND sub_type = ?`,
    );
    const featuresFor = (pid: number, variant: string) => {
      const raw = seriesStmt.get(pid, variant) as { series: string } | undefined;
      if (!raw?.series) return undefined;
      const pts = hydrateSeries(JSON.parse(raw.series));
      return pts.length >= 15 ? buildSeriesFeatures(pts) : undefined;
    };

    const dead: string[] = [];
    const psbWatchNoFloor: string[] = [];
    const testingNoFloor: string[] = [];
    const buckets: Record<string, number> = {};
    const bucketsDeep: Record<string, number> = {};
    const valueDeep: Record<string, number> = {};
    let totalValue = 0;
    let signaled = 0;

    for (const row of FIXTURE.rows) {
      const raw = sigStmt.get(row.pid, row.variant) ?? firstStmt.get(row.pid);
      if (!raw) continue;
      signaled++;
      const signal = hydrateSignal(raw);
      const read = classifyDeal(signal);
      const bucket = rotationBucket(read, signal);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;

      // Same deep pass InventoryScreen runs — series features refine
      // the badge read to the analysis sheet's evidence.
      const features = featuresFor(row.pid, row.variant);
      const readD = classifyDeal(signal, features);
      const bucketD = rotationBucket(readD, signal, features);
      bucketsDeep[bucketD] = (bucketsDeep[bucketD] ?? 0) + 1;
      // Value-weighted — the panel bar divides by dollars, not cards.
      totalValue += Math.max(0, row.live);
      valueDeep[bucketD] = (valueDeep[bucketD] ?? 0) + Math.max(0, row.live);

      const bleeding = (signal.ret7d ?? 0) <= -7 || (signal.ret30d ?? 0) <= -10;
      const bleedingD =
        (features?.ret7d ?? signal.ret7d ?? 0) <= -7 ||
        (features?.ret30d ?? signal.ret30d ?? 0) <= -10;
      if (read.cls === 'DEAD_STABLE' && bleeding) {
        dead.push(`${row.name} r30=${signal.ret30d?.toFixed(0)}`);
      }
      if (readD.cls === 'DEAD_STABLE' && bleedingD) {
        dead.push(`${row.name} (deep) r30=${features?.ret30d?.toFixed(0)}`);
      }
      if (read.cls === 'POST_SPIKE_BLEED' && bucket === 'watch' && !onRealFloor(signal)) {
        psbWatchNoFloor.push(row.name);
      }
      if (
        readD.cls === 'POST_SPIKE_BLEED' &&
        bucketD === 'watch' &&
        !onRealFloor(signal, features)
      ) {
        psbWatchNoFloor.push(`${row.name} (deep)`);
      }
      if (
        read.cls === 'BASE_FORMING' &&
        read.variant === 'testing' &&
        !onRealFloor(signal) &&
        signal.shelfPrice == null
      ) {
        testingNoFloor.push(row.name);
      }
      if (
        readD.cls === 'BASE_FORMING' &&
        readD.variant === 'testing' &&
        !onRealFloor(signal, features) &&
        signal.shelfPrice == null &&
        features?.floorPrice == null
      ) {
        testingNoFloor.push(`${row.name} (deep)`);
      }
    }

    console.log(
      `[inventory] ${signaled} signaled rows — scalar: ` +
        Object.entries(buckets)
          .map(([b, n]) => `${b}:${n}`)
          .join(' ') +
        ' | deep: ' +
        Object.entries(bucketsDeep)
          .map(([b, n]) => `${b}:${n}`)
          .join(' ') +
        ' | deep value%: ' +
        ['grow', 'keep', 'watch', 'rotate', 'dead']
          .map(
            (b) =>
              `${b}:${totalValue > 0 ? Math.round(((valueDeep[b] ?? 0) / totalValue) * 100) : 0}%`,
          )
          .join(' '),
    );

    // A bleeding card is never "value, no motion" — the leak that
    // stuffed the dead bucket with knives stays dead.
    expect(dead).toEqual([]);
    // A post-spike bleeder only watches when a real floor is under it
    // — its own fresh 90d low doesn't count.
    expect(psbWatchNoFloor).toEqual([]);
    // The floor-test badge needs real floor evidence too (the tail
    // possibleRange landing names a stamped shelf, not a bare low).
    expect(testingNoFloor).toEqual([]);
    db.close();
  });
});
