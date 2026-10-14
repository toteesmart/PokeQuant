import { colors } from '../constants/colors';

/** Translucent badge/pill background derived from a hex foreground —
 *  `${fg}26` ≈ 15% alpha. Non-hex input falls back to the neutral
 *  overlay tint. Shared so every tinted surface uses one rule. */
export function tintBg(fg: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(fg) ? `${fg}26` : colors.overlay3;
}
