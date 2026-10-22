import rawFixture from './fixtures/realCards.json';
import { buildSeriesFeatures } from '../src/scanner/services/deal/seriesSignals';
import { assertContract, collectProblems, dumpStack, renderSurfaces } from './helpers/stack';
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

// Item-53 detector pins — fixture keys whose current catalog verdict
// reports a pinned contract violation while the fix is queued (the
// tail-landing family → items 54/55). The rule must still see the
// bug: the row reports problems and every problem matches the pinned
// family. The digest snapshot captures the wrong verdict verbatim.
// A pin that stops matching fails — remove the entry when the
// classifier lands the honest copy, not before. Item 54 retired the
// ninetales pin — its row runs under the contract.
const detectorPins: Record<string, RegExp> = {
  // bellibolt — scalar/deep ceiling divergence (item 60 territory):
  // the stamps resolve a $5.06→$5.36 channel thin enough that px $5.02
  // sits inside its ×0.92 exit band → at-ceiling → DECLINER; the
  // window resolves the range top at ~$5.54 where $5.02 is parked on
  // the floor → RANGE_PLAY·entry. Each path's verdict is honest per
  // its own resolution — the flip is the residual evidence gap.
  bellibolt: /^direction flip/,
  // ogerpon — same family: stamped ceiling $2.77 puts px $2.63 inside
  // the exit band (DECLINER) while the window-resolved ~$2.93 top
  // leaves it on the floor (RANGE_PLAY·entry).
  ogerpon: /^direction flip/,
  // walking_wake_ex — same family, opposite sign: the stamped
  // channel $6.36→$6.88 reads px $6.24 as parked (entry) while the
  // window-resolved $6.10→$6.69 puts it inside the sell-end band
  // (exit). Old entry-first ordering hid the overlap; item 55's
  // ceiling-first verdict surfaces it — item 60 owns the residual.
  walking_wake_ex: /^direction flip/,
  // tremendous_bomb retired — the tail now lands at-ceiling cards on
  // AT_PEAK (badge: priced inside the stamped $1.90 sell-into band)
  // while the window resolves REVIVAL on the crater's own structure.
  // The flat claim the pin guarded no longer renders.
  // flying_pikachu_ev retired with item 60 — the riser carve-out
  // lands STABLE_GROWER on both paths, so the "a low" copy that
  // contradicted the 1y facet no longer renders at all.
};

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
          const pin = detectorPins[key];
          if (pin) {
            const problems = collectProblems(stack);
            expect(problems.length).toBeGreaterThan(0);
            expect(problems.every((p) => pin.test(p))).toBe(true);
            expect(problems).toMatchSnapshot();
          } else {
            assertContract(`${key}/${v.subType}/${c.name}`, stack);
          }
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
