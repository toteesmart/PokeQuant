import type { DealClassId } from './dealClassify';

// Plain-vendor glosses for every badge in the analysis sheet — what the
// term means and a quick example, not jargon about jargon.

const ACTION_TIPS: Record<string, string> = {
  SELL_NOW:
    "Get out now — the price is actively crashing. Example: a card losing " +
    "~10% a week with no floor in sight.",
  SELL_STRENGTH:
    'Sell into bumps — it\'s fading or topping, not crashing. Take strong ' +
    'offers when they pop up.',
  BUY_HOLD:
    'An entry into a long-term climber — buy it and sit on it.',
  BUY_FLIP:
    'Liquid and moving right now — buy it to resell fast, not to hold.',
  HOLD:
    'Cheap but going nowhere yet — the engine says wait for a better ' +
    'moment.',
  NEUTRAL:
    'No strong read either way — judge it on the deal in front of you.',
  UNRATED:
    'Not enough sales history — trust your own read over the model.',
};

const STANCE_TIPS: Record<string, string> = {
  falling:
    "Price is dropping fast right now — a 'falling knife'. Buying it " +
    'means catching the slide.',
  elevated:
    'Priced near the top of its usual range — the expensive end.',
  elevated_rising:
    'At the top of its range and still climbing — strong, but late ' +
    'to buy.',
  depressed:
    'Priced below its usual range — historically cheap right now.',
  neutral:
    'Mid-range vs its own history — nothing extreme either way.',
  insufficient_data:
    'Too little history for the engine to take a stance.',
};

const CONF_TIPS: Record<string, string> = {
  high: 'Lots of sales history behind this read — trust it.',
  medium:
    "Some history — the direction's probably right, but the exact " +
    'numbers can wobble.',
  low: 'Thin history — treat the read as a hint, not a fact.',
};

const CLASS_TIPS: Record<DealClassId, string> = {
  DIP_BUY:
    'A dip inside an uptrend — the long trend is still up, so the dip ' +
    'is likely temporary.',
  FREE_FALL:
    'Actively crashing — double-digit monthly losses and still ' +
    'sliding. Example: down 24% in 30 days.',
  AT_PEAK:
    'Near the top of its own range — it can keep running, but the ' +
    'easy gains are behind it.',
  STABLE_GROWER:
    'Steady climber — appreciates a few percent a month without ' +
    'spikes. The safest kind of stock.',
  DECLINER:
    'Slow long-term bleed — drifts down year over year. It sells ' +
    'fine, but holding it depreciates.',
  DEAD_STABLE:
    "Stable because it's spent — had its run and went flat. It'll " +
    "sell at rate but won't grow.",
  STABLE_FLAT:
    'Flat and alive — no real momentum in either direction.',
  DORMANT:
    'Cheap vs its own history and holding flat — a wait-and-see card.',
  LOW_DATA:
    'Not enough sales history for a reliable read — trust your ' +
    'sticker over the model.',
};

const RISK_TIPS: Record<string, string> = {
  good: 'The read favors picking it up — appreciating or dip-priced.',
  neutral: 'No edge and no danger — workable at the standard rate.',
  risky:
    'The read says danger — falling or long-declining. Shield your ' +
    'offers hard.',
};

export function explainAction(action?: string | null): string {
  return ACTION_TIPS[action ?? ''] ?? ACTION_TIPS.NEUTRAL;
}

export function explainStance(stance?: string | null): string {
  return (
    STANCE_TIPS[stance ?? ''] ??
    "The engine couldn't take a stance on this card."
  );
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

export function explainRisk(risk: string): string {
  return RISK_TIPS[risk] ?? RISK_TIPS.neutral;
}
