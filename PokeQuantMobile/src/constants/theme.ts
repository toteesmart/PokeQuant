// Design tokens for Card Cache. Values formalize the de-facto scales
// already in the app — see docs/design/UI_PRINCIPLES.md. check-ui-tokens.mjs
// enforces these: new literal values outside these scales fail lint:ui.

export const spacing = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  '2xl': 12,
  '3xl': 14,
  '4xl': 16,
  '5xl': 20,
  '6xl': 24,
  '8xl': 32,
  '10xl': 40,
  '12xl': 48,
} as const;

// Semantic spacing — prefer these for the jobs they name.
export const layout = {
  screenPadding: 16,
  screenTop: 12,
  screenBottom: 8,
  cardPadding: 12,
  sheetPadding: 16,
  gridGap: 12,
  rowGap: 10,
} as const;

export const type_ = {
  micro: 9,
  caption: 10,
  meta: 11,
  label: 12,
  body: 13,
  bodyLarge: 14,
  cardTitle: 15,
  title: 16,
  screenTitle: 18,
  display: 24,
} as const;

export const weight = {
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const radius = {
  badge: 4,
  thumb: 6,
  control: 8,
  controlLg: 10,
  card: 12,
  cardLg: 16,
  sheet: 20,
  pill: 999,
} as const;

export const controls = {
  chipHeight: 28,
  inputHeight: 44,
  buttonHeight: 46,
  minTouchTarget: 44,
} as const;

// Pokemon card proportions — one source of truth (was copy-pasted 4×).
export const CARD_ASPECT_WIDTH = 2.5;
export const CARD_ASPECT_HEIGHT = 3.5;
export const CARD_ASPECT_RATIO = CARD_ASPECT_WIDTH / CARD_ASPECT_HEIGHT;
