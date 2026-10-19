// queue-contract — pure check logic for tools/check-queue-contract.mjs,
// split out so the runner stays thin and the jest suite can pin the
// rules through a subprocess import (same shape as dead-normalize.mjs).
//
// The WORK_QUEUE session contract: every commit in the push range that
// touches a gated surface must carry `(item N)` — or the explicit escape
// `(no queue item)` — and when it names an item, that item's
// `## [ ] N.` heading must flip to `## [x] N.` inside the same commit's
// WORK_QUEUE.md diff.
//
// Gated surfaces mirror the queue's reviewer-gate tier (anything the
// tiered policy calls "required"): PokeQuantMobile/src/**, root-level
// worker*.js, and worker_show_vendor/** — the vendored implementation
// worker_show_vendor.js re-exports is the same gated worker surface
// (brief's `worker*.js` read as shorthand, the same reading the
// tools/hooks/pre-push path filter applies).

export const QUEUE_FILE = 'PokeQuantMobile/.devin/WORK_QUEUE.md';

const ITEM_REF_RE = /\(item (\d+)\)/g;
const ESCAPE_RE = /\(no queue item\)/;
// `## [ ] 52.` / `## [x] 52.` heading lines inside a unified diff (the
// sign is the diff marker, not part of the line). `+++`/`---` file
// headers can't match — `#` never follows their sign.
const HEADING_RE = /^([+-])#{1,6} \[([ xX])\] (\d+)\./;

export const isGatedPath = (path) =>
  path.startsWith('PokeQuantMobile/src/') ||
  path.startsWith('worker_show_vendor/') ||
  /^worker[^/]*\.js$/.test(path);

// Unique item ids named by `(item N)` markers, in order of appearance.
export const parseItemRefs = (message) => {
  const items = new Set();
  for (const m of (message || '').matchAll(ITEM_REF_RE)) items.add(Number(m[1]));
  return items;
};

// Item ids whose heading flips `## [ ] N.` → `## [x] N.` within this
// unified diff. Both sides must appear: a `+## [x] N.` without the `-## [ ]`
// is a new already-checked heading, not a box check.
export const flippedItemIds = (diff) => {
  const unchecked = new Set();
  const checked = new Set();
  for (const line of (diff || '').split('\n')) {
    const m = line.match(HEADING_RE);
    if (!m) continue;
    if (m[1] === '-' && m[2] === ' ') unchecked.add(Number(m[3]));
    else if (m[1] === '+' && m[2] !== ' ') checked.add(Number(m[3]));
  }
  return new Set([...unchecked].filter((n) => checked.has(n)));
};

// commit = { files: string[], message: string, queueDiff: string }
// Returns [{ rule, message }] — empty when the commit touches no gated
// path (ungated commits carry no queue-contract obligations) or the
// contract is satisfied.
export const checkCommit = ({ files = [], message = '', queueDiff = '' }) => {
  const gated = files.filter(isGatedPath);
  if (!gated.length) return [];
  if (ESCAPE_RE.test(message)) return [];
  const items = parseItemRefs(message);
  if (!items.size) {
    return [
      {
        rule: 'missing-item-ref',
        message:
          `touches gated path(s) [${gated.join(', ')}] but the commit message ` +
          `carries no '(item N)' ref and no '(no queue item)' escape`,
      },
    ];
  }
  const flipped = flippedItemIds(queueDiff);
  if ([...items].some((n) => flipped.has(n))) return [];
  return [
    {
      rule: 'box-not-flipped',
      message:
        `names ${[...items].map((n) => `(item ${n})`).join(', ')} but the ` +
        `${QUEUE_FILE} diff flips none of them [ ] → [x]`,
    },
  ];
};
