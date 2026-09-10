export const CONDITION_CODES = ['NM', 'LP', 'MP', 'HP', 'DMG'] as const;

export const CONDITION_LABELS: Record<string, string> = {
  NM: 'Near Mint',
  LP: 'Lightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};
