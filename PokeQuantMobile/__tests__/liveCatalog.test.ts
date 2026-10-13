import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import {
  collectProblems,
  renderSurfaces,
} from './helpers/stack';
import {
  hydrateDeep,
  hydratePatterns,
  hydrateSeries,
  hydrateSignal,
} from './helpers/hydrate';

// Live-catalog audit — runs the whole surface contract against the
// REAL downloaded catalog DB (the same stamped rows the phone reads),
// not synthetics. Skip-unless-present: set PQ_CATALOG_DB or drop a
// mobile_catalog.db in %TEMP%. Lane split:
//   hard: objective problems (direction flips, claim lies, insane
//         bands, dead-label contradictions) → test failure
//   soft: same-family badge/sheet class refinements → report only,
//         tracked as a divergence count to trend down over releases.
// This is the upstream golduck-detector: a divergence the synthetic
// sweep can't see lands here before it lands on a phone.

// node:sqlite/fs/path aren't in the @types/node version pinned for
// RN — the runtime is Node ≥22.5, so load them untyped and declare
// the CJS dirname global locally.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

const CANDIDATES = [
  process.env.PQ_CATALOG_DB,
  path.join(process.env.TEMP ?? '', 'mobile_catalog.db'),
  path.join(process.env.TEMP ?? '', 'r2_catalog.db'),
  path.resolve(__dirname, '../../mobile_catalog.db'),
].filter((p: string | undefined): p is string => !!p && fs.existsSync(p));

const dbPath = CANDIDATES[0];

type Raw = Record<string, unknown>;

const AUDIT = dbPath ? describe : describe.skip;

AUDIT(`live catalog audit — ${dbPath ?? 'no db'}`, () => {
  const MAX_ROWS = 1500;

  test('objective surface contract holds across the sampled catalog', () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tables = new Set(
        (db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
        ).map((r) => r.name)
      );
      if (!tables.has('card_signals') || !tables.has('price_series')) {
        console.warn('catalog lacks stamped tables — audit skipped');
        return;
      }
      const hasDeep = tables.has('card_deep');

      // The deep join mirrors signalFromRow's SQL exactly.
      const deepJoin = hasDeep
        ? `LEFT JOIN card_deep d
             ON d.product_id = cs.product_id AND d.sub_type = cs.sub_type`
        : '';
      const deepCols = hasDeep
        ? `, d.shelf_price AS d_shelf_price, d.shelf_tests AS d_shelf_tests,
            d.cycle_days AS d_cycle_days, d.bounce_pct_med AS d_bounce_pct_med,
            d.target_price AS d_target_price`
        : '';

      // Evidence-dense rows first (range stamps, knife legs, at-peak
      // stances) — that's where the divergences live — then a
      // deterministic stride sample of the remainder.
      const evidence = db
        .prepare(
          `SELECT cs.* ${deepCols}
             FROM card_signals cs ${deepJoin}
            WHERE cs.action IS NOT NULL AND cs.action != 'UNRATED'
              AND (d.shelf_tests >= 2 OR d.cycle_days BETWEEN 21 AND 180
                   OR cs.ret_30d <= -10 OR cs.ret_7d <= -7
                   OR cs.stance IN ('elevated','elevated_rising','depressed'))
            ORDER BY cs.product_id, cs.sub_type
            LIMIT ?`
        )
        .all(MAX_ROWS) as Raw[];
      const stride = db
        .prepare(
          `SELECT cs.* ${deepCols}
             FROM card_signals cs ${deepJoin}
            WHERE cs.action IS NOT NULL AND cs.action != 'UNRATED'
              AND cs.price >= 1
            ORDER BY (cs.product_id * 2654435761) % 1000000
            LIMIT ?`
        )
        .all(Math.max(0, MAX_ROWS - evidence.length)) as Raw[];

      const seriesStmt = db.prepare(
        'SELECT series FROM price_series WHERE product_id = ? AND sub_type = ?'
      );
      const deepStmt = hasDeep
        ? db.prepare(
            'SELECT * FROM card_deep WHERE product_id = ? AND sub_type = ?'
          )
        : null;
      const patterns: Record<string, any> = tables.has('pattern_stats')
        ? hydratePatterns(
            Object.fromEntries(
              (db.prepare('SELECT * FROM pattern_stats').all() as Raw[]).map(
                (r) => [String(r.pattern), r]
              )
            )
          )
        : {};

      const hard: string[] = [];
      const refinements: string[] = [];
      let audited = 0;

      for (const row of [...evidence, ...stride]) {
        const signal = hydrateSignal(row);
        if (signal.price == null || signal.price <= 0) continue;
        const sRow = seriesStmt.get(signal.productId, signal.subType) as
          | { series: string }
          | undefined;
        let features;
        if (sRow?.series) {
          try {
            const packed = JSON.parse(sRow.series) as [number, number][];
            const pts = hydrateSeries(packed);
            if (pts.length >= 30) features = buildSeriesFeatures(pts);
          } catch {
            /* unparseable series — badge path still audited */
          }
        }
        const dRow = deepStmt?.get(signal.productId, signal.subType) as
          | Raw
          | undefined;
        const stack = renderSurfaces(signal, features, {
          price: signal.price,
          floor: signal.shelfPrice ?? features?.floorPrice ?? null,
          deep: hydrateDeep(dRow ?? null),
          patterns,
          productId: signal.productId,
          subType: signal.subType,
        });
        audited++;
        const problems = collectProblems(stack);
        for (const p of problems) {
          if (hard.length < 60) {
            hard.push(`pid:${signal.productId}[${signal.subType}] $${signal.price} — ${p}`);
          }
        }
        if (stack.badge.cls !== stack.sheet.cls) {
          refinements.push(
            `pid:${signal.productId}[${signal.subType}] $${signal.price} — badge=${stack.badge.cls}${stack.badge.variant ? `·${stack.badge.variant}` : ''} sheet=${stack.sheet.cls}${stack.sheet.variant ? `·${stack.sheet.variant}` : ''}`
          );
        }
      }

      console.log(
        `\n=== live audit ===\n` +
          `catalog: ${dbPath}\n` +
          `rows audited: ${audited}\n` +
          `objective problems (hard): ${hard.length}${hard.length >= 60 ? '+' : ''}\n` +
          `badge/sheet refinements (soft): ${refinements.length}\n` +
          (refinements.length
            ? refinements.slice(0, 25).join('\n') + '\n'
            : '') +
          `==================`
      );

      // Same-family refinements are reported, not failed — the
      // divergence count is the trend metric across releases.
      expect(hard).toEqual([]);
    } finally {
      db.close();
    }
  });
});
