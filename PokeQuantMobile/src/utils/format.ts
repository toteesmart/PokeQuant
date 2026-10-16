import { colors } from '../constants/colors';

export function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatSignedCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export function confLabel(confidence?: string | null): string {
  const c = (confidence ?? '').toLowerCase();
  return c === 'high' ? 'solid data' : c === 'medium' ? 'decent data' : 'thin data';
}

export function confTint(confidence?: string | null): string {
  const c = (confidence ?? '').toLowerCase();
  if (c === 'high') return colors.velocityPositive;
  if (c === 'medium') return colors.warning;
  return colors.textMuted;
}

/** Money the way a vendor reads it — cents under $10, whole dollars
 *  above. +$0.40 on a $6 card isn't green, it's the same sticker. */
export function fmtDollars(v: number): string {
  return Math.abs(v) < 10 ? Math.abs(v).toFixed(2) : String(Math.round(Math.abs(v)));
}

export function fmtShort(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/** Table-money — vendors deal in whole dollars, so anything that isn't
 *  the raw live market price renders rounded. */
export function tableMoney(n: number): string {
  return `$${Math.round(n)}`;
}

/** tcgcsv price capture began ~Feb 2024 — the ONE owner of the
 *  collection floor; the deal classifier's isYoung and the sheet's
 *  releaseLabel both read it (a first observed price before the floor
 *  means the card predates the dataset). */
export const COLLECTION_FLOOR = '2024-04-01';

export function releaseLabel(firstDate: string, spanDays: number | null): string {
  const span = spanDays != null ? ` · tracked ${spanDays} days` : '';
  if (firstDate > COLLECTION_FLOOR) {
    return `Released ~${fmtShort(firstDate)}${span}`;
  }
  return `Tracked since ${fmtShort(firstDate)}${span}`;
}

export function heldDays(since?: string): number | null {
  if (!since) return null;
  const t = new Date(since).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

export function heldLabel(days: number): string {
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} yrs`;
}
