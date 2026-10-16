import rawFixture from './fixtures/realCards.json';
import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import { assertContract, dumpStack, renderSurfaces } from './helpers/stack';
import {
  hydrateDeep,
  hydratePatterns,
  hydrateSeries,
  hydrateSignal,
  type Fixture,
} from './helpers/hydrate';

// The regression ledger — every entry in realCards.json is a real
// card the user caught misbehaving, exported verbatim from the shipped
// catalog by tools/export_real_cards.py. Each variant is replayed
// through the ENTIRE surface stack (badge, sheet, health, triggers,
// engine lines, facets, claims audit) under three owner states. No
// class pins — the catalog moves between exports; what must hold
// forever is the contract: one card, one story, on every surface.

const data = rawFixture as unknown as Fixture;
const patterns = hydratePatterns(data.patterns);

describe('real cards — the regression ledger', () => {
  expect(Object.keys(data.cards).length).toBeGreaterThan(10);
  let ran = 0;

  for (const [key, card] of Object.entries(data.cards)) {
    for (const v of card.variants) {
      const signal = hydrateSignal(v.signal);
      const deep = hydrateDeep(v.deep);
      const series = hydrateSeries(v.series);
      const features = series.length >= 30 ? buildSeriesFeatures(series) : undefined;
      const price = signal.price ?? 0;
      // vsCost is the dollar gain vs cost basis — green / flat /
      // underwater states scale with the card's own price so a $2
      // card and a $600 card get equally real contexts.
      const ctxs = [
        { name: 'green', vsCost: +Math.max(0.5, price * 0.25).toFixed(2) },
        { name: 'flat', vsCost: 0 },
        { name: 'underwater', vsCost: -Math.max(0.5, price * 0.3).toFixed(2) },
      ];
      for (const c of ctxs) {
        ran++;
        test(`${key} ${card.number} [${v.subType}] ${c.name}`, () => {
          const stack = renderSurfaces(signal, features, {
            price,
            floor: signal.shelfPrice ?? features?.floorPrice ?? null,
            vsCost: c.vsCost,
            daysHeld: 60,
            deep,
            patterns,
          });
          console.log(
            `\n${key} ${card.name} ${card.number} [${v.subType}] ` +
              `(${c.name})\n${dumpStack(stack)}`,
          );
          // Real rows are hydrated by construction — the stamp and the
          // series describe the same card, so direction flips and
          // claim lies are real bugs, not synthetic artifacts.
          assertContract(`${key}/${v.subType}/${c.name}`, stack);
          // Compact digest snapshot — the whole read in one line so a
          // catalog re-export or wording change diffs reviewably.
          expect(
            [
              `${stack.badge.cls}${stack.badge.variant ? `·${stack.badge.variant}` : ''} → ${stack.sheet.cls}${stack.sheet.variant ? `·${stack.sheet.variant}` : ''}`,
              `scout: ${stack.scoutVerb}`,
              `owner: ${stack.ownerVerb}`,
              `bucket: ${stack.bucket}/${stack.scalarBucket}`,
              `hl: ${stack.sheet.headline}`,
              `note: ${stack.note}`,
            ].join(' | '),
          ).toMatchSnapshot();
        });
      }
    }
  }

  test('fixture exercised a real spread of rows', () => {
    expect(ran).toBeGreaterThan(45);
  });
});
