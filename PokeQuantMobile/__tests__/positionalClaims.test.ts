import {
  checkPositionText,
  crossSurfaceProblems,
  type PosAux,
  type PosView,
} from './helpers/claims';

// Positional-claims contract — item 56. Every rendered phrase that
// asserts a position ("sitting on a low", "sell end", "mid-range"), a
// level ("hit its floor", "nothing under it until the shelf"), or an
// evidence claim ("held before", "proven cycle", "flat") is verified
// against the resolved RangeEvidence of the surface that produced it.
// This suite pins each phrase class on synthetic PosViews — the exact
// flag / no-flag boundary — so a producer change can't silently relax
// the contract. Whole-stack pins live in surfaceCoherence, observed
// production siblings in realCards/fuzzSweep.

const view = (over: Partial<PosView> = {}): PosView => ({
  pos: 'mid-range',
  px: 10,
  floor: 8,
  crack: 7.76,
  floorExists: true,
  tests: 3,
  bouncePct: 40,
  cycleDays: 60,
  ceiling: 12,
  ath: 14,
  low90d: 7.5,
  high90d: 15,
  pctile: 60,
  drawdown: -28,
  redLeg: false,
  bigLeg: false,
  bigWeek: false,
  parkedAny: false,
  failedBounce: false,
  higherLows: false,
  ...over,
});

const aux = (over: Partial<PosAux> = {}): PosAux => ({
  sheetPos: 'mid-range',
  sheetCls: 'STABLE_FLAT',
  ...over,
});

const claims = (text: string, v: PosView, src = 'note', a = aux(), cls?: string) =>
  checkPositionText(text, src, v, a, cls);

const flagged = (text: string, v: PosView, src?: string, a?: PosAux, cls?: string) =>
  claims(text, v, src, a, cls).length > 0;
const clean = (text: string, v: PosView, src?: string, a?: PosAux, cls?: string) =>
  claims(text, v, src, a, cls).length === 0;

/* ------------------------------------------------------------------ */
/* Parked claims — the item-53/54 lie shape: floor-side copy at a      */
/* resolved ceiling (ninetales 42352).                                  */
/* ------------------------------------------------------------------ */
describe('parked claims', () => {
  it('flags parked copy away from the floor', () => {
    expect(flagged('Sitting on a low', view({ pos: 'at-ceiling' }))).toBe(true);
    expect(flagged('Sitting on a low', view({ pos: 'mid-range' }))).toBe(true);
    expect(flagged('holding its floor', view({ pos: 'no-structure' }))).toBe(true);
  });
  it('passes parked copy at a resolved floor', () => {
    expect(clean('Sitting on a low', view({ pos: 'on-floor' }))).toBe(true);
    expect(clean('On the buy end of a proven range', view({ pos: 'on-floor' }))).toBe(true);
  });
  it('through-floor vs one shelf stays honest when parked on another', () => {
    // Fuzz sibling: under the window floor but parked on the stamped shelf.
    expect(clean('holding its floor', view({ pos: 'through-floor', parkedAny: true }))).toBe(true);
  });
  it('pctile-proxied resting: distributional-low wording stands, structural words flag', () => {
    const proxied = view({ pos: 'no-structure', floor: null, floorExists: false, pctile: 6 });
    expect(clean('At a low', proxied)).toBe(true);
    expect(clean('Sitting on a low', proxied)).toBe(true);
    expect(flagged('holding a floor', proxied)).toBe(true);
    expect(flagged('the level is holding', proxied)).toBe(true);
    // ...but only when the stamp is actually low.
    expect(flagged('At a low', view({ pos: 'no-structure', floor: null, pctile: 60 }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Floor-thesis claims — "on a held floor" arms the floor as the live  */
/* downside; the producers' own gate is the floorSide reach band.      */
/* ------------------------------------------------------------------ */
describe('floor-thesis claims', () => {
  it('flags a held-floor thesis with no floor-side verdict', () => {
    expect(flagged('on a held floor', view({ pos: 'no-structure' }))).toBe(true);
    expect(flagged('on a held floor', view({ pos: 'mid-range' }))).toBe(true);
    expect(flagged('sell if it drops below', view({ pos: 'at-ceiling' }))).toBe(true);
  });
  it('passes inside the reach band', () => {
    expect(clean('on a held floor', view({ pos: 'on-floor' }))).toBe(true);
    expect(clean('on a held floor', view({ pos: 'approaching-floor' }))).toBe(true);
  });
  it('health trigger gets the row floor resolution, RANGE_PLAY the structural exemption', () => {
    expect(flagged('drops below the floor', view({ pos: 'mid-range' }), 'health trigger')).toBe(
      true,
    );
    expect(
      clean(
        'drops below the floor',
        view({ pos: 'mid-range' }),
        'health trigger',
        aux({ sheetCls: 'RANGE_PLAY' }),
      ),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Directional floor claims — "falling toward a floor" needs the band, */
/* a real level beneath, and a live red leg.                           */
/* ------------------------------------------------------------------ */
describe('approach claims', () => {
  const falling = view({ pos: 'approaching-floor', redLeg: true });
  it('flags without the reach band, a level beneath, or a red leg', () => {
    expect(flagged('falling toward a floor', view({ pos: 'at-ceiling' }))).toBe(true);
    expect(
      flagged('falling toward a floor', view({ pos: 'approaching-floor', px: 4, floor: 8 })),
    ).toBe(true);
    expect(
      flagged('falling toward a floor', view({ pos: 'approaching-floor', redLeg: false })),
    ).toBe(true);
  });
  it('passes when the full predicate holds', () => {
    expect(clean('falling toward a floor', falling)).toBe(true);
    expect(clean('heading toward a floor', falling)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Range-top claims — "sell end" needs at-ceiling; AT_PEAK's distribut-*/
/* ional top copy is stamp-backed (stance axis, not this contract).    */
/* ------------------------------------------------------------------ */
describe('top claims', () => {
  it('flags range-top claims away from the ceiling', () => {
    expect(flagged('at the sell end of its range', view({ pos: 'mid-range' }))).toBe(true);
    expect(flagged('sell into ~$12.00', view({ pos: 'on-floor' }))).toBe(true);
  });
  it('passes at the ceiling', () => {
    expect(clean('at the sell end of its range', view({ pos: 'at-ceiling' }))).toBe(true);
  });
  it('AT_PEAK class scope — stance-axis copy is not a range claim', () => {
    expect(
      clean(
        "It's at the top of its range",
        view({ pos: 'mid-range' }),
        'badge script',
        aux(),
        'AT_PEAK',
      ),
    ).toBe(true);
    expect(
      flagged(
        'at the top of its range',
        view({ pos: 'mid-range' }),
        'sheet script',
        aux(),
        'RANGE_PLAY',
      ),
    ).toBe(true);
  });
  it('health trigger quotes the sheet verdict, not its floor-only row', () => {
    expect(
      clean(
        'sell near the top',
        view({ pos: 'on-floor' }),
        'health trigger',
        aux({ sheetPos: 'at-ceiling' }),
      ),
    ).toBe(true);
    expect(
      flagged(
        'sell near the top',
        view({ pos: 'on-floor' }),
        'health trigger',
        aux({ sheetPos: 'mid-range' }),
      ),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Off-peak claims — a real drawdown, or a self-quantified N% that     */
/* verifies against the stamp.                                         */
/* ------------------------------------------------------------------ */
describe('off-peak claims', () => {
  it('flags an off-peak claim with a flat drawdown', () => {
    expect(flagged('off its peak', view({ drawdown: -1 }))).toBe(true);
    expect(clean('off its peak', view({ drawdown: -28 }))).toBe(true);
  });
  it('quantified claims verify against the stamp itself', () => {
    expect(clean('0% off the high', view({ drawdown: -0.4 }))).toBe(true);
    expect(clean('20% off the high', view({ drawdown: -20.2 }))).toBe(true);
    expect(flagged('20% off the high', view({ drawdown: -5 }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Crack / through claims — vs the surface's own break line; the cut-  */
/* loss hypothetical is not an assertion.                              */
/* ------------------------------------------------------------------ */
describe('crack claims', () => {
  it('flags a crack claim above the break line', () => {
    expect(flagged('the floor broke', view({ px: 10, crack: 7.76 }))).toBe(true);
    expect(clean('the floor broke', view({ px: 7, crack: 7.76 }))).toBe(true);
  });
  it('hypothetical through-the-floor copy is not a crack assertion', () => {
    expect(
      clean('riding it through the floor into a bigger hole', view({ px: 10, crack: 7.76 })),
    ).toBe(true);
  });
  it('through-the-level needs the price under the floor itself', () => {
    expect(flagged('through a failed floor', view({ px: 10, floor: 8, failedBounce: true }))).toBe(
      true,
    );
    expect(clean('through a failed floor', view({ px: 7, floor: 8, failedBounce: true }))).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Mid claims — can't sit at either end or under the floor.            */
/* ------------------------------------------------------------------ */
describe('mid claims', () => {
  it('flags mid-range at a resolved end or below the floor', () => {
    expect(flagged('mid-range on the swing', view({ pos: 'on-floor' }))).toBe(true);
    expect(flagged('Mid-range on a proven cycle', view({ pos: 'through-floor' }))).toBe(true);
    expect(clean('mid-range on the swing', view({ pos: 'mid-range' }))).toBe(true);
    expect(clean('Mid-range on a proven cycle', view({ pos: 'no-structure' }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Floor-existence / beneath / denial claims.                          */
/* ------------------------------------------------------------------ */
describe('floor existence claims', () => {
  it('flags floor vocabulary with no resolved level', () => {
    const none = view({ floor: null, floorExists: false });
    expect(flagged('Hit its floor 3 times and held', none)).toBe(true);
    expect(flagged('waking up off a quiet floor', none)).toBe(true);
    expect(clean('Hit its floor 3 times and held', view())).toBe(true);
  });
  it('a shelf-beneath claim needs the named level under the price', () => {
    expect(flagged('Nothing under it until the shelf', view({ px: 4, floor: 8 }))).toBe(true);
    expect(clean('Nothing under it until the shelf', view({ px: 10, floor: 8 }))).toBe(true);
    expect(flagged('the shelf under it', view({ floor: null }))).toBe(true);
  });
  it('floor denial is illegal within reach, honest after a break', () => {
    expect(flagged("hasn't found a floor", view({ pos: 'on-floor' }))).toBe(true);
    expect(flagged('no floor under it', view({ pos: 'approaching-floor' }))).toBe(true);
    expect(clean("hasn't found a floor", view({ pos: 'through-floor' }))).toBe(true);
    expect(clean("hasn't found a floor", view({ pos: 'mid-range', floor: null }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Evidence claims — tests, proven range, weak bounce, feature flags.  */
/* ------------------------------------------------------------------ */
describe('evidence claims', () => {
  it('tested-floor claims need resolved tests', () => {
    expect(flagged('held before', view({ tests: 0 }))).toBe(true);
    expect(clean('held before', view())).toBe(true);
  });
  it('proven-range claims need the classifier proof bars', () => {
    expect(flagged('Mid-range on a proven cycle', view({ tests: 1 }))).toBe(true);
    expect(flagged('on a rhythm', view({ cycleDays: 400 }))).toBe(true);
    expect(flagged('proven range', view({ bouncePct: 5 }))).toBe(true);
    expect(clean('Mid-range on a proven cycle', view())).toBe(true);
  });
  it('flat claims die on a live leg — the Right-now facet reads the week leg only', () => {
    const running = view({ bigLeg: true });
    expect(flagged('Trading sideways', running)).toBe(true);
    expect(clean('Trading sideways', view())).toBe(true);
    // A −16% month with a flat week: "Right now" stays honest, a badge flat claim doesn't.
    const monthOnly = view({ bigLeg: true, bigWeek: false });
    expect(clean('Flat — not much moving', monthOnly, 'facet "Right now"')).toBe(true);
    expect(flagged('Flat — not much moving', monthOnly, 'badge label')).toBe(true);
  });
  it('feature-flag narratives need the series flags', () => {
    expect(flagged('bounced once and died right back', view())).toBe(true);
    expect(clean('bounced once and died right back', view({ failedBounce: true }))).toBe(true);
    expect(flagged('each dip bottoms higher', view())).toBe(true);
    expect(clean('each dip bottoms higher', view({ higherLows: true }))).toBe(true);
    expect(flagged('floor that barely bounces', view())).toBe(true);
    expect(clean('floor that barely bounces', view({ bouncePct: 8 }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The Recent-range facet's own band claim — spot arithmetic vs the    */
/* stamped 90d band it quotes.                                         */
/* ------------------------------------------------------------------ */
describe('recent-range facet band', () => {
  const src = 'facet "Recent range"';
  it('flags a spot claim that contradicts the quoted band', () => {
    expect(flagged('$8.00 – $15.00 lately — near the bottom', view({ px: 20 }), src)).toBe(true);
    expect(flagged('$8.00 – $15.00 lately — near the top', view({ px: 9 }), src)).toBe(true);
    expect(flagged('$8.00 – $15.00 lately — in the middle', view({ px: 8.2 }), src)).toBe(true);
  });
  it('passes spot claims the band supports', () => {
    expect(clean('$8.00 – $15.00 lately — near the bottom', view({ px: 8.4 }), src)).toBe(true);
    expect(clean('$8.00 – $15.00 lately — near the top', view({ px: 14.5 }), src)).toBe(true);
    expect(clean('$8.00 – $15.00 lately — in the middle', view({ px: 11 }), src)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Cross-surface — the distributional facet can't sit beside opposite- */
/* end structural copy (the pinned flying_pikachu_ev shape).           */
/* ------------------------------------------------------------------ */
describe('cross-surface', () => {
  const stack = (facet: string, texts: Record<string, string>) => ({
    facets: [{ label: 'Price level', text: facet }],
    badge: { label: texts['badge label'] ?? '', headline: texts['badge headline'] ?? '' },
    sheet: {
      label: texts['sheet label'] ?? '',
      headline: texts['sheet headline'] ?? '',
      script: texts['sheet script'] ?? '',
    },
    note: texts.note ?? '',
    ownerVerb: texts['owner verb'] ?? '',
  });

  it('flags a 1y-high facet beside low-side copy', () => {
    const problems = crossSurfaceProblems(
      stack('Near its 1-year high', { 'badge headline': 'Sitting on a low' }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cross-surface.*badge headline/);
  });
  it('high-side structural words do not contradict a 1y-high facet', () => {
    expect(
      crossSurfaceProblems(
        stack('Near its 1-year high', { note: 'holding its floor — sell if it drops below' }),
      ),
    ).toHaveLength(0);
  });
  it('flags a 1y-bottom facet beside lifetime-high copy', () => {
    expect(
      crossSurfaceProblems(
        stack('Bottom of its 1-year range', { 'sheet script': 'At its high — at its peak' }),
      ),
    ).toHaveLength(1);
  });
  it('range-relative tops do not contradict a 1y-bottom facet', () => {
    expect(
      crossSurfaceProblems(
        stack('Bottom of its 1-year range', { 'sheet script': 'at the sell end of its range' }),
      ),
    ).toHaveLength(0);
  });
});
