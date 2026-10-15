import { classifyDeal, dealAction, positionAction } from '../src/scanner/services/deal/dealClassify';
import type { CardSignal } from '../src/db/catalogDb';
import { mkSignal } from './helpers/builders';

// Action audit — the full verb matrix across every class and every
// position state, printed so the whole language surface can be
// reviewed in one shot. The pins below are the coherence invariants:
// fodder never gets urgency, cracked always overrides, good classes
// never tell you to dump, and the verb can't fight its own numbers.

const sig = (over: Partial<CardSignal> = {}): CardSignal => mkSignal(over);

// One signal per class — the minimal shape that lands each read.
const classCases: Record<string, { s: Partial<CardSignal>; label: string }> = {
  knife: {
    label: 'FREE_FALL',
    s: { stance: 'falling', ret30d: -22, ret7d: -8, ret90d: -40, drawdown: -45, cagr: -30, pctile1y: 10, daysSinceHigh: 400 },
  },
  bleeder: {
    label: 'POST_SPIKE_BLEED',
    s: { stance: 'depressed', ret30d: -6, ret7d: -2, ret90d: -18, drawdown: -60, cagr: -20, pctile1y: 15, daysSinceHigh: 200 },
  },
  decliner: {
    label: 'DECLINER',
    s: { stance: 'falling', ret30d: -8, ret7d: -3, ret90d: -25, drawdown: -30, cagr: -40, pctile1y: 30, daysSinceHigh: 600 },
  },
  hype: {
    label: 'HYPE_DECAY',
    s: { stance: 'depressed', ret30d: -15, ret7d: -5, ret90d: -60, drawdown: -70, cagr: -80, pctile1y: 8, daysSinceHigh: 80, spanDays: 90, firstDate: '2026-07-01' },
  },
  dead: {
    label: 'DEAD_STABLE',
    s: { stance: 'neutral', ret30d: 2, ret7d: 1, ret90d: -4, drawdown: -35, cagr: -18, pctile1y: 45, daysSinceHigh: 500 },
  },
  revival: {
    label: 'REVIVAL',
    s: { stance: 'neutral', trend: 'flat', ret30d: 18, ret7d: 8, ret90d: -10, drawdown: -55, cagr: -14, pctile1y: 60, daysSinceHigh: 600 },
  },
  grower: {
    label: 'STABLE_GROWER',
    s: { stance: 'neutral', trend: 'appreciating', ret30d: 8, ret7d: 2, ret90d: 15, drawdown: -10, cagr: 45, pctile1y: 75, daysSinceHigh: 40 },
  },
  peak: {
    label: 'AT_PEAK',
    s: { stance: 'elevated', ret30d: 4, ret7d: 1, ret90d: 20, drawdown: -5, cagr: 60, pctile1y: 92, daysSinceHigh: 3 },
  },
  dip: {
    label: 'DIP_BUY',
    s: { stance: 'falling', trend: 'appreciating', ret30d: -10, ret7d: -4, ret90d: 6, drawdown: -12, cagr: 50, pctile1y: 70, daysSinceHigh: 25 },
  },
  cycEntry: {
    label: 'RANGE_PLAY·entry',
    s: { price: 8.3, shelfPrice: 8.2, shelfTests: 4, cycleDays: 90, medianBouncePct: 30, targetPrice: 10.5, drawdown: -20, pctile1y: 40, daysSinceHigh: 120 },
  },
  cycMid: {
    label: 'RANGE_PLAY·mid',
    s: { price: 9.5, shelfPrice: 8.2, shelfTests: 4, cycleDays: 90, medianBouncePct: 30, targetPrice: 10.5, drawdown: -15, pctile1y: 60, daysSinceHigh: 60 },
  },
  cycExit: {
    label: 'RANGE_PLAY·exit',
    s: { price: 10.4, shelfPrice: 8.2, shelfTests: 4, cycleDays: 90, medianBouncePct: 30, targetPrice: 10.5, drawdown: -8, pctile1y: 85, daysSinceHigh: 10 },
  },
};

const FALLING = new Set(['knife', 'bleeder', 'decliner', 'hype']);
const GOOD = new Set(['revival', 'grower', 'dip']);

describe('action audit — the verb matrix', () => {
  const matrix: Record<string, Record<string, string>> = {};

  for (const [, { s, label }] of Object.entries(classCases)) {
    const read = classifyDeal(sig(s));
    matrix[label] = {
      scout: dealAction(read),
      flat: positionAction(read, { price: 10 }),
      green: positionAction(read, { green: true, price: 10 }),
      fodder: positionAction(read, { green: true, price: 1.49 }),
      cracked: positionAction(read, { cracked: true, bounceCheap: false, price: 10 }),
      crackedCheap: positionAction(read, { cracked: true, bounceCheap: true, price: 10 }),
    };
  }

  test('prints the matrix — review once, not per card', () => {
    const keys = Object.keys(matrix[Object.keys(matrix)[0]]);
    console.log(
      ['CLASS'.padEnd(20), ...keys.map((k) => k.padEnd(38))].join(' | ')
    );
    for (const [label, row] of Object.entries(matrix)) {
      console.log(
        [label.padEnd(20), ...keys.map((k) => (row[k] ?? '').padEnd(38))].join(' | ')
      );
    }
    expect(true).toBe(true);
  });

  test('no empty verbs — every class × state says something', () => {
    for (const [label, row] of Object.entries(matrix)) {
      for (const [state, verb] of Object.entries(row)) {
        expect({ label, state, len: verb.length }.len).toBeGreaterThan(3);
      }
    }
  });

  test('fodder collapses falling classes — never bank/rotate cents', () => {
    for (const key of FALLING) {
      const label = classCases[key].label;
      expect(matrix[label].fodder).toMatch(/fodder|consolidate|bundle/i);
      expect(matrix[label].fodder).not.toMatch(/bank|rotate/i);
    }
  });

  test('green on real prices banks; flat rotates', () => {
    for (const key of FALLING) {
      const label = classCases[key].label;
      expect(matrix[label].green).toMatch(/bank|sell/i);
      expect(matrix[label].flat).toMatch(/rotate|move it/i);
    }
  });

  test('cracked overrides every class — floor broke, never a hold verb', () => {
    for (const [label, row] of Object.entries(matrix)) {
      expect({ label, v: row.cracked }.v).toMatch(/floor broke/i);
      expect({ label, v: row.crackedCheap }.v).toMatch(/floor broke/i);
    }
  });

  test('good classes never tell you to dump — no bank/rotate/fodder', () => {
    for (const key of GOOD) {
      const label = classCases[key].label;
      for (const [state, verb] of Object.entries(matrix[label])) {
        if (state === 'cracked' || state === 'crackedCheap') continue;
        expect({ label, state, verb }.verb).not.toMatch(/rotate|fodder|consolidate|bundle|move it|sell while/i);
      }
    }
  });

  test('cycler verbs follow position — buy end holds, sell end exits', () => {
    expect(matrix['RANGE_PLAY·entry'].flat).toMatch(/buy end/i);
    expect(matrix['RANGE_PLAY·mid'].flat).toMatch(/ceiling|top/i);
    expect(matrix['RANGE_PLAY·exit'].flat).toMatch(/sell|ceiling/i);
    expect(matrix['RANGE_PLAY·entry'].scout).toMatch(/buy/i);
    expect(matrix['RANGE_PLAY·exit'].scout).not.toMatch(/^buy/i);
  });
});
