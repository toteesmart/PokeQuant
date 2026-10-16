// Numeric text-input helpers for settings-style forms — parse/validate
// free text into bounded numbers, and repair min/max pairs so a tier
// range can never invert.

const DOLLAR_INPUT_RE = /^\d*\.?\d*$/;
const PERCENT_INPUT_RE = /^\d*\.?\d*$/;

export function parseDollar(text: string): number | null {
  const raw = text.trim();
  if (raw === '' || raw === '.') return null;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v) || v < 0) return null;
  return Number(v.toFixed(2));
}

export function parsePercent(text: string): number | null {
  const raw = text.trim();
  if (raw === '' || raw === '.') return null;
  const v = Number.parseFloat(raw);
  if (Number.isNaN(v) || v < 0 || v > 100) return null;
  return v;
}

export function sanitizeMinMax(
  min: number,
  max: number,
  changed: 'min' | 'max',
): { min: number; max: number } {
  const round2 = (n: number) => Number(n.toFixed(2));
  min = Math.max(0, round2(min));
  max = Math.max(0, round2(max));

  if (min >= max) {
    if (changed === 'min') {
      max = round2(min + 0.01);
    } else {
      min = round2(max - 0.01);
      if (min < 0) {
        min = 0;
        max = 0.01;
      }
    }
  }

  return { min, max };
}

export function isDollarTextValid(text: string): boolean {
  if (text === '') return true;
  if (!DOLLAR_INPUT_RE.test(text) || text === '.') return false;
  const v = Number.parseFloat(text);
  return !Number.isNaN(v) && v >= 0;
}

export function isPercentTextValid(text: string): boolean {
  if (text === '') return true;
  if (!PERCENT_INPUT_RE.test(text) || text === '.') return false;
  const v = Number.parseFloat(text);
  return !Number.isNaN(v) && v >= 0 && v <= 100;
}

export function clampPercent(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}
