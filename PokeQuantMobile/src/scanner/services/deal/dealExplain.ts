import type { DealClassId } from './dealClassify';

// Plain-vendor glosses for every badge in the analysis sheet — what the
// term means and a quick example, not jargon about jargon.

const CONF_TIPS: Record<string, string> = {
  high: 'Lots of sales history behind this read — trust it.',
  medium: "Some history — the direction's probably right, but the exact " + 'numbers can wobble.',
  low: 'Thin history — treat the read as a hint, not a fact.',
};

const CLASS_TIPS: Record<DealClassId, string> = {
  HYPE_DECAY:
    'A new card still coming off release hype — the slide is normal ' +
    'for a launch window. Buy where it lands, not where it debuted.',
  POST_SPIKE_BLEED:
    'Spiked a while back and still drifting down off the top — the ' +
    "spike price is gone. Pay for where it's heading.",
  REVIVAL:
    'Quiet or flat for a long stretch, now ticking up — early signs ' +
    'of a second run. This is the pickup-before-it-runs signal.',
  BASE_FORMING:
    'Fell, then stopped — buyers are holding a floor. It can sit ' +
    'here or wake up; watch for the first uptick.',
  DIP_BUY:
    'A dip inside an uptrend — the long trend is still up, so the dip ' + 'is likely temporary.',
  FREE_FALL:
    'Actively crashing — double-digit monthly losses and still ' +
    'sliding. Example: down 24% in 30 days.',
  AT_PEAK:
    'Near the top of its own range — it can keep running, but the ' + 'easy gains are behind it.',
  STABLE_GROWER:
    'Steady climber — appreciates a few percent a month without ' +
    'spikes. The safest kind of stock.',
  DECLINER:
    'Slow long-term bleed — drifts down year over year. It sells ' +
    'fine, but holding it depreciates.',
  DEAD_STABLE:
    "Stable because it's spent — had its run and went flat. It'll " +
    "sell at rate but won't grow.",
  STABLE_FLAT: 'Flat and alive — no real moves in either direction.',
  DORMANT: 'Cheap vs its own history and holding flat — a wait-and-see card.',
  RANGE_PLAY:
    'Bounces off the same floor up to the same ceiling on a rhythm — ' +
    'buy at the floor, sell the pop back, repeat.',
  LOW_DATA:
    'Not enough sales history for a reliable read — trust your ' +
    'sticker over the price analysis.',
};

// Display names for the stamped stance — the raw vocabulary ("neutral",
// "elevated_rising") is engine jargon; these read plain on a badge.
const STANCE_LABELS: Record<string, string> = {
  falling: 'falling',
  elevated: 'priced high',
  elevated_rising: 'high & rising',
  depressed: 'priced low',
  neutral: 'mid-range',
  insufficient_data: 'low data',
};

// Archetype chip vocabulary — deterministic lifecycle labels stamped
// pipeline-side. 'neutral' is the default and gets no chip. The gloss
// describes the SHAPE only — a flat card can still be compounding, so
// the money judgment belongs to the verdict, not the archetype.
const ARCHETYPE_LABELS: Record<string, string> = {
  compounder: 'Steady riser',
  boom_bust: 'Boom-bust',
  one_spike: 'One-spike',
  flatline: 'Flat',
  bleeder: 'Slow bleeder',
  young: 'Young card',
};
const ARCHETYPE_GLOSS: Record<string, string> = {
  compounder: 'Long-term steady climber — dips have historically been buyable.',
  boom_bust: 'Spike-and-cool-off cycles — where it sits in the cycle matters more than the trend.',
  one_spike: 'Had one big run and never repeated it — treat rallies as exits, not a comeback.',
  flatline: 'Price has been pinned in a tight range — stable, no big moves either way.',
  bleeder: 'Slow long-term slide — floors have kept failing on this card.',
  young: 'Short price history — pattern reads are thin by nature.',
};

export function archetypeLabel(archetype: string): string {
  return ARCHETYPE_LABELS[archetype] ?? archetype;
}

export function explainArchetype(archetype: string): string {
  return ARCHETYPE_GLOSS[archetype] ?? 'How this card has historically behaved.';
}

export function stanceLabel(stance?: string | null): string {
  return STANCE_LABELS[stance ?? ''] ?? 'no read';
}

export function explainConfidence(confidence?: string | null): string {
  return (
    CONF_TIPS[(confidence ?? '').toLowerCase()] ??
    'How much history backs this read — more is better.'
  );
}

export function explainClass(cls: DealClassId): string {
  return CLASS_TIPS[cls];
}
